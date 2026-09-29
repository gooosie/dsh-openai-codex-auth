import assert from "node:assert/strict";
import test from "node:test";
import { parseResetCredits, requestResetCredits, consumeResetCredit, createResetRedeemer, RESET_CREDITS_URL } from "../lib/reset-credits.js";

const credential = { access: "mock-access", accountId: "mock-account" };
const input = { idempotencyKey: "12345678-1234-4234-8234-123456789abc", confirmed: true, creditId: "private-id" };
const other = { ...input, idempotencyKey: "12345678-1234-4234-8234-123456789abd" };
const json = (payload) => new Response(JSON.stringify(payload));
const details = { available_count: 2, credits: [
	{ id: "private-id", status: "available", reset_type: "codex_rate_limits", expires_at: "2099-07-17T00:00:00Z", profile_user_id: "private-user" },
	{ id: "second-card", status: "available", reset_type: "codex_rate_limits", expires_at: null },
	{ status: "redeemed", reset_type: "codex_rate_limits", expires_at: "2099-07-17T00:00:00Z" },
	{ status: "available", reset_type: "codex_rate_limits", expires_at: "2000-07-17T00:00:00Z" }
] };

test("reset details strip identities, retain unknown expiry and exclude used/expired cards", () => {
	assert.deepEqual(parseResetCredits(details), { availableCount: 2, cards: [
		{ id: "private-id", expiresAt: Date.parse("2099-07-17T00:00:00Z") }, { id: "second-card", expiresAt: null }
	] });
	for (const payload of [null, {}, { available_count: -1, credits: [] }, { available_count: 0, credits: null }]) {
		assert.throws(() => parseResetCredits(payload));
	}
});

test("reset read uses GET and only mocked transport", async () => {
	const result = await requestResetCredits(credential, async (url, init) => {
		assert.equal(url, RESET_CREDITS_URL);
		assert.equal(init.method, "GET");
		assert.equal(init.body, undefined);
		return json(details);
	});
	assert.equal(result.availableCount, 2);
});

test("consume wire matches official source: POST JSON redeem_request_id, safe redirects and OAuth headers", async () => {
	for (const code of ["reset", "already_redeemed", "no_credit", "nothing_to_reset"]) {
		assert.equal(await consumeResetCredit(credential, input, async (url, init) => {
			assert.equal(url, RESET_CREDITS_URL + "/consume");
			assert.equal(init.method, "POST");
			assert.equal(init.redirect, "error");
			assert.equal(init.headers.Authorization, "Bearer mock-access");
			assert.equal(init.headers["chatgpt-account-id"], "mock-account");
			assert.equal(init.headers["Content-Type"], "application/json");
			assert.deepEqual(JSON.parse(init.body), { redeem_request_id: input.idempotencyKey, credit_id: input.creditId });
			assert.ok(init.signal instanceof AbortSignal);
			return json({ code, windows_reset: 2, credit: { private: true } });
		}), code);
	}
});

test("consume refuses missing confirmation or invalid keys before calling transport", async () => {
	for (const invalid of [{}, { ...input, confirmed: false }, { ...input, idempotencyKey: "bad" }, { ...input, token: "private" }]) {
		await assert.rejects(consumeResetCredit(credential, invalid, () => assert.fail("must not send")));
	}
});

test("redeemer deduplicates double clicks and remembers completed attempts", async () => {
	const redeem = createResetRedeemer();
	let calls = 0;
	const fetchMock = async (_url, init) => {
		calls++;
		return json(init.method === "GET" ? details : { code: "reset" });
	};
	const results = await Promise.all([redeem(credential, input, fetchMock), redeem(credential, input, fetchMock)]);
	assert.deepEqual(results, ["reset", "reset"]);
	assert.equal(calls, 2);
	assert.equal(await redeem(credential, input, () => assert.fail("replay")), "reset");
	assert.equal(await redeem({ ...credential, accountId: "other" }, input, fetchMock), "account_changed");
});

test("uncertain redemption retains key, blocks a new attempt and never auto-retries", async () => {
	const redeem = createResetRedeemer();
	let posts = 0;
	assert.equal(await redeem(credential, input, async (_url, init) => {
		if (init.method === "GET") return json(details);
		posts++;
		throw new Error("mock timeout with secret response");
	}), "unknown");
	assert.equal(posts, 1);
	assert.equal(await redeem(credential, other, () => assert.fail("new request")), "pending");
	assert.equal(await redeem(credential, input, async (_url, init) => {
		assert.equal(init.method, "POST");
		assert.equal(JSON.parse(init.body).redeem_request_id, input.idempotencyKey);
		assert.equal(JSON.parse(init.body).credit_id, input.creditId);
		return json({ code: "already_redeemed" });
	}), "already_redeemed");
});

test("no-credit and failed preflight never POST; error bodies are not returned", async () => {
	for (const response of [json({ available_count: 0, credits: [] }), new Response("private details", { status: 403 })]) {
		let calls = 0;
		const result = await createResetRedeemer()(credential, input, async (_url, init) => {
			assert.equal(init.method, "GET");
			calls++;
			return response;
		});
		assert.ok(["no_credit", "unavailable"].includes(result));
		assert.equal(calls, 1);
	}
});

test("logout or account change during preflight prevents POST", async () => {
	assert.equal(await createResetRedeemer()(credential, input, async (_url, init) => {
		assert.equal(init.method, "GET");
		return json(details);
	}, () => false), "account_changed");
});

test("selected card must still exist: never silently consume a different card", async () => {
	const code = await createResetRedeemer()(credential, { ...input, creditId: "missing" }, async (_url, init) => {
		assert.equal(init.method, "GET");
		return json(details);
	});
	assert.equal(code, "no_credit");
});

test("one idempotency key cannot be reused for a different card", async () => {
	const redeem = createResetRedeemer();
	await redeem(credential, input, async (_url, init) => init.method === "GET" ? json(details) : Promise.reject(new Error("timeout")));
	await assert.rejects(redeem(credential, { ...input, creditId: "second-card" }, () => assert.fail("no transport")), /cannot change cards/);
});
