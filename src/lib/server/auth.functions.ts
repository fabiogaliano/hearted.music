import { createServerFn } from "@tanstack/react-start";
import {
	getAuthSessionState,
	requireAuthSession as requireAuthSessionImpl,
} from "@/lib/platform/auth/auth.server";
import type { AuthSessionState } from "@/lib/platform/auth/auth-types";

export const getAuthStatus = createServerFn({ method: "GET" }).handler(
	async (): Promise<AuthSessionState["status"]> => {
		const state = await getAuthSessionState();
		return state.status;
	},
);

export const requireAuthSession = createServerFn({ method: "GET" }).handler(
	async () => {
		return requireAuthSessionImpl();
	},
);
