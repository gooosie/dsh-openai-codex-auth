import { z } from "zod";

const PACKAGE = "dsh-openai-codex-auth";
const SERVICE = "openai-codex-auth";
const NAMESPACE = "openaiCodex";

const UsageLimitSchema = z.object({
	name: z.string(),
	usedPercent: z.number().finite(),
	windowSeconds: z.number().finite(),
	resetAt: z.number().finite()
}).strict().readonly();

const SnapshotSchema = z.object({
	status: z.enum(["idle", "starting", "waiting", "done", "error"]),
	loggedIn: z.boolean(),
	deviceCode: z.string(),
	verificationUri: z.string(),
	expiresAt: z.number().finite(),
	error: z.string(),
	usageStatus: z.enum(["idle", "loading", "ready", "error"]),
	usageLimits: z.array(UsageLimitSchema).readonly(),
	usageCredits: z.string(),
	usageCreditsUnlimited: z.boolean(),
	usageUpdatedAt: z.number().finite(),
	usageError: z.string()
}).strict().readonly();

const snapshotCodec = () => ({
	mode: "strict",
	typeSymbol: `${PACKAGE}/remote#OpenAICodexSnapshot`,
	schema: SnapshotSchema
});

function descriptor(method) {
	return {
		id: `${PACKAGE}#OpenAICodexRemote/${method}`,
		service: SERVICE,
		namespace: NAMESPACE,
		method,
		invocation: { kind: "direct" },
		parameters: [],
		result: snapshotCodec()
	};
}

const descriptors = Object.freeze(["snapshot", "startLogin", "logout"].map(descriptor));

const TYPERT_REMOTE = Object.freeze({
	package: PACKAGE,
	descriptors
});

/** Host face discovered and registered automatically by dsh-typert-loader. */
const TYPERT = Object.freeze({
	package: PACKAGE,
	face: "host",
	schemas: Object.freeze([]),
	invocations: descriptors,
	model: Object.freeze({
		services: Object.freeze([]),
		events: Object.freeze([]),
		objects: Object.freeze([])
	})
});

const parseSnapshot = (value) => SnapshotSchema.parse(value);

export { SnapshotSchema, TYPERT, TYPERT_REMOTE, parseSnapshot };
export default TYPERT_REMOTE;
