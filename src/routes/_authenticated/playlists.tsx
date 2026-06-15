import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PlaylistsCoverFlowScreen } from "@/features/playlists/PlaylistsCoverFlowScreen";
import { playlistManagementQueryOptions } from "@/features/playlists/queries";

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
	const { session } = Route.useRouteContext();

	return (
		<>
			<PlaylistsCoverFlowScreen accountId={session.accountId} />
			<Outlet />
		</>
	);
}
