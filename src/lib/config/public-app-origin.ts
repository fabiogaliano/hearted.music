import { clientEnv } from "@/env.public";

export function getPublicAppOrigin(): string {
	return clientEnv.VITE_PUBLIC_APP_ORIGIN.replace(/\/$/, "");
}

// Assumes `handle` is a canonical bare handle (no leading @).
export function buildPublicHandleUrl(handle: string): string {
	return `${getPublicAppOrigin()}/@${handle}`;
}
