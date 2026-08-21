import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const clientSource = readFileSync(join(projectRoot, "lib", "client.js"), "utf8");

test("login polling refreshes in the background without replacing the card", () => {
	assert.match(
		clientSource,
		/setInterval\(\(\) => \{\s*controller\.load\(\{ background: true \}\);/,
		"the polling path must not switch the card to its loading screen"
	);
	assert.match(clientSource, /async load\(\{ background = false \} = \{\}\)/);
	assert.match(clientSource, /sameJson\(current\.section, section\)/);
});

test("login card uses concise copy and provides a device-code copy action", () => {
	assert.match(clientSource, /intro: "登录 ChatGPT，在 DSH 中使用 OpenAI Codex。"/);
	assert.match(clientSource, /copy: "复制设备码"/);
	assert.match(clientSource, /navigator\.clipboard\.writeText\(deviceCode\)/);
});

test("logged-in card displays Codex usage returned by the host snapshot", () => {
	assert.match(clientSource, /usageStatus !== "loading"/);
	assert.match(clientSource, /usageTitle: "Codex 用量"/);
	assert.match(clientSource, /remaining: "剩余"/);
	assert.match(clientSource, /usageStatus === "error"/);
});

test("usage limits use accessible progress bars and aligned actions", () => {
	assert.match(clientSource, /role: "progressbar"/);
	assert.match(clientSource, /"aria-valuenow": Number\(remaining\)/);
	assert.match(clientSource, /style: progressTrackStyle/);
	assert.match(clientSource, /style: actionRowStyle/);
});

test("usage limits are grouped by model with subtle separators", () => {
	assert.match(clientSource, /function groupUsageLimits\(limits\)/);
	assert.match(clientSource, /const byName = new Map\(\)/);
	assert.match(clientSource, /role: "group"/);
	assert.match(clientSource, /children: group\.name/);
	assert.match(clientSource, /separated: index > 0/);
	assert.match(clientSource, /usageGroupSeparatedStyle = \{ borderTop: "1px solid var\(--dsw-alias-border-l2\)"/);
	assert.match(clientSource, /children: windowLabel/);
});

test("weekly usage is described as an exact seven-day window", () => {
	assert.match(clientSource, /return `\$\{seconds \/ 86400\} \$\{t\("days"\)\}`/);
	assert.match(clientSource, /days: "天"/);
	assert.doesNotMatch(clientSource, /weekly:|每周/);
});

test("usage refreshes automatically without a persistent refresh button", () => {
	assert.match(clientSource, /unwrap\(await this\.remote\.snapshot\(\)\)/);
	assert.doesNotMatch(clientSource, /run\("refresh_usage"\)/);
	assert.doesNotMatch(clientSource, /\.setAction\(/);
	assert.doesNotMatch(clientSource, /refreshUsage:/);
});
