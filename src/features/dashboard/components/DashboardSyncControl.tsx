/**
 * Inline dashboard sync control.
 *
 * Pure presentation: it renders the right CTA or status for a single
 * DashboardSyncUiState and delegates the action to onAction. All
 * orchestration (detection, pairing, triggering, polling) lives in
 * useDashboardSync — keeping this component trivially storyable and testable.
 */

import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import type {
	DashboardSyncUiState,
	ErrorAction,
} from "@/features/dashboard/hooks/useDashboardSync";
import type { ExtensionSyncState } from "@/lib/extension/detect";
import { fonts } from "@/lib/theme/fonts";

interface DashboardSyncControlProps {
	state: DashboardSyncUiState;
	onAction: () => void;
}

const SYNC_PHASE_LABELS: Record<ExtensionSyncState["phase"], string> = {
	idle: "listening to your library",
	likedSongs: "reading your liked songs",
	playlists: "looking through your playlists",
	playlistTracks: "listening to what's inside",
	artistImages: "getting to know the artists",
	uploading: "sending it to hearted",
};

const ERROR_ACTION_LABELS: Record<ErrorAction, string> = {
	retry: "Retry",
	install: "Install extension",
};

function syncPercent(sync: ExtensionSyncState): number | null {
	if (sync.total > 0) {
		return Math.min(100, Math.round((sync.fetched / sync.total) * 100));
	}
	return null;
}

function StatusText({
	children,
	pulse = false,
}: {
	children: ReactNode;
	pulse?: boolean;
}) {
	return (
		<span
			aria-live="polite"
			className={`theme-text-muted text-xs tabular-nums${
				pulse ? " motion-safe:animate-pulse" : ""
			}`}
			style={{ fontFamily: fonts.body }}
		>
			{children}
		</span>
	);
}

function ActionButton({
	children,
	onClick,
	title,
}: {
	children: ReactNode;
	onClick: () => void;
	title?: string;
}) {
	return (
		<Button
			variant="link"
			size="sm"
			onClick={onClick}
			title={title}
			style={{ fontFamily: fonts.body }}
		>
			{children}
		</Button>
	);
}

export function DashboardSyncControl({
	state,
	onAction,
}: DashboardSyncControlProps) {
	switch (state.kind) {
		case "checking":
			return <StatusText pulse>checking…</StatusText>;
		case "install-required":
			return <ActionButton onClick={onAction}>Install extension</ActionButton>;
		case "spotify-reconnect-required":
			return (
				<ActionButton
					onClick={onAction}
					title="Opens Spotify to re-authorize the connection"
				>
					Reconnect Spotify
				</ActionButton>
			);
		case "ready":
			return <ActionButton onClick={onAction}>Sync</ActionButton>;
		case "account-checking":
			return <StatusText pulse>checking account…</StatusText>;
		case "account-unavailable":
			return <StatusText>sync paused · account check unavailable</StatusText>;
		case "account-conflict":
			return <StatusText>sync paused</StatusText>;
		case "triggering":
			return <StatusText pulse>starting…</StatusText>;
		case "syncing": {
			const percent = syncPercent(state.sync);
			const label = SYNC_PHASE_LABELS[state.sync.phase];
			return (
				<StatusText pulse>
					{label}
					{percent === null ? "…" : ` · ${percent}%`}
				</StatusText>
			);
		}
		case "already-running":
			return <StatusText>sync in progress</StatusText>;
		case "cooldown":
			return <StatusText>try again in {state.retryAfterSeconds}s</StatusText>;
		case "success":
			return <StatusText>up to date</StatusText>;
		case "error":
			return (
				<span className="flex items-center gap-2">
					<span
						className="theme-text-muted text-xs"
						style={{ fontFamily: fonts.body }}
						title={state.message}
					>
						couldn't sync
					</span>
					<ActionButton onClick={onAction} title={state.message}>
						{ERROR_ACTION_LABELS[state.action]}
					</ActionButton>
				</span>
			);
	}
}
