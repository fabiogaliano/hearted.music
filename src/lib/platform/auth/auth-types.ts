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
