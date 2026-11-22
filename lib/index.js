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
import { OpenAICodexRemoteService } from "./remote-service.js";
import { requestCodexUsage } from "./usage.js";
import { requestResetCredits, createResetRedeemer } from "./reset-credits.js";
import z from "@deepseek-ai/schemastery";
import { SYSTEM_PROXY_ERROR } from "./system-proxy.js";
import { createProxyManager } from "./proxy-manager.js";
import { toolLocale } from "./tool-locale.js";

const Config = z.object({
	proxyMode: z.union(["host", "system"]).default("host").volatile().description("代理模式 / Proxy mode: host = 跟随 DSH / Follow DSH; system = Windows 手动系统代理 / Windows manual system proxy. PAC is not supported.")
});

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
	// Match DSH pi-ai defaults for the total base64 payload and per-image projections.
	maxRequestImageBytes: 20_971_520,
	requestImagePixelBudget: 4_194_304,
	requestImageMaxBytes: 1_048_576,
	retryPolicy: resolveRetryPolicy(void 0, "openai-codex-auth.retryPolicy"),
	piProvider: PI_PROVIDER,
	modelErrors: new Map(),
	configuredMaxTokens: new Map()
});

const PUBLIC_ERROR_CODES = new Map([
	[SYSTEM_PROXY_ERROR, "proxyUnavailable"],
	["OpenAI Codex is not signed in", "notLoggedIn"],
	["OpenAI device-code response did not include a verification URL", "verificationUrlMissing"],
	["OpenAI device-code response included an invalid verification URL", "verificationUrlInvalid"],
	["OpenAI device-code response included an untrusted verification URL", "verificationUrlUntrusted"]
]);

function safeErrorCode(value, fallback) {
	const message = value instanceof Error ? value.message : value;
	return PUBLIC_ERROR_CODES.get(message) ?? fallback;
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

function configureService(ctx, remoteHandlers, config = {}) {
	const system = (typeof config.proxyMode?.get === "function" ? config.proxyMode.get() : config.proxyMode) === "system";
	const network = createProxyManager(system ? "system" : "host", CODEX_OAUTH);
	const redeemReset = createResetRedeemer();
	const oauth = {
		async login(interaction) {
			const lease = network.acquire();
			try { return await lease.oauth("login", undefined, interaction); } finally { lease.release(); }
		},
		async refresh(credential) {
			const lease = network.acquire();
			try { return await lease.oauth("refresh", credential, {}); } finally { lease.release(); }
		}
	};
	const provider = createCodexProvider(() => {
		const lease = network.acquire();
		return { options: lease.mode === "system" ? { fetch: lease.fetch, transport: "sse" } : {}, release: lease.release };
	});
	const profiles = new Map([[PROVIDER, { ...CODEX_PROFILE, piProvider: provider }]]);
	ctx.effect(() => () => network.dispose(), "openai-codex-auth: dispose isolated proxy transports");
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
		usageLimited: false,
		usageLimits: [],
		usageCredits: "",
		usageCreditsUnlimited: false,
		usageResetCredits: null,
		resetCards: [],
		resetCardsStatus: "idle",
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
			usageLimited: false,
			usageLimits: [],
			usageCredits: "",
			usageCreditsUnlimited: false,
			usageResetCredits: null,
			resetCards: [],
			resetCardsStatus: "idle",
			usageUpdatedAt: 0,
			usageError: ""
		});
	};
	const publicSnapshot = () => ({
		proxyMode: network.mode,
		proxyRestartRequired: false,
		proxyError: network.error ? "proxyUnavailable" : "",
		status: state.status,
		loggedIn: state.loggedIn,
		deviceCode: state.deviceCode,
		verificationUri: state.verificationUri,
		expiresAt: state.expiresAt,
		error: state.error,
		usageStatus: state.usageStatus,
		usageLimited: state.usageLimited,
		usageLimits: state.usageLimits.map((limit) => ({ ...limit })),
		usageCredits: state.usageCredits,
		usageCreditsUnlimited: state.usageCreditsUnlimited,
		usageResetCredits: state.usageResetCredits,
		resetCards: state.resetCards.map((card) => ({ ...card })),
		resetCardsStatus: state.resetCardsStatus,
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
				const refreshed = await oauth.refresh(credential);
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
		updateState({ usageStatus: "loading", usageError: "", resetCardsStatus: "loading" });
		let entry;
		const promise = (async () => {
			const credential = await validCredential();
			if (credential === void 0) throw new Error("OpenAI Codex is not signed in");
			if (generation !== usageGeneration) return;
			const lease = network.acquire();
			let usageResult, cardsResult;
			try {
				[usageResult, cardsResult] = await Promise.allSettled([
					requestCodexUsage(credential, lease.fetch),
					requestResetCredits(credential, lease.fetch)
				]);
			} finally { lease.release(); }
			if (generation !== usageGeneration) return;
			updateState({
				resetCards: cardsResult.status === "fulfilled" ? cardsResult.value.cards : [],
				resetCardsStatus: cardsResult.status === "fulfilled" ? "ready" : "error",
				usageResetCredits: cardsResult.status === "fulfilled" ? cardsResult.value.availableCount : null
			});
			if (usageResult.status === "rejected") throw usageResult.reason;
			const usage = usageResult.value;
			updateState({
				usageStatus: "ready",
				usageLimited: usage.limited,
				usageLimits: usage.limits,
				usageCredits: usage.credits.hasCredits ? usage.credits.balance : "",
				usageCreditsUnlimited: usage.credits.unlimited,
				usageResetCredits: cardsResult.status === "fulfilled" ? cardsResult.value.availableCount : usage.resetCredits,
				usageUpdatedAt: Date.now(),
				usageError: ""
			});
		})().catch((error) => {
			if (generation === usageGeneration) {
				updateState({
					usageStatus: "error",
					resetCardsStatus: state.resetCardsStatus === "loading" ? "error" : state.resetCardsStatus,
					usageUpdatedAt: Date.now(),
					usageError: safeErrorCode(error, "usageFailed")
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
		await network.ready;
		let credential;
		try {
			credential = await validCredential();
		} catch (error) {
			if (activeFlow === null) {
				updateState({
					status: "error",
					loggedIn: false,
					error: safeErrorCode(error, "refreshSignInFailed")
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
		profiles: () => profiles,
		resolveApiKey: async () => {
			const credential = await validCredential();
			if (credential === void 0) {
				throw new LlmError(
					toolLocale(ctx).text("providerNotSignedIn"),
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
		const device = new Promise((resolve) => { settleDevice = resolve; });
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
						settleDevice(challenge);
						updateState({ status: "waiting", ...challenge });
					},
					prompt: async (request) => {
						if (request?.type === "select") return "device_code";
						throw new Error(`${LOG_PREFIX}: unexpected OAuth prompt`);
					}
				};
				const credential = await oauth.login(interaction);
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
				const code = safeErrorCode(error, "loginFailed");
				settleDevice({ error: code });
				if (generation !== flowGeneration) return;
				if (controller.signal.aborted) {
					clearTransient();
					updateState({ status: "idle" });
				} else {
					updateState({ status: "error", error: code });
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

	let proxyChanges = Promise.resolve();
	const selectProxy = (mode) => {
		const change = proxyChanges.catch(() => {}).then(async () => {
		let candidate;
		try {
			const settings = ctx.get("settings");
			const forms = settings?.describe().filter((entry) => /(?:^|:)openai-codex-auth$/.test(entry.ns));
			if (forms?.length !== 1 || !settings.writable) throw new Error("Unavailable settings");
			candidate = await network.prepare(mode);
			await settings.update(forms[0].ns, { proxyMode: mode }, forms[0].revision);
			network.commit(candidate);
			clearUsage();
			if (state.loggedIn) void refreshUsage({ force: true }).catch(() => {});
			return publicSnapshot();
		} catch (error) {
			if (candidate) network.discard(candidate);
			throw new Error(safeErrorCode(error, "proxySaveFailed"));
		}
		});
		proxyChanges = change;
		return change;
	};
	Object.assign(remoteHandlers, {
		consumeReset: async (input) => {
			const revision = credentialRevision;
			const credential = await validCredential();
			if (!credential || revision !== credentialRevision) return { ...publicSnapshot(), resetResult: "account_changed" };
			const lease = network.acquire();
			let resetResult;
			try { resetResult = await redeemReset(credential, input, lease.fetch, () => revision === credentialRevision); }
			finally { lease.release(); }
			if (revision === credentialRevision) {
				clearUsage();
				await refreshUsage({ force: true }).catch(() => {});
			}
			return { ...publicSnapshot(), resetResult };
		},
		followHostProxy: () => selectProxy("host"),
		useSystemProxy: () => selectProxy("system"),
		snapshot: () => getSnapshot(),
		startLogin: () => {
			void startLoginFlow();
			return getSnapshot({ refreshUsageOnOpen: false });
		},
		logout: async () => {
			try {
				await logout();
			} catch {
				throw new Error("logoutFailed");
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
			const { text } = toolLocale(ctx);
			const device = startLoginFlow();
			let challenge;
			let timeoutId;
			try {
				const timeout = new Promise((resolve) => {
					timeoutId = setTimeout(() => resolve({ error: "loginTimedOut" }), DEVICE_CODE_TIMEOUT_MS);
				});
				challenge = await Promise.race([device, timeout]);
			} finally {
				if (timeoutId !== void 0) clearTimeout(timeoutId);
			}
			if (challenge.error !== undefined) {
				return text("loginStartFailed", { reason: text(challenge.error, {}, "loginFailed") });
			}
			return [
				text("loginStarted"),
				text("deviceCode", { code: challenge.deviceCode }),
				text("verificationUrl", { url: challenge.verificationUri }),
				text("loginInstructions")
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
			const { text, date } = toolLocale(ctx);
			const snapshot = await getSnapshot();
			if (!snapshot.loggedIn) {
				if (snapshot.status === "waiting" || snapshot.status === "starting") {
					return [
						text("loginWaiting"),
						text("deviceCode", { code: snapshot.deviceCode || text("notAvailable") }),
						text("verificationUrl", { url: snapshot.verificationUri || text("notAvailable") }),
						text("checkStatus")
					].join("\n");
				}
				if (snapshot.status === "error") {
					return text("previousLoginFailed", { reason: text(snapshot.error, {}, "loginFailed") });
				}
				return text("notLoggedIn");
			}
			return [
				text("loggedIn"),
				text("signInExpires", { date: date(snapshot.expiresAt) })
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
			const { text } = toolLocale(ctx);
			try {
				await logout();
				return text("signedOut");
			} catch {
				return text("logoutFailed");
			}
		}
	}));
}

class OpenAICodexAuthService extends OpenAICodexRemoteService {
	static inject = inject;
	static Config = Config;

	constructor(ctx, config = {}) {
		const remoteHandlers = {};
		super(ctx, remoteHandlers);
		configureService(ctx, remoteHandlers, config);
	}
}

export { OpenAICodexAuthService, Config, inject, name };
export default OpenAICodexAuthService;
