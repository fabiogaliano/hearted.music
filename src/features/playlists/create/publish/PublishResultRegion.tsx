import { useEffect, useRef } from "react";
import type { PublishPlaylistResult } from "../usePublishPlaylist";
import { PartialState } from "./PartialState";
import { SuccessState } from "./SuccessState";
import { UnsyncedState } from "./UnsyncedState";

interface PublishResultRegionProps {
	result: PublishPlaylistResult;
	isRetryingUnsynced: boolean;
	onRetryUnsynced: () => void;
}

/** Own the terminal publish-state switch and its focus/live-region contract. */
export function PublishResultRegion({
	result,
	isRetryingUnsynced,
	onRetryUnsynced,
}: PublishResultRegionProps) {
	const regionRef = useRef<HTMLDivElement>(null);
	const focusedStatusRef = useRef<PublishPlaylistResult["status"] | null>(null);

	useEffect(() => {
		if (focusedStatusRef.current === result.status) return;
		focusedStatusRef.current = result.status;
		regionRef.current?.focus();
	}, [result.status]);

	let content: React.ReactNode;
	switch (result.status) {
		case "success":
			content = (
				<SuccessState
					playlistName={result.playlistName}
					spotifyId={result.spotifyId}
					playlistId={result.playlistId}
				/>
			);
			break;
		case "partial":
			content = (
				<PartialState
					spotifyId={result.spotifyId}
					playlistId={result.playlistId}
					failedTrackCount={result.failedTrackCount}
				/>
			);
			break;
		case "created-unsynced":
			content = (
				<UnsyncedState
					spotifyId={result.spotifyId}
					isRetrying={isRetryingUnsynced}
					onRetry={onRetryUnsynced}
				/>
			);
			break;
		default:
			result satisfies never;
	}

	return (
		<div
			ref={regionRef}
			tabIndex={-1}
			role="status"
			aria-live="polite"
			aria-atomic="true"
			className="outline-none"
		>
			{content}
		</div>
	);
}
