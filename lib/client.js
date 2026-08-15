window.__ModuleLoader__.load({
	id: "dsh-openai-codex-auth",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_runtime_client = require("@deepseek-ai/dsh-client-runtime/client");
		let _deepseek_ai_dsh_client_web_react = require("@deepseek-ai/dsh-client-web-react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		/** ChatGPT (OpenAI Codex) login card in the Models settings area. */
		const NS = "settings.openai-codex-auth";
		const SNAPSHOT_KEYS = new Set([
			"status", "loggedIn", "deviceCode", "verificationUri", "expiresAt", "error",
			"usageStatus", "usageLimits", "usageCredits", "usageCreditsUnlimited",
			"usageUpdatedAt", "usageError"
		]);
		const STATUSES = new Set(["idle", "starting", "waiting", "done", "error"]);
		const USAGE_STATUSES = new Set(["idle", "loading", "ready", "error"]);

		/** Human text for a rejected wire call. */
		function messageOf(error) {
			return error instanceof Error ? error.message : String(error);
		}

		/** Stable JSON equality for the small Remote snapshot returned by DSH. */
		function sameJson(left, right) {
			if (left === right) return true;
			try {
				return JSON.stringify(left) === JSON.stringify(right);
			} catch {
				return false;
			}
		}

		function finite(value) {
			return typeof value === "number" && Number.isFinite(value);
		}

		function parseSnapshot(value) {
			if (value === null || typeof value !== "object" || Array.isArray(value)) {
				throw new TypeError("OpenAI Codex Remote snapshot must be an object");
			}
			for (const key of Object.keys(value)) {
				if (!SNAPSHOT_KEYS.has(key)) throw new TypeError(`OpenAI Codex Remote snapshot has an unexpected ${key}`);
			}
			if (!STATUSES.has(value.status) || typeof value.loggedIn !== "boolean") {
				throw new TypeError("OpenAI Codex Remote snapshot has invalid login state");
			}
			for (const field of ["deviceCode", "verificationUri", "error", "usageCredits", "usageError"]) {
				if (typeof value[field] !== "string") throw new TypeError(`OpenAI Codex Remote snapshot has an invalid ${field}`);
			}
			if (!finite(value.expiresAt) || !finite(value.usageUpdatedAt)) {
				throw new TypeError("OpenAI Codex Remote snapshot has an invalid timestamp");
			}
			if (!USAGE_STATUSES.has(value.usageStatus) || typeof value.usageCreditsUnlimited !== "boolean") {
				throw new TypeError("OpenAI Codex Remote snapshot has invalid usage state");
			}
			if (usageLimitsOf(value.usageLimits).length !== value.usageLimits.length) {
				throw new TypeError("OpenAI Codex Remote snapshot has invalid usage limits");
			}
			return value;
		}

		const SnapshotSchema = Object.freeze({ parse: parseSnapshot });
		const REMOTE_CONTRIBUTION = Object.freeze({
			package: "dsh-openai-codex-auth",
			descriptors: Object.freeze(["snapshot", "startLogin", "logout"].map((method) => ({
				id: `dsh-openai-codex-auth#OpenAICodexRemote/${method}`,
				service: "openai-codex-auth",
				namespace: "openaiCodex",
				method,
				invocation: { kind: "direct" },
				parameters: [],
				result: {
					mode: "strict",
					typeSymbol: "dsh-openai-codex-auth/remote#OpenAICodexSnapshot",
					schema: SnapshotSchema
				}
			})))
		});

		function unwrap(result) {
			if (!result.ok) throw new Error(result.error.message);
			return result.value;
		}

		/** Loads login state and invokes the host's narrow Typed Remote surface. */
		var LoginController = class {
			remote;
			store = (0, _deepseek_ai_dsh_client_runtime_client.createSnapshotStore)({
				status: "idle",
				error: null,
				section: void 0,
				credentialConfigured: false,
				writable: true
			});
			generation = 0;
			constructor(remote) {
				this.remote = remote;
			}
			async load({ background = false } = {}) {
				const generation = ++this.generation;
				if (!background) {
					this.store.update((s) => {
						s.status = "loading";
						s.error = null;
					});
				}
				try {
					const section = unwrap(await this.remote.snapshot());
					if (generation !== this.generation) return;
					const credentialConfigured = section.loggedIn;
					const current = this.store.getSnapshot();
					if (
						current.status === "ready" &&
						current.error === null &&
						sameJson(current.section, section) &&
						current.credentialConfigured === credentialConfigured
					) return;
					this.store.update((s) => {
						s.status = "ready";
						s.error = null;
						s.section = section;
						s.credentialConfigured = credentialConfigured;
						s.writable = true;
					});
				} catch (error) {
					if (generation !== this.generation) return;
					this.store.update((s) => {
						if (!background) s.status = "error";
						s.error = messageOf(error);
					});
				}
			}
			async startLogin() {
				unwrap(await this.remote.startLogin());
				await this.load({ background: true });
			}
			async logout() {
				unwrap(await this.remote.logout());
				await this.load({ background: true });
			}
		};

		/** Shared card button. */
		function ActionButton({ onClick, disabled, children }) {
			return (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
				variant: "outline",
				onClick,
				disabled,
				children
			});
		}

		/** Formats a stored epoch millis for display, or undefined. */
		function expiryText(value) {
			if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return void 0;
			try {
				return new Date(value).toLocaleString();
			} catch {
				return String(value);
			}
		}

		function usageLimitsOf(value) {
			if (!Array.isArray(value)) return [];
			return value.filter((limit) => (
				limit !== null && typeof limit === "object" &&
				typeof limit.name === "string" &&
				typeof limit.usedPercent === "number" && Number.isFinite(limit.usedPercent) &&
				typeof limit.windowSeconds === "number" && Number.isFinite(limit.windowSeconds) &&
				typeof limit.resetAt === "number" && Number.isFinite(limit.resetAt)
			));
		}

		function usageWindowText(seconds, t) {
			if (seconds >= 86400 && seconds % 86400 === 0) return `${seconds / 86400} ${t("days")}`;
			if (seconds >= 3600) return `${Math.round(seconds / 3600)} ${t("hours")}`;
			if (seconds >= 60) return `${Math.round(seconds / 60)} ${t("minutes")}`;
			return t("usageWindow");
		}

		function remainingPercent(usedPercent) {
			const remaining = Math.max(0, Math.min(100, 100 - usedPercent));
			return Number.isInteger(remaining) ? String(remaining) : remaining.toFixed(1);
		}

		function usageLimitLabel(limit, t) {
			return `${limit.name} · ${usageWindowText(limit.windowSeconds, t)}`;
		}

		function UsageLimit({ limit, t }) {
			const label = usageLimitLabel(limit, t);
			const remaining = remainingPercent(limit.usedPercent);
			const resetAt = expiryText(limit.resetAt);
			return (0, react_jsx_runtime.jsxs)("div", {
				style: usageLimitStyle,
				children: [
					(0, react_jsx_runtime.jsxs)("div", {
						style: usageLimitHeaderStyle,
						children: [
							(0, react_jsx_runtime.jsx)("span", {
								style: usageLimitNameStyle,
								children: label
							}),
							(0, react_jsx_runtime.jsx)("span", {
								style: usagePercentStyle,
								children: `${t("remaining")} ${remaining}%`
							})
						]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						role: "progressbar",
						"aria-label": `${label} · ${t("remaining")} ${remaining}%`,
						"aria-valuemin": 0,
						"aria-valuemax": 100,
						"aria-valuenow": Number(remaining),
						style: progressTrackStyle,
						children: (0, react_jsx_runtime.jsx)("div", {
							style: { ...progressFillStyle, width: `${remaining}%` }
						})
					}),
					resetAt === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {
						style: usageResetStyle,
						children: `${resetAt} ${t("resets")}`
					})
				]
			});
		}

		/** Only render HTTPS verification links returned by the trusted auth host. */
		function verificationUrl(value) {
			if (typeof value !== "string" || value.length === 0) return void 0;
			try {
				const url = new URL(value);
				return url.protocol === "https:" && url.hostname === "auth.openai.com" ? url.toString() : void 0;
			} catch {
				return void 0;
			}
		}

		/**
		* Render the ChatGPT login card.
		* @param props - controller, snapshot selector, wire face, and copy.
		* @returns the card, or null while the shell has not injected yet.
		*/
		function Section(props) {
			const { controller, useSnapshot, t } = props;
			if (controller === void 0 || useSnapshot === void 0 || t === void 0) return null;
			return (0, react_jsx_runtime.jsx)(Loaded, { injected: {
				controller,
				useSnapshot,
				t
			} });
		}

		function Loaded({ injected }) {
			const { controller, t } = injected;
			const state = injected.useSnapshot((snapshot) => snapshot);
			const [busy, setBusy] = (0, react.useState)(false);
			const [requested, setRequested] = (0, react.useState)(false);
			const [actionError, setActionError] = (0, react.useState)(void 0);
			const [copiedCode, setCopiedCode] = (0, react.useState)("");

			(0, react.useEffect)(() => {
				if (state.status === "idle") void controller.load();
			}, [controller, state.status]);

			const section = state.section;
			const flowStatus = section === void 0 ? void 0 : section["status"];
			const loggedIn = state.credentialConfigured;
			const usageStatus = section === void 0 ? void 0 : section["usageStatus"];
			// Local `requested` covers the gap between clicking login and the host's
			// first Remote snapshot; once the host reports a flow state it takes over.
			const waiting = flowStatus === "waiting" || flowStatus === "starting" || requested && (flowStatus === void 0 || flowStatus === "idle");

			// Poll only the small Remote snapshot while login or usage is in flight.
			(0, react.useEffect)(() => {
				if (!waiting && usageStatus !== "loading") return;
				const timer = setInterval(() => {
					controller.load({ background: true });
				}, 2500);
				return () => {
					clearInterval(timer);
				};
			}, [controller, usageStatus, waiting]);

			// A terminal host state ends the local waiting state.
			(0, react.useEffect)(() => {
				if (flowStatus === "done" || flowStatus === "error" || flowStatus === "idle") setRequested(false);
			}, [flowStatus]);

			const run = async (action) => {
				setBusy(true);
				setActionError(void 0);
				if (action === "startLogin") setRequested(true);
				try {
					await controller[action]();
				} catch (error) {
					if (action === "startLogin") setRequested(false);
					setActionError(messageOf(error));
				} finally {
					setBusy(false);
				}
			};

			const copyDeviceCode = async (deviceCode) => {
				try {
					if (navigator.clipboard?.writeText === void 0) throw new Error(t("copyUnavailable"));
					await navigator.clipboard.writeText(deviceCode);
					setCopiedCode(deviceCode);
					setActionError(void 0);
				} catch (error) {
					setActionError(`${t("copyFailed")}: ${messageOf(error)}`);
				}
			};

			if (state.status === "loading") {
				return (0, react_jsx_runtime.jsxs)("section", {
					children: [(0, react_jsx_runtime.jsx)("h2", {
						style: sectionTitleStyle,
						children: t("title")
					}), (0, react_jsx_runtime.jsx)("p", {
						style: introStyle,
						children: t("loading")
					})]
				});
			}
			if (state.status === "error") {
				return (0, react_jsx_runtime.jsxs)("section", {
					children: [(0, react_jsx_runtime.jsx)("h2", {
						style: sectionTitleStyle,
						children: t("title")
					}), (0, react_jsx_runtime.jsx)("p", {
						style: errorStyle,
						children: `${t("loadFailed")}: ${state.error}`
					}), (0, react_jsx_runtime.jsx)(ActionButton, {
						onClick: () => {
							controller.load();
						},
						children: t("retry")
					})]
				});
			}

			const deviceCode = section === void 0 ? void 0 : section["deviceCode"];
			const verificationUri = verificationUrl(section === void 0 ? void 0 : section["verificationUri"]);
			const expiresAt = expiryText(section === void 0 ? void 0 : section["expiresAt"]);
			const flowError = section === void 0 ? void 0 : section["error"];
			const hasDeviceCode = typeof deviceCode === "string" && deviceCode.length > 0;
			const usageLimits = usageLimitsOf(section === void 0 ? void 0 : section["usageLimits"]);
			const usageError = section === void 0 ? void 0 : section["usageError"];
			const usageCredits = section === void 0 ? void 0 : section["usageCredits"];
			const usageCreditsUnlimited = section !== void 0 && section["usageCreditsUnlimited"] === true;

			return (0, react_jsx_runtime.jsxs)("section", {
				style: sectionStyle,
				children: [
					(0, react_jsx_runtime.jsx)("h2", {
						style: sectionTitleStyle,
						children: t("title")
					}),
					(0, react_jsx_runtime.jsx)("p", {
						style: introStyle,
						children: t("intro")
					}),
					!state.writable ? (0, react_jsx_runtime.jsx)("p", {
						style: noticeStyle,
						children: t("readOnly")
					}) : null,
					flowError !== void 0 && flowError.length > 0 ? (0, react_jsx_runtime.jsx)("p", {
						style: errorStyle,
						children: `${t("failed")}: ${flowError}`
					}) : null,
					state.status === "ready" && state.error !== null ? (0, react_jsx_runtime.jsx)("p", {
						style: errorStyle,
						children: `${t("refreshFailed")}: ${state.error}`
					}) : null,
					actionError !== void 0 ? (0, react_jsx_runtime.jsx)("p", {
						style: errorStyle,
						children: actionError
					}) : null,
					waiting ? (0, react_jsx_runtime.jsxs)("div", {
						style: statusBoxStyle,
						children: [
							(0, react_jsx_runtime.jsx)("p", {
								style: statusLineStyle,
								children: t("waitingHint")
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								style: codeRowStyle,
								children: [
									(0, react_jsx_runtime.jsx)("p", {
										style: codeStyle,
										children: hasDeviceCode ? deviceCode : t("gettingCode")
									}),
									hasDeviceCode ? (0, react_jsx_runtime.jsx)(ActionButton, {
										onClick: () => {
											void copyDeviceCode(deviceCode);
										},
										children: copiedCode === deviceCode ? t("copied") : t("copy")
									}) : null
								]
							}),
							verificationUri !== void 0 && verificationUri.length > 0 ? (0, react_jsx_runtime.jsx)("p", {
								style: statusLineStyle,
								children: [t("openUrl"), " ", (0, react_jsx_runtime.jsx)("a", {
									href: verificationUri,
									target: "_blank",
									rel: "noreferrer noopener",
									children: verificationUri
								})]
							}) : null,
							(0, react_jsx_runtime.jsx)("p", {
								style: statusLineStyle,
								children: t("waitingPoll")
							})
						]
					}) : null,
					loggedIn ? (0, react_jsx_runtime.jsxs)("div", {
						style: statusBoxStyle,
						children: [
							(0, react_jsx_runtime.jsx)("p", {
								style: okStyle,
								children: t("loggedIn")
							}),
							expiresAt === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {
								style: statusLineStyle,
								children: `${t("expiresAt")} ${expiresAt}`
							}),
							(0, react_jsx_runtime.jsx)("p", {
								style: statusLineStyle,
								children: t("autoRefresh")
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								style: usageBoxStyle,
								children: [
									(0, react_jsx_runtime.jsx)("p", {
										style: usageTitleStyle,
										children: t("usageTitle")
									}),
									usageStatus === "loading" && usageLimits.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
										style: statusLineStyle,
										children: t("loadingUsage")
									}) : null,
									...usageLimits.map((limit, index) => (0, react_jsx_runtime.jsx)(UsageLimit, {
										limit,
										t
									}, `${limit.name}-${limit.windowSeconds}-${index}`)),
									usageCreditsUnlimited ? (0, react_jsx_runtime.jsx)("p", {
										style: statusLineStyle,
										children: `${t("credits")}: ${t("unlimited")}`
									}) : typeof usageCredits === "string" && usageCredits.length > 0 ? (0, react_jsx_runtime.jsx)("p", {
										style: statusLineStyle,
										children: `${t("credits")}: ${usageCredits}`
									}) : null,
									usageStatus === "ready" && usageLimits.length === 0 && !usageCreditsUnlimited && !(typeof usageCredits === "string" && usageCredits.length > 0) ? (0, react_jsx_runtime.jsx)("p", {
										style: noticeStyle,
										children: t("usageUnavailable")
									}) : null,
									usageStatus === "error" ? (0, react_jsx_runtime.jsx)("p", {
										style: noticeStyle,
										children: `${t("usageFailed")}${typeof usageError === "string" && usageError.length > 0 ? `: ${usageError}` : ""}`
									}) : null
								]
							}),
							(0, react_jsx_runtime.jsxs)("div", {
								style: actionRowStyle,
								children: [
									(0, react_jsx_runtime.jsx)(ActionButton, {
										onClick: () => {
											run("logout");
										},
										disabled: busy || !state.writable,
										children: busy ? t("working") : t("logout")
									})
								]
							})
						]
					}) : !waiting ? (0, react_jsx_runtime.jsxs)("div", {
						style: statusBoxStyle,
						children: [
							(0, react_jsx_runtime.jsx)("p", {
								style: statusLineStyle,
								children: t("notLoggedIn")
							}),
							(0, react_jsx_runtime.jsx)(ActionButton, {
								onClick: () => {
								run("startLogin");
								},
								disabled: busy || !state.writable,
								children: busy ? t("working") : t("login")
							})
						]
					}) : null
				]
			});
		}

		/** English strings (the key-set source of truth for this pair). */
		const en = {
			nav: "OpenAI Codex",
			title: "OpenAI Codex",
			intro: "Sign in with ChatGPT to use OpenAI Codex in DSH.",
			loading: "Loading login state…",
			loadFailed: "Loading login state failed",
			refreshFailed: "Refreshing login state failed",
			retry: "Retry",
			readOnly: "The settings document is read-only in this deployment.",
			failed: "Login failed",
			waitingHint: "Enter this code on the verification page:",
			gettingCode: "Getting a device code…",
			copy: "Copy code",
			copied: "Copied",
			copyFailed: "Copy failed",
			copyUnavailable: "Clipboard access is unavailable",
			openUrl: "Verification page:",
			waitingPoll: "Waiting for authorization. Status updates automatically.",
			loggedIn: "Logged in with your ChatGPT account.",
			expiresAt: "Token expires at",
			autoRefresh: "The token refreshes automatically while the harness runs.",
			usageTitle: "Codex usage",
			loadingUsage: "Loading usage…",
			remaining: "Remaining",
			colon: ": ",
			resets: "reset",
			days: "days",
			hours: "hours",
			minutes: "minutes",
			usageWindow: "Usage window",
			credits: "Credits balance",
			unlimited: "Unlimited",
			usageUnavailable: "No usage window was returned.",
			usageFailed: "Usage unavailable",
			notLoggedIn: "Not logged in yet.",
			login: "Sign in with ChatGPT",
			logout: "Sign out",
			working: "Working…"
		};

		/** Chinese strings (same keys as {@link en}). */
		const zh = {
			nav: "OpenAI Codex",
			title: "OpenAI Codex",
			intro: "登录 ChatGPT，在 DSH 中使用 OpenAI Codex。",
			loading: "正在读取登录状态…",
			loadFailed: "读取登录状态失败",
			refreshFailed: "刷新登录状态失败",
			retry: "重试",
			readOnly: "当前部署的设置文档为只读。",
			failed: "登录失败",
			waitingHint: "在验证页面输入设备码：",
			gettingCode: "正在获取设备码…",
			copy: "复制设备码",
			copied: "已复制",
			copyFailed: "复制失败",
			copyUnavailable: "当前浏览器无法访问剪贴板",
			openUrl: "验证页面：",
			waitingPoll: "等待授权，状态会自动更新。",
			loggedIn: "已登录 ChatGPT。",
			expiresAt: "令牌有效期至",
			autoRefresh: "令牌在 Harness 运行期间会自动刷新。",
			usageTitle: "Codex 用量",
			loadingUsage: "正在读取用量…",
			remaining: "剩余",
			colon: "：",
			resets: "重置",
			days: "天",
			hours: "小时",
			minutes: "分钟",
			usageWindow: "用量周期",
			credits: "Credits 余额",
			unlimited: "无限",
			usageUnavailable: "未返回可显示的用量周期。",
			usageFailed: "暂时无法读取用量",
			notLoggedIn: "尚未登录。",
			login: "使用 ChatGPT 登录",
			logout: "退出登录",
			working: "处理中…"
		};

		const sectionStyle = { maxWidth: "720px", color: "var(--dsw-alias-label-primary)", display: "flex", flexDirection: "column", gap: "12px" };
		const sectionTitleStyle = { color: "var(--dsw-alias-label-primary)", margin: 0, fontSize: "16px", fontWeight: 500, lineHeight: "24px" };
		const introStyle = { color: "var(--dsw-alias-label-tertiary)", margin: 0, fontSize: "14px", lineHeight: "22px" };
		const noticeStyle = { color: "var(--dsw-alias-state-warn-label)", margin: 0, fontSize: "12px", lineHeight: "18px" };
		const errorStyle = { color: "var(--dsw-alias-state-error-primary)", margin: 0, fontSize: "12px", lineHeight: "18px" };
		const okStyle = { color: "var(--dsw-alias-state-success-primary)", margin: 0, fontSize: "14px", lineHeight: "22px" };
		const statusBoxStyle = { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "12px", padding: "12px 14px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "8px", margin: "4px 0 0" };
		const statusLineStyle = { color: "var(--dsw-alias-label-secondary)", margin: 0, fontSize: "14px", lineHeight: "22px" };
		const usageBoxStyle = { width: "100%", boxSizing: "border-box", borderTop: "1px solid var(--dsw-alias-border-l2)", paddingTop: "12px", display: "flex", flexDirection: "column", gap: "10px" };
		const usageTitleStyle = { color: "var(--dsw-alias-label-primary)", margin: 0, fontSize: "14px", fontWeight: 500, lineHeight: "22px" };
		const usageLimitStyle = { width: "100%", display: "flex", flexDirection: "column", gap: "6px" };
		const usageLimitHeaderStyle = { width: "100%", display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: "12px" };
		const usageLimitNameStyle = { color: "var(--dsw-alias-label-secondary)", fontSize: "14px", lineHeight: "22px" };
		const usagePercentStyle = { color: "var(--dsw-alias-label-primary)", flexShrink: 0, fontSize: "14px", fontWeight: 500, lineHeight: "22px" };
		const progressTrackStyle = { width: "100%", height: "8px", overflow: "hidden", borderRadius: "999px", background: "var(--dsw-alias-bg-layer-1)" };
		const progressFillStyle = { height: "100%", borderRadius: "inherit", background: "var(--dsw-alias-state-business-primary)", transition: "width 180ms ease" };
		const usageResetStyle = { color: "var(--dsw-alias-label-tertiary)", margin: 0, fontSize: "12px", lineHeight: "18px" };
		const actionRowStyle = { width: "100%", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", paddingTop: "4px" };
		const codeRowStyle = { display: "flex", alignItems: "center", gap: "12px", flexWrap: "wrap" };
		const codeStyle = { color: "var(--dsw-alias-label-primary)", margin: 0, fontSize: "20px", fontWeight: 600, lineHeight: "28px", letterSpacing: "2px" };

		/**
		* Required services (cordis fiber inject). The target slot is declared by
		* ui-settings-general's SettingsRoot; registration depends on it through
		* `slots.inject()`.
		*/
		const inject = ["slots", "locale", "remote"];

		/**
		* Register the ChatGPT login section and mount its generated Remote face.
		* @param ctx - client root context.
		*/
		async function apply(ctx) {
			const disposeRemote = await ctx.remote.$mount(REMOTE_CONTRIBUTION);
			const remote = ctx.get("remote.openaiCodex");
			if (remote === void 0) {
				await disposeRemote();
				throw new Error("OpenAI Codex Remote service did not mount");
			}
			ctx.effect(() => ctx.locale.register(NS, {
				zh,
				en
			}), "openai-codex-auth: copy dictionaries");
			const controller = new LoginController(remote);
			const useSnapshot = (0, _deepseek_ai_dsh_client_web_react.bindSnapshotSelector)(controller.store);
			const t = ctx.locale.bind(NS);
			const injected = () => ({
				controller,
				useSnapshot,
				t
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "openai-codex-auth",
				order: 20,
				label: () => t("nav"),
				inject: injected
			}, Section));
			return async () => {
				await disposeRemote();
			};
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
