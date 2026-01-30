/**
 * /dashboard/liked - Liked songs view
 *
 * Placeholder for future implementation.
 */

import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { themes } from "@/lib/theme/colors";
import { DEFAULT_THEME } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";

export const Route = createFileRoute("/_authenticated/dashboard/liked")({
	component: LikedView,
});

function LikedView() {
	const { dashboardData } = useRouteContext({
		from: "/_authenticated/dashboard",
	});
	const theme = themes[dashboardData.theme ?? DEFAULT_THEME];

	return (
		<div className="max-w-4xl">
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Liked Songs
			</p>
			<h2
				className="mt-2 text-4xl font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				Coming Soon
			</h2>
			<p
				className="mt-4 text-sm"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				The liked songs view will be implemented in a future phase.
			</p>
		</div>
	);
}
