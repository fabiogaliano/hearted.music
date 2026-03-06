/**
 * POST /auth/logout - Destroys Better Auth session and redirects to home
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { getAuth } from "@/lib/auth";

const handleLogout = createServerFn({ method: "POST" }).handler(async () => {
	const request = getRequest();

	await getAuth().api.signOut({ headers: request.headers });

	throw redirect({ to: "/" });
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
