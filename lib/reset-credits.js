// Contract: openai/codex, backend-client/src/client/rate_limit_resets.rs
// and backend-client/src/types.rs. Private ChatGPT backend, best effort.
import { readUsageJson } from "./usage.js";

export const RESET_CREDITS_URL = "https://chatgpt.com/backend-api/wham/rate-limit-reset-credits";
export const RESET_CODES = ["reset", "already_redeemed", "no_credit", "nothing_to_reset"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function validateResetRequest(value) {
	if (!value || Object.keys(value).some((key) => !["idempotencyKey", "confirmed", "creditId"].includes(key)) ||
		typeof value.creditId !== "string" || !/^[A-Za-z0-9_-]{1,200}$/.test(value.creditId) ||
		value.confirmed !== true || typeof value.idempotencyKey !== "string" || !uuid.test(value.idempotencyKey)) {
		throw new Error("Invalid reset confirmation");
	}
	return value;
}

async function request(credential, fetchImpl, body) {
	if (!credential?.access || !credential?.accountId) throw new Error("Reset credits require sign-in");
	const response = await fetchImpl(RESET_CREDITS_URL + (body ? "/consume" : ""), {
		method: body ? "POST" : "GET",
		redirect: "error",
		headers: {
			Authorization: `Bearer ${credential.access}`,
			"chatgpt-account-id": credential.accountId,
			Accept: "application/json",
			...(body ? { "Content-Type": "application/json" } : {})
		},
		...(body ? { body: JSON.stringify(body) } : {}),
		signal: AbortSignal.timeout(10000)
	});
	if (!response.ok) {
		await response.body?.cancel().catch(() => {});
		throw new Error("Reset credits request failed");
	}
	return readUsageJson(response);
}

export function parseResetCredits(payload, now = Date.now()) {
	if (!payload || !Number.isSafeInteger(payload.available_count) || payload.available_count < 0 ||
		!Array.isArray(payload.credits) || payload.credits.length > 1000) throw new Error("Invalid reset credits");
	const cards = payload.credits.filter((card) => card?.status === "available" && card.reset_type === "codex_rate_limits" && typeof card.id === "string" && /^[A-Za-z0-9_-]{1,200}$/.test(card.id))
		.map((card) => {
			const expiresAt = typeof card.expires_at === "string" ? Date.parse(card.expires_at) : NaN;
			return { id: card.id, expiresAt: Number.isFinite(expiresAt) && expiresAt > 0 ? expiresAt : null };
		})
		.filter((card) => card.expiresAt === null || card.expiresAt > now)
		.sort((a, b) => (a.expiresAt ?? Infinity) - (b.expiresAt ?? Infinity));
	return { availableCount: payload.available_count, cards };
}

export async function requestResetCredits(credential, fetchImpl = globalThis.fetch) {
	return parseResetCredits(await request(credential, fetchImpl));
}

/** Never called by polling, startup, or tools. Caller must supply an explicit confirmation. */
export async function consumeResetCredit(credential, input, fetchImpl = globalThis.fetch) {
	validateResetRequest(input);
	const result = await request(credential, fetchImpl, { redeem_request_id: input.idempotencyKey, credit_id: input.creditId });
	if (!RESET_CODES.includes(result?.code)) throw new Error("Unknown reset result");
	return result.code;
}

/** Serialize redemptions; retries retain the key, and completed calls cannot spend twice. */
export function createResetRedeemer() {
	const attempts = new Map();
	let pending = null;
	return async (credential, input, fetchImpl, isCurrent = () => true) => {
		validateResetRequest(input);
		const key = input.idempotencyKey;
		let entry = attempts.get(key);
		if (entry && entry.accountId !== credential.accountId) return "account_changed";
		if (entry && entry.creditId !== input.creditId) throw new Error("Reset attempt cannot change cards");
		if (entry?.result) return entry.result;
		if (entry?.promise) return entry.promise;
		if (pending && pending !== key) return "pending";
		if (!entry) {
			if (attempts.size >= 100) return "pending";
			entry = { accountId: credential.accountId, creditId: input.creditId };
			attempts.set(key, entry);
		}
		pending = key;
		entry.promise = (async () => {
			try {
				// On an uncertain retry, do not preflight: replay the SAME backend key
				// even if the previous request consumed the final credit.
				if (!entry.sent) {
					const details = await requestResetCredits(credential, fetchImpl);
					if (details.availableCount === 0 || !details.cards.some((card) => card.id === input.creditId)) return "no_credit";
				}
				if (!isCurrent()) return "account_changed";
				entry.sent = true;
				return await consumeResetCredit(credential, input, fetchImpl);
			} catch {
				return entry.sent ? "unknown" : "unavailable";
			}
		})().then((code) => {
			if (code !== "unknown") {
				entry.result = code;
				pending = null;
			}
			return code;
		}).finally(() => { entry.promise = null; });
		return entry.promise;
	};
}
