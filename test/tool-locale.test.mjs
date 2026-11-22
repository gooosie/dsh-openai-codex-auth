import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Context } from "@deepseek-ai/cordis";
import { OpenAICodexAuthService } from "../lib/index.js";
import { toolLocale } from "../lib/tool-locale.js";

const languages = ["en", "zh", "ja", "es", "fr", "de", "ru", "pt"];
const dictionaries = Object.fromEntries(languages.map((language) => [language,
	JSON.parse(readFileSync(new URL(`../locale/${language}.json`, import.meta.url), "utf8")).tools]));

test("tool translations preserve all keys and interpolation parameters", () => {
	const keys = Object.keys(dictionaries.en).sort();
	for (const [language, copy] of Object.entries(dictionaries)) {
		assert.deepEqual(Object.keys(copy).sort(), keys, language);
		for (const key of keys) {
			assert.ok(copy[key].trim(), `${language}.${key}`);
			assert.deepEqual(copy[key].match(/\{\w+\}/g)?.sort(), dictionaries.en[key].match(/\{\w+\}/g)?.sort(), `${language}.${key}`);
		}
	}
});

test("registered Codex tools read the saved language for each call and sanitize failures", async (t) => {
	const detail = "private upstream failure detail";
	t.mock.method(globalThis, "fetch", async () => { throw new Error(detail); });
	const ctx = new Context();
	const tools = new Map();
	const credentials = { resolve: async () => undefined, unset: async () => {} };
	let preference;
	const services = {
		llm: { registerAdapter() {} },
		tools: { register(tool) { tools.set(tool.name, tool); } },
		credentials,
		settings: { describe: () => [{ ns: "locale", value: { preference } }] }
	};
	for (const [name, service] of Object.entries(services)) {
		ctx.provide(name);
		ctx.set(name, service);
	}
	const plugin = new OpenAICodexAuthService(ctx);
	const call = (name) => tools.get(`codex_${name}`).execute({}, {});
	for (const language of languages) {
		preference = language;
		assert.equal(await call("status"), dictionaries[language].notLoggedIn);
		assert.equal(await call("logout"), dictionaries[language].signedOut);
	}

	preference = "ja-JP";
	assert.equal(await call("login"), dictionaries.ja.loginStartFailed.replace("{reason}", dictionaries.ja.loginFailed));
	assert.equal((await plugin.snapshot()).error, "loginFailed");
	preference = "fr";
	assert.equal(await call("status"), dictionaries.fr.previousLoginFailed.replace("{reason}", dictionaries.fr.loginFailed));
	t.mock.method(credentials, "unset", async () => { throw new Error(detail); });
	assert.equal(await call("logout"), dictionaries.fr.logoutFailed);
});

test("tool dates follow the selected language and missing settings fall back to the host language", () => {
	const timestamp = Date.UTC(2026, 9, 5, 12);
	const settings = { describe: () => [{ ns: "locale", value: { preference: "zh-CN" } }] };
	assert.equal(toolLocale({ get: () => settings }).date(timestamp), new Date(timestamp).toLocaleString("zh-CN"));
	const hostLanguage = new Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().split("-")[0];
	assert.equal(toolLocale({ get: () => undefined }).text("signedOut"), dictionaries[hostLanguage]?.signedOut ?? dictionaries.en.signedOut);
});
