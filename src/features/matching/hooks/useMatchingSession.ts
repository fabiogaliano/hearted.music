import { useCallback, useEffect, useRef } from "react";
import { markSeenSongs } from "@/lib/server/matching.functions";

export function useMatchingSession(accountId: string) {
	const presentedIdsRef = useRef<Set<string>>(new Set());

	const addPresented = useCallback((songId: string) => {
		presentedIdsRef.current.add(songId);
	}, []);

	// biome-ignore lint/correctness/useExhaustiveDependencies: accountId not read inside the effect body, but its presence in deps intentionally triggers cleanup (flush) and re-setup when the account switches
	useEffect(() => {
		const ids = presentedIdsRef.current;

		const flush = () => {
			const songIds = [...ids];
			if (songIds.length === 0) return;
			void markSeenSongs({ data: { songIds } });
		};

		window.addEventListener("beforeunload", flush);
		return () => {
			window.removeEventListener("beforeunload", flush);
			flush();
		};
	}, [accountId]);

	return { addPresented };
}
