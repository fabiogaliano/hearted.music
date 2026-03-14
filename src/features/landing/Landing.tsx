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

import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { LandingHero } from "./components/LandingHero";
import { SpotifyLoginButton } from "./components/SpotifyLoginButton";
import { WaitlistInput } from "./components/WaitlistInput";

const PRELOAD_MARGIN = 2;

// 7 playlist archetypes that cover the emotional/energetic range of the demo songs
const PLAYLISTS = [
	{
		id: 1,
		name: "crying in the car",
		reason: "for when you're driving and it hits you",
	},
	{ id: 2, name: "sweaty and happy", reason: "movement that feels good" },
	{
		id: 3,
		name: "feeling everything",
		reason: "songs that meet you where you are",
	},
	{
		id: 4,
		name: "main character energy",
		reason: "when you need to feel like the point",
	},
	{ id: 5, name: "3am thoughts", reason: "the spiral, but make it beautiful" },
	{ id: 6, name: "sunday softness", reason: "no urgency, just warmth" },
	{
		id: 7,
		name: "revenge era",
		reason: "when done-with-it becomes a superpower",
	},
] as const;

type PlaylistId = (typeof PLAYLISTS)[number]["id"];

// Per-song top-3 playlist matches with earned scores
// spotifyTrackId → [{ id: PlaylistId, matchScore }]
const SONG_PLAYLIST_MATCHES: Record<
	string,
	Array<{ id: PlaylistId; matchScore: number }>
> = {
	// Ribs — Lorde: existential dread, growing-up vertigo
	"2MvvoeRt8NcOXWESkxWn3g": [
		{ id: 5, matchScore: 0.94 },
		{ id: 3, matchScore: 0.72 },
		{ id: 1, matchScore: 0.51 },
	],
	// Houdini — Dua Lipa: escapist disco, confident fun
	"4OMJGnvZfDvsePyCwRGO7X": [
		{ id: 2, matchScore: 0.95 },
		{ id: 4, matchScore: 0.79 },
		{ id: 7, matchScore: 0.48 },
	],
	// Thinkin Bout You — Frank Ocean: quiet longing, soft ache
	"7DfFc7a6Rwfi3YQMRbDMau": [
		{ id: 5, matchScore: 0.91 },
		{ id: 3, matchScore: 0.68 },
		{ id: 6, matchScore: 0.44 },
	],
	// Motion Sickness — Phoebe Bridgers: bittersweet driving rage
	"5xo8RrjJ9CVNrtRg2S3B1R": [
		{ id: 1, matchScore: 0.96 },
		{ id: 7, matchScore: 0.63 },
		{ id: 5, matchScore: 0.41 },
	],
	// Too Sweet — Hozier: slow blues, gentle rejection
	"3HMY0r2BAdpasXMY8rseR0": [
		{ id: 6, matchScore: 0.88 },
		{ id: 3, matchScore: 0.6 },
		{ id: 5, matchScore: 0.39 },
	],
	// Do I Wanna Know? — Arctic Monkeys: slow-burn late-night desire
	"5FVd6KXrgO9B3JPmC8OPst": [
		{ id: 5, matchScore: 0.93 },
		{ id: 3, matchScore: 0.65 },
		{ id: 1, matchScore: 0.47 },
	],
	// Kill Bill — SZA: dark obsessive love, edge of revenge
	"1Qrg8KqiBpW07V7PNxwwwL": [
		{ id: 7, matchScore: 0.92 },
		{ id: 5, matchScore: 0.74 },
		{ id: 3, matchScore: 0.5 },
	],
	// Not Like Us — Kendrick Lamar: triumphant beef anthem
	"6AI3ezQ4o3HUoP6Dhudph3": [
		{ id: 4, matchScore: 0.96 },
		{ id: 7, matchScore: 0.85 },
		{ id: 2, matchScore: 0.58 },
	],
	// Taxes — Geese: wiry alt-country indie rock
	"7r9BUOSnekEjrkMhmxD6Ae": [
		{ id: 1, matchScore: 0.77 },
		{ id: 6, matchScore: 0.55 },
		{ id: 5, matchScore: 0.38 },
	],
	// Beautiful Things — Benson Boone: emotional pop, gratitude shadowed by fear
	"6tNQ70jh4OwmPGpYy6R2o9": [
		{ id: 3, matchScore: 0.91 },
		{ id: 6, matchScore: 0.67 },
		{ id: 1, matchScore: 0.44 },
	],
	// BIRDS OF A FEATHER — Billie Eilish: tender devotion, soft intensity
	"6dOtVTDdiauQNBQEDOtlAB": [
		{ id: 3, matchScore: 0.93 },
		{ id: 6, matchScore: 0.76 },
		{ id: 5, matchScore: 0.49 },
	],
	// drivers license — Olivia Rodrigo: the driving heartbreak song
	"7lPN2DXiMsVn7XUKtOW1CS": [
		{ id: 1, matchScore: 0.97 },
		{ id: 3, matchScore: 0.81 },
		{ id: 5, matchScore: 0.55 },
	],
	// Pink Pony Club — Chappell Roan: queer joy, camp, liberation
	"1k2pQc5i348DCHwbn5KTdc": [
		{ id: 2, matchScore: 0.94 },
		{ id: 4, matchScore: 0.72 },
		{ id: 7, matchScore: 0.43 },
	],
	// EARFQUAKE — Tyler, the Creator: vulnerable soft love
	"5hVghJ4KaYES3BFUATCYn0": [
		{ id: 3, matchScore: 0.89 },
		{ id: 5, matchScore: 0.66 },
		{ id: 6, matchScore: 0.42 },
	],
	// Blinding Lights — The Weeknd: synthwave driving rush
	"0VjIjW4GlUZAMYd2vXMi3b": [
		{ id: 1, matchScore: 0.88 },
		{ id: 2, matchScore: 0.69 },
		{ id: 4, matchScore: 0.47 },
	],
	// As It Was — Harry Styles: bittersweet, moving-on melancholy
	"4Dvkj6JhhA12EX05fT7y2e": [
		{ id: 3, matchScore: 0.82 },
		{ id: 1, matchScore: 0.61 },
		{ id: 6, matchScore: 0.4 },
	],
	// Manchild — Sabrina Carpenter: sharp wit, playfully done
	"42UBPzRMh5yyz0EDPr6fr1": [
		{ id: 7, matchScore: 0.91 },
		{ id: 4, matchScore: 0.73 },
		{ id: 2, matchScore: 0.46 },
	],
	// God's Plan — Drake: confident generosity, effortless cool
	"6DCZcSspjsKoFjzjrWoCdn": [
		{ id: 4, matchScore: 0.88 },
		{ id: 6, matchScore: 0.57 },
		{ id: 2, matchScore: 0.38 },
	],
	// DtMF — Bad Bunny: reggaeton nostalgia, cultural warmth
	"3sK8wGT43QFpWrvNQsrQya": [
		{ id: 2, matchScore: 0.87 },
		{ id: 3, matchScore: 0.64 },
		{ id: 1, matchScore: 0.42 },
	],
	// That's So True — Gracie Abrams: relatable post-breakup indie folk
	"7ne4VBA60CxGM75vw0EYad": [
		{ id: 3, matchScore: 0.9 },
		{ id: 1, matchScore: 0.71 },
		{ id: 5, matchScore: 0.48 },
	],
};

function getPlaylistsForSong(trackId: string) {
	const matches =
		SONG_PLAYLIST_MATCHES[trackId] ??
		SONG_PLAYLIST_MATCHES["7lPN2DXiMsVn7XUKtOW1CS"]!;
	return matches.map(({ id, matchScore }) => {
		const def = PLAYLISTS.find((p) => p.id === id)!;
		return { id: def.id, name: def.name, reason: def.reason, matchScore };
	});
}

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
								isExpanded={false}
								metaVisible={true}
								albumArtUrl={previewSongManifest.albumArtUrl}
								isLoading={false}
								songKey={previewSongManifest.spotifyTrackId}
							/>
							<MatchesSection
								playlists={getPlaylistsForSong(
									previewSongManifest.spotifyTrackId,
								)}
								addedTo={[]}
								onAdd={() => {}}
								onDismiss={handlePreviewDiscard}
								onNext={handlePreviewNext}
								isExpanded={false}
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
