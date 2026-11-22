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

test("plugin metadata is exported for all DSH languages and links the Chinese detail document", () => {
	assert.equal(packageJson.exports["./locale/*.json"], "./locale/*.json");
	assert.ok(packageJson.files.includes("locale/*.json"));
	for (const language of ["en", "zh", "ja", "es", "fr", "de", "ru", "pt"]) {
		const { meta } = JSON.parse(readFileSync(join(projectRoot, "locale", `${language}.json`), "utf8"));
		assert.ok(meta.title.trim());
		assert.ok(meta.description.trim());
		if (language === "zh") {
			assert.equal(meta.detail, "README.zh-CN.md");
			assert.ok(packageJson.files.includes(meta.detail));
			assert.ok(existsSync(join(projectRoot, meta.detail)));
		}
	}
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

test("web client targets the tested DSH 0.2.0, 0.2.1 and 0.2.2 module contracts", () => {
	const dshPeers = Object.entries(packageJson.peerDependencies)
		.filter(([name]) => name.startsWith("@deepseek-ai/dsh-"));
	for (const [name, range] of dshPeers) {
		assert.equal(range, "0.2.0-rc.2 || 0.2.1-rc.2 || 0.2.1-rc.5 || >=0.2.2-rc.1 <0.2.3-0", `${name} must bound support to the DSH 0.2.2 release line`);
	}
	assert.equal(packageJson.peerDependencies["@deepseek-ai/cordis"], "~4.0.4 || ~4.1.0");
	assert.equal(packageJson.peerDependencies["@earendil-works/pi-ai"], "0.87.1 || 1.1.0 || 1.3.0 || 1.4.0 || >=1.5.0 <1.6.0");
	assert.equal(packageJson.dsh.client.inject.includes("@deepseek-ai/dsh-client-runtime"), false);
	assert.equal("@deepseek-ai/dsh-client-web-react" in packageJson.peerDependencies, false);

	const client = readFileSync(join(projectRoot, "lib", "client.js"), "utf8");
	assert.match(client, /require\("@deepseek-ai\/dsh-client-store"\)/);
	assert.doesNotMatch(client, /dsh-client-runtime/);
	assert.doesNotMatch(client, /dsh-client-web-react/);
	assert.match(client, /react\.useSyncExternalStore/);
});

test("READMEs document the DSH version range and keep Desktop CLI commands in the legacy section", () => {
	const versions = packageJson.peerDependencies["@deepseek-ai/dsh-llm"].split(" || ");
	const readmes = [
		["README.md", "Requirements", "Legacy versions"],
		["README.zh-CN.md", "要求", "旧版说明"]
	];
	for (const [filename, requirementsHeading, legacyHeading] of readmes) {
		const sections = readFileSync(join(projectRoot, filename), "utf8").replaceAll("\r\n", "\n").split("\n## ");
		const requirements = sections.find((section) => section.startsWith(`${requirementsHeading}\n`));
		assert.ok(requirements, `${filename} has a requirements section`);
		for (const version of versions) {
			assert.ok(requirements.includes(`\`${version}\``), `${filename} documents DSH ${version}`);
		}

		const legacy = sections.find((section) => section.startsWith(`${legacyHeading}\n`));
		assert.ok(legacy, `${filename} has a legacy section`);
		assert.match(legacy, /plugin --profile desktop add dsh-openai-codex-auth/);
		assert.match(legacy, /plugin --profile desktop remove dsh-openai-codex-auth/);
		const currentSections = sections.filter((section) => section !== legacy).join("\n");
		assert.doesNotMatch(currentSections, /(?:dsh\.cmd|plugin --profile desktop)/, filename);
	}
});

test("Typed Remote failures expose only allowlisted error codes", () => {
	const host = readFileSync(join(projectRoot, "lib", "index.js"), "utf8");
	const client = readFileSync(join(projectRoot, "lib", "client.js"), "utf8");
	assert.match(host, /safeErrorCode\(error,/);
	assert.doesNotMatch(host, /error:\s*messageOf\(error\)|usageError:\s*messageOf\(error\)/);
	assert.doesNotMatch(client, /result\.error\.message/);
});
