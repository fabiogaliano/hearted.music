/**
 * POST /auth/logout - Destroys Better Auth session and redirects to home
 */

import { createFileRoute, redirect } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { useAnalytics } from "@/lib/observability/useAnalytics";
import { getAuth } from "@/lib/platform/auth/auth";

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
	const analytics = useAnalytics();

	function handleSubmit() {
		analytics.capture("user_logged_out", undefined, {
			send_instantly: true,
		});
		analytics.reset();
	}

	return (
		<div className="flex min-h-screen items-center justify-center">
			<form action={handleLogout.url} method="POST" onSubmit={handleSubmit}>
				<button
					type="submit"
					className="theme-primary-action squircle cursor-pointer rounded-[10px] px-4 py-2 text-sm tracking-widest uppercase transition-opacity duration-150 hover:opacity-90"
				>
					Confirm Logout
				</button>
			</form>
		</div>
	);
}
