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
	loadLandingSongsManifest,
	type LandingSongDetail,
	type LandingSongManifest,
} from "@/lib/data/landing-songs";

import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { LandingHero } from "./components/LandingHero";
import { SpotifyLoginButton } from "./components/SpotifyLoginButton";
import { WaitlistInput } from "./components/WaitlistInput";

const PRELOAD_MARGIN = 2;

const landingPlaylists = [
	{
		id: 1,
		name: "crying in the car",
		reason: "for when you're driving and it hits you",
		matchScore: 0.94,
	},
	{
		id: 2,
		name: "sweaty and happy",
		reason: "movement that feels good",
		matchScore: 0.89,
	},
	{
		id: 3,
		name: "feeling everything",
		reason: "songs that meet you where you are",
		matchScore: 0.82,
	},
	{
		id: 4,
		name: "easy does it",
		reason: "a bit much for gentle mornings",
		matchScore: 0.45,
	},
];

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
	/** Index of song to feature (default 0, can be randomized server-side) */
	featuredSongIndex?: number;
	/** Release mode - true for login, false for waitlist (controlled from PrototypeWrapper) */
	isReleased?: boolean;
}

export function Landing({
	featuredSongIndex = 0,
	isReleased = true,
}: LandingProps) {
	const theme = useTheme();
	const [songManifest, setSongManifest] = useState<LandingSongManifest[]>([]);
	const [songDetailsByTrackId, setSongDetailsByTrackId] = useState<
		Record<string, LandingSongDetail>
	>({});
	const [selectedSongIndex, setSelectedSongIndex] = useState(featuredSongIndex);
	const [previewSongIndex, setPreviewSongIndex] = useState(2);
	const fetchedTrackIdsRef = useRef<Set<string>>(new Set());

	useEffect(() => {
		let cancelled = false;

		const loadManifest = async () => {
			try {
				const manifest = await loadLandingSongsManifest();
				if (cancelled) return;

				setSongManifest(manifest);
				if (manifest.length > 0) {
					setSelectedSongIndex((current) =>
						normalizeIndex(current, manifest.length),
					);
					setPreviewSongIndex((current) =>
						normalizeIndex(current, manifest.length),
					);
				}
			} catch {
				if (cancelled) return;
				setSongManifest([]);
			}
		};

		void loadManifest();

		return () => {
			cancelled = true;
		};
	}, []);

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
		songManifest[selectedSongIndex] ?? songManifest[0] ?? null;
	const previewSongManifest =
		songManifest[previewSongIndex] ?? songManifest[0] ?? null;
	const featuredSong = featuredSongManifest
		? (songDetailsByTrackId[featuredSongManifest.spotifyTrackId] ??
			featuredSongManifest)
		: null;
	const previewSong = previewSongManifest
		? (songDetailsByTrackId[previewSongManifest.spotifyTrackId] ??
			previewSongManifest)
		: null;
	const albumArtUrl = featuredSongManifest?.albumArtUrl;
	const artistImageUrl = featuredSongManifest?.artistImageUrl;

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

	if (!featuredSong || !previewSong) {
		return (
			<div
				data-landing-scroll-root
				className="min-h-screen overflow-x-hidden"
				style={{ fontFamily: fonts.body, background: theme.bg }}
			>
				<section className="flex min-h-screen items-center justify-center px-8">
					<p style={{ color: theme.textMuted }}>Loading songs...</p>
				</section>
			</div>
		);
	}

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
								isExpanded={false}
								metaVisible={true}
								albumArtUrl={previewSongManifest?.albumArtUrl}
								isLoading={false}
							/>
							<MatchesSection
								playlists={landingPlaylists.slice(0, 3)}
								addedTo={[]}
								onAdd={() => {}}
								onDismiss={handlePreviewDiscard}
								onNext={handlePreviewNext}
								isExpanded={false}
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
					<a
						href="/prototypes/warm-pastel/faq"
						className="underline-offset-2 hover:underline"
					>
						FAQ
					</a>
					{" · "}
					<a
						href="/prototypes/warm-pastel/privacy"
						className="underline-offset-2 hover:underline"
					>
						Privacy
					</a>
					{" · "}
					<a
						href="/prototypes/warm-pastel/terms"
						className="underline-offset-2 hover:underline"
					>
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
