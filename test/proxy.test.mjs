import assert from "node:assert/strict";
import test from "node:test";
import { installCodexFetchProxy } from "../lib/proxy.js";

class DefaultAgent {}
class ExistingProxyAgent {}

test("Codex transport installs a proxy dispatcher with local bypasses", async () => {
	const original = new DefaultAgent();
	let installed;
	const didInstall = await installCodexFetchProxy({
		env: { NO_PROXY: "example.test" },
		resolveProxy: async () => new URL("http://proxy.test:8080"),
		loadUndici: async () => ({
			Agent: DefaultAgent,
			EnvHttpProxyAgent: class {
				constructor(options) {
					this.options = options;
				}
			},
			getGlobalDispatcher: () => original,
			setGlobalDispatcher: (dispatcher) => {
				installed = dispatcher;
			}
		})
	});

	assert.equal(didInstall, true);
	assert.equal(installed.options.httpProxy, "http://proxy.test:8080/");
	assert.equal(installed.options.httpsProxy, "http://proxy.test:8080/");
	assert.deepEqual(installed.options.noProxy.split(","), ["example.test", "localhost", "127.0.0.1", "::1"]);
});

test("Codex transport preserves a caller-provided dispatcher", async () => {
	let replaced = false;
	const didInstall = await installCodexFetchProxy({
		resolveProxy: async () => new URL("http://proxy.test:8080"),
		loadUndici: async () => ({
			Agent: DefaultAgent,
			EnvHttpProxyAgent: class {},
			getGlobalDispatcher: () => new ExistingProxyAgent(),
			setGlobalDispatcher: () => {
				replaced = true;
			}
		})
	});

	assert.equal(didInstall, false);
	assert.equal(replaced, false);
});

test("Codex transport leaves direct connections unchanged without a proxy", async () => {
	let loaded = false;
	const didInstall = await installCodexFetchProxy({
		resolveProxy: async () => void 0,
		loadUndici: async () => {
			loaded = true;
			return {};
		}
	});

	assert.equal(didInstall, false);
	assert.equal(loaded, false);
});
