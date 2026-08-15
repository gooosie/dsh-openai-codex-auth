import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

const SELECTABLE_REASONING_LEVELS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
const DEFAULT_CODEX_REASONING_LEVEL = "medium";

/**
 * Let pi-ai consume the access token that DSH resolves and refreshes for each
 * request. The catalog provider is OAuth-only, so pi-ai otherwise ignores an
 * explicit `apiKey` override before the Codex transport can use it.
 */
const dshAccessTokenAuth = Object.freeze({
	name: "DSH OpenAI Codex OAuth token",
	async resolve({ credential }) {
		if (credential?.type !== "api_key" || typeof credential.key !== "string" || credential.key.length === 0) {
			return void 0;
		}
		return {
			auth: { apiKey: credential.key },
			source: "DSH OpenAI Codex OAuth"
		};
	}
});

function selectableWireValue(model, level) {
	const mapped = model.thinkingLevelMap?.[level];
	if (mapped === null) return null;
	if ((level === "xhigh" || level === "max") && mapped === void 0) return null;
	return mapped ?? level;
}

/**
 * Keep the Codex picker aligned with distinct provider capabilities.
 *
 * pi-ai's cross-provider catalog treats the base levels as implicitly
 * supported and currently aliases `minimal` to `low` for Codex. DSH faithfully
 * exposes that generic catalog, which would otherwise produce duplicate or
 * uncertain choices.
 */
function codexModel(model) {
	if (!model.reasoning) return model;
	const thinkingLevelMap = { off: null, minimal: null };
	for (const level of SELECTABLE_REASONING_LEVELS) {
		thinkingLevelMap[level] = selectableWireValue(model, level);
	}
	return { ...model, thinkingLevelMap };
}

/** Create a Codex provider whose advertised reasoning levels fit this route. */
function createCodexProvider() {
	const provider = openaiCodexProvider();
	const getModels = provider.getModels.bind(provider);
	return {
		...provider,
		auth: {
			...provider.auth,
			apiKey: dshAccessTokenAuth
		},
		getModels: () => getModels().map(codexModel)
	};
}

export { createCodexProvider, DEFAULT_CODEX_REASONING_LEVEL };
