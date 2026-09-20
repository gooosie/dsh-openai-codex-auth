import assert from "node:assert/strict";
import test from "node:test";

import { CODEX_USAGE_URL, parseCodexUsage, requestCodexUsage } from "../lib/usage.js";

const payload = {
	user_id: "must-not-leave-parser",
	account_id: "must-not-leave-parser",
	email: "must-not-leave-parser@example.com",
	rate_limit: {
		primary_window: {
			used_percent: 24.5,
			limit_window_seconds: 18000,
			reset_at: 1900000000
		},
		secondary_window: {
			used_percent: 70,
			limit_window_seconds: 604800,
			reset_after_seconds: 90
		}
	},
	additional_rate_limits: [{
		limit_name: "GPT-5.3-Codex-Spark",
		rate_limit: {
			primary_window: {
				used_percent: 5,
				limit_window_seconds: 3600,
				reset_at: 1900000100
			}
		}
	}],
	credits: {
		has_credits: true,
		unlimited: false,
		balance: "12.50"
	}
};

test("usage parser keeps only aggregate windows and credits", () => {
	const usage = parseCodexUsage(payload, 1000000);
	assert.deepEqual(usage, {
		limits: [
			{ name: "Codex", usedPercent: 24.5, windowSeconds: 18000, resetAt: 1900000000000 },
			{ name: "Codex", usedPercent: 70, windowSeconds: 604800, resetAt: 1090000 },
			{ name: "GPT-5.3-Codex-Spark", usedPercent: 5, windowSeconds: 3600, resetAt: 1900000100000 }
		],
		credits: { hasCredits: true, unlimited: false, balance: "12.50" }
	});
	assert.doesNotMatch(JSON.stringify(usage), /must-not-leave-parser/);
});

test("usage request sends OAuth headers and returns a sanitized summary", async () => {
	let request;
	const fetchImpl = async (url, init) => {
		request = { url, init };
		return new Response(JSON.stringify(payload), {
			status: 200,
			headers: { "content-type": "application/json" }
		});
	};
	const usage = await requestCodexUsage({ access: "secret-access", accountId: "account-123" }, fetchImpl, 1000000);
	assert.equal(request.url, CODEX_USAGE_URL);
	assert.equal(request.init.method, "GET");
	assert.equal(request.init.headers.Authorization, "Bearer secret-access");
	assert.equal(request.init.headers["chatgpt-account-id"], "account-123");
	assert.equal(usage.limits.length, 3);
});

test("usage request never includes an error response body", async () => {
	const fetchImpl = async () => new Response("private backend details", { status: 403 });
	await assert.rejects(
		requestCodexUsage({ access: "secret-access", accountId: "account-123" }, fetchImpl),
		(error) => error.message === "OpenAI Codex usage request failed (403)"
	);
});

test("usage uses the host fetch without selecting a dispatcher", async (t) => {
	let calls = 0;
	t.mock.method(globalThis, "fetch", async (url, init) => {
		calls++;
		assert.equal(url, CODEX_USAGE_URL);
		assert.equal("dispatcher" in init, false);
		assert.equal("agent" in init, false);
		assert.equal(init.redirect, "error");
		assert.ok(init.signal instanceof AbortSignal);
		return Response.json(payload);
	});
	await requestCodexUsage({ access: "fake-token", accountId: "fake-account" });
	assert.equal(calls, 1);
});

test("usage rejects and cancels a chunked response over 1 MiB", async () => {
	let cancelled = false;
	const response = new Response(new ReadableStream({
		pull(controller) { controller.enqueue(new Uint8Array(600_000)); },
		cancel() { cancelled = true; }
	}));
	await assert.rejects(requestCodexUsage({ access: "fake-token", accountId: "fake-account" },
		async () => response), /response was too large/);
	assert.equal(cancelled, true);
});

test("usage accepts valid JSON exactly at the 1 MiB limit", async () => {
	const json = JSON.stringify(payload);
	const response = new Response(json.padEnd(1024 * 1024, " "));
	const usage = await requestCodexUsage({ access: "fake-token", accountId: "fake-account" },
		async () => response, 1000000);
	assert.deepEqual(usage, parseCodexUsage(payload, 1000000));
});

test("usage cancels an HTTP error body without reading private details", async () => {
	let cancelled = false;
	const response = new Response(new ReadableStream({
		cancel() { cancelled = true; }
	}), { status: 401 });
	await assert.rejects(requestCodexUsage({ access: "fake-token", accountId: "fake-account" },
		async () => response), { message: "OpenAI Codex usage request failed (401)" });
	assert.equal(cancelled, true);
});
