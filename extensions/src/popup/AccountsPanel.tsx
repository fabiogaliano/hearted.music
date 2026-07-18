import type { HeartedAccountStatus, UserProfile } from "../shared/types";

// Rose / "Warm" pastel theme — mirrored from src/lib/theme/colors.ts.
// Inlined for the same reason as return-banner.ts: no cross-build import.
const THEME = {
	text: "hsl(340, 28%, 22%)",
	textMuted: "hsl(340, 20%, 45%)",
	primary: "hsl(340, 28%, 28%)",
	textOnPrimary: "hsl(340, 32%, 96%)",
	border: "hsl(340, 20%, 75%)",
	warning: "hsl(8, 55%, 42%)",
	// The popup body is already the surface tone (see popup/index.html), so a
	// secondary chip lifts *lighter* than the body to read as pressable rather
	// than blending into it.
	chip: "hsl(340, 40%, 96%)",
	chipHover: "hsl(340, 40%, 99%)",
} as const;

const FONT_DISPLAY = "'Instrument Serif', Georgia, serif";
const FONT_BODY =
	"'Geist', -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif";

/** Presentation state for the popup — the container maps GET_ACCOUNTS onto it. */
export type AccountsView =
	| { kind: "loading" }
	| { kind: "error" }
	| {
			kind: "loaded";
			spotify: UserProfile | null;
			hearted: HeartedAccountStatus;
	  };

export type DisconnectSide = "spotify" | "hearted";

interface AccountsPanelProps {
	view: AccountsView;
	/** Which side, if any, is mid-disconnect (disables + shows a pending label). */
	busy: DisconnectSide | null;
	onDisconnect: (side: DisconnectSide) => void;
	/** Opens hearted.music so the web app can (re)mint the pairing token — the
	 * popup can't, since minting needs the site's session cookie. Drives the
	 * reconnect/connect action on the disconnected + revoked hearted states. */
	onReconnectHearted: () => void;
}

/**
 * The full popup body: brand header, the two account rows (Spotify session vs
 * paired hearted account), and the mismatch note. Pure presentation — the
 * container owns all messaging — so every state is exercisable in Ladle.
 */
export function AccountsPanel({
	view,
	busy,
	onDisconnect,
	onReconnectHearted,
}: AccountsPanelProps) {
	const spotify = view.kind === "loaded" ? view.spotify : null;
	const hearted = view.kind === "loaded" ? view.hearted : null;

	// Both sides know their Spotify identity: the extension's captured session
	// vs the Spotify account the paired hearted library is linked to. When they
	// disagree, syncing would be rejected by the backend — say so up front.
	const mismatch =
		spotify !== null &&
		hearted?.state === "connected" &&
		hearted.account.spotifyId !== null &&
		hearted.account.spotifyId !== spotify.spotifyId;

	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
			<h1
				style={{
					fontFamily: FONT_DISPLAY,
					fontSize: 26,
					fontWeight: 400,
					lineHeight: 1.1,
					letterSpacing: "-0.005em",
					color: THEME.text,
				}}
			>
				everything you
				<br />
				ever <em style={{ fontStyle: "italic" }}>hearted.</em>
			</h1>

			<Divider />

			<output
				aria-live="polite"
				style={{
					display: "flex",
					flexDirection: "column",
					gap: 12,
					fontFamily: FONT_BODY,
				}}
			>
				{view.kind === "loading" && (
					<Row dot="loading" label="checking…" muted />
				)}
				{view.kind === "error" && (
					<Row dot="off" label="couldn't reach the extension" muted />
				)}
				{view.kind === "loaded" && (
					<>
						<SpotifyRow
							profile={view.spotify}
							busy={busy === "spotify"}
							onDisconnect={() => onDisconnect("spotify")}
						/>
						<HeartedRow
							status={view.hearted}
							busy={busy === "hearted"}
							onDisconnect={() => onDisconnect("hearted")}
							onReconnect={onReconnectHearted}
						/>
					</>
				)}
			</output>

			{mismatch && (
				<>
					<Divider />
					<p
						style={{
							fontFamily: FONT_BODY,
							fontSize: 12,
							lineHeight: 1.5,
							color: THEME.warning,
						}}
					>
						these accounts don't match — your browser's Spotify isn't the one
						this hearted library was built from. Syncing is paused until they
						agree.
					</p>
				</>
			)}
		</div>
	);
}

function SpotifyRow({
	profile,
	busy,
	onDisconnect,
}: {
	profile: UserProfile | null;
	busy: boolean;
	onDisconnect: () => void;
}) {
	if (profile === null) {
		return (
			<Row dot="off" caption="Spotify" label="open Spotify to connect" muted />
		);
	}
	return (
		<Row
			avatarUrl={profile.avatarUrl}
			dot="on"
			caption="Spotify"
			label={profile.displayName}
			action={
				<DisconnectButton
					busy={busy}
					onClick={onDisconnect}
					ariaLabel={`Disconnect Spotify account ${profile.displayName}`}
					title="Forgets the captured session — your browser stays signed in to Spotify"
				/>
			}
		/>
	);
}

function HeartedRow({
	status,
	busy,
	onDisconnect,
	onReconnect,
}: {
	status: HeartedAccountStatus;
	busy: boolean;
	onDisconnect: () => void;
	onReconnect: () => void;
}) {
	if (status.state === "disconnected") {
		return (
			<Row
				dot="off"
				caption="hearted."
				label="not connected"
				muted
				action={
					<ReconnectButton
						onClick={onReconnect}
						label="connect"
						ariaLabel="Connect to hearted on hearted.music"
					/>
				}
			/>
		);
	}
	if (status.state === "revoked") {
		return (
			<Row
				dot="off"
				caption="hearted."
				label="session expired"
				muted
				action={
					<ReconnectButton
						onClick={onReconnect}
						label="reconnect"
						ariaLabel="Reconnect to hearted on hearted.music"
					/>
				}
			/>
		);
	}
	const label =
		status.account.displayName ??
		(status.verified ? "connected" : "connected (offline)");
	return (
		<Row
			avatarUrl={status.account.imageUrl}
			dot="on"
			caption="hearted."
			label={label}
			action={
				<DisconnectButton
					busy={busy}
					onClick={onDisconnect}
					ariaLabel={`Disconnect hearted account ${label}`}
					title="Unpairs this browser from your hearted account"
				/>
			}
		/>
	);
}

function Row({
	dot,
	label,
	caption,
	avatarUrl,
	action,
	muted = false,
}: {
	dot: StatusDotState;
	label: string;
	caption?: string;
	avatarUrl?: string | null;
	action?: React.ReactNode;
	muted?: boolean;
}) {
	return (
		<div style={{ display: "flex", alignItems: "center", gap: 10 }}>
			{avatarUrl ? (
				<img
					src={avatarUrl}
					alt=""
					width={20}
					height={20}
					style={{ borderRadius: "50%", flexShrink: 0 }}
				/>
			) : (
				<StatusDot state={dot} />
			)}
			<span
				style={{
					display: "flex",
					flexDirection: "column",
					minWidth: 0,
					flex: 1,
				}}
			>
				{caption && (
					<span
						style={{
							fontSize: 10,
							letterSpacing: "0.08em",
							textTransform: "uppercase",
							color: THEME.textMuted,
							opacity: 0.8,
						}}
					>
						{caption}
					</span>
				)}
				<span
					style={{
						fontSize: 13,
						fontWeight: 400,
						color: muted ? THEME.textMuted : THEME.text,
						overflow: "hidden",
						textOverflow: "ellipsis",
						whiteSpace: "nowrap",
					}}
				>
					{label}
				</span>
			</span>
			{action}
		</div>
	);
}

function DisconnectButton({
	busy,
	onClick,
	ariaLabel,
	title,
}: {
	busy: boolean;
	onClick: () => void;
	ariaLabel: string;
	title: string;
}) {
	return (
		<button
			type="button"
			onClick={onClick}
			disabled={busy}
			aria-label={ariaLabel}
			title={title}
			style={{
				fontFamily: FONT_BODY,
				fontSize: 11,
				color: THEME.text,
				background: THEME.chip,
				border: `1px solid ${THEME.border}`,
				borderRadius: 999,
				padding: "3px 10px",
				cursor: busy ? "default" : "pointer",
				opacity: busy ? 0.5 : 1,
				flexShrink: 0,
			}}
		>
			{busy ? "…" : "disconnect"}
		</button>
	);
}

function ReconnectButton({
	onClick,
	label,
	ariaLabel,
}: {
	onClick: () => void;
	label: string;
	ariaLabel: string;
}) {
	// Filled (not outline like Disconnect) so it reads as the recovery action.
	// Opens hearted.music in a new tab — see AccountsPanelProps.onReconnectHearted.
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label={ariaLabel}
			title="Opens hearted.music, where your browser re-pairs with the extension"
			style={{
				fontFamily: FONT_BODY,
				fontSize: 11,
				color: THEME.textOnPrimary,
				background: THEME.primary,
				border: `1px solid ${THEME.primary}`,
				borderRadius: 999,
				padding: "3px 12px",
				cursor: "pointer",
				flexShrink: 0,
			}}
		>
			{label}
		</button>
	);
}

function Divider() {
	return (
		<div
			aria-hidden="true"
			style={{
				height: 1,
				background: THEME.border,
				opacity: 0.6,
			}}
		/>
	);
}

type StatusDotState = "on" | "off" | "loading";

function StatusDot({ state }: { state: StatusDotState }) {
	const size = 8;
	const common: React.CSSProperties = {
		width: size,
		height: size,
		borderRadius: "50%",
		flexShrink: 0,
	};

	if (state === "on") {
		return <span style={{ ...common, background: THEME.primary }} />;
	}
	if (state === "off") {
		return (
			<span
				style={{
					...common,
					background: "transparent",
					border: `1.5px solid ${THEME.textMuted}`,
					opacity: 0.7,
				}}
			/>
		);
	}
	// loading — muted solid, gently pulsing via inline keyframes injected once
	return (
		<>
			<style>{`
				@keyframes hearted-dot-pulse {
					0%, 100% { opacity: 0.35; }
					50%      { opacity: 0.8; }
				}
				@media (prefers-reduced-motion: reduce) {
					.hearted-loading-dot { animation: none !important; opacity: 0.5 !important; }
				}
			`}</style>
			<span
				className="hearted-loading-dot"
				style={{
					...common,
					background: THEME.textMuted,
					animation: "hearted-dot-pulse 1.1s ease-in-out infinite",
				}}
			/>
		</>
	);
}
