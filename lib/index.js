// dsh-openai-codex-auth — Host plugin.
//
// The plugin owns the OpenAI Codex OAuth lifecycle, a dedicated DSH LLM route,
// and a small Typed Remote surface for its Web settings card. OAuth credentials
// stay in DSH's credential store; only sanitized login and usage state crosses
// the Remote boundary.

import { PiAiAdapter } from "@deepseek-ai/dsh-llm-pi-ai";
import { INVALID_CREDENTIAL_CODE, LlmError, resolveRetryPolicy } from "@deepseek-ai/dsh-llm";
import { credentialRef } from "@deepseek-ai/dsh-credentials";
import { defineTool } from "@deepseek-ai/dsh-tools";
import { createCodexProvider, DEFAULT_CODEX_REASONING_LEVEL } from "./provider.js";
import { ensureCodexFetchProxy } from "./proxy.js";
import { OpenAICodexRemoteService } from "./remote-service.js";
import { requestCodexUsage } from "./usage.js";

const name = "openai-codex-auth";
const inject = ["llm", "credentials", "tools"];
const PROVIDER = "openai-codex";
const OAUTH_REF = credentialRef("PI_OAUTH_OPENAI_CODEX");
const DEVICE_CODE_TIMEOUT_MS = 30000;
const REFRESH_LEEWAY_MS = 60000;
const STREAM_IDLE_TIMEOUT_MS = 300000;
const USAGE_CACHE_MS = 60000;
const LOG_PREFIX = "openai-codex-auth";

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

const SAFE_ERROR_MESSAGES = new Set([
	"OpenAI Codex is not signed in",
	"OpenAI device-code response did not include a verification URL",
	"OpenAI device-code response included an invalid verification URL",
	"OpenAI device-code response included an untrusted verification URL"
]);

function safeErrorMessage(value, fallback) {
	const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
	return SAFE_ERROR_MESSAGES.has(message) ? message : fallback;
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

async function refreshCredential(credential) {
	return CODEX_OAUTH.refresh(credential);
}

function configureService(ctx, remoteHandlers) {
	let activeFlow = null;
	let flowGeneration = 0;
	let refreshInFlight = null;
	let usageInFlight = null;
	let usageGeneration = 0;
	let credentialRevision = 0;
	let credentialMutationTail = Promise.resolve();
	const state = {
		status: "idle",
		loggedIn: false,
		deviceCode: "",
		verificationUri: "",
		expiresAt: 0,
		error: "",
		usageStatus: "idle",
		usageLimits: [],
		usageCredits: "",
		usageCreditsUnlimited: false,
		usageUpdatedAt: 0,
		usageError: ""
	};

	const updateState = (patch) => {
		Object.assign(state, patch);
	};
	const clearTransient = () => {
		updateState({ deviceCode: "", verificationUri: "", error: "" });
	};
	const clearUsage = () => {
		usageGeneration++;
		updateState({
			usageStatus: "idle",
			usageLimits: [],
			usageCredits: "",
			usageCreditsUnlimited: false,
			usageUpdatedAt: 0,
			usageError: ""
		});
	};
	const publicSnapshot = () => ({
		status: state.status,
		loggedIn: state.loggedIn,
		deviceCode: state.deviceCode,
		verificationUri: state.verificationUri,
		expiresAt: state.expiresAt,
		error: state.error,
		usageStatus: state.usageStatus,
		usageLimits: state.usageLimits.map((limit) => ({ ...limit })),
		usageCredits: state.usageCredits,
		usageCreditsUnlimited: state.usageCreditsUnlimited,
		usageUpdatedAt: state.usageUpdatedAt,
		usageError: state.usageError
	});

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
				if (!stored || revision !== credentialRevision) {
					throw new Error("credential changed while token refresh was being stored");
				}
				updateState({ loggedIn: true, expiresAt: refreshed.expires });
				return refreshed;
			})().finally(() => {
				refreshInFlight = null;
			});
		}
		return refreshInFlight;
	};

	const refreshUsage = ({ force = false } = {}) => {
		const generation = usageGeneration;
		if (usageInFlight?.generation === generation) return usageInFlight.promise;
		if (
			!force && (state.usageStatus === "ready" || state.usageStatus === "error") &&
			Date.now() - state.usageUpdatedAt < USAGE_CACHE_MS
		) return Promise.resolve();
		updateState({ usageStatus: "loading", usageError: "" });
		let entry;
		const promise = (async () => {
			const credential = await validCredential();
			if (credential === void 0) throw new Error("OpenAI Codex is not signed in");
			if (generation !== usageGeneration) return;
			const usage = await requestCodexUsage(credential);
			if (generation !== usageGeneration) return;
			updateState({
				usageStatus: "ready",
				usageLimits: usage.limits,
				usageCredits: usage.credits.hasCredits ? usage.credits.balance : "",
				usageCreditsUnlimited: usage.credits.unlimited,
				usageUpdatedAt: Date.now(),
				usageError: ""
			});
		})().catch((error) => {
			if (generation === usageGeneration) {
				updateState({
					usageStatus: "error",
					usageUpdatedAt: Date.now(),
					usageError: safeErrorMessage(error, "Unable to load OpenAI Codex usage.")
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

	const getSnapshot = async ({ refreshUsageOnOpen = true } = {}) => {
		let credential;
		try {
			credential = await validCredential();
		} catch (error) {
			if (activeFlow === null) {
				updateState({
					status: "error",
					loggedIn: false,
					error: safeErrorMessage(error, "Unable to refresh OpenAI Codex sign-in.")
				});
			}
			return publicSnapshot();
		}
		if (credential === void 0) {
			updateState({ loggedIn: false, expiresAt: 0 });
			if (activeFlow === null && state.status === "done") updateState({ status: "idle" });
		} else {
			updateState({ loggedIn: true, expiresAt: credential.expires });
			if (activeFlow === null) updateState({ status: "done", error: "" });
			if (refreshUsageOnOpen) void refreshUsage().catch(() => {});
		}
		return publicSnapshot();
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

	const startLoginFlow = () => {
		if (activeFlow !== null) activeFlow.controller.abort("a new login was requested");
		const generation = ++flowGeneration;
		const controller = new AbortController();
		let settleDevice;
		const device = new Promise((resolve, reject) => {
			settleDevice = { resolve, reject };
		});
		clearUsage();
		clearTransient();
		updateState({ status: "starting" });
		const currentFlow = { controller, done: null, generation };
		activeFlow = currentFlow;
		const flow = (async () => {
			try {
				const interaction = {
					signal: controller.signal,
					notify: (info) => {
						if (info?.type !== "device_code") return;
						const challenge = {
							deviceCode: info.userCode,
							verificationUri: trustedVerificationUri(info.verificationUri)
						};
						settleDevice.resolve(challenge);
						updateState({ status: "waiting", ...challenge });
					},
					prompt: async (request) => {
						if (request?.type === "select") return "device_code";
						throw new Error(`${LOG_PREFIX}: unexpected OAuth prompt`);
					}
				};
				const credential = await CODEX_OAUTH.login(interaction);
				if (generation !== flowGeneration || controller.signal.aborted) throw new Error("login cancelled");
				const revision = ++credentialRevision;
				const stored = await storeCredential(credential, () => {
					return generation === flowGeneration && revision === credentialRevision && !controller.signal.aborted;
				});
				if (!stored || generation !== flowGeneration || revision !== credentialRevision || controller.signal.aborted) {
					throw new Error("login cancelled while credentials were being stored");
				}
				clearTransient();
				updateState({ status: "done", loggedIn: true, expiresAt: credential.expires });
				void refreshUsage({ force: true }).catch(() => {});
			} catch (error) {
				const publicMessage = safeErrorMessage(error, "Unable to complete OpenAI Codex sign-in.");
				settleDevice.reject(new Error(publicMessage));
				if (generation !== flowGeneration) return;
				if (controller.signal.aborted) {
					clearTransient();
					updateState({ status: "idle" });
				} else {
					updateState({ status: "error", error: publicMessage });
				}
			} finally {
				if (activeFlow === currentFlow) activeFlow = null;
			}
		})();
		currentFlow.done = flow;
		return device;
	};

	const logout = async () => {
		flowGeneration++;
		credentialRevision++;
		if (activeFlow !== null) activeFlow.controller.abort("logout requested");
		activeFlow = null;
		await clearCredential();
		clearUsage();
		updateState({
			status: "idle",
			loggedIn: false,
			deviceCode: "",
			verificationUri: "",
			expiresAt: 0,
			error: ""
		});
	};

	Object.assign(remoteHandlers, {
		snapshot: () => getSnapshot(),
		startLogin: () => {
			void startLoginFlow().catch(() => {});
			return getSnapshot({ refreshUsageOnOpen: false });
		},
		logout: async () => {
			try {
				await logout();
			} catch {
				throw new Error("Unable to sign out of OpenAI Codex.");
			}
			return getSnapshot({ refreshUsageOnOpen: false });
		}
	});

	ctx.effect(() => () => {
		flowGeneration++;
		credentialRevision++;
		if (activeFlow !== null) activeFlow.controller.abort("plugin disposed");
	}, "openai-codex-auth: abort in-flight login on dispose");

	ctx.tools.register(defineTool({
		name: "codex_login",
		description: "Start an OpenAI Codex OAuth device-code login with the user's eligible ChatGPT subscription. Return the device code and verification URL to the user, then call codex_status after authorization.",
		parameters: {},
		output: {
			schema: { type: "string" },
			render: (_args, value) => textBlock(value)
		},
		async execute() {
			const device = startLoginFlow();
			let challenge;
			let timeoutId;
			try {
				const timeout = new Promise((_resolve, reject) => {
					timeoutId = setTimeout(() => reject(new Error("timed out waiting for the device code from OpenAI")), DEVICE_CODE_TIMEOUT_MS);
				});
				challenge = await Promise.race([device, timeout]);
			} catch (error) {
				return `登录未能开始：${safeErrorMessage(error, "无法启动 OpenAI Codex 登录，请重试。")}`;
			} finally {
				if (timeoutId !== void 0) clearTimeout(timeoutId);
			}
			return [
				"已开始使用 ChatGPT 账号登录 OpenAI Codex。",
				`设备码：${challenge.deviceCode}`,
				`验证网址：${challenge.verificationUri}`,
				"请让用户打开验证网址并输入设备码完成授权。授权完成后调用 codex_status 确认结果。"
			].join("\n");
		}
	}));

	ctx.tools.register(defineTool({
		name: "codex_status",
		description: "Report the current OpenAI Codex ChatGPT login state and silently refresh an expired token when possible.",
		parameters: {},
		output: {
			schema: { type: "string" },
			render: (_args, value) => textBlock(value)
		},
		async execute() {
			const snapshot = await getSnapshot();
			if (!snapshot.loggedIn) {
				if (snapshot.status === "waiting" || snapshot.status === "starting") {
					return [
						"登录正在进行中。",
						`设备码：${snapshot.deviceCode || "(尚未取得)"}`,
						`验证网址：${snapshot.verificationUri || "(尚未取得)"}`,
						"请让用户完成授权后再查一次。"
					].join("\n");
				}
				if (snapshot.status === "error") return `上次登录失败：${snapshot.error || "未知错误"}`;
				return "尚未登录。调用 codex_login 开始 ChatGPT 账号登录。";
			}
			return [
				"已登录 ChatGPT。",
				`令牌有效期至 ${new Date(snapshot.expiresAt).toLocaleString()}，过期后会自动刷新。`
			].join("\n");
		}
	}));

	ctx.tools.register(defineTool({
		name: "codex_logout",
		description: "Sign out of OpenAI Codex in DSH by clearing the locally stored ChatGPT OAuth credential.",
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
				return `退出登录失败：${safeErrorMessage(error, "无法清除本地 OpenAI Codex 凭据，请重试。")}`;
			}
		}
	}));
}

class OpenAICodexAuthService extends OpenAICodexRemoteService {
	static inject = inject;

	constructor(ctx) {
		const remoteHandlers = {};
		super(ctx, remoteHandlers);
		configureService(ctx, remoteHandlers);
	}
}

export { OpenAICodexAuthService, inject, name };
export default OpenAICodexAuthService;
