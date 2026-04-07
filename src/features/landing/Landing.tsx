/**
 * HEARTED - Unified Landing Page
 *
 * Structure:
 * 1. Hero (100vh): True 50/50 split - copy left, full-height panel right with artist image
 * 2. Matching: Shows the playlist matching proposition
 * 3. CTA: Simple close with login/waitlist
 *
 * Voice: Curious friend — warm, observant, confident, playful
 *
 * Modes:
 * - Released (default): Shows "Login with Spotify" for live product
 * - Pre-release: Shows waitlist email input for launch prep
 */
import { useEffect, useRef, useState } from "react";
import { MatchesSection } from "@/features/matching/components/MatchesSection";
import { SongSection } from "@/features/matching/components/SongSection";
import {
	loadLandingSongDetail,
	type LandingSongDetail,
	type LandingSongManifest,
} from "@/lib/data/landing-songs";

import { getDemoMatchesForSong } from "@/lib/data/demo-matches";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { LandingHero } from "./components/LandingHero";
import { SpotifyLoginButton } from "./components/SpotifyLoginButton";
import { WaitlistInput } from "./components/WaitlistInput";

const PRELOAD_MARGIN = 2;

function normalizeIndex(index: number, total: number): number {
	if (total === 0) return 0;
	return ((index % total) + total) % total;
}

function getWindowIndexes(
	centerIndex: number,
	total: number,
	margin: number,
): number[] {
	if (total === 0) return [];
	const indexes = new Set<number>();
	for (let offset = -margin; offset <= margin; offset += 1) {
		indexes.add(normalizeIndex(centerIndex + offset, total));
	}
	return [...indexes];
}

interface LandingProps {
	/** Pre-shuffled manifest from server loader */
	initialManifest: LandingSongManifest[];
	/** First song's full detail, loaded server-side */
	initialDetail: LandingSongDetail;
	/** Release mode - true for login, false for waitlist (controlled from PrototypeWrapper) */
	isReleased?: boolean;
}

export function Landing({
	initialManifest,
	initialDetail,
	isReleased = true,
}: LandingProps) {
	const theme = useTheme();
	const [songManifest] = useState(initialManifest);
	const [songDetailsByTrackId, setSongDetailsByTrackId] = useState<
		Record<string, LandingSongDetail>
	>({ [initialDetail.spotifyTrackId]: initialDetail });
	const [selectedSongIndex, setSelectedSongIndex] = useState(0);
	const [previewSongIndex, setPreviewSongIndex] = useState(
		initialManifest.length > 2 ? 2 : 0,
	);
	const fetchedTrackIdsRef = useRef<Set<string>>(
		new Set([initialDetail.spotifyTrackId]),
	);

	useEffect(() => {
		if (songManifest.length === 0) return;

		const indexesToPrefetch = new Set<number>([
			...getWindowIndexes(
				selectedSongIndex,
				songManifest.length,
				PRELOAD_MARGIN,
			),
			...getWindowIndexes(
				previewSongIndex,
				songManifest.length,
				PRELOAD_MARGIN,
			),
		]);

		for (const index of indexesToPrefetch) {
			const manifestSong = songManifest[index];
			if (!manifestSong) continue;

			const trackId = manifestSong.spotifyTrackId;
			if (fetchedTrackIdsRef.current.has(trackId)) continue;

			fetchedTrackIdsRef.current.add(trackId);
			void loadLandingSongDetail(manifestSong.detailPath)
				.then((detail) => {
					setSongDetailsByTrackId((prev) => ({ ...prev, [trackId]: detail }));
				})
				.catch(() => {
					fetchedTrackIdsRef.current.delete(trackId);
				});
		}
	}, [songManifest, selectedSongIndex, previewSongIndex]);

	const featuredSongManifest =
		songManifest[selectedSongIndex] ?? songManifest[0]!;
	const previewSongManifest =
		songManifest[previewSongIndex] ?? songManifest[0]!;
	const featuredSong =
		songDetailsByTrackId[featuredSongManifest.spotifyTrackId] ??
		featuredSongManifest;
	const previewSong =
		songDetailsByTrackId[previewSongManifest.spotifyTrackId] ??
		previewSongManifest;
	const albumArtUrl = featuredSongManifest.albumArtUrl;
	const artistImageUrl = featuredSongManifest.artistImageUrl;

	const handlePrev = () => {
		if (songManifest.length === 0) return;
		setSelectedSongIndex((current) =>
			normalizeIndex(current - 1, songManifest.length),
		);
	};
	const handleNext = () => {
		if (songManifest.length === 0) return;
		setSelectedSongIndex((current) =>
			normalizeIndex(current + 1, songManifest.length),
		);
	};

	const handlePreviewNext = () => {
		if (songManifest.length === 0) return;
		setPreviewSongIndex((current) =>
			normalizeIndex(current + 1, songManifest.length),
		);
	};
	const handlePreviewDiscard = () => {
		// Discard behaves the same as next for the preview
		handlePreviewNext();
	};

	return (
		<div
			data-landing-scroll-root
			className="min-h-screen overflow-x-hidden xl:h-screen xl:snap-y xl:snap-proximity xl:overflow-y-auto xl:overscroll-none"
			style={{ fontFamily: fonts.body, background: theme.bg }}
		>
			<LandingHero
				featuredSong={featuredSong}
				albumArtUrl={albumArtUrl}
				artistImageUrl={artistImageUrl}
				onPrev={handlePrev}
				onNext={handleNext}
				isReleased={isReleased}
			/>

			<section
				className="flex min-h-screen snap-start snap-always items-center px-8 lg:px-16"
				style={{ background: theme.surface }}
			>
				<div className="mx-auto w-full max-w-7xl py-16 lg:py-24">
					<div className="mb-12 max-w-2xl">
						<p className="mb-4 text-lg" style={{ color: theme.textMuted }}>
							It found you. You kept it.
						</p>
						<h3
							className="text-3xl leading-tight font-extralight md:text-4xl lg:text-5xl"
							style={{ fontFamily: fonts.display, color: theme.text }}
						>
							See where it <span className="italic">could land.</span>
						</h3>
					</div>

					{/* UI Preview Container */}
					<div
						className="rounded-sm p-6 lg:p-8"
						style={{
							background: theme.bg,
							border: `1px solid ${theme.border}`,
							boxShadow: `0 1px 3px ${theme.text}08, 0 4px 12px ${theme.text}04`,
						}}
					>
						<div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
							<SongSection
								song={previewSong}
								metaVisible={true}
								albumArtUrl={previewSongManifest.albumArtUrl}
								isLoading={false}
								songKey={previewSongManifest.spotifyTrackId}
							/>
							<MatchesSection
								playlists={getDemoMatchesForSong(
									previewSongManifest.spotifyTrackId,
								)}
								addedTo={[]}
								onAdd={() => {}}
								onDismiss={handlePreviewDiscard}
								onNext={handlePreviewNext}
								songKey={previewSongManifest.spotifyTrackId}
							/>
						</div>
					</div>
				</div>
			</section>

			<section
				id="waitlist-cta"
				className="flex flex-col items-center justify-center px-8 py-24 lg:px-16 lg:py-32"
			>
				<p className="mb-4 text-lg" style={{ color: theme.textMuted }}>
					Your songs have been trying to tell you something.
				</p>
				<h3
					className="text-3xl font-extralight md:text-4xl lg:text-5xl"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					What do they <span className="italic">say about you?</span>
				</h3>
				<div className="mt-10 flex justify-center">
					{isReleased ? <SpotifyLoginButton /> : <WaitlistInput />}
				</div>
			</section>

			<footer
				className="px-8 py-8 text-center text-sm lg:px-16"
				style={{
					borderTop: `1px solid ${theme.border}`,
					color: theme.textMuted,
				}}
			>
				<p>
					<a href="/faq" className="underline-offset-2 hover:underline">
						FAQ
					</a>
					{" · "}
					<a href="/privacy" className="underline-offset-2 hover:underline">
						Privacy
					</a>
					{" · "}
					<a href="/terms" className="underline-offset-2 hover:underline">
						Terms
					</a>
				</p>
				<p
					className="mt-2 opacity-60"
					style={{ fontFamily: fonts.display, fontWeight: 300 }}
				>
					hearted. by{" "}
					<a
						href="https://fabiogaliano.com"
						target="_blank"
						rel="noopener noreferrer"
						className="underline-offset-2 hover:underline"
					>
						fábio galiano
					</a>
				</p>
			</footer>
		</div>
	);
}

export default Landing;
