import assert from "node:assert/strict";
import test from "node:test";
import { createModels, getSupportedThinkingLevels } from "@earendil-works/pi-ai";
import { createCodexProvider, DEFAULT_CODEX_REASONING_LEVEL } from "../lib/provider.js";

test("Codex models expose distinct reasoning levels only", () => {
	const models = createCodexProvider().getModels();
	assert.ok(models.length > 0);

	for (const model of models) {
		const levels = getSupportedThinkingLevels(model);
		assert.deepEqual(levels.slice(0, 4), ["low", "medium", "high", "xhigh"], model.id);
		assert.equal(levels.includes("off"), false, model.id);
		assert.equal(levels.includes("minimal"), false, model.id);
		assert.equal(levels.includes("max"), model.thinkingLevelMap.max !== null, model.id);
	}
});

test("Codex provider keeps OAuth and streaming behavior", () => {
	const provider = createCodexProvider();
	assert.equal(provider.id, "openai-codex");
	assert.equal(typeof provider.auth.oauth?.login, "function");
	assert.equal(typeof provider.streamSimple, "function");
});

test("Codex provider accepts the refreshed OAuth access token from DSH", async () => {
	const models = createModels();
	const provider = createCodexProvider();
	models.setProvider(provider);
	const model = provider.getModels()[0];
	const accessToken = "test.oauth.access-token";

	const resolved = await models.getAuth(model, { apiKey: accessToken });

	assert.equal(resolved?.auth.apiKey, accessToken);
});

test("Codex uses an explicit supported level instead of provider default", () => {
	assert.equal(DEFAULT_CODEX_REASONING_LEVEL, "medium");
	for (const model of createCodexProvider().getModels()) {
		assert.ok(getSupportedThinkingLevels(model).includes(DEFAULT_CODEX_REASONING_LEVEL), model.id);
	}
});
