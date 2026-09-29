import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { Worker } from "node:worker_threads";
import { once } from "node:events";
import { parseSystemProxy, readSystemProxy, bypassSystemProxy, systemProxyTransport, systemOAuth } from "../lib/system-proxy.js";
import { Config } from "../lib/index.js";
import { createCodexProvider } from "../lib/provider.js";

const manual = (server) => `ProxyEnable REG_DWORD 0x1\nProxyServer REG_SZ ${server}`;
test("system proxy parses manual combined and per-scheme settings", () => {
	assert.equal(parseSystemProxy(manual("127.0.0.1:7897")).https, "http://127.0.0.1:7897/");
	assert.equal(parseSystemProxy(manual("http=localhost:1;https=localhost:2")).https, "http://localhost:2/");
});
test("system proxy fails closed for PAC, disabled, SOCKS-only and malformed configuration", async () => {
	for (const text of ["", manual("localhost:1") + "\nAutoConfigURL REG_SZ https://private/pac", "ProxyEnable REG_DWORD 0x0", manual("socks=localhost:1"), manual("socks5://localhost:1"), manual("user:secret@localhost:1")]) {
		assert.throws(() => parseSystemProxy(text), /manual HTTP\/HTTPS/);
	}
	await assert.rejects(readSystemProxy("linux"), /manual HTTP\/HTTPS/);
	await assert.rejects(readSystemProxy("win32", () => { throw new Error("secret"); }), (error) => !error.message.includes("secret"));
});
test("system proxy honors Windows bypass syntax and loopback", () => {
	assert.equal(bypassSystemProxy(new URL("https://a.example.com"), "*.example.com;<local>"), true);
	assert.equal(bypassSystemProxy(new URL("http://intranet"), "<local>"), true);
	assert.equal(bypassSystemProxy(new URL("http://127.0.0.2"), ""), true);
	assert.equal(bypassSystemProxy(new URL("https://auth.openai.com"), "*.example.com"), false);
});
test("config exposes persistent host/system choice with host default", () => {
	assert.equal(Config({}).proxyMode.get(), "host");
	assert.equal(Config({ proxyMode: "system" }).proxyMode.get(), "system");
	assert.throws(() => Config({ proxyMode: "unknown" }));
});
test("isolated system dispatcher tunnels requests and leaves global fetch untouched", async (t) => {
	let connections = 0;
	const server = http.createServer((_request, response) => { connections++; response.end("{}"); });
	server.on("connect", (_request, socket) => {
		connections++;
		socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
		socket.once("data", () => socket.end("HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}"));
	});
	server.listen(0, "127.0.0.1"); await once(server, "listening");
	t.after(() => server.close());
	const original = globalThis.fetch;
	const transport = systemProxyTransport({ http: `http://127.0.0.1:${server.address().port}`, bypass: "" });
	t.after(() => transport.close());
	const response = await transport.fetch("http://example.invalid/test", { signal: AbortSignal.timeout(3000) });
	assert.equal(await response.text(), "{}");
	assert.equal(connections, 1);
	assert.equal(globalThis.fetch, original);
});
test("OAuth worker isolates fetch and carries only mock credentials in test", async () => {
	const provider = `export function openaiCodexProvider(){return {auth:{oauth:{refresh:async()=>({type:'oauth',access:'mock',isolated:typeof fetch==='function'})}}}}`;
	const original = globalThis.fetch;
	const worker = new Worker(new URL("../lib/system-proxy-worker.js", import.meta.url), { workerData: {
		policy: { https: "http://127.0.0.1:1", bypass: "" }, operation: "refresh", credential: {},
		providerUrl: `data:text/javascript,${encodeURIComponent(provider)}`
	} });
	try {
		const [message] = await once(worker, "message");
		assert.equal(message.type, "result");
		assert.equal(message.value.access, "mock");
		assert.equal(globalThis.fetch, original);
	} finally { await worker.terminate(); }
});
test("cancelled OAuth does not start network activity", async () => {
	await assert.rejects(systemOAuth({}, "login", undefined, { signal: AbortSignal.abort() }), /cancelled/);
});

for (const operation of ["login", "refresh"]) {
	test(`real pi-ai OAuth ${operation} reaches only the mock CONNECT proxy`, { timeout: 10000 }, async (t) => {
		const targets = [];
		const server = http.createServer();
		server.on("connect", (request, socket) => {
			targets.push(request.url);
			// Reject before TLS: no credentials or OAuth request can leave this fixture.
			socket.end("HTTP/1.1 403 Forbidden\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
		});
		server.listen(0, "127.0.0.1"); await once(server, "listening");
		t.after(() => server.close());
		const workers = new Set();
		t.after(async () => { await Promise.all([...workers].map((worker) => worker.terminate())); });
		await assert.rejects(systemOAuth({ https: `http://127.0.0.1:${server.address().port}`, bypass: "" }, operation,
			{ type: "oauth", access: "fixture-access", refresh: "fixture-refresh", expires: 0 },
			{ signal: AbortSignal.timeout(5000) }, workers), /OAuth request failed/);
		assert.ok(targets.length > 0);
		assert.ok(targets.every((target) => target === "auth.openai.com:443"));
		assert.equal(workers.size, 0);
	});
}
test("system provider forces SSE and injected fetch even when caller requests websocket", async () => {
	let calls = 0;
	const provider = createCodexProvider({ transport: "sse", fetch: async () => { calls++; return new Response("{}", { status: 400 }); } });
	const payload = Buffer.from(JSON.stringify({ "https://api.openai.com/auth": { chatgpt_account_id: "mock" } })).toString("base64url");
	const stream = provider.streamSimple(provider.getModels()[0], { messages: [] }, { apiKey: `a.${payload}.b`, transport: "websocket", maxRetries: 0 });
	for await (const _ of stream) { /* Consume error event; no real model call. */ }
	assert.equal(calls, 1);
});
