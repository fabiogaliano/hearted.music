/**
 * POST /auth/logout - Clears session and redirects to home
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { clearSessionCookie, getSessionCookie } from "@/lib/auth/cookies";
import { deleteToken } from "@/lib/data/auth-tokens";

const handleLogout = createServerFn({ method: "POST" }).handler(async () => {
	const request = getRequest();
	const accountId = getSessionCookie(request);

	// Delete tokens from database if we have a session
	if (accountId) {
		try {
			await deleteToken(accountId);
		} catch {
			// Ignore errors - session will be cleared anyway
		}
	}

	// Clear session cookie
	const clearCookie = clearSessionCookie();

	throw redirect({
		to: "/",
		headers: {
			"Set-Cookie": clearCookie,
		},
	});
});

// Export the server function for use in forms/buttons
export { handleLogout };

export const Route = createFileRoute("/auth/logout")({
	component: LogoutPage,
});

function LogoutPage() {
	return (
		<div className="flex min-h-screen items-center justify-center">
			<form action={handleLogout.url} method="POST">
				<button
					type="submit"
					className="rounded-md bg-red-600 px-4 py-2 text-white hover:bg-red-700"
				>
					Confirm Logout
				</button>
			</form>
		</div>
	);
}
