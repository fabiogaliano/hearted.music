import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PlaylistsScreen } from "@/features/playlists/PlaylistsScreen";
import { playlistManagementQueryOptions } from "@/features/playlists/queries";
import { DEFAULT_THEME } from "@/lib/theme/types";
import { getTheme } from "@/lib/theme/useTheme";

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

	return (
		<>
			<PlaylistsScreen theme={theme} accountId={session.accountId} />
			<Outlet />
		</>
	);
}
