import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import test from "node:test";
import { installProxyFromEnvironment, proxyRouteFor } from "@deepseek-ai/dsh-http-proxy";
import { CODEX_USAGE_URL, requestCodexUsage } from "../lib/usage.js";

const credential = { access: "fake-token", accountId: "fake-account" };

function environment(values) {
	return { get: (name) => values[name] === undefined ? undefined : { value: values[name] } };
}

async function listen(t, handler) {
	const server = createServer(handler);
	const sockets = new Set();
	server.on("connection", (socket) => {
		sockets.add(socket);
		socket.on("close", () => sockets.delete(socket));
	});
	server.listen(0, "127.0.0.1");
	await once(server, "listening");
	t.after(() => {
		for (const socket of sockets) socket.destroy();
		server.close();
	});
	return { server, url: `http://127.0.0.1:${server.address().port}` };
}

// Redirect only the endpoint to an offline fixture; keep Node's real fetch and
// the DSH-installed dispatcher so these tests exercise actual socket routing.
function fixtureFetch(t, url) {
	const fetch = globalThis.fetch;
	t.mock.method(globalThis, "fetch", (requested, init) => {
		assert.equal(requested, CODEX_USAGE_URL);
		assert.equal("dispatcher" in init, false);
		return fetch(url, init);
	});
}

test("usage request reaches the proxy installed by DSH", async (t) => {
	let proxyRequests = 0;
	const { url } = await listen(t, (request, response) => {
		proxyRequests++;
		assert.equal(request.url, "http://usage.invalid/usage");
		response.end("{}");
	});
	const dispose = await installProxyFromEnvironment(environment({ HTTP_PROXY: url }), (message) => assert.fail(message));
	t.after(dispose);
	fixtureFetch(t, "http://usage.invalid/usage");
	const usage = await requestCodexUsage(credential);
	assert.equal(proxyRequests, 1);
	assert.deepEqual(usage.limits, []);
});

test("usage follows the DSH direct route with NO_PROXY", async (t) => {
	const target = await listen(t, (_req, res) => res.end("{}"));
	let proxyRequests = 0;
	const proxy = await listen(t, (_req, res) => { proxyRequests++; res.end("{}"); });
	proxy.server.on("connect", (_req, socket) => { proxyRequests++; socket.destroy(); });
	const dispose = await installProxyFromEnvironment(environment({ HTTP_PROXY: proxy.url, NO_PROXY: "*" }),
		(message) => assert.fail(message));
	t.after(dispose);
	assert.equal(proxyRouteFor(new URL("http://usage.invalid")).proxied, false);
	fixtureFetch(t, target.url);
	await requestCodexUsage(credential);
	assert.equal(proxyRequests, 0);
});

test("usage timeout remains active while streaming the response body", async (t) => {
	const { url } = await listen(t, (_req, res) => {
		res.writeHead(200, { "Content-Type": "application/json" });
		res.write("{");
	});
	fixtureFetch(t, url);
	const timeout = AbortSignal.timeout.bind(AbortSignal);
	t.mock.method(AbortSignal, "timeout", (ms) => {
		assert.equal(ms, 10000);
		return timeout(100);
	});
	await assert.rejects(requestCodexUsage(credential),
		(error) => error.name === "AbortError" || error.name === "TimeoutError");
});

test("usage does not follow redirects carrying authentication headers", async (t) => {
	let redirected = false;
	const { url } = await listen(t, (req, res) => {
		if (req.url === "/redirected") { redirected = true; res.end("{}"); return; }
		res.writeHead(302, { Location: "/redirected" });
		res.end();
	});
	fixtureFetch(t, url);
	await assert.rejects(requestCodexUsage(credential));
	assert.equal(redirected, false);
});
