import assert from "node:assert/strict";
import test from "node:test";
import { zstdDecompressSync } from "node:zlib";
import { createCodexProvider } from "../lib/provider.js";

const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "mock" } })).toString("base64url");
for (const method of ["stream", "streamSimple"]) {
	for (const mode of ["none", "host", "system", "static"]) {
		for (const temperature of [0, 0.7, undefined]) {
			test(`${method} omits temperature=${temperature} in ${mode} mode without mutating options`, async () => {
				let body, releases = 0;
				const fetch = async (_url, init) => {
					body = JSON.parse(typeof init.body === "string" ? init.body : zstdDecompressSync(init.body).toString());
					return new Response(JSON.stringify({ detail: "mock request captured" }), { status: 400 });
				};
				const networkOptions = Object.freeze({ fetch, transport: "sse" });
				const provider = createCodexProvider(mode === "none" ? undefined : mode === "static" ? networkOptions :
					() => ({ options: mode === "host" ? {} : networkOptions, release: () => { releases++; } }));
				const options = Object.freeze({ apiKey: `a.${payload}.b`, transport: "sse", fetch, maxRetries: 0,
					...(temperature === undefined ? {} : { temperature }) });
				await provider[method](provider.getModels()[0], { messages: [] }, options).result();
				await Promise.resolve();
				assert.ok(body, "real pi-ai must reach the mocked transport");
				assert.equal(Object.hasOwn(body, "temperature"), false);
				assert.equal(body.model, provider.getModels()[0].id);
				assert.equal(body.stream, true);
				assert.equal(options.temperature, temperature);
				assert.equal(Object.hasOwn(options, "temperature"), temperature !== undefined);
				assert.equal(releases, ["host", "system"].includes(mode) ? 1 : 0);
			});
		}
	}
}
