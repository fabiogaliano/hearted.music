import { createFileRoute } from "@tanstack/react-router";
import { getTheme } from "@/lib/theme/useTheme";
import { DEFAULT_THEME } from "@/lib/theme/types";

export const Route = createFileRoute("/_authenticated/match")({
	component: MatchPage,
});

function MatchPage() {
	const { theme: themeColor } = Route.useRouteContext();
	const theme = getTheme(themeColor ?? DEFAULT_THEME);

	return (
		<div className="flex items-center justify-center min-h-[60vh]">
			<div className="text-center">
				<h1
					className="text-2xl font-semibold mb-2"
					style={{ color: theme.text }}
				>
					Match Songs
				</h1>
				<p style={{ color: theme.textMuted }}>Coming Soon</p>
			</div>
		</div>
	);
}
