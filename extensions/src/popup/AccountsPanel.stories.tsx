import type { Story } from "@ladle/react";
import type { ReactNode } from "react";
import type { HeartedAccountStatus, UserProfile } from "../shared/types";
import { AccountsPanel, type AccountsView } from "./AccountsPanel";

export default {
	title: "Extension/Popup Accounts",
};

const noop = () => {};

// Reproduce the popup chrome: 320px width, the popup body background + padding
// from popup/index.html, so each state is judged at the size it actually ships.
function PopupFrame({ children }: { children: ReactNode }) {
	return (
		<div style={{ padding: 32, background: "hsl(340, 12%, 96%)" }}>
			<div
				style={{
					width: 320,
					minHeight: 180,
					padding: "22px 20px 20px",
					background: "hsl(340, 32%, 91%)",
					color: "hsl(340, 28%, 22%)",
					boxShadow: "0 8px 30px hsl(340 20% 40% / 0.18)",
					WebkitFontSmoothing: "antialiased",
				}}
			>
				{children}
			</div>
		</div>
	);
}

const SPOTIFY: UserProfile = {
	spotifyId: "spotify-user-1",
	displayName: "fabio",
	username: "fabio",
	avatarUrl: null,
};

const OTHER_SPOTIFY: UserProfile = {
	spotifyId: "spotify-user-other",
	displayName: "alex@work",
	username: "alex",
	avatarUrl: null,
};

function heartedConnected(
	overrides: Partial<HeartedAccountStatus & { verified: boolean }> = {},
): HeartedAccountStatus {
	return {
		state: "connected",
		verified: true,
		account: {
			displayName: "fabio",
			imageUrl: null,
			spotifyId: "spotify-user-1",
		},
		...overrides,
	} as HeartedAccountStatus;
}

function Frame(view: AccountsView, busy: "spotify" | "hearted" | null = null) {
	const Component: Story = () => (
		<PopupFrame>
			<AccountsPanel
				view={view}
				busy={busy}
				onDisconnect={noop}
				onReconnectHearted={noop}
			/>
		</PopupFrame>
	);
	return Component;
}

export const Loading = Frame({ kind: "loading" });

export const Unreachable = Frame({ kind: "error" });

// Healthy: both sides connected and pointing at the same Spotify account.
export const BothConnected = Frame({
	kind: "loaded",
	spotify: SPOTIFY,
	hearted: heartedConnected(),
});

// Spotify session captured, but no hearted pairing yet.
export const SpotifyOnly = Frame({
	kind: "loaded",
	spotify: SPOTIFY,
	hearted: { state: "disconnected" },
});

// Paired to hearted, but the browser has no usable Spotify session.
export const HeartedOnly = Frame({
	kind: "loaded",
	spotify: null,
	hearted: heartedConnected(),
});

// Neither connected.
export const NothingConnected = Frame({
	kind: "loaded",
	spotify: null,
	hearted: { state: "disconnected" },
});

// The stored hearted apiToken was revoked backend-side.
export const HeartedRevoked = Frame({
	kind: "loaded",
	spotify: SPOTIFY,
	hearted: { state: "revoked" },
});

// Backend unreachable at check time — hearted row falls back to cached identity
// with the "(offline)" hint when no display name was cached.
export const HeartedOffline = Frame({
	kind: "loaded",
	spotify: SPOTIFY,
	hearted: heartedConnected({
		verified: false,
		account: { displayName: null, imageUrl: null, spotifyId: null },
	}),
});

// The headline conflict: the browser's Spotify account differs from the one the
// paired hearted library was built from — surfaces the mismatch note.
export const AccountMismatch = Frame({
	kind: "loaded",
	spotify: OTHER_SPOTIFY,
	hearted: heartedConnected(),
});

// A disconnect is in flight on the Spotify row.
export const DisconnectingSpotify = Frame(
	{
		kind: "loaded",
		spotify: SPOTIFY,
		hearted: heartedConnected(),
	},
	"spotify",
);

// Single interactive story: drive presence of each side + mismatch + busy from
// the Controls panel to compare states without switching stories.
type PlaygroundProps = {
	spotifyConnected: boolean;
	spotifyMatches: boolean;
	heartedState: "connected" | "disconnected" | "revoked";
	heartedVerified: boolean;
	busy: "none" | "spotify" | "hearted";
};

export const Playground: Story<PlaygroundProps> = ({
	spotifyConnected,
	spotifyMatches,
	heartedState,
	heartedVerified,
	busy,
}) => {
	const spotify = spotifyConnected
		? spotifyMatches
			? SPOTIFY
			: OTHER_SPOTIFY
		: null;
	const hearted: HeartedAccountStatus =
		heartedState === "connected"
			? heartedConnected({ verified: heartedVerified })
			: { state: heartedState };
	return (
		<PopupFrame>
			<AccountsPanel
				view={{ kind: "loaded", spotify, hearted }}
				busy={busy === "none" ? null : busy}
				onDisconnect={noop}
				onReconnectHearted={noop}
			/>
		</PopupFrame>
	);
};

Playground.args = {
	spotifyConnected: true,
	spotifyMatches: true,
	heartedState: "connected",
	heartedVerified: true,
	busy: "none",
};

Playground.argTypes = {
	spotifyConnected: { control: { type: "boolean" } },
	spotifyMatches: { control: { type: "boolean" } },
	heartedState: {
		options: ["connected", "disconnected", "revoked"],
		control: { type: "radio" },
	},
	heartedVerified: { control: { type: "boolean" } },
	busy: {
		options: ["none", "spotify", "hearted"],
		control: { type: "radio" },
	},
};
