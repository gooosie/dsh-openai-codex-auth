import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";

const source = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8");
let client;
class ChineseSystemDate extends Date {
	toLocaleString(locale, options) { return super.toLocaleString(locale ?? "zh-CN", options); }
	toLocaleDateString(locale, options) { return super.toLocaleDateString(locale ?? "zh-CN", options); }
}
runInNewContext(source.replace("exports.apply = apply;", "exports.expiryText = expiryText; exports.en = en; exports.zh = zh; exports.apply = apply;"), {
	Date: ChineseSystemDate,
	window: { __ModuleLoader__: { load: ({ factory }) => { client = factory(() => ({})); } } }
});
for (const language of ["en", "zh"]) {
	test(`${language} dates follow UI language, not the Chinese system locale`, () => {
		const t = (key) => client[language][key];
		const stamp = Date.UTC(2026, 9, 5, 12);
		const locale = language === "en" ? "en-US" : "zh-CN";
		assert.equal(client.expiryText(stamp, t), new Date(stamp).toLocaleString(locale));
		assert.equal(client.expiryText(stamp, t, true), new Date(stamp).toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }));
		assert.equal(client.expiryText(null, t), undefined);
	});
}
