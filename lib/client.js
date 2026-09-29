window.__ModuleLoader__.load({
	id: "dsh-openai-codex-auth",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react_jsx_runtime = require("react/jsx-runtime");
		let react = require("react");
		let _deepseek_ai_dsh_client_store = require("@deepseek-ai/dsh-client-store");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");

		/** ChatGPT (OpenAI Codex) login card in the Models settings area. */
		const NS = "settings.openai-codex-auth";
		const SNAPSHOT_KEYS = new Set([
			"proxyMode", "proxyRestartRequired", "proxyError",
			"status", "loggedIn", "deviceCode", "verificationUri", "expiresAt", "error",
			"usageStatus", "usageLimits", "usageCredits", "usageCreditsUnlimited",
			"usageUpdatedAt", "usageError", "usageResetCredits", "resetCards", "resetCardsStatus", "resetResult"
		]);
		const STATUSES = new Set(["idle", "starting", "waiting", "done", "error"]);
		const USAGE_STATUSES = new Set(["idle", "loading", "ready", "error"]);
		const RESET_RESULTS = new Set(["reset", "already_redeemed", "no_credit", "nothing_to_reset", "unknown", "unavailable", "pending", "account_changed"]);
		const ResetRequestSchema = { parse(value) {
			if (!value || value.confirmed !== true || typeof value.idempotencyKey !== "string" ||
				typeof value.creditId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value.creditId) ||
				!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.idempotencyKey) ||
				Object.keys(value).some((key) => !["idempotencyKey", "confirmed", "creditId"].includes(key))) throw new TypeError("Invalid reset confirmation");
			return value;
		} };

		/** Human text for a rejected wire call. */
		function safeClientError(value) {
			if (value instanceof Error && value.message === "OpenAI Codex request failed") return value.message;
			return "OpenAI Codex request failed";
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

		/** Bind a DSH snapshot store using React 18's built-in subscription hook. */
		function bindSnapshotSelector(store) {
			const subscribe = (listener) => store.subscribe(listener);
			const getSnapshot = () => store.getSnapshot();
			return (selector) => selector((0, react.useSyncExternalStore)(subscribe, getSnapshot, getSnapshot));
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
			if (value.proxyMode !== undefined && !["host", "system"].includes(value.proxyMode) || value.proxyRestartRequired !== undefined && typeof value.proxyRestartRequired !== "boolean" || value.proxyError !== undefined && typeof value.proxyError !== "string") throw new TypeError("Invalid proxy snapshot");
			if (!STATUSES.has(value.status) || typeof value.loggedIn !== "boolean") {
				throw new TypeError("OpenAI Codex Remote snapshot has invalid login state");
			}
			if (value.usageResetCredits != null && (!Number.isSafeInteger(value.usageResetCredits) || value.usageResetCredits < 0)) throw new TypeError("Invalid reset credits");
			if (value.resetCards !== undefined && (!Array.isArray(value.resetCards) || value.resetCards.length > 1000 ||
				value.resetCards.some((card) => !card || Object.keys(card).some((key) => !["id", "expiresAt"].includes(key)) ||
					typeof card.id !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(card.id) ||
					!(card.expiresAt === null || finite(card.expiresAt) && card.expiresAt > 0)))) throw new TypeError("Invalid reset cards");
			if (value.resetCardsStatus !== undefined && !USAGE_STATUSES.has(value.resetCardsStatus)) throw new TypeError("Invalid reset cards status");
			if (value.resetResult !== undefined && !RESET_RESULTS.has(value.resetResult)) throw new TypeError("Invalid reset result");
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
			descriptors: Object.freeze(["snapshot", "startLogin", "logout", "followHostProxy", "useSystemProxy", "consumeReset"].map((method) => ({
				id: `dsh-openai-codex-auth#OpenAICodexRemote/${method}`,
				service: "openai-codex-auth",
				namespace: "openaiCodex",
				method,
				invocation: { kind: "direct" },
				parameters: method === "consumeReset" ? [{
					name: "input", wire: "input", source: "json",
					codec: { mode: "strict", typeSymbol: "dsh-openai-codex-auth/remote#ResetRequest", create: () => ResetRequestSchema }
				}] : [],
				result: {
					mode: "strict",
					typeSymbol: "dsh-openai-codex-auth/remote#OpenAICodexSnapshot",
					create: () => SnapshotSchema
				}
			})))
		});

		function unwrap(result) {
			if (!result.ok) throw new Error("OpenAI Codex request failed");
			return result.value;
		}

		/** Loads login state and invokes the host's narrow Typed Remote surface. */
		var LoginController = class {
			remote;
			store = (0, _deepseek_ai_dsh_client_store.createSnapshotStore)({
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
						s.error = safeClientError(error);
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
			async followHostProxy() { await this.saveProxy("followHostProxy"); }
			async useSystemProxy() { await this.saveProxy("useSystemProxy"); }
			async consumeReset(input) {
				++this.generation;
				const section = unwrap(await this.remote.consumeReset(ResetRequestSchema.parse(input)));
				this.store.update((state) => { state.section = section; });
				return section.resetResult;
			}
			async saveProxy(method) {
				++this.generation;
				const section = unwrap(await this.remote[method]());
				this.store.update((state) => { state.section = section; });
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

		const RESET_ATTEMPT_STORAGE = "dsh-openai-codex-auth.pending-reset";
		function readResetAttempt() {
			try {
				const raw = sessionStorage.getItem(RESET_ATTEMPT_STORAGE);
				if (!raw) return null;
				try {
					const attempt = JSON.parse(raw);
					ResetRequestSchema.parse({ idempotencyKey: attempt.idempotencyKey, creditId: attempt.creditId, confirmed: true });
					return { idempotencyKey: attempt.idempotencyKey, creditId: attempt.creditId,
						expiresAt: finite(attempt.expiresAt) && attempt.expiresAt > 0 ? attempt.expiresAt : null };
				} catch { return { legacy: true }; }
			} catch { return { legacy: true }; }
		}

		function ResetCards({ section, controller, t, busy, setBusy }) {
			const [selected, setSelected] = (0, react.useState)(null);
			const [pending, setPending] = (0, react.useState)(readResetAttempt);
			const [result, setResult] = (0, react.useState)(null);
			const submitting = (0, react.useRef)(false);
			const ready = section?.resetCardsStatus === "ready";
			const count = section?.usageResetCredits;
			const cards = ready ? section.resetCards ?? [] : [];
			const expiry = (card, compact = false) => card?.expiresAt == null ? t("resetExpiryUnknown") :
				t("resetExpires") + " " + (compact ? new Date(card.expiresAt).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }) : expiryText(card.expiresAt));
			const confirm = async () => {
				if (submitting.current || busy || !selected || pending?.legacy) return;
				submitting.current = true;
				setBusy(true);
				setResult(null);
				let code = "unknown";
				try {
					const attempt = pending ?? { idempotencyKey: crypto.randomUUID(), creditId: selected.id, expiresAt: selected.expiresAt };
					// Both the request key AND card stay fixed across uncertain retries.
					sessionStorage.setItem(RESET_ATTEMPT_STORAGE, JSON.stringify(attempt));
					setPending(attempt);
					code = await controller.consumeReset({ idempotencyKey: attempt.idempotencyKey, creditId: attempt.creditId, confirmed: true });
					if (!["unknown", "pending", "account_changed"].includes(code)) {
						sessionStorage.removeItem(RESET_ATTEMPT_STORAGE);
						setPending(null);
					}
				} catch { /* Never retry automatically or show remote error bodies. */ }
				finally {
					setResult(code);
					setSelected(null);
					setBusy(false);
					submitting.current = false;
				}
			};
			const row = (card, index, retryOnly = false) => {
				const retry = pending?.creditId === card.id;
				return (0, react_jsx_runtime.jsxs)("div", {
					style: resetCardRowStyle,
					children: [
						(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "4px", minWidth: 0 }, children: [
							(0, react_jsx_runtime.jsx)("span", { style: usageTitleStyle, children: t("resetFull") }),
							(0, react_jsx_runtime.jsx)("span", { style: { ...introStyle, fontSize: "12px" }, title: expiry(card), children: expiry(card, true) })
						] }),
						(0, react_jsx_runtime.jsx)(ActionButton, {
							disabled: busy || Boolean(pending && !retry) || (!retry && (!ready || !(count > 0) || card.expiresAt !== null && card.expiresAt <= Date.now())),
							onClick: () => setSelected(card), children: t(retry || retryOnly ? "resetRetry" : "resetUse")
						})
					]
				}, card.id);
			};
			return (0, react_jsx_runtime.jsxs)("div", { role: "group", "aria-label": t("resetTitle"), style: resetCardsStyle, children: [
				(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [
					(0, react_jsx_runtime.jsx)("h3", { style: regionTitleStyle, children: t("resetTitle") }),
					(0, react_jsx_runtime.jsx)("span", { style: { ...introStyle, fontSize: "12px" }, children: `${t("resetAvailable")} ${count == null ? t("resetCreditsUnavailable") : count}` })
				] }),
				...cards.map((card, index) => row(card, index)),
				pending?.creditId && !cards.some((card) => card.id === pending.creditId) ? row({ id: pending.creditId, expiresAt: pending.expiresAt }, cards.length, true) : null,
				pending?.legacy ? (0, react_jsx_runtime.jsx)("p", { role: "alert", style: introStyle, children: t("resetLegacyPending") }) : null,
				!ready ? (0, react_jsx_runtime.jsx)("p", { style: introStyle, children: t(section?.resetCardsStatus === "loading" ? "loading" : "resetDetailsUnavailable") }) : null,
				ready && count > cards.length ? (0, react_jsx_runtime.jsx)("p", { style: introStyle, children: t("resetDetailsPartial") }) : null,
				result ? (0, react_jsx_runtime.jsx)("p", { role: "status", style: introStyle, children: t("resetResult_" + result) }) : null,
				(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
					open: selected !== null, onClose: () => { if (!submitting.current) setSelected(null); },
					title: t("resetConfirmTitle"), closeLabel: t("resetCancel"),
					description: t(pending ? "resetRetryHint" : "resetConfirmHint"),
					children: selected ? (0, react_jsx_runtime.jsx)("p", { style: statusLineStyle, children: t("resetFull") + " · " + expiry(selected) }) : null,
					footer: (0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", justifyContent: "flex-end", gap: "8px" }, children: [
						(0, react_jsx_runtime.jsx)("button", { type: "button", "data-modal-autofocus": true, style: proxySelectStyle,
							disabled: busy, onClick: () => setSelected(null), children: t("resetCancel") }),
						(0, react_jsx_runtime.jsx)(ActionButton, { disabled: busy, onClick: () => void confirm(), children: t(busy ? "working" : "resetConfirm") })
					] })
				})
			] });
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

		function groupUsageLimits(limits) {
			const groups = [];
			const byName = new Map();
			for (const limit of limits) {
				let group = byName.get(limit.name);
				if (group === void 0) {
					group = { name: limit.name, limits: [] };
					byName.set(limit.name, group);
					groups.push(group);
				}
				group.limits.push(limit);
			}
			return groups;
		}

		function UsageLimit({ limit, t }) {
			const windowLabel = usageWindowText(limit.windowSeconds, t);
			const label = `${limit.name} · ${windowLabel}`;
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
								children: windowLabel
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

		function UsageGroup({ group, t, separated, hideTitle = false }) {
			return (0, react_jsx_runtime.jsxs)("div", {
				role: "group",
				"aria-label": group.name,
				style: separated ? { ...usageGroupStyle, ...usageGroupSeparatedStyle } : usageGroupStyle,
				children: [
					hideTitle ? null : (0, react_jsx_runtime.jsx)("p", {
						style: usageGroupTitleStyle,
						children: group.name
					}),
					(0, react_jsx_runtime.jsx)("div", {
						style: usageGroupLimitsStyle,
						children: group.limits.map((limit, index) => (0, react_jsx_runtime.jsx)(UsageLimit, {
							limit,
							t
						}, `${limit.windowSeconds}-${index}`))
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

			const [proxySaving, setProxySaving] = (0, react.useState)(false);
			const [proxyMenuOpen, setProxyMenuOpen] = (0, react.useState)(false);
			const run = async (action) => {
				const isProxy = action === "followHostProxy" || action === "useSystemProxy";
				if (isProxy) setProxySaving(true);
				setBusy(true);
				setActionError(void 0);
				if (action === "startLogin") setRequested(true);
				try {
					await controller[action]();
				} catch (error) {
					if (action === "startLogin") setRequested(false);
					setActionError(isProxy ? t("proxySaveFailed") : safeClientError(error));
				} finally {
					setBusy(false);
					if (isProxy) setProxySaving(false);
				}
			};

			const copyDeviceCode = async (deviceCode) => {
				try {
					if (navigator.clipboard?.writeText === void 0) throw new Error(t("copyUnavailable"));
					await navigator.clipboard.writeText(deviceCode);
					setCopiedCode(deviceCode);
					setActionError(void 0);
				} catch (error) {
					setActionError(t("copyFailed"));
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
			const usageGroups = groupUsageLimits(usageLimits);
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
					(0, react_jsx_runtime.jsxs)("div", { style: loggedIn ? signedInStyle : void 0, children: [
					loggedIn ? (0, react_jsx_runtime.jsxs)("div", {
						children: [
							(0, react_jsx_runtime.jsxs)("div", { style: accountHeaderStyle, children: [
								(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "8px" }, children: [
									(0, react_jsx_runtime.jsx)("span", { "aria-hidden": true, style: { width: "6px", height: "6px", borderRadius: "50%", background: "var(--dsw-alias-state-success-primary)" } }),
									(0, react_jsx_runtime.jsx)("span", { style: statusLineStyle, children: t("connected") })
								] }),
								(0, react_jsx_runtime.jsx)(ActionButton, {
									disabled: busy || !state.writable, onClick: () => void run("logout"), children: t("logout") })
							] }),
							(0, react_jsx_runtime.jsxs)("div", { style: connectionDetailsStyle, children: [
								(0, react_jsx_runtime.jsxs)("div", { style: { display: "flex", flexDirection: "column", gap: "4px", paddingTop: "8px" }, children: [
									expiresAt === void 0 ? null : (0, react_jsx_runtime.jsx)("p", { style: introStyle, children: `${t("expiresAt")} ${expiresAt}` }),
									(0, react_jsx_runtime.jsx)("p", { style: introStyle, children: t("autoRefresh") })
								] })
							] }),
							(0, react_jsx_runtime.jsxs)("div", {
								style: usageBoxStyle,
								children: [
									(0, react_jsx_runtime.jsx)("h3", {
										style: regionTitleStyle,
										children: t("usageTitle")
									}),
									usageStatus === "loading" && usageLimits.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
										style: statusLineStyle,
										children: t("loadingUsage")
									}) : null,
									usageGroups.length === 0 ? null : (0, react_jsx_runtime.jsx)("div", {
										style: usageGroupsStyle,
										children: usageGroups.map((group, index) => (0, react_jsx_runtime.jsx)(UsageGroup, {
											group,
											t,
											hideTitle: usageGroups.length === 1 && group.name === "Codex",
											separated: index > 0
										}, group.name))
									}),

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
							(0, react_jsx_runtime.jsx)(ResetCards, { section, controller, t, busy, setBusy })
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
					}) : null,
					(0, react_jsx_runtime.jsxs)("div", { style: proxyBoxStyle, children: [
						(0, react_jsx_runtime.jsx)("h3", { style: regionTitleStyle, children: t("proxyLabel") }),
						(0, react_jsx_runtime.jsxs)("div", { style: proxyControlsStyle, children: [
							(0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Menu, {
								open: proxyMenuOpen && !busy, onClose: () => setProxyMenuOpen(false), compact: true, portal: true, autoFocus: true,
								selectedId: section?.proxyMode ?? "host",
								items: [{ id: "host", label: t("proxyHost") }, { id: "system", label: t("proxySystem") }],
								onSelect: (mode) => { setProxyMenuOpen(false); if (!busy && state.writable && mode !== (section?.proxyMode ?? "host")) void run(mode === "system" ? "useSystemProxy" : "followHostProxy"); },
								anchor: (0, react_jsx_runtime.jsx)("button", {
									type: "button", "aria-haspopup": "menu", "aria-expanded": proxyMenuOpen && !busy,
									"aria-label": t("proxyLabel"), title: t("proxyHint"), disabled: busy || !state.writable,
									onClick: () => setProxyMenuOpen((open) => !open), style: proxySelectStyle,
									children: t(section?.proxyMode === "system" ? "proxySystem" : "proxyHost") + " ▾"
								})
							}),
						section?.proxyMode === "system" ? (0, react_jsx_runtime.jsx)("button", {
							type: "button", disabled: busy || !state.writable, title: t("proxyReload"),
							"aria-label": t("proxyReload"), style: proxyReloadStyle,
							onClick: () => void run("useSystemProxy"), children: "↻"
						}) : null,
						(0, react_jsx_runtime.jsx)("span", { role: "status", "aria-live": "polite", style: introStyle,
							children: proxySaving ? t("proxySaving") : null })
						] })
					] }),
					section?.proxyError ? (0, react_jsx_runtime.jsx)("p", { role: "alert", style: errorStyle, children: t("proxyUnavailable") }) : null
					] })
				]
			});
		}

		/** English strings (the key-set source of truth for this pair). */
		const en = {
			nav: "OpenAI Codex",
			title: "OpenAI Codex",
			intro: "Sign in with ChatGPT to use OpenAI Codex in DSH.",
			proxyLabel: "Proxy",
			resetCredits: "Reset cards remaining",
			resetCreditsUnavailable: "Unavailable",
			resetUse: "Use reset",
			resetTitle: "Reset credits",
			connected: "Connected to ChatGPT",
			connectionDetails: "Connection details",
			resetAvailable: "Available",
			resetFull: "Full reset",
			resetLegacyPending: "An earlier reset has an unresolved record. Check its result in the original version before starting another reset.",
			resetRetry: "Retry same reset",
			resetCard: "Card",
			resetExpires: "Expires",
			resetExpiryUnknown: "Expiry not provided",
			resetDetailsUnavailable: "Card expiry details are unavailable.",
			resetDetailsPartial: "Some cards have no displayable expiry details.",
			resetConfirmTitle: "Use one reset card?",
			resetConfirmHint: "This may consume one account-wide reset card to reset eligible Codex usage limits. It cannot be undone. Other sessions using this account are affected. The selected card will be used; the server determines which limits reset.",
			resetRetryHint: "The previous result is uncertain. This retries the same request ID, not a new reset. Check current usage and card count before continuing.",
			resetCancel: "Cancel",
			resetConfirm: "Confirm reset",
			resetResult_reset: "Reset applied. Usage and cards have been refreshed where available.",
			resetResult_already_redeemed: "This request was already redeemed; no new reset was requested.",
			resetResult_no_credit: "The selected reset card is no longer available. Refresh before choosing another card.",
			resetResult_nothing_to_reset: "There are no eligible limits to reset. No card was consumed.",
			resetResult_unknown: "Result uncertain. Check usage and cards; retry only the same reset. Do not start another reset in a different window.",
			resetResult_unavailable: "Could not check available cards. No reset was sent.",
			resetResult_pending: "Another reset is pending. Return to its original window to check the result.",
			resetResult_account_changed: "Account changed. Return to the original account to resolve the pending reset.",
			proxyHost: "Follow DSH",
			proxySystem: "Windows system proxy",
			proxyHint: "New requests use the selected route immediately. Active requests keep their connection. System mode uses SSE; PAC is not supported.",
			proxyInstant: "No restart needed",
			proxySaving: "Applying…",

			proxyHostDetail: "Use the host network configuration",
			proxySystemDetail: "Windows manual HTTP/HTTPS proxy",
			proxyReload: "Reload system proxy",
			proxySaveFailed: "Could not apply the proxy. Check the manual system proxy and configuration permissions. The previous mode is unchanged.",
			proxyUnavailable: "No supported Windows manual HTTPS proxy found. PAC and SOCKS are not supported. Configure a manual proxy or follow DSH.",
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
			proxyLabel: "网络代理",
			resetCredits: "剩余重置卡",
			resetCreditsUnavailable: "暂不可用",
			resetUse: "使用重置额度",
			resetTitle: "重置卡",
			connected: "已连接 ChatGPT",
			connectionDetails: "连接信息",
			resetAvailable: "可用",
			resetFull: "完全重置",
			resetLegacyPending: "有旧版或无法读取的待确认记录，请先在原版本核对结果，再发起新的重置。",
			resetRetry: "重试同一次重置",
			resetCard: "重置卡",
			resetExpires: "到期时间",
			resetExpiryUnknown: "接口未提供到期时间",
			resetDetailsUnavailable: "暂时无法读取重置卡到期详情。",
			resetDetailsPartial: "部分重置卡暂无可显示的到期详情。",
			resetConfirmTitle: "确认使用一张重置卡？",
			resetConfirmHint: "此操作可能消耗账户的一张重置卡，重置符合条件的 Codex 用量，且无法撤销。同一账户的其他会话也会受影响。将使用你选择的这张卡，具体重置哪些额度由服务端决定。",
			resetRetryHint: "上次操作结果尚不确定。本次将沿用同一请求标识重试，不会发起新的重置。请先核对当前用量和卡片数量。",
			resetCancel: "取消",
			resetConfirm: "确认重置",
			resetResult_reset: "重置成功，已尝试刷新用量和卡片信息。",
			resetResult_already_redeemed: "这次请求已兑换过，未发起新的重置。",
			resetResult_no_credit: "所选重置卡已不可用，请刷新后重新选择。",
			resetResult_nothing_to_reset: "当前没有符合条件的额度需要重置，未消耗重置卡。",
			resetResult_unknown: "操作结果尚不确定，请核对用量和卡片；重试会沿用同一请求。请勿在其他窗口另行重置。",
			resetResult_unavailable: "无法检查可用重置卡，未发送重置请求。",
			resetResult_pending: "另一次重置仍待确认，请回到原窗口查看结果。",
			resetResult_account_changed: "账户已变化，请切回原账户确认待处理的重置结果。",
			proxyHost: "跟随 DSH 宿主",
			proxySystem: "Windows 系统代理",
			proxyHint: "新请求立即使用所选代理，进行中的请求保持原连接。系统模式使用 SSE，暂不支持 PAC。",
			proxyInstant: "无需重启",
			proxySaving: "正在应用…",

			proxyHostDetail: "沿用宿主的网络配置",
			proxySystemDetail: "Windows 手动 HTTP/HTTPS 代理",
			proxyReload: "重新读取系统代理",
			proxySaveFailed: "代理切换失败，请检查手动系统代理及配置写入权限。原模式保持不变。",
			proxyUnavailable: "没有可用的 Windows 手动 HTTPS 代理。不支持 PAC 或 SOCKS，请设置手动代理或选择跟随 DSH。",
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
		const signedInStyle = { display: "flex", flexDirection: "column", marginTop: "8px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "12px", padding: "16px", boxSizing: "border-box", minWidth: 0 };
		const accountHeaderStyle = { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px" };
		const connectionDetailsStyle = { marginTop: "4px", fontSize: "12px", color: "var(--dsw-alias-label-secondary)" };
		const proxyBoxStyle = { display: "flex", flexDirection: "column", gap: "12px", borderTop: "1px solid var(--dsw-alias-border-l2)", paddingTop: "20px", marginTop: "12px", fontSize: "12px", color: "var(--dsw-alias-label-secondary)" };
		const resetCardRowStyle = { display: "flex", flexWrap: "wrap", alignItems: "center", justifyContent: "space-between", gap: "8px 16px", padding: "8px 0" };
		const resetCardsStyle = { borderTop: "1px solid var(--dsw-alias-border-l2)", paddingTop: "20px", marginTop: "24px", display: "flex", flexDirection: "column", gap: "8px" };
		const proxyControlsStyle = { display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px" };
		const proxySelectStyle = { maxWidth: "100%", padding: "5px 9px", border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "8px", color: "var(--dsw-alias-label-primary)", background: "transparent", font: "inherit", cursor: "pointer" };
		const proxyReloadStyle = { padding: "2px 5px", border: 0, color: "inherit", background: "transparent", fontSize: "18px", cursor: "pointer" };
		const sectionTitleStyle = { color: "var(--dsw-alias-label-primary)", margin: 0, fontSize: "16px", fontWeight: 500, lineHeight: "24px" };
		const introStyle = { color: "var(--dsw-alias-label-tertiary)", margin: 0, fontSize: "14px", lineHeight: "22px" };
		const noticeStyle = { color: "var(--dsw-alias-state-warn-label)", margin: 0, fontSize: "12px", lineHeight: "18px" };
		const errorStyle = { color: "var(--dsw-alias-state-error-primary)", margin: 0, fontSize: "12px", lineHeight: "18px" };
		const okStyle = { color: "var(--dsw-alias-state-success-primary)", margin: 0, fontSize: "14px", lineHeight: "22px" };
		const statusBoxStyle = { border: "1px solid var(--dsw-alias-border-l2)", borderRadius: "12px", padding: "12px 14px", boxSizing: "border-box", display: "flex", flexDirection: "column", gap: "8px", margin: "4px 0 0" };
		const statusLineStyle = { color: "var(--dsw-alias-label-secondary)", margin: 0, fontSize: "14px", lineHeight: "22px" };
		const usageBoxStyle = { width: "100%", boxSizing: "border-box", borderTop: "1px solid var(--dsw-alias-border-l2)", paddingTop: "20px", marginTop: "24px", display: "flex", flexDirection: "column", gap: "16px" };
		const regionTitleStyle = { color: "var(--dsw-alias-label-primary)", margin: 0, fontSize: "14px", fontWeight: 600, lineHeight: "22px" };
		const usageTitleStyle = { ...regionTitleStyle, fontWeight: 500 };
		const usageGroupsStyle = { width: "100%", display: "flex", flexDirection: "column", gap: "10px" };
		const usageGroupStyle = { width: "100%", display: "flex", flexDirection: "column", gap: "8px" };
		const usageGroupSeparatedStyle = { borderTop: "1px solid var(--dsw-alias-border-l2)", paddingTop: "10px" };
		const usageGroupTitleStyle = { color: "var(--dsw-alias-label-primary)", margin: 0, fontSize: "13px", fontWeight: 500, lineHeight: "20px" };
		const usageGroupLimitsStyle = { width: "100%", display: "flex", flexDirection: "column", gap: "10px" };
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
			const useSnapshot = bindSnapshotSelector(controller.store);
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
