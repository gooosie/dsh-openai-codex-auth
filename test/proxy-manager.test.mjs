import assert from "node:assert/strict";
import test from "node:test";
import { createProxyManager } from "../lib/proxy-manager.js";
import { createCodexProvider } from "../lib/provider.js";

const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
	const closed = [];
	let revision = 0;
	const manager = createProxyManager("host", {}, {
		read: async () => ({ revision: ++revision }),
		transport: policy => ({ fetch: async () => new Response(String(policy.revision)), close: () => { closed.push(policy.revision); } }),
		fetch: async () => new Response("host")
	});
	return { manager, closed };
}
test("switching preserves old leases and closes only after final release", async () => {
	const { manager, closed } = fixture();
	manager.commit(await manager.prepare("system"));
	const first = manager.acquire();
	const second = manager.acquire();
	manager.commit(await manager.prepare("system"));
	const next = manager.acquire();
	assert.equal(await (await first.fetch("https://fixture.invalid")).text(), "1");
	assert.equal(await (await next.fetch("https://fixture.invalid")).text(), "2");
	first.release(); await tick(); assert.deepEqual(closed, []);
	second.release(); second.release(); await tick(); assert.deepEqual(closed, [1]);
	manager.commit(await manager.prepare("host"));
	await tick(); assert.deepEqual(closed, [1]);
	next.release(); await tick(); assert.deepEqual(closed, [1, 2]);
	manager.dispose();
});
test("failed preparation and failed persistence leave active mode intact", async () => {
	const { manager, closed } = fixture();
	const candidate = await manager.prepare("system");
	manager.discard(candidate); await tick();
	assert.equal(manager.mode, "host");
	assert.deepEqual(closed, [1]);
	manager.dispose();
	const bad = createProxyManager("host", {}, { read: async () => { throw new Error("private-address"); } });
	await assert.rejects(bad.prepare("system"), error => !error.message.includes("private-address"));
	assert.equal(bad.mode, "host"); bad.dispose();
});
test("OAuth already started retains its route after a mode change", async () => {
	let complete;
	const manager = createProxyManager("system", {}, {
		read: async () => ({}), transport: () => ({ close: () => {} }),
		oauth: () => new Promise(resolve => { complete = resolve; })
	});
	await manager.ready;
	const lease = manager.acquire();
	const pending = lease.oauth("refresh", {}, {});
	await tick();
	manager.commit(await manager.prepare("host"));
	complete("old-route-result");
	assert.equal(await pending, "old-route-result");
	lease.release(); manager.dispose();
});
test("disposal during asynchronous proxy read cleans up and rejects commit", async () => {
	let resolve;
	let closed = 0;
	const manager = createProxyManager("host", {}, { read: () => new Promise(r => { resolve = r; }), transport: () => ({ close: () => { closed++; } }) });
	const pending = manager.prepare("system");
	manager.dispose(); resolve({});
	await assert.rejects(pending, /disposed/); await tick();
	assert.equal(closed, 1);
	assert.throws(() => manager.acquire(), /disposed/);
});

test("real pi-ai SSE stream keeps its lease until the response completes", async () => {
	let finishResponse;
	let closed = 0;
	const manager = createProxyManager("system", {}, {
		read: async () => ({}),
		transport: () => ({ fetch: () => new Promise(resolve => { finishResponse = resolve; }), close: () => { closed++; } })
	});
	await manager.ready;
	const provider = createCodexProvider(() => {
		const lease = manager.acquire();
		return { options: { fetch: lease.fetch, transport: "sse" }, release: lease.release };
	});
	const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "mock" } })).toString("base64url");
	const stream = provider.streamSimple(provider.getModels()[0], { messages: [] }, { apiKey: `a.${payload}.b`, maxRetries: 0 });
	for (let i = 0; !finishResponse && i < 100; i++) await new Promise(resolve => setTimeout(resolve, 10));
	assert.equal(typeof finishResponse, "function");
	manager.commit(await manager.prepare("host"));
	await tick(); assert.equal(closed, 0);
	finishResponse(new Response("{}", { status: 400 }));
	await stream.result(); await tick();
	assert.equal(closed, 1);
	manager.dispose();
});
