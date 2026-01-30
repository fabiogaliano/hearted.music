/**
 * /dashboard/playlists - Playlists view
 *
 * Placeholder for Phase 7b.4 implementation.
 */

import { createFileRoute, useRouteContext } from "@tanstack/react-router";
import { themes } from "@/lib/theme/colors";
import { DEFAULT_THEME } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";

export const Route = createFileRoute("/_authenticated/dashboard/playlists")({
	component: PlaylistsView,
});

function PlaylistsView() {
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
				Playlists
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
				The playlists view will be implemented in Phase 7b.4.
			</p>
		</div>
	);
}
