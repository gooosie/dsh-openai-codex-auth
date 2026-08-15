import assert from "node:assert/strict";
import test from "node:test";
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
		"logout"
	]);
	for (const descriptor of remoteContribution.descriptors) {
		assert.equal(descriptor.service, "openai-codex-auth");
		assert.equal(descriptor.namespace, "openaiCodex");
		assert.equal(descriptor.parameters.length, 0);
		assert.equal(descriptor.result.mode, "strict");
	}
});

test("Remote snapshot schema rejects extra fields that could leak credentials", () => {
	assert.deepEqual(SnapshotSchema.parse(snapshot), snapshot);
	assert.throws(() => SnapshotSchema.parse({ ...snapshot, accessToken: "secret" }));
});

test("Host service marks the same three methods for Typed Remote discovery", () => {
	const ctx = new Context();
	const service = new OpenAICodexRemoteService(ctx, {
		snapshot: () => snapshot,
		startLogin: () => snapshot,
		logout: () => snapshot
	});
	assert.deepEqual(remoteMethods(service).map((entry) => entry.method), [
		"snapshot",
		"startLogin",
		"logout"
	]);
});
