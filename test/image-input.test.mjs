import assert from "node:assert/strict";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { OpenAICodexAuthService } from "../lib/index.js";

function createImageHarness(t, readImageRequest) {
	const ctx = new Context();
	let adapter;
	for (const key of ["llm", "tools", "attachments"]) ctx.provide(key);
	ctx.set("llm", { registerAdapter(_providers, value) { adapter = value; } });
	ctx.set("tools", { register() {} });
	ctx.set("attachments", { readImageRequest });
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
	return async (messages) => {
		const chunks = [];
		for await (const chunk of adapter.stream({
			provider: "openai-codex", model: model.id, messages
		})) chunks.push(chunk);
		assert.equal(chunks.at(-1).type, "finish");
		assert.equal(chunks.at(-1).reason.kind, "stop");
		assert.ok(providerContext, "prepared image reaches the provider");
		return providerContext;
	};
}

test("registered Codex adapter prepares image input before calling the provider", async (t) => {
	const data = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1ioAAAAASUVORK5CYII=", "base64");
	const attachment = {
		attachmentId: "test-image", mediaType: "image/png", bytes: data.length,
		width: 1, height: 1
	};
	let imageReads = 0;
	const stream = createImageHarness(t, async (ref, policy) => {
		imageReads++;
		assert.equal(ref, attachment);
		assert.deepEqual(policy, { maxPixels: 4_194_304, maxBytes: 1_048_576 });
		return { ...ref, data, variantId: "test-variant" };
	});
	const providerContext = await stream([{ role: "user", content: [
		{ type: "text", text: "Describe this image." },
		{ type: "image", attachment }
	] }]);
	assert.equal(imageReads, 1);
	assert.deepEqual(providerContext.messages[0].content.find((block) => block.type === "image"), {
		type: "image", data: data.toString("base64"), mimeType: "image/png"
	});
});

for (const scenario of [
	{ name: "at the base64 budget", bytes: 786_432, kept: 20 },
	{ name: "just over the base64 budget", bytes: 786_433, kept: 19 },
	{ name: "with images across conversation history", bytes: 1_048_576, kept: 14, history: true },
	// DSH's per-image compression target is best-effort; check its exact-size pass too.
	{ name: "when prepared images exceed the estimate", bytes: 786_432, preparedBytes: 1_048_576, kept: 14 }
]) {
	test(`Codex bounds total request images ${scenario.name}`, async (t) => {
		const reads = [];
		const stream = createImageHarness(t, async (ref) => {
			reads.push(ref.attachmentId);
			// Synthetic attachment-service output: no decoding or provider network involved.
			const data = Buffer.alloc(scenario.preparedBytes ?? ref.bytes, Number(ref.attachmentId));
			return { ...ref, bytes: data.length, data, variantId: `variant-${ref.attachmentId}` };
		});
		const images = Array.from({ length: 20 }, (_, i) => ({ type: "image", attachment: {
			attachmentId: String(i), mediaType: "image/png", bytes: scenario.bytes,
			width: 1024, height: 1024
		} }));
		const prompt = { type: "text", text: "Describe these images." };
		const messages = scenario.history
			? images.map((image) => ({ role: "user", content: [prompt, image] }))
			: [{ role: "user", content: [prompt, ...images] }];
		const original = structuredClone(messages);
		const context = await stream(messages);
		const outputImages = context.messages.flatMap((message) =>
			Array.isArray(message.content) ? message.content.filter((block) => block.type === "image") : []);
		assert.equal(outputImages.length, scenario.kept);
		assert.ok(outputImages.reduce((sum, image) => sum + image.data.length, 0) <= 20_971_520,
			"base64 image payload stays within DSH's 20 MiB request budget");
		assert.deepEqual(outputImages.map((image) => Buffer.from(image.data, "base64")[0]),
			Array.from({ length: scenario.kept }, (_, i) => 20 - scenario.kept + i),
			"oldest images are offloaded first, preserving the newest images in order");
		assert.equal(reads.length, scenario.preparedBytes ? 20 : scenario.kept,
			"images offloaded during estimation do not need attachment reads");
		assert.equal(context.messages.length, messages.length, "text history is retained");
		for (const message of context.messages) {
			const text = typeof message.content === "string" ? message.content
				: message.content.filter((block) => block.type === "text").map((block) => block.text).join("\n");
			assert.ok(text.includes(prompt.text));
		}
		assert.deepEqual(messages, original, "stored image history is not mutated");
	});
}
