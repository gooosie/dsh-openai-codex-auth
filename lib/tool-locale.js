import de from "../locale/de.json" with { type: "json" };
import en from "../locale/en.json" with { type: "json" };
import es from "../locale/es.json" with { type: "json" };
import fr from "../locale/fr.json" with { type: "json" };
import ja from "../locale/ja.json" with { type: "json" };
import pt from "../locale/pt.json" with { type: "json" };
import ru from "../locale/ru.json" with { type: "json" };
import zh from "../locale/zh.json" with { type: "json" };

const dictionaries = { de, en, es, fr, ja, pt, ru, zh };
const dateLocales = { de: "de-DE", en: "en-US", es: "es-ES", fr: "fr-FR", ja: "ja-JP", pt: "pt-BR", ru: "ru-RU", zh: "zh-CN" };

function savedLocale(ctx) {
	try {
		return ctx.get("settings")?.describe({ redactSecrets: true }).find(({ ns }) => ns === "locale")?.value?.preference;
	} catch {
		// Headless and older profiles may not serve configuration forms.
		return undefined;
	}
}

/** Use the saved DSH language when available, otherwise the host language. */
export function toolLocale(ctx) {
	const preference = savedLocale(ctx);
	const locale = typeof preference === "string" ? preference : new Intl.DateTimeFormat().resolvedOptions().locale;
	const language = locale.toLowerCase().split("-")[0];
	const selected = Object.hasOwn(dictionaries, language) ? language : "en";
	const messages = dictionaries[selected].tools;
	return {
		text(key, params = {}, fallback = key) {
			const template = Object.hasOwn(messages, key) ? messages[key] : messages[fallback];
			return template.replace(/\{(\w+)\}/g, (_match, name) => params[name]);
		},
		date(timestamp) {
			return new Date(timestamp).toLocaleString(dateLocales[selected]);
		}
	};
}
