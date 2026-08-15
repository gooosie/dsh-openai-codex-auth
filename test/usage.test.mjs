import assert from "node:assert/strict";
import test from "node:test";

import { CODEX_USAGE_URL, parseCodexUsage, requestCodexUsage, resolveUsageProxy } from "../lib/usage.js";

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

test("usage proxy resolution falls back to the enabled Windows system proxy", async () => {
	const proxy = await resolveUsageProxy(CODEX_USAGE_URL, {
		env: {},
		platform: "win32",
		readWindowsProxy: async () => "127.0.0.1:7897"
	});
	assert.equal(proxy?.toString(), "http://127.0.0.1:7897/");
});
