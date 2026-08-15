import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

const SERVICE_KEY = "openai-codex-auth";
const NAMESPACE = "openaiCodex";

/**
 * Host service exposed to the Web client through DSH's Typed Remote gateway.
 * The handlers return sanitized snapshots only; OAuth credentials never cross
 * this boundary.
 */
class OpenAICodexRemoteService extends TypertRemoteService {
	constructor(ctx, handlers) {
		super(ctx, SERVICE_KEY, { namespace: NAMESPACE });
		this.handlers = handlers;
		for (const initialize of REMOTE_INITIALIZERS) initialize.call(this);
	}

	snapshot() {
		return this.handlers.snapshot();
	}

	startLogin() {
		return this.handlers.startLogin();
	}

	logout() {
		return this.handlers.logout();
	}
}

function remoteInitializer(prototype, method) {
	let initialize;
	Remote(prototype[method], {
		kind: "method",
		name: method,
		static: false,
		private: false,
		addInitializer(value) {
			initialize = value;
		}
	});
	if (initialize === void 0) throw new Error(`failed to mark Remote method ${method}`);
	return initialize;
}

const REMOTE_INITIALIZERS = ["snapshot", "startLogin", "logout"].map((method) => {
	return remoteInitializer(OpenAICodexRemoteService.prototype, method);
});

export { NAMESPACE, OpenAICodexRemoteService, SERVICE_KEY };
