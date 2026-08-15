import { CODEX_USAGE_URL, resolveUsageProxy } from "./usage.js";

const LOCAL_PROXY_BYPASS = Object.freeze(["localhost", "127.0.0.1", "::1"]);
let setupPromise;

function localNoProxy(env) {
	const configured = env.no_proxy || env.NO_PROXY || "";
	const entries = configured.split(/[\s,]+/).filter(Boolean);
	for (const hostname of LOCAL_PROXY_BYPASS) {
		if (!entries.includes(hostname)) entries.push(hostname);
	}
	return entries.join(",");
}

/**
 * Install a proxy-aware global dispatcher only while Node still uses Undici's
 * default dispatcher. A caller-provided dispatcher always wins.
 */
export async function installCodexFetchProxy(options = {}) {
	const env = options.env ?? process.env;
	const resolveProxy = options.resolveProxy ?? resolveUsageProxy;
	const proxyUrl = await resolveProxy(CODEX_USAGE_URL, { env });
	if (proxyUrl === void 0) return false;

	const loadUndici = options.loadUndici ?? (() => import("undici"));
	const {
		Agent,
		EnvHttpProxyAgent,
		getGlobalDispatcher,
		setGlobalDispatcher
	} = await loadUndici();
	const current = getGlobalDispatcher();
	if (!(current instanceof Agent) || current.constructor !== Agent) return false;

	const proxy = proxyUrl.toString();
	setGlobalDispatcher(new EnvHttpProxyAgent({
		httpProxy: proxy,
		httpsProxy: proxy,
		noProxy: localNoProxy(env)
	}));
	return true;
}

/** Configure the model transport at most once per DSH process. */
export function ensureCodexFetchProxy() {
	setupPromise ??= installCodexFetchProxy();
	return setupPromise;
}
