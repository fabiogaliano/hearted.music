import { createFileRoute } from "@tanstack/react-router";
import { getTheme } from "@/lib/theme/useTheme";
import { DEFAULT_THEME } from "@/lib/theme/types";
import { playlistManagementQueryOptions } from "@/features/playlists/queries";
import { PlaylistsScreen } from "@/features/playlists/PlaylistsScreen";

export const Route = createFileRoute("/_authenticated/playlists")({
	loader: async ({ context }) => {
		const accountId = context.session.accountId;
		await context.queryClient.ensureQueryData(
			playlistManagementQueryOptions(accountId),
		);
	},
	component: PlaylistsPage,
});

function PlaylistsPage() {
	const { theme: themeColor, session } = Route.useRouteContext();
	const theme = getTheme(themeColor ?? DEFAULT_THEME);

	return <PlaylistsScreen theme={theme} accountId={session.accountId} />;
}
