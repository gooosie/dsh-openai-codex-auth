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
		const LOCALE_TAGS = { en: "en-US", zh: "zh-CN", ja: "ja-JP", es: "es-ES", fr: "fr-FR", de: "de-DE", ru: "ru-RU", pt: "pt-BR" };
		const SNAPSHOT_KEYS = new Set([
			"proxyMode", "proxyRestartRequired", "proxyError",
			"status", "loggedIn", "deviceCode", "verificationUri", "expiresAt", "error",
			"usageStatus", "usageLimited", "usageLimits", "usageCredits", "usageCreditsUnlimited",
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

		const PUBLIC_ERROR_CODES = new Set([
			"loginFailed", "refreshSignInFailed", "usageFailed", "notLoggedIn", "proxyUnavailable",
			"verificationUrlMissing", "verificationUrlInvalid", "verificationUrlUntrusted"
		]);
		const ACTION_FAILURES = {
			startLogin: "loginFailed",
			logout: "logoutFailed",
			followHostProxy: "proxySaveFailed",
			useSystemProxy: "proxySaveFailed"
		};

		function localizedFailure(t, code, fallback) {
			return t(PUBLIC_ERROR_CODES.has(code) ? code : fallback);
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
			if (!USAGE_STATUSES.has(value.usageStatus) || typeof value.usageCreditsUnlimited !== "boolean" || typeof value.usageLimited !== "boolean") {
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
				error: false,
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
						s.error = false;
					});
				}
				try {
					const section = unwrap(await this.remote.snapshot());
					if (generation !== this.generation) return;
					const credentialConfigured = section.loggedIn;
					const current = this.store.getSnapshot();
					if (
						current.status === "ready" &&
						!current.error &&
						sameJson(current.section, section) &&
						current.credentialConfigured === credentialConfigured
					) return;
					this.store.update((s) => {
						s.status = "ready";
						s.error = false;
						s.section = section;
						s.credentialConfigured = credentialConfigured;
						s.writable = true;
					});
				} catch {
					if (generation !== this.generation) return;
					this.store.update((s) => {
						if (!background) s.status = "error";
						s.error = true;
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

		function ResetCards({ section, controller, t, locale, busy, setBusy }) {
			const [selected, setSelected] = (0, react.useState)(null);
			const [pending, setPending] = (0, react.useState)(readResetAttempt);
			const [result, setResult] = (0, react.useState)(null);
			const submitting = (0, react.useRef)(false);
			const ready = section?.resetCardsStatus === "ready";
			const count = section?.usageResetCredits;
			const cards = ready ? section.resetCards ?? [] : [];
			const expiry = (card, compact = false) => card?.expiresAt == null ? t("resetExpiryUnknown") :
				t("resetExpires", { date: expiryText(card.expiresAt, locale, compact) });
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
			const row = (card, retryOnly = false) => {
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
					(0, react_jsx_runtime.jsx)("span", { style: { ...introStyle, fontSize: "12px" },
						children: count == null ? t("resetCreditsUnavailable") : t("resetAvailable", { count: count.toLocaleString(locale) }) })
				] }),
				...cards.map((card) => row(card)),
				pending?.creditId && !cards.some((card) => card.id === pending.creditId) ? row({ id: pending.creditId, expiresAt: pending.expiresAt }, true) : null,
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
		function expiryText(value, locale, compact = false) {
			if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return void 0;
			try {
				return compact
					? new Date(value).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" })
					: new Date(value).toLocaleString(locale);
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

		function usageWindowText(seconds, t, locale) {
			if (seconds >= 86400 && seconds % 86400 === 0) return unitText(seconds / 86400, "day", locale);
			if (seconds >= 3600) return unitText(Math.round(seconds / 3600), "hour", locale);
			if (seconds >= 60) return unitText(Math.round(seconds / 60), "minute", locale);
			return t("usageWindow");
		}

		function unitText(value, unit, locale) {
			return new Intl.NumberFormat(locale, { style: "unit", unit, unitDisplay: "long" }).format(value);
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

		function UsageLimit({ limit, t, locale }) {
			const windowLabel = usageWindowText(limit.windowSeconds, t, locale);
			const label = `${limit.name} · ${windowLabel}`;
			const remaining = Number(Math.max(0, Math.min(100, 100 - limit.usedPercent)).toFixed(1));
			const percent = new Intl.NumberFormat(locale, { style: "percent", maximumFractionDigits: 1 }).format(remaining / 100);
			const remainingLabel = t("remaining", { percent });
			const resetAt = expiryText(limit.resetAt, locale);
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
								children: remainingLabel
							})
						]
					}),
					(0, react_jsx_runtime.jsx)("div", {
						role: "progressbar",
						"aria-label": `${label} · ${remainingLabel}`,
						"aria-valuemin": 0,
						"aria-valuemax": 100,
						"aria-valuenow": remaining,
						style: progressTrackStyle,
						children: (0, react_jsx_runtime.jsx)("div", {
							style: { ...progressFillStyle, width: `${remaining}%` }
						})
					}),
					resetAt === void 0 ? null : (0, react_jsx_runtime.jsx)("p", {
						style: usageResetStyle,
						children: t("resets", { date: resetAt })
					})
				]
			});
		}

		function UsageGroup({ group, t, locale, separated, hideTitle = false }) {
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
							t,
							locale
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
			const { controller, useSnapshot, useLocale, t } = props;
			if (controller === void 0 || useSnapshot === void 0 || useLocale === void 0 || t === void 0) return null;
			return (0, react_jsx_runtime.jsx)(Loaded, { injected: {
				controller,
				useSnapshot,
				useLocale,
				t
			} });
		}

		function Loaded({ injected }) {
			const { controller, t } = injected;
			const state = injected.useSnapshot((snapshot) => snapshot);
			const activeLocale = injected.useLocale((snapshot) => snapshot.active);
			const locale = Object.hasOwn(LOCALE_TAGS, activeLocale) ? LOCALE_TAGS[activeLocale] : activeLocale;
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

			// The initial load happens only once per page lifetime; without this the
			// usage bars stay frozen at whatever was fetched hours ago. Refresh on
			// mount and every minute while the card is visible — the host caches
			// usage for USAGE_CACHE_MS, so this costs at most one fetch per minute.
			(0, react.useEffect)(() => {
				void controller.load({ background: true });
				const timer = setInterval(() => {
					void controller.load({ background: true });
				}, 60000);
				return () => {
					clearInterval(timer);
				};
			}, [controller]);

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
				} catch {
					if (action === "startLogin") setRequested(false);
					setActionError(ACTION_FAILURES[action]);
				} finally {
					setBusy(false);
					if (isProxy) setProxySaving(false);
				}
			};

			const copyDeviceCode = async (deviceCode) => {
				if (navigator.clipboard?.writeText === void 0) {
					setActionError("copyUnavailable");
					return;
				}
				try {
					await navigator.clipboard.writeText(deviceCode);
					setCopiedCode(deviceCode);
					setActionError(void 0);
				} catch {
					setActionError("copyFailed");
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
						children: t("loadFailed")
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
			const expiresAt = expiryText(section === void 0 ? void 0 : section["expiresAt"], locale);
			const flowError = section === void 0 ? void 0 : section["error"];
			const hasDeviceCode = typeof deviceCode === "string" && deviceCode.length > 0;
			const usageLimits = usageLimitsOf(section === void 0 ? void 0 : section["usageLimits"]);
			const usageGroups = groupUsageLimits(usageLimits);
			const usageError = section === void 0 ? void 0 : section["usageError"];
			const usageCredits = section === void 0 ? void 0 : section["usageCredits"];
			const usageCreditsUnlimited = section !== void 0 && section["usageCreditsUnlimited"] === true;
			const usageLimited = section !== void 0 && section["usageLimited"] === true;

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
						children: localizedFailure(t, flowError, "loginFailed")
					}) : null,
					state.status === "ready" && state.error ? (0, react_jsx_runtime.jsx)("p", {
						style: errorStyle,
						children: t("refreshFailed")
					}) : null,
					actionError !== void 0 ? (0, react_jsx_runtime.jsx)("p", {
						style: errorStyle,
						children: t(actionError)
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
									expiresAt === void 0 ? null : (0, react_jsx_runtime.jsx)("p", { style: introStyle, children: t("expiresAt", { date: expiresAt }) }),
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
									usageLimited ? (0, react_jsx_runtime.jsx)("p", {
										style: errorStyle,
										children: t("usageLimited")
									}) : null,
									usageStatus === "loading" && usageLimits.length === 0 ? (0, react_jsx_runtime.jsx)("p", {
										style: statusLineStyle,
										children: t("loadingUsage")
									}) : null,
									usageGroups.length === 0 ? null : (0, react_jsx_runtime.jsx)("div", {
										style: usageGroupsStyle,
										children: usageGroups.map((group, index) => (0, react_jsx_runtime.jsx)(UsageGroup, {
											group,
											t,
											locale,
											hideTitle: usageGroups.length === 1 && group.name === "Codex",
											separated: index > 0
										}, group.name))
									}),

									usageCreditsUnlimited ? (0, react_jsx_runtime.jsx)("p", {
										style: statusLineStyle,
										children: t("credits", { amount: t("unlimited") })
									}) : typeof usageCredits === "string" && usageCredits.length > 0 ? (0, react_jsx_runtime.jsx)("p", {
										style: statusLineStyle,
										children: t("credits", { amount: usageCredits })
									}) : null,
									usageStatus === "ready" && usageLimits.length === 0 && !usageCreditsUnlimited && !(typeof usageCredits === "string" && usageCredits.length > 0) ? (0, react_jsx_runtime.jsx)("p", {
										style: noticeStyle,
										children: t("usageUnavailable")
									}) : null,
									usageStatus === "error" ? (0, react_jsx_runtime.jsx)("p", {
										style: noticeStyle,
										children: localizedFailure(t, usageError, "usageFailed")
									}) : null
								]
							}),
							(0, react_jsx_runtime.jsx)(ResetCards, { section, controller, t, locale, busy, setBusy })
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

		/** Settings copy shipped inside the self-contained DSH client module. */
		const en = {
			title: "OpenAI Codex",
			intro: "Sign in with ChatGPT to use OpenAI Codex in DSH.",
			proxyLabel: "Proxy",
			resetCreditsUnavailable: "Available card count is unknown",
			resetUse: "Use reset",
			resetTitle: "Reset credits",
			connected: "Connected to ChatGPT",
			resetAvailable: "Available cards: {count}",
			resetFull: "Full reset",
			resetLegacyPending: "An earlier reset has an unresolved record. Check its result in the original version before starting another reset.",
			resetRetry: "Retry same reset",
			resetExpires: "Expires {date}",
			resetExpiryUnknown: "Expiry not provided",
			resetDetailsUnavailable: "Card expiry details are unavailable.",
			resetDetailsPartial: "Some cards have no displayable expiry details.",
			resetConfirmTitle: "Use one reset card?",
			resetConfirmHint: "This may use the selected reset card to reset eligible Codex usage limits across the account, including other sessions. The server determines which limits reset. This action is irreversible.",
			resetRetryHint: "The previous result is uncertain. This reuses the same request ID. Check current usage and card count before continuing.",
			resetCancel: "Cancel",
			resetConfirm: "Confirm reset",
			resetResult_reset: "Reset applied. Usage and cards have been refreshed where available.",
			resetResult_already_redeemed: "This request was already redeemed; no new reset was requested.",
			resetResult_no_credit: "The selected reset card is no longer available. Refresh before choosing another card.",
			resetResult_nothing_to_reset: "There are no eligible limits to reset. No card was consumed.",
			resetResult_unknown: "Result uncertain. Check usage and cards. Retry only this reset from the same window.",
			resetResult_unavailable: "Could not check available cards. No reset was sent.",
			resetResult_pending: "Another reset is pending. Return to its original window to check the result.",
			resetResult_account_changed: "Account changed. Return to the original account to resolve the pending reset.",
			proxyHost: "Follow DSH",
			proxySystem: "Windows system proxy",
			proxyHint: "New requests use the selected route immediately. Active requests keep their connection. System mode uses SSE and requires a manual proxy.",
			proxySaving: "Applying…",
			proxyReload: "Reload system proxy",
			proxySaveFailed: "Could not apply the proxy. Check the manual system proxy and configuration permissions. The previous mode is unchanged.",
			proxyUnavailable: "No supported Windows manual HTTPS proxy found. PAC and SOCKS are not supported. Configure a manual proxy or follow DSH.",
			loading: "Loading login state…",
			loadFailed: "Loading login state failed",
			refreshFailed: "Refreshing login state failed",
			retry: "Retry",
			readOnly: "The settings document is read-only in this deployment.",
			loginFailed: "Could not sign in to OpenAI Codex. Try again.",
			logoutFailed: "Could not sign out of OpenAI Codex. Try again.",
			refreshSignInFailed: "Could not refresh your OpenAI Codex sign-in. Try signing in again.",
			verificationUrlMissing: "OpenAI did not return a device verification URL.",
			verificationUrlInvalid: "OpenAI returned an invalid device verification URL.",
			verificationUrlUntrusted: "The device verification URL is outside OpenAI’s sign-in service.",
			waitingHint: "Enter this code on the verification page:",
			gettingCode: "Getting a device code…",
			copy: "Copy code",
			copied: "Copied",
			copyFailed: "Copy failed",
			copyUnavailable: "Clipboard access is unavailable",
			openUrl: "Verification page:",
			waitingPoll: "Waiting for authorization. Status updates automatically.",
			expiresAt: "Token expires at {date}",
			autoRefresh: "The token refreshes automatically while the harness runs.",
			usageTitle: "Codex usage",
			usageLimited: "Codex usage limit reached",
			loadingUsage: "Loading usage…",
			remaining: "{percent} remaining",
			resets: "Resets at {date}",
			usageWindow: "Usage window",
			credits: "Credits balance: {amount}",
			unlimited: "Unlimited",
			usageUnavailable: "No usage window was returned.",
			usageFailed: "Usage unavailable",
			notLoggedIn: "Not logged in yet.",
			login: "Sign in with ChatGPT",
			logout: "Sign out",
			working: "Working…"
		};

		const zh = {
			title: "OpenAI Codex",
			intro: "登录 ChatGPT，在 DSH 中使用 OpenAI Codex。",
			proxyLabel: "网络代理",
			resetCreditsUnavailable: "暂时无法读取可用卡数",
			resetUse: "使用重置额度",
			resetTitle: "重置卡",
			connected: "已连接 ChatGPT",
			resetAvailable: "可用卡数：{count}",
			resetFull: "完全重置",
			resetLegacyPending: "有旧版或无法读取的待确认记录，请先在原版本核对结果，再发起新的重置。",
			resetRetry: "重试同一次重置",
			resetExpires: "到期时间：{date}",
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
			proxySaving: "正在应用…",
			proxyReload: "重新读取系统代理",
			proxySaveFailed: "代理切换失败，请检查手动系统代理及配置写入权限。原模式保持不变。",
			proxyUnavailable: "没有可用的 Windows 手动 HTTPS 代理。不支持 PAC 或 SOCKS，请设置手动代理或选择跟随 DSH。",
			loading: "正在读取登录状态…",
			loadFailed: "读取登录状态失败",
			refreshFailed: "刷新登录状态失败",
			retry: "重试",
			readOnly: "当前部署的设置文档为只读。",
			loginFailed: "无法登录 OpenAI Codex，请重试。",
			logoutFailed: "无法退出 OpenAI Codex 登录，请重试。",
			refreshSignInFailed: "无法续期 OpenAI Codex 登录，请重新登录。",
			verificationUrlMissing: "OpenAI 未返回设备验证网址。",
			verificationUrlInvalid: "OpenAI 返回了无效的设备验证网址。",
			verificationUrlUntrusted: "设备验证网址不属于 OpenAI 登录服务。",
			waitingHint: "在验证页面输入设备码：",
			gettingCode: "正在获取设备码…",
			copy: "复制设备码",
			copied: "已复制",
			copyFailed: "复制失败",
			copyUnavailable: "当前浏览器无法访问剪贴板",
			openUrl: "验证页面：",
			waitingPoll: "等待授权，状态会自动更新。",
			expiresAt: "令牌有效期至 {date}",
			autoRefresh: "令牌在 Harness 运行期间会自动刷新。",
			usageTitle: "Codex 用量",
			usageLimited: "Codex 已达使用上限",
			loadingUsage: "正在读取用量…",
			remaining: "剩余 {percent}",
			resets: "{date} 重置",
			usageWindow: "用量周期",
			credits: "Credits 余额：{amount}",
			unlimited: "无限",
			usageUnavailable: "未返回可显示的用量周期。",
			usageFailed: "暂时无法读取用量",
			notLoggedIn: "尚未登录。",
			login: "使用 ChatGPT 登录",
			logout: "退出登录",
			working: "处理中…"
		};

		const ja = {
			title: "OpenAI Codex",
			intro: "ChatGPT アカウントでサインインして、DSH で OpenAI Codex を利用できます。",
			proxyLabel: "プロキシ",
			resetCreditsUnavailable: "利用可能なカード枚数を取得できません",
			resetUse: "リセットカードを使う",
			resetTitle: "リセットカード",
			connected: "ChatGPT に接続済み",
			resetAvailable: "利用可能なカード: {count} 枚",
			resetFull: "完全リセット",
			resetLegacyPending: "以前のリセット結果が確認できていません。新しいリセットの前に、元のバージョンで結果を確認してください。",
			resetRetry: "同じリセットを再試行",
			resetExpires: "有効期限: {date}",
			resetExpiryUnknown: "有効期限の情報がありません",
			resetDetailsUnavailable: "カードの有効期限を取得できません。",
			resetDetailsPartial: "一部のカードの有効期限を表示できません。",
			resetConfirmTitle: "リセットカードを 1 枚使いますか？",
			resetConfirmHint: "選択したカード 1 枚を消費して、同じアカウントの他のセッションも含め、対象の Codex 利用上限をリセットする場合があります。リセット対象はサーバーで決まります。この操作は取り消せません。",
			resetRetryHint: "前回の結果を確認できていません。同じリクエスト ID で再試行します。続行前に利用状況とカード枚数を確認してください。",
			resetCancel: "キャンセル",
			resetConfirm: "リセットを確定",
			resetResult_reset: "リセットしました。取得できた利用状況とカード情報を更新しました。",
			resetResult_already_redeemed: "このリクエストは既に処理済みです。新しいリセットは送信されていません。",
			resetResult_no_credit: "選択したカードは利用できなくなりました。更新してから別のカードを選んでください。",
			resetResult_nothing_to_reset: "リセット対象の上限がありません。カードは消費されていません。",
			resetResult_unknown: "結果を確認できていません。利用状況とカードを確認し、同じウィンドウからこのリセットだけを再試行してください。",
			resetResult_unavailable: "利用可能なカードを確認できませんでした。リセットは送信されていません。",
			resetResult_pending: "別のリセットが処理中です。元のウィンドウで結果を確認してください。",
			resetResult_account_changed: "アカウントが変わりました。元のアカウントに戻り、保留中のリセット結果を確認してください。",
			proxyHost: "DSH の設定に従う",
			proxySystem: "Windows のシステムプロキシ",
			proxyHint: "新しいリクエストには選択した経路がすぐに適用されます。処理中のリクエストは現在の接続を使い続けます。システムモードでは SSE と手動プロキシを使用します。",
			proxySaving: "適用中…",
			proxyReload: "システムプロキシを再読み込み",
			proxySaveFailed: "プロキシ設定を適用できませんでした。手動プロキシと設定の書き込み権限を確認してください。現在のモードで動作を続けます。",
			proxyUnavailable: "利用できる Windows の手動 HTTPS プロキシがありません。PAC と SOCKS には対応していません。手動プロキシを設定するか、DSH の設定に従ってください。",
			loading: "サインイン状態を読み込み中…",
			loadFailed: "サインイン状態を読み込めませんでした。",
			refreshFailed: "サインイン状態を更新できませんでした。",
			retry: "再試行",
			readOnly: "この環境では設定ファイルは読み取り専用です。",
			loginFailed: "OpenAI Codex にサインインできませんでした。もう一度お試しください。",
			logoutFailed: "OpenAI Codex からサインアウトできませんでした。もう一度お試しください。",
			refreshSignInFailed: "OpenAI Codex のサインインを更新できませんでした。再度サインインしてください。",
			verificationUrlMissing: "OpenAI からデバイス確認用の URL が返されませんでした。",
			verificationUrlInvalid: "OpenAI から無効なデバイス確認用 URL が返されました。",
			verificationUrlUntrusted: "デバイス確認用の URL が OpenAI のサインインサービスに属していません。",
			waitingHint: "確認ページでこのコードを入力してください。",
			gettingCode: "デバイスコードを取得中…",
			copy: "コードをコピー",
			copied: "コピーしました",
			copyFailed: "コピーできませんでした。",
			copyUnavailable: "クリップボードにアクセスできません。",
			openUrl: "確認ページ:",
			waitingPoll: "承認を待っています。状態は自動で更新されます。",
			expiresAt: "トークンの有効期限: {date}",
			autoRefresh: "DSH の実行中にトークンは自動で更新されます。",
			usageTitle: "Codex の利用状況",
			usageLimited: "Codex の利用上限に達しました。",
			loadingUsage: "利用状況を読み込み中…",
			remaining: "残り {percent}",
			resets: "{date} にリセット",
			usageWindow: "利用期間",
			credits: "クレジット残高: {amount}",
			unlimited: "無制限",
			usageUnavailable: "表示できる利用期間がありません。",
			usageFailed: "利用状況を読み込めませんでした。",
			notLoggedIn: "サインインしていません。",
			login: "ChatGPT でサインイン",
			logout: "サインアウト",
			working: "処理中…"
		};

		const es = {
			title: "OpenAI Codex",
			intro: "Inicia sesión con ChatGPT para usar OpenAI Codex en DSH.",
			proxyLabel: "Proxy",
			resetCreditsUnavailable: "No se conoce el número de tarjetas disponibles",
			resetUse: "Usar una tarjeta de restablecimiento",
			resetTitle: "Tarjetas de restablecimiento",
			connected: "Conectado a ChatGPT",
			resetAvailable: "Tarjetas disponibles: {count}",
			resetFull: "Restablecimiento completo",
			resetLegacyPending: "Queda por confirmar el resultado de un restablecimiento anterior. Compruébalo en la versión original antes de iniciar otro.",
			resetRetry: "Reintentar el mismo restablecimiento",
			resetExpires: "Caduca el {date}",
			resetExpiryUnknown: "Fecha de caducidad no disponible",
			resetDetailsUnavailable: "No se han podido consultar las fechas de caducidad de las tarjetas.",
			resetDetailsPartial: "No se puede mostrar la caducidad de algunas tarjetas.",
			resetConfirmTitle: "¿Usar una tarjeta de restablecimiento?",
			resetConfirmHint: "Esta acción puede consumir la tarjeta seleccionada para restablecer los límites de uso de Codex aplicables en toda la cuenta, incluidas otras sesiones. El servidor decide qué límites se restablecen. La acción es irreversible.",
			resetRetryHint: "El resultado anterior es incierto. Se volverá a usar el mismo ID de solicitud. Comprueba el uso y las tarjetas disponibles antes de continuar.",
			resetCancel: "Cancelar",
			resetConfirm: "Confirmar restablecimiento",
			resetResult_reset: "Restablecimiento aplicado. Se actualizaron los datos de uso y las tarjetas que estaban disponibles.",
			resetResult_already_redeemed: "Esta solicitud ya se procesó. No se solicitó otro restablecimiento.",
			resetResult_no_credit: "La tarjeta seleccionada ya no está disponible. Actualiza los datos antes de seleccionar otra.",
			resetResult_nothing_to_reset: "No hay límites que se puedan restablecer. No se consumió ninguna tarjeta.",
			resetResult_unknown: "El resultado es incierto. Comprueba el uso y las tarjetas. Reintenta únicamente este restablecimiento desde la misma ventana.",
			resetResult_unavailable: "No se pudieron comprobar las tarjetas disponibles. No se envió el restablecimiento.",
			resetResult_pending: "Hay otro restablecimiento pendiente. Vuelve a su ventana original para consultar el resultado.",
			resetResult_account_changed: "La cuenta ha cambiado. Vuelve a la cuenta original para comprobar el restablecimiento pendiente.",
			proxyHost: "Usar los ajustes de DSH",
			proxySystem: "Proxy del sistema de Windows",
			proxyHint: "Las nuevas solicitudes usan de inmediato la ruta elegida. Las solicitudes en curso conservan su conexión. El modo del sistema usa SSE y requiere un proxy manual.",
			proxySaving: "Aplicando…",
			proxyReload: "Volver a cargar el proxy del sistema",
			proxySaveFailed: "No se pudo aplicar el proxy. Comprueba el proxy manual y los permisos de configuración. Se sigue usando el modo anterior.",
			proxyUnavailable: "No hay un proxy HTTPS manual de Windows compatible. PAC y SOCKS no son compatibles. Configura un proxy manual o usa los ajustes de DSH.",
			loading: "Cargando el estado de la sesión…",
			loadFailed: "No se pudo cargar el estado de la sesión.",
			refreshFailed: "No se pudo actualizar el estado de la sesión.",
			retry: "Reintentar",
			readOnly: "El documento de configuración es de solo lectura en este entorno.",
			loginFailed: "No se pudo iniciar sesión en OpenAI Codex. Inténtalo de nuevo.",
			logoutFailed: "No se pudo cerrar la sesión de OpenAI Codex. Inténtalo de nuevo.",
			refreshSignInFailed: "No se pudo renovar la sesión de OpenAI Codex. Vuelve a iniciar sesión.",
			verificationUrlMissing: "OpenAI no devolvió una URL de verificación del dispositivo.",
			verificationUrlInvalid: "OpenAI devolvió una URL de verificación del dispositivo no válida.",
			verificationUrlUntrusted: "La URL de verificación del dispositivo no pertenece al servicio de inicio de sesión de OpenAI.",
			waitingHint: "Introduce este código en la página de verificación.",
			gettingCode: "Obteniendo el código de dispositivo…",
			copy: "Copiar código",
			copied: "Copiado",
			copyFailed: "No se pudo copiar el código.",
			copyUnavailable: "No se puede acceder al portapapeles.",
			openUrl: "Página de verificación:",
			waitingPoll: "Esperando la autorización. El estado se actualiza automáticamente.",
			expiresAt: "El token caduca el {date}",
			autoRefresh: "El token se renueva automáticamente mientras DSH está en ejecución.",
			usageTitle: "Uso de Codex",
			usageLimited: "Se alcanzó el límite de uso de Codex.",
			loadingUsage: "Cargando datos de uso…",
			remaining: "{percent} restante",
			resets: "Se restablece el {date}",
			usageWindow: "Periodo de uso",
			credits: "Saldo de créditos: {amount}",
			unlimited: "Ilimitado",
			usageUnavailable: "No se recibió ningún periodo de uso.",
			usageFailed: "No se pudieron cargar los datos de uso.",
			notLoggedIn: "Aún no has iniciado sesión.",
			login: "Iniciar sesión con ChatGPT",
			logout: "Cerrar sesión",
			working: "Procesando…"
		};

		const fr = {
			title: "OpenAI Codex",
			intro: "Connectez-vous avec ChatGPT pour utiliser OpenAI Codex dans DSH.",
			proxyLabel: "Proxy",
			resetCreditsUnavailable: "Nombre de cartes disponibles inconnu",
			resetUse: "Utiliser une carte de réinitialisation",
			resetTitle: "Cartes de réinitialisation",
			connected: "Connecté à ChatGPT",
			resetAvailable: "Cartes disponibles : {count}",
			resetFull: "Réinitialisation complète",
			resetLegacyPending: "Le résultat d’une réinitialisation précédente est encore inconnu. Vérifiez-le dans la version d’origine avant de lancer une autre réinitialisation.",
			resetRetry: "Réessayer la même réinitialisation",
			resetExpires: "Expire le {date}",
			resetExpiryUnknown: "Date d’expiration inconnue",
			resetDetailsUnavailable: "Impossible de lire les dates d’expiration des cartes.",
			resetDetailsPartial: "Certaines cartes n’ont pas de date d’expiration à afficher.",
			resetConfirmTitle: "Utiliser une carte de réinitialisation ?",
			resetConfirmHint: "Cette opération peut consommer la carte sélectionnée pour réinitialiser les limites d’utilisation éligibles de Codex sur le compte, y compris dans les autres sessions. Le serveur décide quelles limites réinitialiser. L’opération est irréversible.",
			resetRetryHint: "Le résultat précédent est incertain. Le même identifiant de requête sera réutilisé. Vérifiez votre utilisation et le nombre de cartes avant de continuer.",
			resetCancel: "Annuler",
			resetConfirm: "Confirmer la réinitialisation",
			resetResult_reset: "Réinitialisation effectuée. Les données d’utilisation et les informations sur les cartes ont été actualisées lorsqu’elles étaient disponibles.",
			resetResult_already_redeemed: "Cette requête a déjà été traitée. Aucune nouvelle réinitialisation n’a été demandée.",
			resetResult_no_credit: "La carte sélectionnée est indisponible. Actualisez les données avant de choisir une autre carte.",
			resetResult_nothing_to_reset: "Aucune limite n’est éligible à la réinitialisation. Aucune carte n’a été consommée.",
			resetResult_unknown: "Le résultat est incertain. Vérifiez les données d’utilisation et les cartes. Réessayez uniquement cette réinitialisation, dans la même fenêtre.",
			resetResult_unavailable: "Impossible de vérifier les cartes disponibles. Aucune demande de réinitialisation n’a été envoyée.",
			resetResult_pending: "Une autre réinitialisation est en attente. Revenez à sa fenêtre d’origine pour en vérifier le résultat.",
			resetResult_account_changed: "Le compte a changé. Revenez au compte d’origine pour vérifier la réinitialisation en attente.",
			proxyHost: "Utiliser les paramètres de DSH",
			proxySystem: "Proxy système de Windows",
			proxyHint: "Les nouvelles requêtes empruntent immédiatement la route choisie. Les requêtes en cours gardent leur connexion. Le mode système utilise SSE et requiert un proxy manuel.",
			proxySaving: "Application…",
			proxyReload: "Recharger le proxy système",
			proxySaveFailed: "Impossible d’appliquer le proxy. Vérifiez le proxy manuel et les droits de modification des paramètres. Le mode précédent reste actif.",
			proxyUnavailable: "Aucun proxy HTTPS manuel compatible n’est disponible dans Windows. PAC et SOCKS ne sont pas pris en charge. Configurez un proxy manuel ou utilisez les paramètres de DSH.",
			loading: "Chargement de l’état de connexion…",
			loadFailed: "Impossible de charger l’état de connexion.",
			refreshFailed: "Impossible d’actualiser l’état de connexion.",
			retry: "Réessayer",
			readOnly: "Le document des paramètres est en lecture seule dans cet environnement.",
			loginFailed: "Impossible de se connecter à OpenAI Codex. Réessayez.",
			logoutFailed: "Impossible de se déconnecter d’OpenAI Codex. Réessayez.",
			refreshSignInFailed: "Impossible de renouveler la connexion à OpenAI Codex. Reconnectez-vous.",
			verificationUrlMissing: "OpenAI n’a fourni aucune URL de vérification de l’appareil.",
			verificationUrlInvalid: "OpenAI a fourni une URL de vérification de l’appareil invalide.",
			verificationUrlUntrusted: "L’URL de vérification de l’appareil n’appartient pas au service de connexion d’OpenAI.",
			waitingHint: "Saisissez ce code sur la page de vérification.",
			gettingCode: "Récupération du code d’appareil…",
			copy: "Copier le code",
			copied: "Copié",
			copyFailed: "Impossible de copier le code.",
			copyUnavailable: "Le presse-papiers est inaccessible.",
			openUrl: "Page de vérification :",
			waitingPoll: "En attente d’autorisation. L’état s’actualise automatiquement.",
			expiresAt: "Le jeton expire le {date}",
			autoRefresh: "Le jeton se renouvelle automatiquement tant que DSH est en cours d’exécution.",
			usageTitle: "Utilisation de Codex",
			usageLimited: "La limite d’utilisation de Codex est atteinte.",
			loadingUsage: "Chargement des données d’utilisation…",
			remaining: "{percent} restants",
			resets: "Réinitialisation le {date}",
			usageWindow: "Période d’utilisation",
			credits: "Solde de crédits : {amount}",
			unlimited: "Illimité",
			usageUnavailable: "Aucune période d’utilisation n’a été reçue.",
			usageFailed: "Impossible de charger les données d’utilisation.",
			notLoggedIn: "Vous n’êtes pas encore connecté.",
			login: "Se connecter avec ChatGPT",
			logout: "Se déconnecter",
			working: "Traitement…"
		};

		const de = {
			title: "OpenAI Codex",
			intro: "Melde dich mit ChatGPT an, um OpenAI Codex in DSH zu nutzen.",
			proxyLabel: "Proxy",
			resetCreditsUnavailable: "Anzahl verfügbarer Karten unbekannt",
			resetUse: "Reset-Karte verwenden",
			resetTitle: "Reset-Karten",
			connected: "Mit ChatGPT verbunden",
			resetAvailable: "Verfügbare Karten: {count}",
			resetFull: "Vollständiger Reset",
			resetLegacyPending: "Das Ergebnis eines früheren Resets ist ungeklärt. Prüfe es in der ursprünglichen Version, bevor du einen weiteren Reset startest.",
			resetRetry: "Denselben Reset erneut versuchen",
			resetExpires: "Läuft am {date} ab",
			resetExpiryUnknown: "Ablaufdatum unbekannt",
			resetDetailsUnavailable: "Die Ablaufdaten der Karten konnten nicht geladen werden.",
			resetDetailsPartial: "Für einige Karten ist kein Ablaufdatum verfügbar.",
			resetConfirmTitle: "Eine Reset-Karte verwenden?",
			resetConfirmHint: "Dabei kann die ausgewählte Karte verbraucht werden, um die dafür vorgesehenen Codex-Nutzungslimits für das gesamte Konto zurückzusetzen, auch in anderen Sitzungen. Der Server bestimmt, welche Limits zurückgesetzt werden. Die Aktion ist endgültig.",
			resetRetryHint: "Das vorherige Ergebnis ist unklar. Dieselbe Anfrage-ID wird erneut verwendet. Prüfe vor dem Fortfahren die Nutzung und die Anzahl der Karten.",
			resetCancel: "Abbrechen",
			resetConfirm: "Reset bestätigen",
			resetResult_reset: "Der Reset wurde durchgeführt. Verfügbare Nutzungs- und Karteninformationen wurden aktualisiert.",
			resetResult_already_redeemed: "Diese Anfrage wurde bereits eingelöst. Es wurde kein weiterer Reset angefordert.",
			resetResult_no_credit: "Die ausgewählte Karte ist nicht mehr verfügbar. Aktualisiere die Daten, bevor du eine andere Karte auswählst.",
			resetResult_nothing_to_reset: "Es gibt keine Limits, die zurückgesetzt werden können. Es wurde keine Karte verbraucht.",
			resetResult_unknown: "Ergebnis unklar. Prüfe Nutzung und Karten. Wiederhole ausschließlich diesen Reset im selben Fenster.",
			resetResult_unavailable: "Die verfügbaren Karten konnten nicht geprüft werden. Es wurde kein Reset gesendet.",
			resetResult_pending: "Ein anderer Reset ist noch offen. Prüfe das Ergebnis in dessen ursprünglichem Fenster.",
			resetResult_account_changed: "Das Konto wurde gewechselt. Kehre zum ursprünglichen Konto zurück, um den offenen Reset zu prüfen.",
			proxyHost: "DSH-Einstellungen verwenden",
			proxySystem: "Windows-Systemproxy",
			proxyHint: "Neue Anfragen verwenden sofort die ausgewählte Route. Laufende Anfragen behalten ihre Verbindung. Der Systemmodus verwendet SSE und benötigt einen manuell eingerichteten Proxy.",
			proxySaving: "Wird angewendet…",
			proxyReload: "Systemproxy neu laden",
			proxySaveFailed: "Der Proxy konnte nicht angewendet werden. Prüfe den manuellen Proxy und die Schreibrechte für die Konfiguration. Der bisherige Modus bleibt aktiv.",
			proxyUnavailable: "Es ist kein unterstützter manueller HTTPS-Proxy von Windows verfügbar. PAC und SOCKS werden nicht unterstützt. Richte einen manuellen Proxy ein oder verwende die DSH-Einstellungen.",
			loading: "Anmeldestatus wird geladen…",
			loadFailed: "Der Anmeldestatus konnte nicht geladen werden.",
			refreshFailed: "Der Anmeldestatus konnte nicht aktualisiert werden.",
			retry: "Erneut versuchen",
			readOnly: "Das Einstellungsdokument ist in dieser Umgebung schreibgeschützt.",
			loginFailed: "Die Anmeldung bei OpenAI Codex ist fehlgeschlagen. Versuche es erneut.",
			logoutFailed: "Die Abmeldung von OpenAI Codex ist fehlgeschlagen. Versuche es erneut.",
			refreshSignInFailed: "Die Anmeldung bei OpenAI Codex konnte nicht erneuert werden. Melde dich erneut an.",
			verificationUrlMissing: "OpenAI hat keine URL zur Gerätebestätigung zurückgegeben.",
			verificationUrlInvalid: "OpenAI hat eine ungültige URL zur Gerätebestätigung zurückgegeben.",
			verificationUrlUntrusted: "Die URL zur Gerätebestätigung gehört nicht zum OpenAI-Anmeldedienst.",
			waitingHint: "Gib diesen Code auf der Bestätigungsseite ein.",
			gettingCode: "Gerätecode wird abgerufen…",
			copy: "Code kopieren",
			copied: "Kopiert",
			copyFailed: "Der Code konnte nicht kopiert werden.",
			copyUnavailable: "Die Zwischenablage ist nicht verfügbar.",
			openUrl: "Bestätigungsseite:",
			waitingPoll: "Warte auf Autorisierung. Der Status wird automatisch aktualisiert.",
			expiresAt: "Token läuft am {date} ab",
			autoRefresh: "Das Token wird automatisch erneuert, solange DSH ausgeführt wird.",
			usageTitle: "Codex-Nutzung",
			usageLimited: "Das Codex-Nutzungslimit ist erreicht.",
			loadingUsage: "Nutzungsdaten werden geladen…",
			remaining: "{percent} verbleibend",
			resets: "Reset am {date}",
			usageWindow: "Nutzungszeitraum",
			credits: "Guthaben: {amount}",
			unlimited: "Unbegrenzt",
			usageUnavailable: "Es wurde kein Nutzungszeitraum zurückgegeben.",
			usageFailed: "Die Nutzungsdaten konnten nicht geladen werden.",
			notLoggedIn: "Du bist noch nicht angemeldet.",
			login: "Mit ChatGPT anmelden",
			logout: "Abmelden",
			working: "Wird verarbeitet…"
		};

		const ru = {
			title: "OpenAI Codex",
			intro: "Войдите через ChatGPT, чтобы использовать OpenAI Codex в DSH.",
			proxyLabel: "Прокси",
			resetCreditsUnavailable: "Число доступных карт неизвестно",
			resetUse: "Использовать карту сброса",
			resetTitle: "Карты сброса",
			connected: "Подключено к ChatGPT",
			resetAvailable: "Доступно карт: {count}",
			resetFull: "Полный сброс",
			resetLegacyPending: "Результат предыдущего сброса неизвестен. Перед новым сбросом проверьте результат в исходной версии.",
			resetRetry: "Повторить тот же сброс",
			resetExpires: "Срок действия истекает {date}",
			resetExpiryUnknown: "Срок действия неизвестен",
			resetDetailsUnavailable: "Не удалось получить сведения о сроке действия карт.",
			resetDetailsPartial: "Срок действия некоторых карт недоступен.",
			resetConfirmTitle: "Использовать одну карту сброса?",
			resetConfirmHint: "Выбранная карта может быть списана для сброса подходящих лимитов использования Codex во всём аккаунте, в том числе в других сеансах. Сервер определяет, какие лимиты будут сброшены. Действие необратимо.",
			resetRetryHint: "Результат предыдущего запроса неизвестен. Будет использован тот же идентификатор запроса. Перед продолжением проверьте использование и число карт.",
			resetCancel: "Отмена",
			resetConfirm: "Подтвердить сброс",
			resetResult_reset: "Сброс выполнен. Доступные данные об использовании и картах обновлены.",
			resetResult_already_redeemed: "Этот запрос уже обработан. Новый сброс не запрашивался.",
			resetResult_no_credit: "Выбранная карта больше недоступна. Обновите данные, прежде чем выбрать другую карту.",
			resetResult_nothing_to_reset: "Нет лимитов, подходящих для сброса. Карта не была списана.",
			resetResult_unknown: "Результат неизвестен. Проверьте использование и карты. Повторяйте только этот сброс и только в том же окне.",
			resetResult_unavailable: "Не удалось проверить доступные карты. Запрос на сброс не отправлен.",
			resetResult_pending: "Ожидается результат другого сброса. Проверьте его в исходном окне.",
			resetResult_account_changed: "Аккаунт изменился. Вернитесь в исходный аккаунт, чтобы проверить незавершённый сброс.",
			proxyHost: "Использовать настройки DSH",
			proxySystem: "Системный прокси Windows",
			proxyHint: "Новые запросы сразу идут по выбранному маршруту. Текущие запросы сохраняют соединение. Системный режим использует SSE и требует ручной настройки прокси.",
			proxySaving: "Применение…",
			proxyReload: "Перечитать настройки системного прокси",
			proxySaveFailed: "Не удалось применить настройки прокси. Проверьте ручную настройку прокси и права на запись конфигурации. Действует прежний режим.",
			proxyUnavailable: "Поддерживаемый ручной HTTPS-прокси Windows отсутствует. PAC и SOCKS не поддерживаются. Настройте прокси вручную или используйте настройки DSH.",
			loading: "Загрузка состояния входа…",
			loadFailed: "Не удалось загрузить состояние входа.",
			refreshFailed: "Не удалось обновить состояние входа.",
			retry: "Повторить",
			readOnly: "Документ настроек в этой среде доступен только для чтения.",
			loginFailed: "Не удалось войти в OpenAI Codex. Попробуйте ещё раз.",
			logoutFailed: "Не удалось выйти из OpenAI Codex. Попробуйте ещё раз.",
			refreshSignInFailed: "Не удалось обновить сеанс OpenAI Codex. Войдите снова.",
			verificationUrlMissing: "OpenAI не предоставил URL для подтверждения устройства.",
			verificationUrlInvalid: "OpenAI предоставил недействительный URL для подтверждения устройства.",
			verificationUrlUntrusted: "URL для подтверждения устройства не принадлежит службе входа OpenAI.",
			waitingHint: "Введите этот код на странице подтверждения.",
			gettingCode: "Получение кода устройства…",
			copy: "Скопировать код",
			copied: "Скопировано",
			copyFailed: "Не удалось скопировать код.",
			copyUnavailable: "Буфер обмена недоступен.",
			openUrl: "Страница подтверждения:",
			waitingPoll: "Ожидание авторизации. Статус обновляется автоматически.",
			expiresAt: "Срок действия токена истекает {date}",
			autoRefresh: "Пока DSH работает, токен обновляется автоматически.",
			usageTitle: "Использование Codex",
			usageLimited: "Достигнут лимит использования Codex.",
			loadingUsage: "Загрузка данных об использовании…",
			remaining: "Осталось {percent}",
			resets: "Сброс {date}",
			usageWindow: "Период использования",
			credits: "Баланс кредитов: {amount}",
			unlimited: "Без ограничений",
			usageUnavailable: "Не получен ни один период использования.",
			usageFailed: "Не удалось загрузить данные об использовании.",
			notLoggedIn: "Вход ещё не выполнен.",
			login: "Войти через ChatGPT",
			logout: "Выйти",
			working: "Выполняется…"
		};

		const pt = {
			title: "OpenAI Codex",
			intro: "Entre com o ChatGPT para usar o OpenAI Codex no DSH.",
			proxyLabel: "Proxy",
			resetCreditsUnavailable: "Quantidade de cartões disponíveis desconhecida",
			resetUse: "Usar um cartão de redefinição",
			resetTitle: "Cartões de redefinição",
			connected: "Conectado ao ChatGPT",
			resetAvailable: "Cartões disponíveis: {count}",
			resetFull: "Redefinição completa",
			resetLegacyPending: "O resultado de uma redefinição anterior ainda é desconhecido. Confira o resultado na versão original antes de iniciar outra redefinição.",
			resetRetry: "Tentar a mesma redefinição novamente",
			resetExpires: "Expira em {date}",
			resetExpiryUnknown: "Data de expiração desconhecida",
			resetDetailsUnavailable: "Não foi possível consultar as datas de expiração dos cartões.",
			resetDetailsPartial: "Alguns cartões não têm data de expiração para exibir.",
			resetConfirmTitle: "Usar um cartão de redefinição?",
			resetConfirmHint: "Esta ação pode consumir o cartão selecionado para redefinir os limites de uso aplicáveis do Codex em toda a conta, inclusive em outras sessões. O servidor determina quais limites serão redefinidos. A ação é irreversível.",
			resetRetryHint: "O resultado anterior é incerto. O mesmo ID de solicitação será reutilizado. Confira o uso e a quantidade de cartões antes de continuar.",
			resetCancel: "Cancelar",
			resetConfirm: "Confirmar redefinição",
			resetResult_reset: "Redefinição aplicada. Os dados de uso e dos cartões disponíveis foram atualizados.",
			resetResult_already_redeemed: "Esta solicitação já foi processada. Nenhuma nova redefinição foi solicitada.",
			resetResult_no_credit: "O cartão selecionado não está mais disponível. Atualize os dados antes de escolher outro cartão.",
			resetResult_nothing_to_reset: "Não há limites que possam ser redefinidos. Nenhum cartão foi consumido.",
			resetResult_unknown: "O resultado é incerto. Confira o uso e os cartões. Repita somente esta redefinição na mesma janela.",
			resetResult_unavailable: "Não foi possível verificar os cartões disponíveis. Nenhuma redefinição foi enviada.",
			resetResult_pending: "Outra redefinição está pendente. Volte à janela original para verificar o resultado.",
			resetResult_account_changed: "A conta mudou. Volte à conta original para verificar a redefinição pendente.",
			proxyHost: "Usar as configurações do DSH",
			proxySystem: "Proxy do sistema Windows",
			proxyHint: "Novas solicitações usam imediatamente a rota selecionada. Solicitações em andamento mantêm a conexão. O modo de sistema usa SSE e exige um proxy manual.",
			proxySaving: "Aplicando…",
			proxyReload: "Recarregar o proxy do sistema",
			proxySaveFailed: "Não foi possível aplicar o proxy. Verifique o proxy manual e as permissões de configuração. O modo anterior continua ativo.",
			proxyUnavailable: "Não há um proxy HTTPS manual do Windows compatível. PAC e SOCKS não são compatíveis. Configure um proxy manual ou use as configurações do DSH.",
			loading: "Carregando o status do login…",
			loadFailed: "Não foi possível carregar o status do login.",
			refreshFailed: "Não foi possível atualizar o status do login.",
			retry: "Tentar novamente",
			readOnly: "O documento de configurações é somente leitura neste ambiente.",
			loginFailed: "Não foi possível entrar no OpenAI Codex. Tente novamente.",
			logoutFailed: "Não foi possível sair do OpenAI Codex. Tente novamente.",
			refreshSignInFailed: "Não foi possível renovar a sessão do OpenAI Codex. Entre novamente.",
			verificationUrlMissing: "A OpenAI não retornou uma URL de verificação do dispositivo.",
			verificationUrlInvalid: "A OpenAI retornou uma URL de verificação do dispositivo inválida.",
			verificationUrlUntrusted: "A URL de verificação do dispositivo não pertence ao serviço de login da OpenAI.",
			waitingHint: "Insira este código na página de verificação.",
			gettingCode: "Obtendo o código do dispositivo…",
			copy: "Copiar código",
			copied: "Copiado",
			copyFailed: "Não foi possível copiar o código.",
			copyUnavailable: "A área de transferência está indisponível.",
			openUrl: "Página de verificação:",
			waitingPoll: "Aguardando autorização. O status é atualizado automaticamente.",
			expiresAt: "O token expira em {date}",
			autoRefresh: "O token é renovado automaticamente enquanto o DSH está em execução.",
			usageTitle: "Uso do Codex",
			usageLimited: "O limite de uso do Codex foi atingido.",
			loadingUsage: "Carregando dados de uso…",
			remaining: "{percent} restante",
			resets: "Redefinição em {date}",
			usageWindow: "Período de uso",
			credits: "Saldo de créditos: {amount}",
			unlimited: "Ilimitado",
			usageUnavailable: "Nenhum período de uso foi recebido.",
			usageFailed: "Não foi possível carregar os dados de uso.",
			notLoggedIn: "Você ainda não entrou.",
			login: "Entrar com o ChatGPT",
			logout: "Sair",
			working: "Processando…"
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
			ctx.effect(() => ctx.locale.register(NS, { en, zh, ja, es, fr, de, ru, pt }), "openai-codex-auth: copy dictionaries");
			const controller = new LoginController(remote);
			const useSnapshot = bindSnapshotSelector(controller.store);
			const useLocale = bindSnapshotSelector(ctx.locale);
			const t = ctx.locale.bind(NS);
			const injected = () => ({
				controller,
				useSnapshot,
				useLocale,
				t
			});
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "openai-codex-auth",
				order: 20,
				label: () => t("title"),
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
