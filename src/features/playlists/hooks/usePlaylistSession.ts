import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	flushPlaylistManagementSession,
	setPlaylistTargetMutation,
} from "@/lib/server/playlists.functions";
import { playlistKeys } from "../queries";

interface PlaylistSessionState {
	targetMembershipChanged: boolean;
	// Tracks whether scoring signals (intent text, genre pills) changed during
	// the session — mapped to scoringConfigChanged in the flush payload.
	scoringConfigChanged: boolean;
}

export function usePlaylistSession(accountId: string) {
	const queryClient = useQueryClient();
	const sessionRef = useRef<PlaylistSessionState>({
		targetMembershipChanged: false,
		scoringConfigChanged: false,
	});

	const [optimisticTargets, setOptimisticTargets] = useState<
		Map<string, boolean>
	>(new Map());

	const toggleTarget = useCallback(
		async (playlistId: string, isTarget: boolean) => {
			setOptimisticTargets((prev) => {
				const next = new Map(prev);
				next.set(playlistId, isTarget);
				return next;
			});

			sessionRef.current.targetMembershipChanged = true;

			try {
				await setPlaylistTargetMutation({
					data: { playlistId, isTarget },
				});
				queryClient.invalidateQueries({
					queryKey: playlistKeys.management(accountId),
				});
			} catch {
				setOptimisticTargets((prev) => {
					const next = new Map(prev);
					next.delete(playlistId);
					return next;
				});
			}
		},
		[accountId, queryClient],
	);

	// Called when the user edits scoring signals (intent text or genre pills) so
	// the session flush knows to request a snapshot recompute on close.
	const markMetadataChanged = useCallback(() => {
		sessionRef.current.scoringConfigChanged = true;
	}, []);

	const flush = useCallback(() => {
		const session = sessionRef.current;
		if (!session.targetMembershipChanged && !session.scoringConfigChanged) {
			return;
		}

		void flushPlaylistManagementSession({
			data: {
				targetMembershipChanged: session.targetMembershipChanged,
				scoringConfigChanged: session.scoringConfigChanged,
				// Read-time filter changes are handled at save time via savePlaylistMatchConfig,
				// not accumulated in the session hook — session flush only tracks scoring/membership.
				readTimeFilterChanged: false,
			},
		});
	}, []);

	useEffect(() => {
		const handlePageHide = () => flush();
		window.addEventListener("pagehide", handlePageHide);

		return () => {
			window.removeEventListener("pagehide", handlePageHide);
			flush();
		};
	}, [flush]);

	return {
		optimisticTargets,
		toggleTarget,
		markMetadataChanged,
	};
}
