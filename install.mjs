// Install or update dsh-openai-codex-auth in the active DSH Web profile.
//
// DSH 0.1.0-rc.6 keeps Web-readable settings namespaces in a host-side
// allowlist, so installation currently includes one small, marked product
// patch. Re-running this script is safe. A future DSH release with declarative
// settings exposure can remove that patch without changing the plugin API.

import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	rmSync,
	writeFileSync
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "dsh-openai-codex-auth";
const PLUGIN_ID = "openai-codex-auth";
const LEGACY_PACKAGE_NAME = "dsh-openai-codex-login";
const LEGACY_PLUGIN_ID = "openai-codex-login";
const CONFLICT_PACKAGE_NAMES = ["dsh-openai-codex", "dsh-oauth-openai"];

const projectRoot = dirname(fileURLToPath(import.meta.url));
const dshHome = resolve(process.env.DSH_HOME ?? join(homedir(), ".dsh"));
const modules = join(dshHome, "profiles", "node_modules");
const targetPackage = join(modules, PACKAGE_NAME);
const legacyPackage = join(modules, LEGACY_PACKAGE_NAME);
const apiProxyPath = join(modules, "@deepseek-ai", "dsh-host-apiproxy", "lib", "index.js");
const adapterPath = join(modules, "@deepseek-ai", "dsh-llm-pi-ai", "lib", "index.js");
const cordisPatchPath = join(dshHome, "profiles", "web", "cordis.patch.yml");

const API_BEGIN = `/* ${PACKAGE_NAME}:begin */`;
const API_END = `/* ${PACKAGE_NAME}:end */`;
const LEGACY_API_BEGIN = `/* ${LEGACY_PACKAGE_NAME}:begin */`;
const LEGACY_API_END = `/* ${LEGACY_PACKAGE_NAME}:end */`;
const CORDIS_BEGIN = `# ${PACKAGE_NAME}:begin`;
const CORDIS_END = `# ${PACKAGE_NAME}:end`;

function log(message) {
	console.log(`${PACKAGE_NAME}: ${message}`);
}

function fail(message) {
	console.error(`${PACKAGE_NAME}: ${message}`);
	process.exit(1);
}

function eolOf(text) {
	return text.includes("\r\n") ? "\r\n" : "\n";
}

function replaceMarkedBlock(text, begin, end, replacement) {
	const start = text.indexOf(begin);
	if (start < 0) return { found: false, text };
	const endStart = text.indexOf(end, start + begin.length);
	if (endStart < 0) fail(`found ${begin} without its closing marker`);
	let finish = endStart + end.length;
	if (text.slice(finish, finish + 2) === "\r\n") finish += 2;
	else if (text[finish] === "\n") finish += 1;
	return {
		found: true,
		text: text.slice(0, start) + replacement + text.slice(finish)
	};
}

function copyRuntimePackage() {
	const sourcePath = realpathSync(projectRoot);
	const installedPath = existsSync(targetPackage) ? realpathSync(targetPackage) : resolve(targetPackage);
	if (sourcePath === installedPath) {
		log("already running from the installed package");
		return;
	}
	mkdirSync(targetPackage, { recursive: true });
	for (const entry of ["package.json", "README.md", "LICENSE", "CONTRIBUTING.md", "SECURITY.md", "install.mjs", "lib"]) {
		const source = join(projectRoot, entry);
		if (!existsSync(source)) fail(`source entry not found: ${source}`);
		cpSync(source, join(targetPackage, entry), { recursive: true, force: true });
	}
	log(`installed ${targetPackage}`);
}

function patchSettingsAllowlist() {
	let source = readFileSync(apiProxyPath, "utf8");
	const eol = eolOf(source);
	const block = [API_BEGIN, `\t"${PLUGIN_ID}",`, API_END, ""].join(eol);

	const withoutLegacy = replaceMarkedBlock(source, LEGACY_API_BEGIN, LEGACY_API_END, "");
	source = withoutLegacy.text;
	const current = replaceMarkedBlock(source, API_BEGIN, API_END, block);
	if (current.found) {
		source = current.text;
	} else {
		const anchor = '\t"web-search-deepseek"';
		if (!source.includes(anchor)) {
			fail("DSH Web settings allowlist anchor changed; refusing to guess a patch location");
		}
		source = source.replace(anchor, block + anchor);
	}

	writeFileSync(apiProxyPath, source, "utf8");
	log(withoutLegacy.found ? "migrated the Web settings allowlist patch" : "Web settings exposure is ready");
}

function removeLegacyCordisEntry(text) {
	const eol = eolOf(text);
	const hadFinalEol = text.endsWith("\n");
	const lines = text.split(/\r?\n/);
	const hits = lines
		.map((line, index) => line.trim() === `name: ${LEGACY_PACKAGE_NAME}` ? index : -1)
		.filter((index) => index >= 0);
	if (hits.length > 1) fail("multiple legacy Cordis entries found; remove duplicates manually and rerun");
	if (hits.length === 0) return { found: false, text };

	const nameIndex = hits[0];
	if (
		lines[nameIndex - 1]?.trim() !== `- id: ${LEGACY_PLUGIN_ID}` ||
		lines[nameIndex - 2]?.trim() !== "- insert:"
	) {
		fail("legacy Cordis entry has an unexpected shape; refusing to rewrite it");
	}
	let start = nameIndex - 2;
	while (start > 0 && lines[start - 1]?.trimStart().startsWith("#")) start--;
	lines.splice(start, nameIndex - start + 1);
	let output = lines.join(eol);
	if (hadFinalEol && !output.endsWith(eol)) output += eol;
	return { found: true, text: output };
}

function assertCordisCompatible(source) {
	const conflict = CONFLICT_PACKAGE_NAMES.find((packageName) => {
		const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
		return new RegExp(`^\\s*name:\\s*${escaped}\\s*$`, "m").test(source);
	});
	if (conflict !== void 0) {
		fail(`the conflicting ${conflict} provider is enabled; remove it before installing this standalone provider`);
	}
	removeLegacyCordisEntry(source);
	if (source.includes(CORDIS_BEGIN)) replaceMarkedBlock(source, CORDIS_BEGIN, CORDIS_END, "");
	if (
		/^\s*name:\s*dsh-openai-codex-auth\s*$/m.test(source) &&
		!/^\s*- id:\s*openai-codex-auth\s*$/m.test(source)
	) {
		fail("the existing Cordis package entry uses an unexpected plugin id");
	}
}

function patchCordisProfile() {
	let source = existsSync(cordisPatchPath) ? readFileSync(cordisPatchPath, "utf8") : "";
	assertCordisCompatible(source);
	const eol = eolOf(source);
	const block = [
		CORDIS_BEGIN,
		"# OpenAI Codex provider with ChatGPT subscription sign-in.",
		"- insert:",
		`    - id: ${PLUGIN_ID}`,
		`      name: ${PACKAGE_NAME}`,
		CORDIS_END,
		""
	].join(eol);

	const legacy = removeLegacyCordisEntry(source);
	source = legacy.text;
	const current = replaceMarkedBlock(source, CORDIS_BEGIN, CORDIS_END, block);
	if (current.found) {
		source = current.text;
	} else if (/^\s*name:\s*dsh-openai-codex-auth\s*$/m.test(source)) {
		if (!/^\s*- id:\s*openai-codex-auth\s*$/m.test(source)) {
			fail("the existing Cordis package entry uses an unexpected plugin id");
		}
	} else {
		if (source.length > 0 && !source.endsWith("\n")) source += eol;
		if (source.length > 0 && !source.endsWith(eol + eol)) source += eol;
		source += block;
	}

	mkdirSync(dirname(cordisPatchPath), { recursive: true });
	writeFileSync(cordisPatchPath, source, "utf8");
	log(legacy.found ? "migrated the legacy Cordis entry" : "Cordis profile entry is ready");
}

function removeLegacyPackage() {
	if (!existsSync(legacyPackage)) return;
	if (dirname(resolve(legacyPackage)) !== resolve(modules) || basename(legacyPackage) !== LEGACY_PACKAGE_NAME) {
		fail(`refusing to remove an unexpected legacy path: ${legacyPackage}`);
	}
	try {
		rmSync(legacyPackage, { recursive: true, force: true });
		log(`removed legacy package ${legacyPackage}`);
	} catch (error) {
		console.warn(`${PACKAGE_NAME}: could not remove the unused legacy package: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function preflightProfile() {
	if (!existsSync(join(projectRoot, "package.json"))) fail(`source package not found at ${projectRoot}`);
	if (!existsSync(apiProxyPath)) fail(`DSH Web API proxy not found at ${apiProxyPath}; install or start the Web profile first`);
	const apiProxy = readFileSync(apiProxyPath, "utf8");
	if (!apiProxy.includes(API_BEGIN) && !apiProxy.includes(LEGACY_API_BEGIN) && !apiProxy.includes('\t"web-search-deepseek"')) {
		fail("DSH Web settings allowlist anchor changed; refusing to patch this version");
	}
	if (apiProxy.includes(API_BEGIN)) replaceMarkedBlock(apiProxy, API_BEGIN, API_END, "");
	if (apiProxy.includes(LEGACY_API_BEGIN)) replaceMarkedBlock(apiProxy, LEGACY_API_BEGIN, LEGACY_API_END, "");
	const cordis = existsSync(cordisPatchPath) ? readFileSync(cordisPatchPath, "utf8") : "";
	assertCordisCompatible(cordis);
}

function removeSettingsAllowlistPatch() {
	if (!existsSync(apiProxyPath)) {
		log("DSH Web API proxy is absent; settings allowlist is already clean");
		return;
	}
	const source = readFileSync(apiProxyPath, "utf8");
	const current = replaceMarkedBlock(source, API_BEGIN, API_END, "");
	if (!current.found) {
		log("settings allowlist patch is already absent");
		return;
	}
	writeFileSync(apiProxyPath, current.text, "utf8");
	log("removed the Web settings allowlist patch");
}

function removeCordisProfilePatch() {
	if (!existsSync(cordisPatchPath)) {
		log("Cordis profile patch is already absent");
		return;
	}
	const source = readFileSync(cordisPatchPath, "utf8");
	const current = replaceMarkedBlock(source, CORDIS_BEGIN, CORDIS_END, "");
	if (!current.found) {
		log("marked Cordis profile entry is already absent");
		return;
	}
	writeFileSync(cordisPatchPath, current.text, "utf8");
	log("removed the marked Cordis profile entry");
}

if (process.argv.includes("--uninstall")) {
	removeSettingsAllowlistPatch();
	removeCordisProfilePatch();
	log(`integration patches removed; run "dsh plugin --profile web remove ${PACKAGE_NAME}" to remove the package`);
} else {
	preflightProfile();
	copyRuntimePackage();
	patchSettingsAllowlist();
	patchCordisProfile();
	removeLegacyPackage();

	if (existsSync(adapterPath)) {
		const adapter = readFileSync(adapterPath, "utf8");
		if (adapter.includes(LEGACY_API_BEGIN) || adapter.includes(API_BEGIN)) {
			console.warn(`${PACKAGE_NAME}: an obsolete dsh-llm-pi-ai patch is still present; reinstall that DSH package before publishing bug reports`);
		}
	}

	log("install/update complete; restart DSH to load it");
}
