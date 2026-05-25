import { getAuthRequestState } from "@/lib/platform/auth/auth-request-state";

export function getAuth() {
	return getAuthRequestState().getAuth();
}
