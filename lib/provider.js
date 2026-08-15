import { openaiCodexProvider } from "@earendil-works/pi-ai/providers/openai-codex";

const SELECTABLE_REASONING_LEVELS = Object.freeze(["low", "medium", "high", "xhigh", "max"]);
const DEFAULT_CODEX_REASONING_LEVEL = "medium";

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
		getModels: () => getModels().map(codexModel)
	};
}

export { createCodexProvider, DEFAULT_CODEX_REASONING_LEVEL };
