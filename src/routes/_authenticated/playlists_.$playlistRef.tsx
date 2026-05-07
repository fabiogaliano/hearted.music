import { createFileRoute } from "@tanstack/react-router";
import { PlaylistsScreen } from "@/features/playlists/PlaylistsScreen";
import { playlistManagementQueryOptions } from "@/features/playlists/queries";
import { DEFAULT_THEME } from "@/lib/theme/types";
import { getTheme } from "@/lib/theme/useTheme";

export const Route = createFileRoute("/_authenticated/playlists_/$playlistRef")(
	{
		loader: async ({ context }) => {
			const accountId = context.session.accountId;
			await context.queryClient.ensureQueryData(
				playlistManagementQueryOptions(accountId),
			);
		},
		component: PlaylistsRefPage,
	},
);

function PlaylistsRefPage() {
	const { theme: themeColor, session } = Route.useRouteContext();
	const { playlistRef } = Route.useParams();
	const theme = getTheme(themeColor ?? DEFAULT_THEME);

	return (
		<PlaylistsScreen
			theme={theme}
			accountId={session.accountId}
			selectedPlaylistRef={playlistRef}
		/>
	);
}
