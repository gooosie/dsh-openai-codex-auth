import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const installer = join(projectRoot, "install.mjs");

function occurrences(text, needle) {
	return text.split(needle).length - 1;
}

function runInstaller(dshHome) {
	const result = runInstallerRaw(dshHome);
	assert.equal(
		result.status,
		0,
		`installer failed\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`
	);
}

function runInstallerRaw(dshHome, args = []) {
	return spawnSync(process.execPath, [installer, ...args], {
		encoding: "utf8",
		env: { ...process.env, DSH_HOME: dshHome }
	});
}

test("installer migrates the legacy name and remains idempotent", () => {
	const dshHome = mkdtempSync(join(tmpdir(), "dsh-openai-codex-auth-"));
	try {
		const modules = join(dshHome, "profiles", "node_modules");
		const apiProxy = join(modules, "@deepseek-ai", "dsh-host-apiproxy", "lib", "index.js");
		const cordisPatch = join(dshHome, "profiles", "web", "cordis.patch.yml");
		const legacyPackage = join(modules, "dsh-openai-codex-login");
		mkdirSync(dirname(apiProxy), { recursive: true });
		mkdirSync(dirname(cordisPatch), { recursive: true });
		mkdirSync(legacyPackage, { recursive: true });
		writeFileSync(join(legacyPackage, "package.json"), "{}\n");
		writeFileSync(apiProxy, [
			"const readableSettings = [",
			'\t"permission",',
			"/* dsh-openai-codex-login:begin */",
			'\t"openai-codex-login",',
			"/* dsh-openai-codex-login:end */",
			'\t"web-search-deepseek"',
			"];",
			""
		].join("\n"));
		writeFileSync(cordisPatch, [
			"# User-owned header.",
			"",
			"# OpenAI Codex OAuth login.",
			"# Obsolete installer comment.",
			"- insert:",
			"    - id: openai-codex-login",
			"      name: dsh-openai-codex-login",
			""
		].join("\n"));

		runInstaller(dshHome);
		runInstaller(dshHome);

		const api = readFileSync(apiProxy, "utf8");
		assert.equal(occurrences(api, "/* dsh-openai-codex-auth:begin */"), 1);
		assert.equal(occurrences(api, '"openai-codex-auth"'), 1);
		assert.equal(api.includes("openai-codex-login"), false);

		const cordis = readFileSync(cordisPatch, "utf8");
		assert.equal(occurrences(cordis, "# dsh-openai-codex-auth:begin"), 1);
		assert.equal(occurrences(cordis, "name: dsh-openai-codex-auth"), 1);
		assert.equal(occurrences(cordis, "id: openai-codex-auth"), 1);
		assert.equal(cordis.includes("dsh-openai-codex-login"), false);
		assert.equal(cordis.includes("# User-owned header."), true);

		const installedPackage = join(modules, "dsh-openai-codex-auth", "package.json");
		const installedInstaller = join(modules, "dsh-openai-codex-auth", "install.mjs");
		assert.equal(existsSync(installedPackage), true);
		assert.equal(existsSync(installedInstaller), true);
		assert.equal(JSON.parse(readFileSync(installedPackage, "utf8")).name, "dsh-openai-codex-auth");
		assert.equal(existsSync(legacyPackage), false);

		const uninstall = spawnSync(process.execPath, [installedInstaller, "--uninstall"], {
			encoding: "utf8",
			env: { ...process.env, DSH_HOME: dshHome }
		});
		assert.equal(uninstall.status, 0, uninstall.stderr);
		assert.equal(readFileSync(apiProxy, "utf8").includes("dsh-openai-codex-auth"), false);
		const uninstalledCordis = readFileSync(cordisPatch, "utf8");
		assert.equal(uninstalledCordis.includes("dsh-openai-codex-auth"), false);
		assert.equal(uninstalledCordis.includes("# User-owned header."), true);
		assert.equal(runInstallerRaw(dshHome, ["--uninstall"]).status, 0);
	} finally {
		rmSync(dshHome, { recursive: true, force: true });
	}
});

for (const conflictPackage of ["dsh-openai-codex", "dsh-oauth-openai"]) {
	test(`installer refuses ${conflictPackage} before mutating the profile`, () => {
		const dshHome = mkdtempSync(join(tmpdir(), "dsh-openai-codex-auth-conflict-"));
		try {
			const modules = join(dshHome, "profiles", "node_modules");
			const apiProxy = join(modules, "@deepseek-ai", "dsh-host-apiproxy", "lib", "index.js");
			const cordisPatch = join(dshHome, "profiles", "web", "cordis.patch.yml");
			mkdirSync(dirname(apiProxy), { recursive: true });
			mkdirSync(dirname(cordisPatch), { recursive: true });
			const initialApi = 'const readableSettings = [\n\t"web-search-deepseek"\n];\n';
			writeFileSync(apiProxy, initialApi);
			writeFileSync(cordisPatch, `- insert:\n    - id: openai-codex\n      name: ${conflictPackage}\n`);

			const result = runInstallerRaw(dshHome);
			assert.notEqual(result.status, 0);
			assert.match(result.stderr, new RegExp(conflictPackage));
			assert.equal(readFileSync(apiProxy, "utf8"), initialApi);
			assert.equal(existsSync(join(modules, "dsh-openai-codex-auth")), false);
		} finally {
			rmSync(dshHome, { recursive: true, force: true });
		}
	});
}
