import { parentPort, workerData } from "node:worker_threads";
import { systemProxyTransport } from "./system-proxy.js";

const transport = systemProxyTransport(workerData.policy);
// This global belongs to the isolated worker, never to DSH's plugin process.
globalThis.fetch = transport.fetch;
try {
	const { openaiCodexProvider } = await import(workerData.providerUrl);
	const oauth = openaiCodexProvider().auth.oauth;
	const value = workerData.operation === "refresh"
		? await oauth.refresh(workerData.credential, new AbortController().signal)
		: await oauth.login({
			signal: new AbortController().signal,
			notify: (value) => parentPort.postMessage({ type: "notify", value }),
			prompt: async (request) => {
				if (request.type === "select") return "device_code";
				throw new Error("Unsupported login interaction");
			}
		});
	parentPort.postMessage({ type: "result", value });
} catch {
	parentPort.postMessage({ type: "error" });
} finally {
	await transport.close();
}
