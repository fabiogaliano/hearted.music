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
import { SetupOnComputerNoticeGate } from "@/features/onboarding/components/SetupOnComputerNotice";
import { getDemoMatchesForSong } from "@/lib/content/landing/demo-matches";
import {
	type LandingSongDetail,
	type LandingSongManifest,
	loadLandingSongDetail,
} from "@/lib/content/landing/landing-songs";
import { fonts } from "@/lib/theme/fonts";
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
	const fallbackSongManifest: LandingSongManifest = initialManifest[0] ?? {
		...initialDetail,
		detailPath: "",
	};

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
		songManifest[selectedSongIndex] ?? fallbackSongManifest;
	const previewSongManifest =
		songManifest[previewSongIndex] ?? fallbackSongManifest;
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
			className="theme-bg min-h-screen overflow-x-hidden xl:h-screen xl:snap-y xl:snap-proximity xl:overflow-y-auto xl:overscroll-none"
			style={{ fontFamily: fonts.body }}
		>
			<LandingHero
				featuredSong={featuredSong}
				albumArtUrl={albumArtUrl}
				artistImageUrl={artistImageUrl}
				onPrev={handlePrev}
				onNext={handleNext}
				isReleased={isReleased}
			/>

			<section className="theme-surface-bg flex min-h-screen snap-start snap-always items-center px-8 lg:px-16">
				<div className="mx-auto w-full max-w-7xl py-16 lg:py-24">
					<div className="mb-12 max-w-2xl">
						<p className="theme-text-muted mb-4 text-lg">
							It found you. You kept it.
						</p>
						<h3
							className="theme-text text-3xl leading-tight font-extralight md:text-4xl lg:text-5xl"
							style={{ fontFamily: fonts.display }}
						>
							See where it <span className="italic">could land.</span>
						</h3>
					</div>

					{/* UI Preview Container */}
					<div
						className="theme-bg theme-border-color rounded-sm border p-6 lg:p-8"
						style={{
							boxShadow:
								"0 1px 3px color-mix(in srgb, var(--t-text) 8%, transparent), 0 4px 12px color-mix(in srgb, var(--t-text) 4%, transparent)",
						}}
					>
						<div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
							<SongSection
								song={previewSong}
								albumArtUrl={previewSongManifest.albumArtUrl}
								songKey={previewSongManifest.spotifyTrackId}
							/>
							<MatchesSection
								songKey={previewSongManifest.spotifyTrackId}
								playlists={getDemoMatchesForSong(
									previewSongManifest.spotifyTrackId,
								)}
								addedTo={[]}
								onAdd={() => {}}
								onDismiss={handlePreviewDiscard}
								onNext={handlePreviewNext}
							/>
						</div>
					</div>
				</div>
			</section>

			<section
				id="waitlist-cta"
				className="flex flex-col items-center justify-center px-8 py-24 lg:px-16 lg:py-32"
			>
				<p className="theme-text-muted mb-4 text-lg">
					Your songs have been trying to tell you something.
				</p>
				<h3
					className="theme-text text-3xl font-extralight md:text-4xl lg:text-5xl"
					style={{ fontFamily: fonts.display }}
				>
					What do they <span className="italic">say about you?</span>
				</h3>
				<div className="mt-10 flex justify-center">
					{isReleased ? <SpotifyLoginButton /> : <WaitlistInput />}
				</div>
				{isReleased && <SetupOnComputerNoticeGate className="mt-6 max-w-sm" />}
			</section>

			<footer className="theme-border-color theme-text-muted border-t px-8 py-8 text-center text-sm lg:px-16">
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
