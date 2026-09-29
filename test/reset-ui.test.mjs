import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

function harness(consumeReset) {
	const hooks = [];
	const storage = new Map();
	let cursor = 0, ResetCards, busy = false;
	const react = {
		useState(initial) {
			const id = cursor++;
			if (!(id in hooks)) hooks[id] = typeof initial === "function" ? initial() : initial;
			return [hooks[id], (value) => { hooks[id] = typeof value === "function" ? value(hooks[id]) : value; }];
		},
		useRef(value) {
			const id = cursor++;
			return hooks[id] ??= { current: value };
		}
	};
	const jsx = (type, props) => ({ type, props });
	const code = readFileSync(new URL("../lib/client.js", import.meta.url), "utf8")
		.replace("exports.apply = apply;", "exports.ResetCards = ResetCards; exports.apply = apply;");
	runInNewContext(code, {
		window: { __ModuleLoader__: { load: ({ factory }) => {
			({ ResetCards } = factory((id) => id === "react" ? react :
				id === "react/jsx-runtime" ? { jsx, jsxs: jsx } : { Modal: "Modal" }));
		} } },
		sessionStorage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
		crypto: { randomUUID: () => "12345678-1234-4234-8234-123456789abc" }
	});
	const props = { section: { usageResetCredits: 2, resetCardsStatus: "ready", resetCards: [{ id: "card-1", expiresAt: null }, { id: "card-2", expiresAt: 4102444800000 }] },
		controller: { consumeReset }, t: (key) => key, setBusy: (value) => { busy = value; } };
	const render = () => { cursor = 0; return ResetCards({ ...props, busy }); };
	const walk = (node) => !node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat().flatMap(walk)];
	const find = (root, label) => walk(root).find((node) => node.props?.children === label);
	const modal = (root) => walk(root).find((node) => node.type === "Modal");
	return { render, find, modal, storage, walk };
}

test("opening and cancelling confirmation never calls redemption; confirmation dispatches once", async () => {
	const inputs = [];
	let complete;
	const h = harness((input) => { inputs.push(input); return new Promise((resolve) => { complete = resolve; }); });
	h.find(h.render(), "resetUse").props.onClick();
	assert.equal(h.modal(h.render()).props.open, true);
	h.find(h.modal(h.render()).props.footer, "resetCancel").props.onClick();
	assert.equal(inputs.length, 0);
	h.find(h.render(), "resetUse").props.onClick();
	const confirm = h.find(h.modal(h.render()).props.footer, "resetConfirm").props.onClick;
	confirm();
	confirm();
	assert.equal(inputs.length, 1);
	assert.equal(inputs[0].confirmed, true);
	assert.equal(inputs[0].creditId, "card-1");
	assert.equal(h.storage.size, 1);
	assert.equal(h.find(h.modal(h.render()).props.footer, "working").props.disabled, true);
	complete("reset");
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(h.storage.size, 0);
	assert.equal(h.modal(h.render()).props.open, false);
});

test("uncertain UI result retains the original idempotency key for a confirmed retry", async () => {
	const inputs = [];
	const h = harness(async (input) => { inputs.push(input); return inputs.length === 1 ? "unknown" : "already_redeemed"; });
	for (const label of ["resetUse", "resetRetry"]) {
		h.find(h.render(), label).props.onClick();
		h.find(h.modal(h.render()).props.footer, "resetConfirm").props.onClick();
		await new Promise((resolve) => setImmediate(resolve));
	}
	assert.equal(inputs.length, 2);
	assert.equal(inputs[0].idempotencyKey, inputs[1].idempotencyKey);
	assert.equal(inputs[0].creditId, inputs[1].creditId);
	assert.equal(h.storage.size, 0);
});

test("second row selects the second card and confirmation includes its expiry", async () => {
	let sent;
	const h = harness(async (input) => { sent = input; return "reset"; });
	const buttons = h.walk(h.render()).filter((node) => node.props?.children === "resetUse");
	buttons[1].props.onClick();
	assert.match(h.modal(h.render()).props.children.props.children, /2100/);
	h.find(h.modal(h.render()).props.footer, "resetConfirm").props.onClick();
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(sent.creditId, "card-2");
});

test("reset cards share one region divider, without dividers on individual rows", () => {
	const h = harness(() => assert.fail("display never consumes"));
	const root = h.render();
	assert.equal(root.props.role, "group");
	assert.equal(root.props["aria-label"], "resetTitle");
	assert.ok(root.props.style.borderTop);
	const rows = root.props.children.filter((node) => node?.props?.style?.justifyContent === "space-between");
	assert.equal(rows.length, 2);
	for (const row of rows) assert.equal(row.props.style.borderTop, undefined);
});
