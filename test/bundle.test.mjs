import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const packageJson = JSON.parse(readFileSync(join(projectRoot, "package.json"), "utf8"));

test("package installs as a DSH bundle without a second installer step", () => {
	assert.equal(packageJson.dsh?.bundle?.patch, "./cordis.patch.yml");
	assert.equal(packageJson.exports?.["./cordis.patch.yml"], "./cordis.patch.yml");
	assert.equal(packageJson.exports?.["./typert"], "./lib/remote.js");
	assert.equal(packageJson.files.includes("cordis.patch.yml"), true);
	assert.equal(packageJson.files.includes("install.mjs"), false);
	assert.equal(existsSync(join(projectRoot, "install.mjs")), false);

	const patch = readFileSync(join(projectRoot, "cordis.patch.yml"), "utf8");
	assert.match(patch, /id: openai-codex-auth/);
	assert.match(patch, /name: dsh-openai-codex-auth/);
});

test("web client uses the Typed Remote gateway instead of settings allowlists", () => {
	assert.ok(packageJson.dsh.client.inject.includes("@deepseek-ai/dsh-api-gateway"));
	assert.equal(packageJson.dsh.client.inject.includes("@deepseek-ai/dsh-api-remotes"), false);

	const host = readFileSync(join(projectRoot, "lib", "index.js"), "utf8");
	const client = readFileSync(join(projectRoot, "lib", "client.js"), "utf8");
	assert.doesNotMatch(host, /installSettingsSection|settingsNamespace|ctx\.settings/);
	assert.doesNotMatch(client, /api\.settings|api\.credentials|\.setAction\(/);
	assert.match(client, /ctx\.remote\.\$mount\(REMOTE_CONTRIBUTION\)/);
});
