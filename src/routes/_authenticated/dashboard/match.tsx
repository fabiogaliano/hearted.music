/**
 * /dashboard/match - Match songs flow
 *
 * Placeholder for Phase 7b.3 implementation.
 */

import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { themes } from "@/lib/theme/colors";
import { DEFAULT_THEME } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";

export const Route = createFileRoute("/_authenticated/dashboard/match")({
	component: MatchView,
});

function MatchView() {
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
				Match Songs
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
				The matching flow will be implemented in Phase 7b.3.
			</p>
		</div>
	);
}
