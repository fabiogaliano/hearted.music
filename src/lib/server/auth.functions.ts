import { createServerFn } from "@tanstack/react-start";
import {
	getAuthSessionState,
	requireAuthSession as requireAuthSessionImpl,
} from "@/lib/platform/auth/auth.server";
import type { AuthSessionState } from "@/lib/platform/auth/auth-types";
import { signUserJotIdentity } from "@/lib/server/userjot-signature.server";

export const getAuthStatus = createServerFn({ method: "GET" }).handler(
	async (): Promise<AuthSessionState["status"]> => {
		const state = await getAuthSessionState();
		return state.status;
	},
);

// Carries the feedback widget's identity signature so the shell doesn't spend
// a server fn call on it after hydration.
export const requireAuthSession = createServerFn({ method: "GET" }).handler(
	async () => {
		const auth = await requireAuthSessionImpl();
		return {
			...auth,
			userJotSignature: await signUserJotIdentity(auth.session.accountId),
		};
	},
);
