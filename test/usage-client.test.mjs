import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
function harness() {
	let client;
	const effects = [], timers = new Map();
	const jsx = (type, props) => ({ type, props });
	runInNewContext(source.replace("exports.apply = apply;", "exports.Loaded = Loaded; exports.en = en; exports.zh = zh; exports.apply = apply;"), {
		setInterval: (fn, delay) => { timers.set(fn, delay); return fn; },
		clearInterval: (id) => timers.delete(id),
		window: { __ModuleLoader__: { load: ({ factory }) => { client = factory((name) => {
			if (name === "react/jsx-runtime") return { jsx, jsxs: jsx };
			if (name === "react") return { useState: (v) => [v, () => {}], useEffect: (fn) => effects.push(fn) };
			return {};
		}); } } }
	});
	return { client, effects, timers };
}
function texts(node) {
	if (typeof node === "string") return [node];
	if (Array.isArray(node)) return Array.from(node).flatMap(texts);
	return node?.props ? texts(node.props.children) : [];
}
for (const language of ["en", "zh"]) {
	test(`${language} aggregate warning never infers recovery from exhausted windows`, () => {
		const { client } = harness();
		for (const additional of [[], [{ name: "Spark", usedPercent: 100, windowSeconds: 18000, resetAt: 1000 }]]) {
			for (const limited of [true, false]) {
				const section = { status: "done", usageStatus: "ready", usageLimited: limited, usageLimits: [
					{ name: "Codex", usedPercent: 100, windowSeconds: 18000, resetAt: 2000 },
					{ name: "Codex", usedPercent: 100, windowSeconds: 604800, resetAt: 9000 }, ...additional
				] };
				const tree = client.Loaded({ injected: { controller: {}, t: (key) => client[language][key],
					useSnapshot: () => ({ status: "ready", credentialConfigured: true, section }) } });
				const warnings = texts(tree).filter((text) => text.includes(client[language].usageLimited));
				assert.deepEqual(warnings, limited ? [client[language].usageLimited] : []);
			}
		}
	});
}
test("ready settings refresh on each mount, every minute, and stop on unmount", () => {
	for (let mount = 0; mount < 2; mount++) {
		const { client, effects, timers } = harness();
		const calls = [];
		client.Loaded({ injected: { controller: { load: (options) => calls.push(options) }, t: (key) => key,
			useSnapshot: () => ({ status: "ready", credentialConfigured: true, section: { status: "done", usageStatus: "ready" } }) } });
		const cleanups = effects.map((effect) => effect()).filter((cleanup) => typeof cleanup === "function");
		assert.equal(calls.length, 1);
		assert.equal(calls[0].background, true);
		assert.deepEqual([...timers.values()], [60000]);
		for (const tick of timers.keys()) tick();
		assert.equal(calls.length, 2);
		for (const cleanup of cleanups) cleanup();
		assert.equal(timers.size, 0);
	}
});
