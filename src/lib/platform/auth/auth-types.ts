import type { Account } from "@/lib/domains/library/accounts/queries";

export interface AppSession {
	accountId: string;
	id: string;
	createdAt: Date;
}

export interface AuthIdentity {
	email: string;
	emailVerified: boolean;
}

export interface AuthContext {
	session: AppSession;
	account: Account;
	identity: AuthIdentity;
}

/**
 * `unavailable` is kept apart from `unauthenticated` so an auth/DB outage is
 * never shown to a signed-in user as being logged out.
 */
export type AuthSessionState =
	| { status: "authenticated"; auth: AuthContext }
	| { status: "unauthenticated" }
	| { status: "unavailable" };
