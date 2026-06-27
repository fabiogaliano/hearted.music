import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	flushPlaylistManagementSession,
	setPlaylistTargetMutation,
} from "@/lib/server/playlists.functions";
import { playlistKeys } from "../queries";

interface PlaylistSessionState {
	targetMembershipChanged: boolean;
}

export function usePlaylistSession(accountId: string) {
	const queryClient = useQueryClient();
	const sessionRef = useRef<PlaylistSessionState>({
		targetMembershipChanged: false,
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

	const flush = useCallback(() => {
		const session = sessionRef.current;
		if (!session.targetMembershipChanged) {
			return;
		}

		// Scoring (intent/genre) and read-time filter changes are committed and
		// invalidated at save time by savePlaylistMatchConfig, so the session flush
		// only conveys target-membership toggles (which have no per-save server
		// function of their own). Both other facts are always false here.
		void flushPlaylistManagementSession({
			data: {
				targetMembershipChanged: session.targetMembershipChanged,
				scoringConfigChanged: false,
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
	};
}
