import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { createServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { SongDetailPanel } from "@/features/liked-songs/components/SongDetailPanel";
import { PanelVariantCompactStack } from "@/features/liked-songs/components/variants/PanelVariantCompactStack";
import { PanelVariantCompass } from "@/features/liked-songs/components/variants/PanelVariantCompass";
import { PanelVariantConstellation } from "@/features/liked-songs/components/variants/PanelVariantConstellation";
import { PanelVariantEqualizer } from "@/features/liked-songs/components/variants/PanelVariantEqualizer";
import { PanelVariantFieldGuide } from "@/features/liked-songs/components/variants/PanelVariantFieldGuide";
import { PanelVariantJourneyCenter } from "@/features/liked-songs/components/variants/PanelVariantJourneyCenter";
import { PanelVariantLinerNotes } from "@/features/liked-songs/components/variants/PanelVariantLinerNotes";
import { PanelVariantLinesStage } from "@/features/liked-songs/components/variants/PanelVariantLinesStage";
import { PanelVariantLyricDeck } from "@/features/liked-songs/components/variants/PanelVariantLyricDeck";
import { PanelVariantMoodFirst } from "@/features/liked-songs/components/variants/PanelVariantMoodFirst";
import { PanelVariantMotionRibbon } from "@/features/liked-songs/components/variants/PanelVariantMotionRibbon";
import { PanelVariantQuietLoud } from "@/features/liked-songs/components/variants/PanelVariantQuietLoud";
import { PanelVariantQuoteFirst } from "@/features/liked-songs/components/variants/PanelVariantQuoteFirst";
import { PanelVariantReverse } from "@/features/liked-songs/components/variants/PanelVariantReverse";
import { PanelVariantScrollScore } from "@/features/liked-songs/components/variants/PanelVariantScrollScore";
import { PanelVariantScrubTape } from "@/features/liked-songs/components/variants/PanelVariantScrubTape";
import { PanelVariantTapReveal } from "@/features/liked-songs/components/variants/PanelVariantTapReveal";
import { PanelVariantThemePivot } from "@/features/liked-songs/components/variants/PanelVariantThemePivot";
import { PanelVariantVerbatim } from "@/features/liked-songs/components/variants/PanelVariantVerbatim";
import { PanelVariantWideOpen } from "@/features/liked-songs/components/variants/PanelVariantWideOpen";
import type { AnalysisContent, LikedSong } from "@/features/liked-songs/types";
import { PaneRoot, usePane } from "@/integrations/uipane";
import { createAdminSupabaseClient } from "@/lib/data/client";
import { authMiddleware } from "@/lib/platform/auth/auth.middleware";
import { requireAuthSession } from "@/lib/server/auth.functions";
import { themes } from "@/lib/theme/colors";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import { DEFAULT_THEME } from "@/lib/theme/types";

const PANEL_OPTIONS = [
	{ value: "prod", label: "1. Prod Panel" },
	{ value: "v2", label: "2. Verbatim" },
	{ value: "v3", label: "3. Quote First" },
	{ value: "v4", label: "4. Mood First" },
	{ value: "v5", label: "5. Journey Center" },
	{ value: "v6", label: "6. Tap Reveal" },
	{ value: "v7", label: "7. Theme Pivot" },
	{ value: "v8", label: "8. Lines Stage" },
	{ value: "v9", label: "9. Reverse" },
	{ value: "v10", label: "10. Compact Stack" },
	{ value: "v11", label: "11. Wide Open" },
	{ value: "v12", label: "12. Compass" },
	{ value: "v13", label: "13. Scrub Tape" },
	{ value: "v14", label: "14. Liner Notes" },
	{ value: "v15", label: "15. Constellation" },
	{ value: "v16", label: "16. Quiet Loud" },
	{ value: "v17", label: "17. Scroll Score" },
	{ value: "v18", label: "18. Field Guide" },
	{ value: "v19", label: "19. Equalizer" },
	{ value: "v20", label: "20. Lyric Deck" },
	{ value: "v21", label: "21. Motion Ribbon" },
];

interface DevAnalysisRow {
	id: string;
	analysis: AnalysisContent;
	model: string | null;
	created_at: string | null;
}

interface DevAudioFeatureRow {
	tempo: number | null;
	energy: number | null;
	valence: number | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function isAnalysisContent(value: unknown): value is AnalysisContent {
	return isRecord(value);
}

function nullableString(value: unknown): string | null {
	return typeof value === "string" ? value : null;
}

function nullableNumber(value: unknown): number | null {
	return typeof value === "number" ? value : null;
}

function getFirstAnalysisRow(value: unknown): DevAnalysisRow | null {
	if (!Array.isArray(value)) return null;

	const first = value[0];
	if (!isRecord(first)) return null;

	const id = first.id;
	const analysis = first.analysis;
	if (typeof id !== "string" || !isAnalysisContent(analysis)) return null;

	return {
		id,
		analysis,
		model: nullableString(first.model),
		created_at: nullableString(first.created_at),
	};
}

function getAudioFeatureRow(value: unknown): DevAudioFeatureRow | null {
	if (!isRecord(value)) return null;

	return {
		tempo: nullableNumber(value.tempo),
		energy: nullableNumber(value.energy),
		valence: nullableNumber(value.valence),
	};
}

const fetchDevSongs = createServerFn({ method: "GET" })
	.middleware([authMiddleware])
	.handler(async (): Promise<LikedSong[]> => {
		if (import.meta.env.PROD) {
			throw new Response("Not Found", { status: 404 });
		}

		const supabase = createAdminSupabaseClient();

		const { data: songs, error } = await supabase
			.from("song")
			.select(
				`id, name, artists, artist_ids, album_name, image_url, genres, spotify_id,
         song_analysis!inner ( id, analysis, model, created_at ),
         song_audio_feature!inner ( tempo, energy, valence )`,
			)
			.limit(40);

		if (error) throw new Error(`DB error: ${error.message}`);

		const fullyAnalyzed =
			songs?.filter((s) => {
				const analysis = getFirstAnalysisRow(s.song_analysis)?.analysis;
				return (
					(analysis?.themes?.length ?? 0) > 0 &&
					(analysis?.journey?.length ?? 0) > 0 &&
					(analysis?.key_lines?.length ?? 0) > 0 &&
					Boolean(analysis?.headline)
				);
			}) ?? [];

		const top = fullyAnalyzed.slice(0, 20);

		const artistIds = Array.from(
			new Set(
				top
					.map((s) => s.artist_ids?.[0])
					.filter((id): id is string => typeof id === "string"),
			),
		);
		const artistImageMap = new Map<string, string | null>();
		if (artistIds.length > 0) {
			const { data: artists } = await supabase
				.from("artist")
				.select("spotify_id, image_url")
				.in("spotify_id", artistIds);
			for (const a of artists ?? []) {
				artistImageMap.set(a.spotify_id, a.image_url ?? null);
			}
		}

		return top.map((row) => {
			// PostgREST returns song_analysis as an array (no unique constraint)
			// but song_audio_feature as an object (song_id_key unique constraint → 1-to-1).
			const analysisRow = getFirstAnalysisRow(row.song_analysis);
			const audioFeatures = getAudioFeatureRow(row.song_audio_feature);
			const primaryArtistId = row.artist_ids[0] ?? null;

			return {
				liked_at: new Date().toISOString(),
				matching_status: null,
				displayState: "analyzed" as const,
				track: {
					id: row.id,
					spotify_track_id: row.spotify_id,
					name: row.name,
					artist: row.artists[0] ?? "",
					artist_id: primaryArtistId,
					artist_image_url: primaryArtistId
						? (artistImageMap.get(primaryArtistId) ?? null)
						: null,
					album: row.album_name ?? null,
					image_url: row.image_url ?? null,
					genres: row.genres,
					audio_features: audioFeatures,
				},
				analysis: analysisRow
					? {
							id: analysisRow.id,
							track_id: row.id,
							analysis: analysisRow.analysis,
							model_name: analysisRow.model ?? "unknown",
							version: 1,
							created_at: analysisRow.created_at,
						}
					: null,
			};
		});
	});

export const Route = createFileRoute("/dev-song-detail-panel-v2")({
	beforeLoad: async () => {
		if (import.meta.env.PROD) {
			throw notFound();
		}

		await requireAuthSession();
	},
	component: DevPlaygroundV2,
});

function DevPlaygroundV2() {
	const [isExpanded, setIsExpanded] = useState(true);

	const { data: songs, isLoading } = useQuery({
		queryKey: ["dev-songs-v2"],
		queryFn: () => fetchDevSongs(),
	});

	const songOptions = useMemo(
		() =>
			(songs ?? []).map((s) => ({
				value: s.track.id,
				label: `${s.track.name} — ${s.track.artist}`,
			})),
		[songs],
	);

	const defaultSongId = songOptions[0]?.value ?? "";

	const { panel: selectedPanel, song: selectedSongId } = usePane(
		"SongDetailPanel",
		{
			panel: {
				type: "select",
				value: "prod",
				options: PANEL_OPTIONS,
			},
			song: {
				type: "select",
				value: defaultSongId,
				options:
					songOptions.length > 0
						? songOptions
						: [{ value: "", label: "Loading…" }],
			},
		},
	);

	const song = useMemo(
		() =>
			(songs ?? []).find((s) => s.track.id === selectedSongId) ??
			(songs ?? [])[0],
		[songs, selectedSongId],
	);

	return (
		<ThemeHueProvider theme={themes[DEFAULT_THEME]}>
			<div className="min-h-screen" style={{ background: "hsl(0, 0%, 92%)" }}>
				{isLoading && (
					<span
						style={{
							position: "fixed",
							top: "50%",
							left: "50%",
							transform: "translate(-50%, -50%)",
							fontSize: 13,
							color: "hsl(0, 0%, 50%)",
						}}
					>
						Loading…
					</span>
				)}

				{!isExpanded && (
					<button
						type="button"
						onClick={() => setIsExpanded(true)}
						style={{
							position: "fixed",
							top: 16,
							right: 16,
							fontSize: 12,
							padding: "6px 12px",
							background: "hsl(0, 0%, 20%)",
							color: "hsl(0, 0%, 80%)",
							border: "none",
							borderRadius: 6,
							cursor: "pointer",
						}}
					>
						Open panel
					</button>
				)}

				{song && selectedPanel === "prod" && (
					<SongDetailPanel
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						startRect={null}
						onClose={() => setIsExpanded(false)}
						onNext={() => {}}
						onPrevious={() => {}}
						hasNext={false}
						hasPrevious={false}
					/>
				)}

				{song && selectedPanel === "v2" && (
					<PanelVariantVerbatim
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v3" && (
					<PanelVariantQuoteFirst
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v4" && (
					<PanelVariantMoodFirst
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v5" && (
					<PanelVariantJourneyCenter
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v6" && (
					<PanelVariantTapReveal
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v7" && (
					<PanelVariantThemePivot
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v8" && (
					<PanelVariantLinesStage
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v9" && (
					<PanelVariantReverse
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v10" && (
					<PanelVariantCompactStack
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v11" && (
					<PanelVariantWideOpen
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v12" && (
					<PanelVariantCompass
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v13" && (
					<PanelVariantScrubTape
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v14" && (
					<PanelVariantLinerNotes
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v15" && (
					<PanelVariantConstellation
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v16" && (
					<PanelVariantQuietLoud
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v17" && (
					<PanelVariantScrollScore
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v18" && (
					<PanelVariantFieldGuide
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v19" && (
					<PanelVariantEqualizer
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v20" && (
					<PanelVariantLyricDeck
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				{song && selectedPanel === "v21" && (
					<PanelVariantMotionRibbon
						key={song.track.id}
						song={song}
						albumArtUrl={song.track.image_url ?? undefined}
						artistImageUrl={song.track.artist_image_url ?? undefined}
						isExpanded={isExpanded}
						onClose={() => setIsExpanded(false)}
					/>
				)}

				<PaneRoot>{null}</PaneRoot>
			</div>
		</ThemeHueProvider>
	);
}
