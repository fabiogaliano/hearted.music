import { createServerFn } from "@tanstack/react-start";
import {
	getAuthSession as getAuthSessionImpl,
	requireAuthSession as requireAuthSessionImpl,
} from "@/lib/auth.server";

export const getAuthSession = createServerFn({ method: "GET" }).handler(
	async () => {
		return getAuthSessionImpl();
	},
);

export const requireAuthSession = createServerFn({ method: "GET" }).handler(
	async () => {
		return requireAuthSessionImpl();
	},
);
