/**
 * Read the aggregate Codex usage summary exposed to the official Codex client.
 *
 * This is a ChatGPT backend endpoint, not a documented Platform API. Keep the
 * feature best-effort: callers must never make login or model requests depend
 * on it, and only the non-identifying limit summary may leave this module.
 */

export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
const REQUEST_TIMEOUT_MS = 10000;
const MAX_RESPONSE_BYTES = 1024 * 1024;

/** Read decoded response bytes with a hard bound, including chunked responses. */
async function readUsageJson(response) {
	if (response.body === null) throw new Error("OpenAI Codex usage response was empty");
	const reader = response.body.getReader();
	const chunks = [];
	let size = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_RESPONSE_BYTES) {
				throw new Error("OpenAI Codex usage response was too large");
			}
			chunks.push(value);
		}
	} finally {
		await reader.cancel().catch(() => {});
		reader.releaseLock();
	}
	return JSON.parse(Buffer.concat(chunks, size).toString("utf8"));
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
export async function requestCodexUsage(credential, fetchImpl = globalThis.fetch, now = Date.now()) {
	if (
		credential === null || typeof credential !== "object" ||
		typeof credential.access !== "string" || credential.access.length === 0 ||
		typeof credential.accountId !== "string" || credential.accountId.length === 0
	) {
		throw new Error("OpenAI Codex usage requires a valid OAuth credential");
	}
	const response = await fetchImpl(CODEX_USAGE_URL, {
		method: "GET",
		redirect: "error",
		headers: {
			Authorization: `Bearer ${credential.access}`,
			"chatgpt-account-id": credential.accountId,
			Accept: "application/json"
		},
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
	});
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new Error(`OpenAI Codex usage request failed (${response.status})`);
	}
	return parseCodexUsage(await readUsageJson(response), now);
}
