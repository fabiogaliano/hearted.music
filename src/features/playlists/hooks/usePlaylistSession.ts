import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
	setPlaylistTargetMutation,
	flushPlaylistManagementSession,
} from "@/lib/server/playlists.functions";
import { playlistKeys } from "../queries";

export interface PlaylistSessionState {
	targetMembershipChanged: boolean;
	targetMetadataChanged: boolean;
}

export function usePlaylistSession(accountId: string) {
	const queryClient = useQueryClient();
	const sessionRef = useRef<PlaylistSessionState>({
		targetMembershipChanged: false,
		targetMetadataChanged: false,
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

	const markMetadataChanged = useCallback(() => {
		sessionRef.current.targetMetadataChanged = true;
	}, []);

	const flush = useCallback(() => {
		const session = sessionRef.current;
		if (!session.targetMembershipChanged && !session.targetMetadataChanged) {
			return;
		}

		void flushPlaylistManagementSession({
			data: {
				targetMembershipChanged: session.targetMembershipChanged,
				targetMetadataChanged: session.targetMetadataChanged,
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
