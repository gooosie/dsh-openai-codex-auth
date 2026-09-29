import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { Context } from "@deepseek-ai/cordis";
import { remoteMethods } from "@deepseek-ai/dsh-typert-protocol";
import { OpenAICodexRemoteService } from "../lib/remote-service.js";
import remoteContribution, { SnapshotSchema, TYPERT } from "../lib/remote.js";

const snapshot = {
	status: "idle",
	loggedIn: false,
	deviceCode: "",
	verificationUri: "",
	expiresAt: 0,
	error: "",
	usageStatus: "idle",
	usageLimits: [],
	usageCredits: "",
	usageCreditsUnlimited: false,
	usageUpdatedAt: 0,
	usageError: ""
};

test("Remote contribution exposes only the sanitized login lifecycle", () => {
	assert.equal(remoteContribution.package, "dsh-openai-codex-auth");
	assert.equal(TYPERT.face, "host");
	assert.equal(TYPERT.invocations, remoteContribution.descriptors);
	assert.deepEqual(remoteContribution.descriptors.map((entry) => entry.method), [
		"snapshot",
		"startLogin",
		"logout", "followHostProxy", "useSystemProxy", "consumeReset"
	]);
	for (const descriptor of remoteContribution.descriptors) {
		assert.equal(descriptor.service, "openai-codex-auth");
		assert.equal(descriptor.namespace, "openaiCodex");
		assert.equal(descriptor.parameters.length, descriptor.method === "consumeReset" ? 1 : 0);
		assert.equal(descriptor.result.mode, "strict");
	}
});

test("Remote snapshot schema rejects extra fields that could leak credentials", () => {
	assert.deepEqual(SnapshotSchema.parse(snapshot), snapshot);
	assert.throws(() => SnapshotSchema.parse({ ...snapshot, accessToken: "secret" }));
});

test("host result codecs expose lazy factories for DSH 0.1.7", () => {
	for (const { result } of TYPERT.invocations) {
		assert.equal(typeof result.create, "function");
		assert.deepEqual(result.create().parse(snapshot), snapshot);
		assert.throws(() => result.create().parse({ ...snapshot, accessToken: "secret" }));
	}
});

test("browser mounts matching lazy result codecs", async () => {
	let client;
	let contribution;
	runInNewContext(readFileSync(new URL("../lib/client.js", import.meta.url), "utf8"), {
		window: { __ModuleLoader__: { load: ({ factory }) => {
			client = factory(() => ({}));
		} } }
	});
	// Stop immediately after mounting: no UI, OAuth or network activity.
	const mounted = new Error("mounted");
	await assert.rejects(client.apply({ remote: { $mount: async (value) => {
		contribution = value;
		throw mounted;
	} } }), (error) => error === mounted);
	assert.equal(contribution.package, TYPERT.package);
	for (const [index, descriptor] of contribution.descriptors.entries()) {
		assert.equal(descriptor.id, TYPERT.invocations[index].id);
		assert.equal(descriptor.result.typeSymbol, TYPERT.invocations[index].result.typeSymbol);
		assert.equal(typeof descriptor.result.create, "function");
		if (descriptor.method === "consumeReset") {
			const input = { idempotencyKey: "12345678-1234-4234-8234-123456789abc", confirmed: true, creditId: "card-1" };
			const clientParameter = descriptor.parameters[0];
			const hostParameter = TYPERT.invocations[index].parameters[0];
			assert.equal(clientParameter.wire, hostParameter.wire);
			assert.equal(clientParameter.codec.typeSymbol, hostParameter.codec.typeSymbol);
			for (const parameter of [clientParameter, hostParameter]) {
				assert.deepEqual(parameter.codec.create().parse(input), input);
				assert.throws(() => parameter.codec.create().parse({ ...input, confirmed: false }));
			}
		}
		assert.equal(descriptor.result.create().parse(snapshot), snapshot);
		assert.throws(() => descriptor.result.create().parse({ ...snapshot, accessToken: "secret" }));
	}
});

test("Host service marks matching methods for Typed Remote discovery", () => {
	const ctx = new Context();
	const service = new OpenAICodexRemoteService(ctx, {
		snapshot: () => snapshot,
		startLogin: () => snapshot,
		logout: () => snapshot
	});
	assert.deepEqual(remoteMethods(service).map((entry) => entry.method), [
		"snapshot",
		"startLogin",
		"logout", "followHostProxy", "useSystemProxy", "consumeReset"
	]);
});
