import type { Story } from "@ladle/react";
import { SongDetailPanel } from "./SongDetailPanel";
import { GOLD_SONG_DETAILS } from "./song-detail-data";
import type { PlaylistsPanel, SongDetail } from "./song-detail-types";

export default {
	title: "Liked Songs/SongDetailPanel",
};

const noop = () => {};

// Real Spotify CDN art for the showcase song (drivers license / Olivia Rodrigo).
// These are content-addressed by hash, so they're stable; the `b273` / `e5eb`
// prefixes are Spotify's 640px size variants — crisp enough for the hero.
const ALBUM_ART_URL =
	"https://i.scdn.co/image/ab67616d0000b273bdf5ed83a765fd10a97f08f1";
const ARTIST_IMAGE_URL =
	"https://i.scdn.co/image/ab6761610000e5ebe654806251e2661def1f4e65";

// A read-bearing fixture for the analyzed surface. The unread variants reuse its
// identity (so the hero stays constant) and only flip displayState / read — the
// empty state is then the only thing that changes between stories.
const analyzed: SongDetail = {
	...GOLD_SONG_DETAILS[0],
	displayState: "analyzed",
	albumArtUrl: ALBUM_ART_URL,
	artistImageUrl: ARTIST_IMAGE_URL,
};

const unread = (overrides: Partial<SongDetail>): SongDetail => ({
	...analyzed,
	read: null,
	...overrides,
});

// The panel is a `position: fixed` slide-out, so on its own it anchors to the
// viewport and paints over Ladle's own chrome. A `transform` on this frame makes
// it the containing block for the panel's fixed root, so `right: 0` resolves to
// the frame's right edge (inside the story canvas) instead of the viewport's.
function Frame({ children }: { children: React.ReactNode }) {
	return (
		<div
			style={{
				position: "relative",
				width: "100%",
				height: "100vh",
				overflow: "hidden",
				transform: "translateZ(0)",
			}}
		>
			{children}
		</div>
	);
}

function PanelStory({
	song,
	isEnrichmentRunning = false,
	lockedCta,
	playlists,
}: {
	song: SongDetail;
	isEnrichmentRunning?: boolean;
	lockedCta?: { label: string; onClick: () => void };
	playlists?: PlaylistsPanel;
}) {
	return (
		<Frame>
			<SongDetailPanel
				song={song}
				isExpanded
				hasNext={false}
				hasPrevious={false}
				onClose={noop}
				onNext={noop}
				onPrevious={noop}
				isEnrichmentRunning={isEnrichmentRunning}
				lockedCta={lockedCta}
				playlists={playlists}
			/>
		</Frame>
	);
}

export const FullRead: Story = () => <PanelStory song={analyzed} />;
FullRead.meta = {
	description: "Analyzed song — the full Read / Take / Trace surface.",
};

export const WithPlaylists: Story = () => (
	<PanelStory
		song={analyzed}
		playlists={{
			matches: [
				{ playlistId: "1", name: "late night drives", score: 0.94 },
				{ playlistId: "2", name: "heartbreak hours", score: 0.81 },
				{
					playlistId: "3",
					name: "songs to cry in the car to (a deliberately long name to test truncation)",
					score: 0.62,
				},
			],
			addedTo: ["2"],
			reconnectNeeded: false,
			onAdd: noop,
		}}
	/>
);
WithPlaylists.meta = {
	description:
		"Analyzed read with the add-to-playlist coda — score + name + Add, one row already 'Added'.",
};

export const Locked: Story = () => (
	<PanelStory song={unread({ displayState: "locked" })} />
);
Locked.meta = {
	description:
		"Locked song with no billing context (e.g. walkthrough) — lock icon + copy, CTA hidden.",
};

export const LockedUnlock: Story = () => (
	<PanelStory
		song={unread({ displayState: "locked" })}
		lockedCta={{ label: "Unlock this song", onClick: noop }}
	/>
);
LockedUnlock.meta = {
	description:
		"Locked + account has credits — primary 'Unlock this song' button (opens the confirm dialog in the app).",
};

export const LockedSeePlans: Story = () => (
	<PanelStory
		song={unread({ displayState: "locked" })}
		lockedCta={{ label: "See plans", onClick: noop }}
	/>
);
LockedSeePlans.meta = {
	description:
		"Locked + free account out of credits — 'See plans' button (opens the paywall in the app).",
};

export const Analyzing: Story = () => (
	<PanelStory song={unread({ displayState: "pending" })} />
);
Analyzing.meta = {
	description:
		"Queued for analysis, e.g. just unlocked — 'Getting a feel for this one…' with a pulsing dot. 'pending' alone triggers it; isEnrichmentRunning does too.",
};

export const Unavailable: Story = () => (
	<PanelStory song={unread({ displayState: "failed" })} />
);
Unavailable.meta = {
	description:
		"No read and nothing running — 'Quiet one' / 'We couldn’t find enough about this one.'",
};
