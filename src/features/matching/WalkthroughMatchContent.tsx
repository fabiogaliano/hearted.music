import { useCallback, useMemo, useState } from "react";
import { useFlaggedPlaylistIds } from "@/features/onboarding/demoSandboxStore";
import { useStepNavigation } from "@/features/onboarding/hooks/useStepNavigation";
import { TourCoachMark } from "@/features/onboarding/TourCoachMark";
import { getDemoMatchesForFlaggedPlaylists } from "@/lib/content/landing/demo-matches";
import type { WalkthroughSong } from "@/lib/domains/library/accounts/onboarding-session";
import { MatchingHeader } from "./sections/MatchingHeader";
import { MatchingSession } from "./sections/MatchingSession";
import type { Playlist, SongForMatching } from "./types";

function songToMatchingSong(song: WalkthroughSong): SongForMatching {
	return {
		id: song.id,
		spotifyId: "",
		name: song.name,
		artist: song.artist,
		album: song.album,
		albumArtUrl: song.albumArtUrl,
		genres: [],
		analysis: null,
	};
}

/**
 * The match-walkthrough reveal — entirely canned, no server and no background
 * jobs. The reveal scores the picked song against the playlists the user flagged
 * in the flag-playlists rehearsal (read from the cross-step demo store), so the
 * demo runs end-to-end pre-sync. If the flagged set is empty (a hard refresh
 * dropped the rehearsal state), it falls back to the song's curated matches.
 */
export function WalkthroughMatchContent({
	walkthroughSong,
}: {
	walkthroughSong: WalkthroughSong;
}) {
	const { navigateTo, isPending } = useStepNavigation();
	const flaggedIds = useFlaggedPlaylistIds();
	const [finishing, setFinishing] = useState(false);

	const currentSong = useMemo(
		() => songToMatchingSong(walkthroughSong),
		[walkthroughSong],
	);

	const playlists = useMemo<Playlist[]>(
		() =>
			getDemoMatchesForFlaggedPlaylists(
				walkthroughSong.spotifyTrackId,
				flaggedIds,
			)
				.slice(0, 5)
				.map((m) => ({
					id: m.id,
					spotifyId: m.spotifyId,
					name: m.name,
					reason: m.reason,
					matchScore: m.matchScore,
				})),
		[walkthroughSong.spotifyTrackId, flaggedIds],
	);

	// Any match action ends the rehearsal — but instead of cutting straight to the
	// real-setup step, open a finish dialog so the walkthrough closes on a beat.
	const handleWalkthroughAction = useCallback(() => {
		setFinishing(true);
	}, []);

	const handleFinish = useCallback(async () => {
		if (isPending) return;
		await navigateTo("install-extension");
	}, [isPending, navigateTo]);

	return (
		<>
			<div className="mx-auto w-full max-w-[min(1600px,100%)]">
				<MatchingHeader currentIndex={0} totalSongs={1} />
				<MatchingSession
					currentSong={currentSong}
					playlists={playlists}
					addedTo={[]}
					isDemo={true}
					onAdd={handleWalkthroughAction}
					onDismiss={handleWalkthroughAction}
					onNext={handleWalkthroughAction}
				/>
			</div>
			{finishing && (
				<TourCoachMark
					body={[
						"You've seen the whole loop. Ready to set it up for your real library?",
					]}
					actionLabel="Let's go"
					onAction={handleFinish}
				/>
			)}
		</>
	);
}
