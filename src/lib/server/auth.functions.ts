import { redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
	getAuthSession,
	getAuthSessionState,
} from "@/lib/platform/auth/auth.server";
import type { AuthSessionState } from "@/lib/platform/auth/auth-types";
import { returnPathSchema } from "@/lib/platform/auth/return-path";
import { signUserJotIdentity } from "@/lib/server/userjot-signature.server";

export const getAuthStatus = createServerFn({ method: "GET" }).handler(
	async (): Promise<AuthSessionState["status"]> => {
		const state = await getAuthSessionState();
		return state.status;
	},
);

// Carries the feedback widget's identity signature so the shell doesn't spend
// a server fn call on it after hydration. returnTo rides along to the landing
// page so signing in lands back on the deep link instead of the dashboard.
export const requireAuthSession = createServerFn({ method: "GET" })
	.validator(z.object({ returnTo: returnPathSchema }))
	.handler(async ({ data }) => {
		const auth = await getAuthSession();
		if (!auth) {
			throw redirect({ to: "/", search: { redirect: data.returnTo } });
		}
		return {
			...auth,
			userJotSignature: await signUserJotIdentity(auth.session.accountId),
		};
	});
