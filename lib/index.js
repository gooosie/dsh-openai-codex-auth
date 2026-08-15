// dsh-openai-codex-auth — Host half.
//
// Lets an eligible ChatGPT subscriber use their account inside DeepSeek Harness
// through OpenAI's Codex OAuth flow. pi-ai ships the flow and Codex wire adapter;
// this plugin drives login and owns a dedicated DSH LLM route.
//
// Responsibilities:
//   - register the `openai-codex-auth` settings namespace as the login-status
//     channel the Models-settings client card reads and writes (`action` field).
//   - run pi-ai's device-code login in a background task and persist the OAuth
//     credential (JSON) under `PI_OAUTH_OPENAI_CODEX`.
//   - register an `openai-codex` PiAiAdapter route directly. The adapter resolves
//     the stored access token for every request and refreshes it before expiry,
//     so this package does not patch `dsh-llm-pi-ai`.
//   - expose codex_login / codex_status / codex_logout tools so an agent can
//     start, check (and silently refresh), or clear the local login from chat.
//
// The Web settings gateway still needs to expose this plugin's settings
// namespace; see `install.mjs` and the README for upgrade notes.

import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { INVALID_CREDENTIAL_CODE, LlmError, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import z from "@deepseek-ai/schemastery";
import { installSettingsSection, settingsNamespace } from "@deepseek-ai/dsh-settings";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createCodexProvider, DEFAULT_CODEX_REASONING_LEVEL } from "./provider.js";
import { ensureCodexFetchProxy } from "./proxy.js";
import { requestCodexUsage } from "./usage.js";

const name = "openai-codex-auth";
const inject = ["llm", "settings", "credentials", "tools"];

/** Provider route key registered into `llm-pi-ai`. */
const PROVIDER = "openai-codex";
/** Settings namespace serving as the login-status channel. */
const NS = settingsNamespace("openai-codex-auth");
/**
 * Credential reference holding the OAuth credential JSON. This is a reference,
 * not a secret embedded in settings; the value stays in DSH's credential store.
 */
const OAUTH_REF = credentialRef("PI_OAUTH_OPENAI_CODEX");
/** How long a codex_login tool call waits for the device code to be issued. */
const DEVICE_CODE_TIMEOUT_MS = 30000;
/** Refresh early so a token cannot expire while a request is being assembled. */
const REFRESH_LEEWAY_MS = 60000;
/** Default PiAiAdapter stream watchdog, matching dsh-llm-pi-ai. */
const STREAM_IDLE_TIMEOUT_MS = 300000;
/** Avoid repeatedly calling the best-effort ChatGPT usage endpoint. */
const USAGE_CACHE_MS = 60000;
const LOG_PREFIX = "openai-codex-auth";

/** Reuse pi-ai's provider-owned OAuth implementation with a focused catalog. */
const PI_PROVIDER = createCodexProvider();
const CODEX_OAUTH = PI_PROVIDER.auth.oauth;
if (CODEX_OAUTH === void 0) throw new Error("pi-ai OpenAI Codex provider does not expose OAuth");

const CODEX_PROFILE = Object.freeze({
	provider: PROVIDER,
	displayName: "OpenAI Codex",
	reasoning: DEFAULT_CODEX_REASONING_LEVEL,
	streamIdleTimeoutMs: STREAM_IDLE_TIMEOUT_MS,
	retryPolicy: resolveRetryPolicy(void 0, "openai-codex-auth.retryPolicy"),
	piProvider: PI_PROVIDER,
	configuredMaxTokens: new Map()
});
const CODEX_PROFILES = new Map([[PROVIDER, CODEX_PROFILE]]);

const UsageLimit = z.object({
	name: z.string().default(""),
	usedPercent: z.number().default(0),
	windowSeconds: z.number().default(0),
	resetAt: z.number().default(0)
});

/** Status namespace schema: every field the host writes and the card reads. */
const LoginStatus = z.object({
	action: z.string().default(""),
	status: z.string().default("idle"),
	deviceCode: z.string().default(""),
	verificationUri: z.string().default(""),
	expiresAt: z.number().default(0),
	error: z.string().default(""),
	usageStatus: z.string().default("idle"),
	usageLimits: z.array(UsageLimit).default([]),
	usageCredits: z.string().default(""),
	usageCreditsUnlimited: z.boolean().default(false),
	usageUpdatedAt: z.number().default(0),
	usageError: z.string().default("")
});

function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}

function textBlock(value) {
	return [{ type: "text", text: value }];
}

function trustedVerificationUri(value) {
	if (typeof value !== "string" || value.length === 0) {
		throw new Error("OpenAI device-code response did not include a verification URL");
	}
	let url;
	try {
		url = new URL(value);
	} catch {
		throw new Error("OpenAI device-code response included an invalid verification URL");
	}
	if (url.protocol !== "https:" || url.hostname !== "auth.openai.com") {
		throw new Error("OpenAI device-code response included an untrusted verification URL");
	}
	return url.toString();
}

/** Refresh through pi-ai so endpoint and client details stay provider-owned. */
async function refreshCredential(credential) {
	return CODEX_OAUTH.refresh(credential);
}

function apply(ctx, config) {
	/** Latest resolved value of the status namespace. */
	let readSection = () => ({});
	/** The in-flight login flow, if any. */
	let activeFlow = null;
	/** Monotonic identity preventing an aborted older flow from overwriting a newer one. */
	let flowGeneration = 0;
	/** One refresh at a time because OpenAI refresh tokens may rotate. */
	let refreshInFlight = null;
	/** Deduplicate the optional Codex usage request. */
	let usageInFlight = null;
	/** Prevent an older account's usage response from surviving logout/re-login. */
	let usageGeneration = 0;
	/** Invalidates refresh/login writes that race with logout or replacement. */
	let credentialRevision = 0;
	/** Serialize credential writes so a completed logout is always final. */
	let credentialMutationTail = Promise.resolve();
	/** Suppress duplicate recovery writes while clearing a stale device flow. */
	let recoveringStaleState = false;

	const writeStatus = async (patch) => {
		try {
			await ctx.settings.mutate(NS, Object.entries(patch).map(([key, value]) => ({
				op: "set",
				path: [key],
				value
			})));
		} catch (error) {
			ctx.logger.warn(`${LOG_PREFIX}: status write failed`);
			ctx.logger.warn(error);
		}
	};
	const clearTransient = async () => {
		try {
			await ctx.settings.mutate(NS, [
				{ op: "unset", path: ["deviceCode"] },
				{ op: "unset", path: ["verificationUri"] },
				{ op: "unset", path: ["error"] }
			]);
		} catch (error) {
			ctx.logger.warn(`${LOG_PREFIX}: transient status clear failed`);
			ctx.logger.warn(error);
		}
	};
	const clearAction = async () => {
		try {
			await ctx.settings.mutate(NS, [{ op: "unset", path: ["action"] }]);
		} catch (error) {
			ctx.logger.warn(`${LOG_PREFIX}: action clear failed`);
			ctx.logger.warn(error);
		}
	};
	const clearUsage = () => {
		usageGeneration++;
		return writeStatus({
			usageStatus: "idle",
			usageLimits: [],
			usageCredits: "",
			usageCreditsUnlimited: false,
			usageUpdatedAt: 0,
			usageError: ""
		});
	};

	const readCredential = async () => {
		const credentials = ctx.get("credentials");
		if (credentials === void 0) return void 0;
		const hit = await credentials.resolve(OAUTH_REF);
		if (hit === void 0) return void 0;
		try {
			const parsed = JSON.parse(hit.value);
			if (
				parsed?.type !== "oauth" ||
				typeof parsed.access !== "string" || parsed.access.length === 0 ||
				typeof parsed.refresh !== "string" || parsed.refresh.length === 0 ||
				typeof parsed.expires !== "number" || !Number.isFinite(parsed.expires) ||
				typeof parsed.accountId !== "string" || parsed.accountId.length === 0
			) return void 0;
			return parsed;
		} catch {
			return void 0;
		}
	};

	const mutateCredential = (operation) => {
		const result = credentialMutationTail.catch(() => {}).then(operation);
		credentialMutationTail = result.catch(() => {});
		return result;
	};
	const storeCredential = (credential, isCurrent = () => true) => {
		return mutateCredential(async () => {
			if (!isCurrent()) return false;
			const credentials = ctx.get("credentials");
			if (credentials === void 0) throw new Error("credentials service unavailable");
			await credentials.set(OAUTH_REF, JSON.stringify(credential));
			return true;
		});
	};
	const clearCredential = () => {
		return mutateCredential(async () => {
			const credentials = ctx.get("credentials");
			if (credentials === void 0) throw new Error("credentials service unavailable");
			await credentials.unset(OAUTH_REF);
		});
	};

	const validCredential = async () => {
		const credential = await readCredential();
		if (credential === void 0) return void 0;
		if (Date.now() + REFRESH_LEEWAY_MS < credential.expires) return credential;
		if (refreshInFlight === null) {
			const revision = credentialRevision;
			refreshInFlight = (async () => {
				const refreshed = await refreshCredential(credential);
				if (revision !== credentialRevision) throw new Error("credential changed while token refresh was in flight");
				const stored = await storeCredential(refreshed, () => revision === credentialRevision);
				if (!stored || revision !== credentialRevision) throw new Error("credential changed while token refresh was being stored");
				await writeStatus({
					status: "done",
					expiresAt: refreshed.expires,
					error: ""
				});
				return refreshed;
			})().finally(() => {
				refreshInFlight = null;
			});
		}
		return refreshInFlight;
	};

	/**
	 * Refresh the optional usage summary without making authentication or model
	 * availability depend on ChatGPT's private usage endpoint.
	 */
	const refreshUsage = ({ force = false } = {}) => {
		const generation = usageGeneration;
		if (usageInFlight?.generation === generation) return usageInFlight.promise;
		const section = readSection();
		const updatedAt = section["usageUpdatedAt"];
		if (
			!force && section["usageStatus"] === "ready" &&
			typeof updatedAt === "number" && Date.now() - updatedAt < USAGE_CACHE_MS
		) return Promise.resolve();
		let entry;
		const promise = (async () => {
			const credential = await validCredential();
			if (credential === void 0) throw new Error("OpenAI Codex is not signed in");
			if (generation !== usageGeneration) return;
			await writeStatus({ usageStatus: "loading", usageError: "" });
			const usage = await requestCodexUsage(credential);
			if (generation !== usageGeneration) return;
			await writeStatus({
				usageStatus: "ready",
				usageLimits: usage.limits,
				usageCredits: usage.credits.hasCredits ? usage.credits.balance : "",
				usageCreditsUnlimited: usage.credits.unlimited,
				usageUpdatedAt: Date.now(),
				usageError: ""
			});
		})().catch(async (error) => {
			if (generation === usageGeneration) {
				await writeStatus({
					usageStatus: "error",
					usageUpdatedAt: Date.now(),
					usageError: messageOf(error)
				});
			}
			throw error;
		}).finally(() => {
			if (usageInFlight === entry) usageInFlight = null;
		});
		entry = { generation, promise };
		usageInFlight = entry;
		return promise;
	};

	const adapter = new PiAiAdapter({
		profiles: () => CODEX_PROFILES,
		resolveApiKey: async () => {
			await ensureCodexFetchProxy();
			const credential = await validCredential();
			if (credential === void 0) {
				throw new LlmError(
					"OpenAI Codex is not signed in. Open Settings → OpenAI Codex and sign in first.",
					INVALID_CREDENTIAL_CODE
				);
			}
			return credential.access;
		},
		resolveAttachments: () => ctx.get("attachments")
	});
	ctx.llm.registerAdapter([PROVIDER], adapter);

	/**
	 * Start the device-code login. Resolves with the device code + verification
	 * URL once OpenAI issues them (the user can then authorize); the flow keeps
	 * running in the background and persists the credential on completion.
	 * @returns a promise of the device-code state.
	 */
	const startLoginFlow = () => {
		if (activeFlow !== null) activeFlow.controller.abort("a new login was requested");
		const generation = ++flowGeneration;
		const controller = new AbortController();
		let settleDevice;
		const device = new Promise((resolve, reject) => {
			settleDevice = { resolve, reject };
		});
		const flow = (async () => {
			try {
				await clearUsage();
				await clearTransient();
				await writeStatus({ status: "starting" });
				const interaction = {
					signal: controller.signal,
					notify: (info) => {
						if (info?.type === "device_code") {
							const state = {
								deviceCode: info.userCode,
								verificationUri: trustedVerificationUri(info.verificationUri)
							};
							settleDevice.resolve(state);
							void writeStatus({
								status: "waiting",
								deviceCode: state.deviceCode,
								verificationUri: state.verificationUri
							});
						}
					},
					prompt: async (request) => {
						if (request?.type === "select") return "device_code";
						throw new Error(`${LOG_PREFIX}: unexpected OAuth prompt`);
					}
				};
				const credential = await CODEX_OAUTH.login(interaction);
				if (generation !== flowGeneration || controller.signal.aborted) {
					throw new Error("login cancelled");
				}
				const revision = ++credentialRevision;
				const stored = await storeCredential(credential, () => {
					return generation === flowGeneration && revision === credentialRevision && !controller.signal.aborted;
				});
				if (!stored || generation !== flowGeneration || revision !== credentialRevision || controller.signal.aborted) {
					throw new Error("login cancelled while credentials were being stored");
				}
				await writeStatus({
					status: "done",
					expiresAt: credential.expires
				});
				await clearTransient();
				void refreshUsage({ force: true }).catch(() => {});
			} catch (error) {
				settleDevice.reject(error instanceof Error ? error : new Error(messageOf(error)));
				if (generation !== flowGeneration) return;
				if (controller.signal.aborted) {
					await clearTransient();
					await writeStatus({ status: "idle" });
				} else {
					await writeStatus({ status: "error", error: messageOf(error) });
				}
			} finally {
				if (activeFlow?.generation === generation) activeFlow = null;
			}
		})();
		activeFlow = { controller, done: flow, generation };
		return device;
	};

	const logout = async () => {
		flowGeneration++;
		credentialRevision++;
		if (activeFlow !== null) activeFlow.controller.abort("logout requested");
		await clearCredential();
		await clearTransient();
		await clearUsage();
		try {
			await ctx.settings.mutate(NS, [
				{ op: "unset", path: ["status"] },
				{ op: "unset", path: ["expiresAt"] }
			]);
		} catch (error) {
			ctx.logger.warn(`${LOG_PREFIX}: status reset failed`);
			ctx.logger.warn(error);
		}
		await writeStatus({ status: "idle" });
	};

	/** React to the client card's `action` writes. */
	const onSectionChange = () => {
		const section = readSection();
		const action = section["action"];
		if (action === "login") {
			void clearAction().then(() => {
				// The client observes failures through status; consume the challenge
				// promise here so an early network failure is never unhandled.
				void startLoginFlow().catch(() => {});
			});
		} else if (action === "logout") {
			void clearAction().then(() => {
				void logout().catch((error) => {
					void writeStatus({ status: "error", error: `Logout failed: ${messageOf(error)}` });
				});
			});
		} else if (action === "refresh_usage") {
			void clearAction().then(() => {
				void refreshUsage({ force: true }).catch(() => {});
			});
		} else if (!recoveringStaleState && activeFlow === null && (section["status"] === "starting" || section["status"] === "waiting")) {
			// Device codes are process-bound. A persisted in-flight state after a
			// crash/restart is stale and must not leave the card polling forever.
			recoveringStaleState = true;
			void clearTransient()
				.then(() => writeStatus({ status: "idle" }))
				.finally(() => {
					recoveringStaleState = false;
				});
		}
	};

	installSettingsSection(ctx, NS, LoginStatus, config, {
		setSource: (source) => {
			readSection = source;
		},
		onChange: onSectionChange
	});

	ctx.effect(() => () => {
		flowGeneration++;
		credentialRevision++;
		if (activeFlow !== null) activeFlow.controller.abort("plugin disposed");
	}, "openai-codex-auth: abort in-flight login on dispose");

	ctx.tools.register(defineTool({
		name: "codex_login",
		description: "Start an OpenAI Codex OAuth device-code login with the user's eligible ChatGPT subscription, so the harness can use Codex models without an OpenAI API key. Returns a device code and a verification URL that you must show to the user; after the user opens the URL and enters the code, call codex_status to confirm the login completed.",
		parameters: {},
		output: {
			schema: { type: "string" },
			render: (_args, value) => textBlock(value)
		},
		async execute() {
			const device = startLoginFlow();
			let state;
			let timeoutId;
			try {
				const timeout = new Promise((_resolve, reject) => {
					timeoutId = setTimeout(() => reject(new Error("timed out waiting for the device code from OpenAI")), DEVICE_CODE_TIMEOUT_MS);
				});
				state = await Promise.race([device, timeout]);
			} catch (error) {
				return `登录未能开始：${messageOf(error)}`;
			} finally {
				if (timeoutId !== void 0) clearTimeout(timeoutId);
			}
			return [
				"已开始使用 ChatGPT 账号登录 OpenAI Codex。",
				`设备码：${state.deviceCode}`,
				`验证网址：${state.verificationUri}`,
				"请让用户打开验证网址并输入设备码完成授权。授权完成后调用 codex_status 确认结果。"
			].join("\n");
		}
	}));

	ctx.tools.register(defineTool({
		name: "codex_status",
		description: "Report the current OpenAI Codex (ChatGPT account) login state. If a stored token is expired it is silently refreshed first. Returns whether the user is logged in and the token expiry; or the in-progress device-code state; or a failure from the last login attempt.",
		parameters: {},
		output: {
			schema: { type: "string" },
			render: (_args, value) => textBlock(value)
		},
		async execute() {
			let credential;
			try {
				credential = await validCredential();
			} catch (error) {
				return `令牌刷新失败（${messageOf(error)}）。请调用 codex_login 重新登录。`;
			}
			if (credential === void 0) {
				const section = readSection();
				const status = section["status"];
				if (status === "waiting" || status === "starting") {
					return [
						"登录正在进行中。",
						`设备码：${section["deviceCode"] ?? "(尚未取得)"}`,
						`验证网址：${section["verificationUri"] ?? "(尚未取得)"}`,
						"请让用户完成授权后再查一次。"
					].join("\n");
				}
				if (status === "error") return `上次登录失败：${section["error"] ?? "未知错误"}`;
				return "尚未登录。调用 codex_login 开始 ChatGPT 账号登录。";
			}
			return [
				"已登录 ChatGPT。",
				`令牌有效期至 ${new Date(credential.expires).toLocaleString()}，过期后会自动刷新。`
			].join("\n");
		}
	}));

	ctx.tools.register(defineTool({
		name: "codex_logout",
		description: "Sign out of OpenAI Codex in DSH by clearing the stored ChatGPT OAuth credential. The model route remains available and asks for login on its next unauthenticated request.",
		parameters: {},
		output: {
			schema: { type: "string" },
			render: (_args, value) => textBlock(value)
		},
		async execute() {
			try {
				await logout();
				return "已退出 ChatGPT 登录。";
			} catch (error) {
				return `退出登录失败：${messageOf(error)}`;
			}
		}
	}));
}

export { apply, inject, name };
