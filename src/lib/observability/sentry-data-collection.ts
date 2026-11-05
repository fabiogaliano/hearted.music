import type { DataCollection } from "@sentry/core";

// Header, query-param and cookie names that carry client addresses or
// identities. Sentry's own sensitive-key filter (auth, token, password, …)
// still applies on top of this.
const IDENTITY_KEY_DENYLIST = ["forwarded", "-ip", "remote-", "via", "-user"];

/**
 * Shared by the browser, web-server and worker inits. Left unset, Sentry
 * collects user IPs, cookies, request/response bodies, DB query data and
 * GenAI prompts/outputs. The browser init runs before consent as a
 * legitimate-interest baseline, so none of that may be collected there, and
 * the servers hold to the same line: account ids reach Sentry only through
 * captureServerError's explicit `user.id`.
 */
export const SENTRY_DATA_COLLECTION: DataCollection = {
	userInfo: false,
	cookies: false,
	httpHeaders: {
		request: { deny: IDENTITY_KEY_DENYLIST },
		response: { deny: IDENTITY_KEY_DENYLIST },
	},
	httpBodies: [],
	urlQueryParams: { deny: IDENTITY_KEY_DENYLIST },
	genAI: { inputs: false, outputs: false },
	databaseQueryData: false,
	queues: false,
	graphQL: { document: false, variables: false },
	// Source context size existing issues were grouped and read with.
	frameContextLines: 7,
};
