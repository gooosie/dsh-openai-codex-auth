import { readSystemProxy, systemProxyTransport, systemOAuth, SYSTEM_PROXY_ERROR } from "./system-proxy.js";

/** Per-operation leases pin old connections until OAuth, response bodies or streams finish. */
export function createProxyManager(initialMode, hostOAuth, dependencies = {}) {
	const read = dependencies.read ?? readSystemProxy;
	const makeTransport = dependencies.transport ?? systemProxyTransport;
	const workerOAuth = dependencies.oauth ?? systemOAuth;
	const hostFetch = dependencies.fetch ?? globalThis.fetch;
	const routes = new Set();
	const workers = new Set();
	let disposed = false;
	function make(mode) {
		const route = { mode, users: 0, retired: false, closed: false, error: "", transport: null };
		routes.add(route);
		route.ready = (async () => {
			if (mode === "system") {
				route.policy = await read();
				route.transport = makeTransport(route.policy);
			}
		})().catch(() => { route.error = SYSTEM_PROXY_ERROR; });
		route.fetch = async (...args) => {
			await route.ready;
			if (route.error) throw new Error(route.error);
			return mode === "system" ? route.transport.fetch(...args) : hostFetch(...args);
		};
		return route;
	}
	function collect(route, force = false) {
		if (route.closed || !force && (!route.retired || route.users !== 0)) return;
		route.closed = true;
		routes.delete(route);
		void route.ready.then(() => route.transport?.close()).catch(() => {});
	}
	let current = make(initialMode);
	return {
		get mode() { return current.mode; },
		get error() { return current.error; },
		get ready() { return current.ready; },
		async prepare(mode) {
			if (disposed) throw new Error("Proxy manager disposed");
			const candidate = make(mode);
			await candidate.ready;
			if (candidate.error || disposed) {
				collect(candidate, true);
				throw new Error(candidate.error || "Proxy manager disposed");
			}
			return candidate;
		},
		commit(candidate) {
			if (disposed) { collect(candidate, true); throw new Error("Proxy manager disposed"); }
			const old = current;
			current = candidate;
			old.retired = true;
			collect(old);
		},
		discard(candidate) { collect(candidate, true); },
		acquire() {
			if (disposed) throw new Error("Proxy manager disposed");
			const route = current;
			route.users++;
			let released = false;
			return {
				mode: route.mode,
				fetch: route.fetch,
				async oauth(operation, credential, interaction) {
					await route.ready;
					if (route.error) throw new Error(route.error);
					if (route.mode === "system") return workerOAuth(route.policy, operation, credential, interaction, workers);
					return operation === "login" ? hostOAuth.login(interaction) : hostOAuth.refresh(credential);
				},
				release() { if (!released) { released = true; route.users--; collect(route); } }
			};
		},
		dispose() {
			disposed = true;
			for (const worker of workers) void worker.terminate();
			for (const route of routes) collect(route, true);
		}
	};
}
