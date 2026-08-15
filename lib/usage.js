/**
 * Read the aggregate Codex usage summary exposed to the official Codex client.
 *
 * This is a ChatGPT backend endpoint, not a documented Platform API. Keep the
 * feature best-effort: callers must never make login or model requests depend
 * on it, and only the non-identifying limit summary may leave this module.
 */

import { execFile } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { promisify } from "node:util";

export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const execFileAsync = promisify(execFile);

function proxyFromEnvironment(target, env) {
	const noProxy = env.no_proxy || env.NO_PROXY || "";
	const hostname = target.hostname.toLowerCase();
	const bypassed = noProxy.split(/[\s,]+/).some((entry) => {
		const value = entry.trim().toLowerCase().replace(/^\*\./, ".").split(":", 1)[0];
		return value === "*" || value.length > 0 && (hostname === value || value.startsWith(".") && hostname.endsWith(value));
	});
	if (bypassed) return void 0;
	return env.https_proxy || env.HTTPS_PROXY || env.all_proxy || env.ALL_PROXY || void 0;
}

function normalizeProxy(value, protocol = "https") {
	if (typeof value !== "string" || value.trim().length === 0) return void 0;
	let candidate = value.trim();
	if (candidate.includes("=") && candidate.includes(";")) {
		const entries = Object.fromEntries(candidate.split(";").map((part) => part.split("=", 2)).filter((part) => part.length === 2));
		candidate = entries[protocol] || entries.http || "";
	}
	if (candidate.length === 0) return void 0;
	if (!candidate.includes("://")) candidate = `http://${candidate}`;
	try {
		const url = new URL(candidate);
		return url.protocol === "http:" || url.protocol === "https:" ? url : void 0;
	} catch {
		return void 0;
	}
}

async function readWindowsInternetProxy() {
	const key = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings";
	const enabled = await execFileAsync("reg.exe", ["query", key, "/v", "ProxyEnable"], {
		encoding: "utf8",
		windowsHide: true
	});
	if (!/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(enabled.stdout)) return void 0;
	const server = await execFileAsync("reg.exe", ["query", key, "/v", "ProxyServer"], {
		encoding: "utf8",
		windowsHide: true
	});
	return server.stdout.match(/ProxyServer\s+REG_SZ\s+(.+)$/im)?.[1]?.trim();
}

/** Resolve standard proxy variables, then the enabled Windows internet proxy. */
export async function resolveUsageProxy(targetUrl, options = {}) {
	const target = new URL(targetUrl);
	const env = options.env ?? process.env;
	const fromEnvironment = normalizeProxy(proxyFromEnvironment(target, env), target.protocol.slice(0, -1));
	if (fromEnvironment !== void 0) return fromEnvironment;
	if ((options.platform ?? process.platform) !== "win32") return void 0;
	try {
		const readWindowsProxy = options.readWindowsProxy ?? readWindowsInternetProxy;
		return normalizeProxy(await readWindowsProxy(), target.protocol.slice(0, -1));
	} catch {
		return void 0;
	}
}

async function usageFetch(url, init) {
	const proxyUrl = await resolveUsageProxy(url);
	let agent;
	if (proxyUrl !== void 0) {
		const { HttpsProxyAgent } = await import("https-proxy-agent");
		agent = new HttpsProxyAgent(proxyUrl);
	}
	return new Promise((resolve, reject) => {
		const request = httpsRequest(url, {
			method: init.method,
			headers: init.headers,
			agent,
			signal: init.signal
		}, (response) => {
			const chunks = [];
			let size = 0;
			response.on("data", (chunk) => {
				size += chunk.length;
				if (size > MAX_RESPONSE_BYTES) {
					request.destroy(new Error("OpenAI Codex usage response was too large"));
					return;
				}
				chunks.push(chunk);
			});
			response.on("end", () => {
				const body = Buffer.concat(chunks).toString("utf8");
				resolve({
					ok: response.statusCode >= 200 && response.statusCode < 300,
					status: response.statusCode ?? 0,
					json: async () => JSON.parse(body)
				});
			});
		});
		request.on("error", reject);
		request.end();
	});
}

function finiteNumber(value) {
	const number = typeof value === "number" ? value : Number(value);
	return Number.isFinite(number) ? number : void 0;
}

function safeText(value, maxLength = 80) {
	return typeof value === "string" && value.length > 0 && value.length <= maxLength ? value : void 0;
}

function normalizeWindow(value, name, now) {
	if (value === null || typeof value !== "object") return void 0;
	const rawUsedPercent = finiteNumber(value.used_percent);
	if (rawUsedPercent === void 0) return void 0;
	const windowSeconds = finiteNumber(value.limit_window_seconds);
	const resetAtSeconds = finiteNumber(value.reset_at);
	const resetAfterSeconds = finiteNumber(value.reset_after_seconds);
	const resetAt = resetAtSeconds !== void 0
		? resetAtSeconds * 1000
		: resetAfterSeconds !== void 0
			? now + Math.max(0, resetAfterSeconds) * 1000
			: 0;
	return {
		name,
		usedPercent: Math.min(100, Math.max(0, rawUsedPercent)),
		windowSeconds: windowSeconds === void 0 ? 0 : Math.max(0, windowSeconds),
		resetAt
	};
}

function appendRateLimit(target, rateLimit, name, now) {
	if (rateLimit === null || typeof rateLimit !== "object") return;
	const primary = normalizeWindow(rateLimit.primary_window, name, now);
	const secondary = normalizeWindow(rateLimit.secondary_window, name, now);
	if (primary !== void 0) target.push(primary);
	if (secondary !== void 0) target.push(secondary);
}

/**
 * Strip a usage response down to display-safe aggregate fields.
 * User id, account id, and email returned by the endpoint are deliberately
 * ignored and are never persisted into DSH settings.
 */
export function parseCodexUsage(payload, now = Date.now()) {
	if (payload === null || typeof payload !== "object") {
		throw new Error("OpenAI Codex usage response was not an object");
	}
	const limits = [];
	appendRateLimit(limits, payload.rate_limit, "Codex", now);
	if (Array.isArray(payload.additional_rate_limits)) {
		for (const entry of payload.additional_rate_limits.slice(0, 8)) {
			if (entry === null || typeof entry !== "object") continue;
			const name = safeText(entry.limit_name);
			if (name !== void 0) appendRateLimit(limits, entry.rate_limit, name, now);
		}
	}
	const rawCredits = payload.credits;
	const hasCredits = rawCredits !== null && typeof rawCredits === "object" && rawCredits.has_credits === true;
	const rawBalance = hasCredits ? rawCredits.balance : void 0;
	const balance = typeof rawBalance === "number" && Number.isFinite(rawBalance)
		? String(rawBalance)
		: typeof rawBalance === "string" && /^\d+(?:\.\d+)?$/.test(rawBalance)
			? rawBalance
			: "";
	return {
		limits,
		credits: {
			hasCredits,
			unlimited: hasCredits && rawCredits.unlimited === true,
			balance
		}
	};
}

/** Fetch and sanitize the current Codex usage summary. */
export async function requestCodexUsage(credential, fetchImpl = usageFetch, now = Date.now()) {
	if (
		credential === null || typeof credential !== "object" ||
		typeof credential.access !== "string" || credential.access.length === 0 ||
		typeof credential.accountId !== "string" || credential.accountId.length === 0
	) {
		throw new Error("OpenAI Codex usage requires a valid OAuth credential");
	}
	const response = await fetchImpl(CODEX_USAGE_URL, {
		method: "GET",
		headers: {
			Authorization: `Bearer ${credential.access}`,
			"chatgpt-account-id": credential.accountId,
			Accept: "application/json"
		},
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (!response.ok) {
		throw new Error(`OpenAI Codex usage request failed (${response.status})`);
	}
	return parseCodexUsage(await response.json(), now);
}
