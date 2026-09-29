import { z } from "zod";

const PACKAGE = "dsh-openai-codex-auth";
const SERVICE = "openai-codex-auth";
const NAMESPACE = "openaiCodex";
const ResetRequestSchema = z.object({
	creditId: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/),
	idempotencyKey: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
	confirmed: z.literal(true)
}).strict();

const UsageLimitSchema = z.object({
	name: z.string(),
	usedPercent: z.number().finite(),
	windowSeconds: z.number().finite(),
	resetAt: z.number().finite()
}).strict().readonly();

const SnapshotSchema = z.object({
	proxyMode: z.enum(["host", "system"]).optional(),
	proxyRestartRequired: z.boolean().optional(),
	proxyError: z.string().optional(),
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
	usageResetCredits: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
	resetCards: z.array(z.object({ id: z.string().regex(/^[A-Za-z0-9_-]{1,200}$/), expiresAt: z.number().finite().positive().nullable() }).strict()).max(1000).optional(),
	resetCardsStatus: z.enum(["idle", "loading", "ready", "error"]).optional(),
	resetResult: z.enum(["reset", "already_redeemed", "no_credit", "nothing_to_reset", "unknown", "unavailable", "pending", "account_changed"]).optional(),
	usageUpdatedAt: z.number().finite(),
	usageError: z.string()
}).strict().readonly();

const snapshotCodec = () => ({
	mode: "strict",
	typeSymbol: `${PACKAGE}/remote#OpenAICodexSnapshot`,
	create: () => SnapshotSchema
});

function descriptor(method) {
	return {
		id: `${PACKAGE}#OpenAICodexRemote/${method}`,
		service: SERVICE,
		namespace: NAMESPACE,
		method,
		invocation: { kind: "direct" },
		parameters: method === "consumeReset" ? [{
			name: "input", wire: "input", source: "json",
			codec: { mode: "strict", typeSymbol: `${PACKAGE}/remote#ResetRequest`, create: () => ResetRequestSchema }
		}] : [],
		result: snapshotCodec()
	};
}

const descriptors = Object.freeze(["snapshot", "startLogin", "logout", "followHostProxy", "useSystemProxy", "consumeReset"].map(descriptor));

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

export { SnapshotSchema, ResetRequestSchema, TYPERT, TYPERT_REMOTE, parseSnapshot };
export default TYPERT_REMOTE;
