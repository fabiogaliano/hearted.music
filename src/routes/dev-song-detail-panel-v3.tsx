import { useQuery } from "@tanstack/react-query";
import { createFileRoute, notFound } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { ConceptPanel } from "@/features/liked-songs/components/concept-panel/ConceptPanel";
import { fetchConceptArtwork } from "@/features/liked-songs/components/concept-panel/concept-artwork.functions";
import { CONCEPT_SONGS } from "@/features/liked-songs/components/concept-panel/concept-data";
import type { ConceptSong } from "@/features/liked-songs/components/concept-panel/concept-types";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import { DEFAULT_THEME } from "@/lib/theme/types";

export const Route = createFileRoute("/dev-song-detail-panel-v3")({
	beforeLoad: () => {
		if (import.meta.env.PROD) {
			throw notFound();
		}
	},
	component: DevSongPanelV3,
});

function DevSongPanelV3() {
	const [songId, setSongId] = useState<string>(CONCEPT_SONGS[0].id);

	const { data: artwork } = useQuery({
		queryKey: ["dev-v3-artwork"],
		queryFn: () => fetchConceptArtwork(),
		staleTime: Infinity,
	});

	const songs = useMemo<ConceptSong[]>(
		() =>
			CONCEPT_SONGS.map((s) => {
				const art = artwork?.[s.spotifyTrackId];
				return {
					...s,
					albumArtUrl: art?.albumArtUrl ?? undefined,
					artistImageUrl: art?.artistImageUrl ?? undefined,
				};
			}),
		[artwork],
	);

	const song = songs.find((s) => s.id === songId) ?? songs[0];

	return (
		<ThemeHueProvider theme={themes[DEFAULT_THEME]}>
			<div
				style={{
					minHeight: "100vh",
					background: "hsl(0, 0%, 6%)",
					color: "hsl(0, 0%, 75%)",
					fontFamily: fonts.body,
					padding: "40px clamp(24px, 4vw, 64px)",
				}}
			>
				<div style={{ maxWidth: 460 }}>
					<div
						style={{
							fontSize: 10,
							letterSpacing: "0.18em",
							textTransform: "uppercase",
							color: "hsl(0, 0%, 45%)",
							marginBottom: 12,
						}}
					>
						Step 0 — read coherence test
					</div>
					<h1
						style={{
							fontFamily: fonts.display,
							fontSize: 36,
							fontWeight: 400,
							lineHeight: 1.15,
							margin: 0,
							color: "hsl(0, 0%, 92%)",
						}}
					>
						The Read
					</h1>
					<p
						style={{
							marginTop: 14,
							fontSize: 13,
							lineHeight: 1.6,
							color: "hsl(0, 0%, 60%)",
						}}
					>
						Four hand-written song reads under the proposed three-layer schema.
						Read and take are always visible; the trace exposes its scaffolding
						(mood spine, quoted lines) and reveals prose on demand.
					</p>

					<div style={{ marginTop: 28 }}>
						<SongPicker songs={songs} songId={songId} onChange={setSongId} />
					</div>
				</div>

				<ConceptPanel key={song.id} song={song} />
			</div>
		</ThemeHueProvider>
	);
}

function SongPicker({
	songs,
	songId,
	onChange,
}: {
	songs: ConceptSong[];
	songId: string;
	onChange: (id: string) => void;
}) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
			<div
				style={{
					fontSize: 10,
					letterSpacing: "0.15em",
					textTransform: "uppercase",
					color: "hsl(0, 0%, 45%)",
					marginBottom: 4,
				}}
			>
				Exemplar
			</div>
			{songs.map((s) => {
				const isActive = s.id === songId;
				const t = themes[s.theme];
				return (
					<button
						key={s.id}
						type="button"
						onClick={() => onChange(s.id)}
						style={{
							display: "flex",
							alignItems: "center",
							gap: 12,
							padding: "10px 12px",
							borderRadius: 6,
							border: `1px solid ${isActive ? t.primary : "hsl(0, 0%, 14%)"}`,
							background: isActive ? "hsl(0, 0%, 11%)" : "hsl(0, 0%, 9%)",
							color: isActive ? "hsl(0, 0%, 92%)" : "hsl(0, 0%, 75%)",
							cursor: "pointer",
							textAlign: "left",
							fontSize: 13,
							fontFamily: "inherit",
							transition:
								"background 150ms ease, border-color 150ms ease, color 150ms ease",
						}}
					>
						<span
							aria-hidden
							style={{
								width: 8,
								height: 8,
								borderRadius: 4,
								background: t.primary,
								flexShrink: 0,
							}}
						/>
						<span style={{ fontWeight: 500, flex: 1 }}>{s.title}</span>
						<span
							style={{
								fontSize: 11,
								color: "hsl(0, 0%, 50%)",
							}}
						>
							{s.artist}
						</span>
					</button>
				);
			})}
		</div>
	);
}
