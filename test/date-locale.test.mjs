import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
const localeTags = { en: "en-US", zh: "zh-CN", ja: "ja-JP", es: "es-ES", fr: "fr-FR", de: "de-DE", ru: "ru-RU", pt: "pt-BR" };
let client;
class ChineseSystemDate extends Date {
	toLocaleString(locale, options) { return super.toLocaleString(locale ?? "zh-CN", options); }
	toLocaleDateString(locale, options) { return super.toLocaleDateString(locale ?? "zh-CN", options); }
}
runInNewContext(source.replace("exports.apply = apply;", "exports.expiryText = expiryText; exports.usageWindowText = usageWindowText; exports.apply = apply;"), {
	Date: ChineseSystemDate,
	window: { __ModuleLoader__: { load: ({ factory }) => { client = factory(() => ({ createSnapshotStore: () => ({}) })); } } }
});
let dictionaries;
await client.apply({
	remote: { $mount: async () => async () => {} },
	get: () => ({}),
	effect: (apply) => apply(),
	locale: { register: (_namespace, copy) => { dictionaries = copy; }, bind: () => () => {} },
	slots: { inject: () => {} }
});

test("settings register every DSH language with matching copy keys and placeholders", () => {
	assert.deepEqual(Object.keys(dictionaries).sort(), Object.keys(localeTags).sort());
	const keys = Object.keys(dictionaries.en).sort();
	for (const [language, copy] of Object.entries(dictionaries)) {
		assert.deepEqual(Object.keys(copy).sort(), keys, language);
		for (const key of keys) {
			assert.ok(copy[key].trim(), `${language}.${key}`);
			assert.deepEqual(copy[key].match(/\{\w+\}/g)?.sort(), dictionaries.en[key].match(/\{\w+\}/g)?.sort(), `${language}.${key}`);
		}
	}
});

for (const [language, locale] of Object.entries(localeTags)) {
	test(`${language} dates follow UI language, not the Chinese system locale`, () => {
		const stamp = Date.UTC(2026, 9, 5, 12);
		assert.equal(client.expiryText(stamp, locale), new Date(stamp).toLocaleString(locale));
		assert.equal(client.expiryText(stamp, locale, true), new Date(stamp).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }));
		assert.equal(client.expiryText(null, locale), undefined);
	});
}

test("usage windows retain exact durations and use locale-sensitive units", () => {
	const t = (key) => dictionaries.ru[key];
	assert.equal(client.usageWindowText(604800, t, "ru-RU"), "7 дней");
	assert.equal(client.usageWindowText(3600, t, "ru-RU"), "1 час");
	assert.equal(client.usageWindowText(120, t, "ru-RU"), "2 минуты");
	assert.equal(client.usageWindowText(0, t, "ru-RU"), t("usageWindow"));
});
