import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { OpenAICodexAuthService } from "../lib/index.js";

test("registered Codex adapter prepares image input before calling the provider", async (t) => {
	const ctx = new Context();
	let adapter;
	for (const key of ["llm", "tools", "attachments"]) ctx.provide(key);
	ctx.set("llm", { registerAdapter(_providers, value) { adapter = value; } });
	ctx.set("tools", { register() {} });
	const data = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=", "base64");
	const attachment = {
		attachmentId: "test-image", mediaType: "image/png", bytes: data.length,
		width: 1, height: 1
	};
	let imageReads = 0;
	ctx.set("attachments", {
		async readImageRequest(ref, policy) {
			imageReads++;
			assert.equal(ref, attachment);
			assert.ok(Number.isSafeInteger(policy.maxPixels) && policy.maxPixels > 0,
				"Image request maxPixels must be a positive integer.");
			assert.ok(Number.isSafeInteger(policy.maxBytes) && policy.maxBytes > 0,
				"Image request maxBytes must be a positive integer.");
			assert.deepEqual(policy, { maxPixels: 4_194_304, maxBytes: 1_048_576 });
			return { ...ref, data, variantId: "test-variant" };
		}
	});
	new OpenAICodexAuthService(ctx);
	// Keep authentication and transport offline; exercise the real registered adapter.
	t.mock.method(adapter.config, "resolveApiKey", async () => "test-access-token");
	const profile = adapter.config.profiles().get("openai-codex");
	const model = profile.piProvider.getModels().find((entry) => entry.input.includes("image"));
	assert.ok(model, "Codex exposes an image-capable model");
	let providerContext;
	t.mock.method(profile.piProvider, "streamSimple", async function* (_model, context) {
		providerContext = context;
		yield { type: "done", reason: "stop", message: {
			role: "assistant", content: [{ type: "text", text: "A test image." }],
			api: model.api, provider: model.provider, model: model.id,
			stopReason: "stop", timestamp: 0,
			usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } }
		} };
	});
	const chunks = [];
	for await (const chunk of adapter.stream({
		provider: "openai-codex", model: model.id,
		messages: [{ role: "user", content: [
			{ type: "text", text: "Describe this image." },
			{ type: "image", attachment }
		] }]
	})) {
		chunks.push(chunk);
	}
	assert.equal(chunks.at(-1).type, "finish");
	assert.equal(chunks.at(-1).reason.kind, "stop");
	assert.equal(imageReads, 1);
	assert.ok(providerContext, "prepared image reaches the provider");
	assert.deepEqual(providerContext.messages[0].content.find((block) => block.type === "image"), {
		type: "image", data: data.toString("base64"), mimeType: "image/png"
	});
});
