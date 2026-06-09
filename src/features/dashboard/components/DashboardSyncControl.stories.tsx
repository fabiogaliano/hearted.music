import type { Story } from "@ladle/react";
import type { ReactNode } from "react";
import type { DashboardSyncUiState } from "@/features/dashboard/hooks/useDashboardSync";
import type { ExtensionSyncState } from "@/lib/extension/detect";
import { fonts } from "@/lib/theme/fonts";
import { DashboardSyncControl } from "./DashboardSyncControl";

export default {
	title: "Dashboard/SyncControl",
};

const noop = () => {};

// Mirror DashboardHeader's right-hand metadata cluster so each state is judged
// in the layout it actually ships in, across all four theme hues.
function HeaderContext({ children }: { children: ReactNode }) {
	return (
		<div style={{ padding: 48 }}>
			<div
				className="theme-text-muted flex flex-wrap items-center gap-x-2 gap-y-2 text-xs"
				style={{ fontFamily: fonts.body }}
			>
				<span className="tabular-nums">
					1,280 <span className="tracking-widest uppercase">songs</span>
				</span>
				<span aria-hidden="true" className="opacity-40">
					·
				</span>
				<span className="tabular-nums">
					24 <span className="tracking-widest uppercase">playlists</span>
				</span>
				<span aria-hidden="true" className="mx-1 opacity-40">
					|
				</span>
				<span className="flex items-center gap-2">
					<span className="theme-text-muted-bg size-1.5 rounded-full" />
					synced 2 hours ago
				</span>
				{children}
			</div>
		</div>
	);
}

function makeSync(overrides: Partial<ExtensionSyncState>): ExtensionSyncState {
	return {
		status: "syncing",
		phase: "likedSongs",
		fetched: 0,
		total: 0,
		likedSongs: { fetched: 0, total: 0 },
		playlists: { fetched: 0, total: 0 },
		playlistTracks: { fetched: 0, total: 0 },
		artistImages: { fetched: 0, total: 0 },
		lastSyncAt: null,
		error: null,
		...overrides,
	};
}

function StoryFor(state: DashboardSyncUiState): Story {
	const Component: Story = () => (
		<HeaderContext>
			<DashboardSyncControl state={state} onAction={noop} />
		</HeaderContext>
	);
	return Component;
}

export const Checking = StoryFor({ kind: "checking" });
export const InstallRequired = StoryFor({ kind: "install-required" });
export const ReconnectRequired = StoryFor({ kind: "reconnect-required" });
export const ReadyIdle = StoryFor({ kind: "ready", lastSyncAt: Date.now() });
export const Triggering = StoryFor({ kind: "triggering" });

export const SyncingLikedSongs = StoryFor({
	kind: "syncing",
	sync: makeSync({ phase: "likedSongs", fetched: 320, total: 1280 }),
});

export const SyncingPlaylists = StoryFor({
	kind: "syncing",
	sync: makeSync({ phase: "playlists", fetched: 8, total: 24 }),
});

export const SyncingPlaylistTracks = StoryFor({
	kind: "syncing",
	sync: makeSync({ phase: "playlistTracks", fetched: 540, total: 900 }),
});

export const SyncingArtistImages = StoryFor({
	kind: "syncing",
	sync: makeSync({ phase: "artistImages", fetched: 45, total: 60 }),
});

export const Uploading = StoryFor({
	kind: "syncing",
	sync: makeSync({ phase: "uploading", fetched: 0, total: 0 }),
});

export const AlreadyRunning = StoryFor({ kind: "already-running" });
export const Cooldown429 = StoryFor({
	kind: "cooldown",
	retryAfterSeconds: 42,
});

export const RetryableError = StoryFor({
	kind: "error",
	message: "Sync couldn't finish: HTTP 500",
	retryable: true,
	action: "retry",
});

export const ReconnectError = StoryFor({
	kind: "error",
	message: "We couldn't reach the extension. Reconnect and try again.",
	retryable: true,
	action: "reconnect",
});

export const SuccessJustSynced = StoryFor({
	kind: "success",
	syncedAt: Date.now(),
});
