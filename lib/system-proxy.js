import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Worker } from "node:worker_threads";
import { ProxyAgent, fetch as proxyFetch } from "undici";

const KEY = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
export const SYSTEM_PROXY_ERROR = "Windows manual HTTP/HTTPS system proxy is unavailable. PAC is not supported; configure a manual proxy or follow DSH.";
const FAILURE = SYSTEM_PROXY_ERROR;

/** Parse only the current user's manual WinINET proxy. Never return addresses to Web UI. */
export function parseSystemProxy(output) {
	const values = {};
	for (const line of output.split(/\r?\n/)) {
		const match = /^\s*(ProxyEnable|ProxyServer|AutoConfigURL|ProxyOverride)\s+REG_\w+\s+(.*?)\s*$/.exec(line);
		if (match) values[match[1]] = match[2];
	}
	if (values.AutoConfigURL || Number(values.ProxyEnable) !== 1 || !values.ProxyServer) throw new Error(FAILURE);
	const proxies = {};
	const address = (value) => {
		const url = new URL(value.includes("://") ? value : `http://${value}`);
		if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error(FAILURE);
		return url.href;
	};
	try {
		if (!values.ProxyServer.includes("=")) proxies.http = proxies.https = address(values.ProxyServer);
		else for (const entry of values.ProxyServer.split(";")) {
			const match = /^\s*(https?)\s*=\s*(.+?)\s*$/.exec(entry);
			if (match) proxies[match[1]] = address(match[2]);
		}
	} catch { throw new Error(FAILURE); }
	// All Codex endpoints require HTTPS. Do not silently fall back to direct traffic.
	if (!proxies.https) throw new Error(FAILURE);
	return { ...proxies, bypass: values.ProxyOverride ?? "" };
}

export async function readSystemProxy(platform = process.platform, execute = promisify(execFile)) {
	if (platform !== "win32") throw new Error(FAILURE);
	try {
		const result = await execute("reg.exe", ["query", KEY], { encoding: "utf8", windowsHide: true, timeout: 5000, maxBuffer: 65536 });
		return parseSystemProxy(typeof result === "string" ? result : result.stdout);
	} catch { throw new Error(FAILURE); }
}

export function bypassSystemProxy(url, bypass) {
	const host = url.hostname.replace(/^\[|\]$/g, "").toLowerCase();
	if (["localhost", "::1"].includes(host) || /^127\./.test(host)) return true;
	return bypass.split(";").some((raw) => {
		const pattern = raw.trim().toLowerCase();
		if (!pattern) return false;
		if (pattern === "<local>") return !host.includes(".") && !host.includes(":");
		const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
		return new RegExp(`^${escaped}$`).test(pattern.includes(":") ? url.host.toLowerCase() : host);
	});
}

/** Independent dispatcher: never changes host environment or global dispatcher. */
export function systemProxyTransport(policy) {
	const agents = new Map();
	return {
		async fetch(input, init) {
			const url = new URL(typeof input === "string" || input instanceof URL ? input : input.url);
			if (bypassSystemProxy(url, policy.bypass)) {
				// Explicit system bypass must not accidentally inherit the DSH proxy.
				const { Agent } = await import("undici");
				if (!agents.has("direct")) agents.set("direct", new Agent());
				return proxyFetch(input, { ...init, dispatcher: agents.get("direct") });
			}
			const address = policy[url.protocol.slice(0, -1)];
			if (!address) throw new Error(FAILURE);
			if (!agents.has(address)) agents.set(address, new ProxyAgent(address));
			return proxyFetch(input, { ...init, dispatcher: agents.get(address) });
		},
		close: () => Promise.all([...agents.values()].map((agent) => agent.destroy()))
	};
}

/** pi-ai OAuth has no per-call fetch hook: isolate its global fetch in a Worker. */
export function systemOAuth(policy, operation, credential, interaction = {}, workers = new Set()) {
	return new Promise((resolve, reject) => {
		if (interaction.signal?.aborted) return reject(new Error("Codex proxy operation cancelled."));
		const worker = new Worker(new URL("./system-proxy-worker.js", import.meta.url), {
			workerData: { policy, operation, credential, providerUrl: import.meta.resolve("@earendil-works/pi-ai/providers/openai-codex") }
		});
		workers.add(worker);
		let finished = false;
		const finish = (error, result) => {
			if (finished) return;
			finished = true;
			clearTimeout(timer);
			interaction.signal?.removeEventListener("abort", abort);
			workers.delete(worker);
			void worker.terminate();
			if (error) reject(error); else resolve(result);
		};
		const abort = () => finish(new Error("Codex proxy operation cancelled."));
		const timer = setTimeout(() => finish(new Error("Codex proxy operation timed out.")), operation === "login" ? 15 * 60_000 : 30_000);
		interaction.signal?.addEventListener("abort", abort, { once: true });
		worker.on("message", (message) => {
			if (message.type === "notify") {
				try { interaction.notify?.(message.value); } catch { finish(new Error("Codex proxy login notification failed.")); }
			} else if (message.type === "result") finish(null, message.value);
			else if (message.type === "error") finish(new Error("Codex system-proxy OAuth request failed."));
		});
		worker.on("error", () => finish(new Error("Codex system-proxy worker failed.")));
		worker.on("exit", () => { if (!finished) finish(new Error("Codex system-proxy worker stopped.")); });
	});
}
