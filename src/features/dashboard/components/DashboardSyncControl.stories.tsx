import type { Story } from "@ladle/react";
import type { ReactNode } from "react";
import type { DashboardSyncUiState } from "@/features/dashboard/hooks/useDashboardSync";
import type { ExtensionSyncState } from "@/lib/extension/detect";
import { fonts } from "@/lib/theme/fonts";
import {
	DashboardSyncControl,
	rendersActionOnly,
} from "./DashboardSyncControl";

export default {
	title: "Dashboard/SyncControl",
};

const noop = () => {};

// Reproduce DashboardSyncStatus's own row, in the dashboard header's right
// corner where it now lives — including its rule for when the last-sync phrase
// appears at all. Hardcoding the timestamp onto every story was how "Never
// looking through your playlists" stayed invisible here for so long: the states
// that suppress it looked fine in Ladle and broken in the app.
function HeaderContext({
	state,
	children,
}: {
	state: DashboardSyncUiState;
	children: ReactNode;
}) {
	return (
		<div style={{ padding: 48 }}>
			<div
				className="theme-text-muted flex items-center gap-x-2 text-xs"
				style={{ fontFamily: fonts.body }}
			>
				{rendersActionOnly(state) && (
					<span className="flex items-center gap-2">
						<span className="theme-text-muted-bg size-1.5 rounded-full" />
						Synced 2 hours ago
					</span>
				)}
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
		<HeaderContext state={state}>
			<DashboardSyncControl state={state} onAction={noop} />
		</HeaderContext>
	);
	return Component;
}

export const Checking = StoryFor({ kind: "checking" });
export const InstallRequired = StoryFor({ kind: "install-required" });
export const SpotifyReconnectRequired = StoryFor({
	kind: "spotify-reconnect-required",
});
export const ReadyIdle = StoryFor({ kind: "ready", lastSyncAt: Date.now() });
// Linked account with a non-ok verdict (spotify-disconnected / mismatch /
// unpaired / unverifiable) — the dashboard banner owns the reconnect action,
// so the control renders status only (the fix for the two-reconnects bug).
export const Paused = StoryFor({ kind: "paused" });
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

// The other half of ERROR_ACTION_LABELS — a failure whose fix is installing the
// extension rather than retrying. Every other branch of the control had a story;
// this label was the one nobody could look at.
export const ErrorNeedsInstall = StoryFor({
	kind: "error",
	message: "The extension isn't available in this browser",
	retryable: false,
	action: "install",
});

export const SuccessJustSynced = StoryFor({
	kind: "success",
	syncedAt: Date.now(),
});
