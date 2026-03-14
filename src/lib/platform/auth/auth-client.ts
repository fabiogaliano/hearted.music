/**
 * Better Auth client for React.
 *
 * Provides hooks and methods for client-side auth operations.
 * The baseURL is omitted — defaults to current origin in TanStack Start.
 */

import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient();

export const { signIn, signOut, useSession } = authClient;
