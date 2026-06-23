import {
	CheckCircleIcon,
	MicrophoneStageIcon,
	MusicNotesIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Badge, Card, ErrorState, Loading } from "../components/primitives";
import { postJson, useApi } from "../lib/api";
import { noAutofill } from "../lib/form";

interface LyricsReviewRow {
	songId: string;
	songName: string;
	artistLabel: string;
	albumName: string | null;
	imageUrl: string | null;
	durationMs: number | null;
	fetchStatus: "not_found" | "instrumental";
	fetchSource: string | null;
	fetchUpdatedAt: string;
}

type Filter = "needs_review" | "instrumental";

function SongCard({
	r,
	onActioned,
}: {
	r: LyricsReviewRow;
	onActioned: () => void;
}) {
	const [text, setText] = useState("");
	const [busy, setBusy] = useState<null | "lyrics" | "instrumental">(null);
	const [error, setError] = useState<string | null>(null);

	// Em dash, not hyphen: song names here often already contain " - " (e.g.
	// "Wonderwall - Remastered"), so a hyphen separator would blur together.
	const title = r.artistLabel ? `${r.artistLabel} — ${r.songName}` : r.songName;
	const hasText = text.trim().length > 0;

	async function run(
		action: "lyrics" | "instrumental",
		fn: () => Promise<unknown>,
	) {
		setBusy(action);
		setError(null);
		try {
			await fn();
			onActioned();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	}

	function saveLyrics() {
		void run("lyrics", () =>
			postJson(`/api/lyrics-reviews/${r.songId}/lyrics`, { text }),
		);
	}

	function markInstrumental() {
		const verb = r.fetchStatus === "instrumental" ? "Re-confirm" : "Mark";
		if (
			!window.confirm(
				`${verb} "${r.songName}" as instrumental?\n\nThis settles the song — it won't be re-offered for lyrics.`,
			)
		)
			return;
		void run("instrumental", () =>
			postJson(`/api/lyrics-reviews/${r.songId}/instrumental`, {}),
		);
	}

	return (
		<Card
			title="Song"
			icon={MusicNotesIcon}
			span={12}
			action={
				r.fetchStatus === "instrumental" ? (
					<Badge tone="default">instrumental</Badge>
				) : (
					<Badge tone="warning">no lyrics</Badge>
				)
			}
		>
			<div className="ar-panel">
				{r.imageUrl ? (
					<img
						className="ar-art cover"
						src={r.imageUrl}
						alt=""
						loading="lazy"
					/>
				) : (
					<span className="ar-art cover placeholder" />
				)}
				<div className="ar-body">
					<div className="ar-eyebrow">
						<MusicNotesIcon className="sp" size={12} weight="fill" />
						Spotify song
					</div>
					<div className="ar-title">{title}</div>
					<div className="ar-sub">{r.albumName ?? "—"}</div>
				</div>
			</div>

			<div className="field" style={{ marginTop: 12 }}>
				<label htmlFor={`lyrics-${r.songId}`}>
					{r.fetchStatus === "instrumental" ? "Override with lyrics" : "Lyrics"}
				</label>
				<textarea
					id={`lyrics-${r.songId}`}
					className="input textarea"
					rows={6}
					placeholder="Paste or type the lyrics, one line per line…"
					value={text}
					{...noAutofill}
					onChange={(e) => setText(e.target.value)}
				/>
			</div>

			<div className="btn-row">
				<button
					type="button"
					className="btn primary"
					disabled={busy !== null || !hasText}
					onClick={saveLyrics}
				>
					<CheckCircleIcon size={14} weight="fill" />
					{busy === "lyrics" ? "Saving…" : "Save lyrics"}
				</button>
				<button
					type="button"
					className="btn"
					disabled={busy !== null}
					onClick={markInstrumental}
				>
					<WaveformIcon size={14} weight="bold" />
					{busy === "instrumental"
						? "Marking…"
						: r.fetchStatus === "instrumental"
							? "Re-confirm instrumental"
							: "Mark instrumental"}
				</button>
			</div>

			{error && (
				<div className="result err" style={{ marginTop: 10 }}>
					{error}
				</div>
			)}
		</Card>
	);
}

const EMPTY_COPY: Record<Filter, string> = {
	needs_review: "No songs awaiting manual lyrics — the queue is clear.",
	instrumental: "No instrumental songs to review.",
};

export function LyricsReviewSection({ refreshKey }: { refreshKey: number }) {
	const [filter, setFilter] = useState<Filter>("needs_review");
	const { data, error, refetch } = useApi<{
		reviews: LyricsReviewRow[];
		needsReviewTotal: number;
		instrumentalTotal: number;
	}>(`/api/lyrics-reviews?filter=${filter}`, refreshKey);

	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const { reviews, needsReviewTotal, instrumentalTotal } = data;

	return (
		<div className="grid">
			<Card
				title="Lyrics review"
				icon={MicrophoneStageIcon}
				span={12}
				action={
					needsReviewTotal > 0 ? (
						<Badge tone="warning">{needsReviewTotal} to enter</Badge>
					) : (
						<Badge tone="success">all clear</Badge>
					)
				}
			>
				<p className="muted-text">
					Entitled, liked songs whose lyrics fetch came up{" "}
					<strong>not found</strong> across every provider — no automated path
					is left, so they're entered by hand. Paste the lyrics and save (writes
					a manual <code>song_lyrics</code> row on prod; the song re-analyzes on
					the next enrichment pass automatically), or mark it{" "}
					<strong>instrumental</strong> to settle it. Switch to{" "}
					<strong>Instrumental</strong> ({instrumentalTotal}) to override a
					misclassified vocal track with its lyrics.
				</p>
				<div className="btn-row" style={{ marginTop: 12 }}>
					<button
						type="button"
						className={`btn ${filter === "needs_review" ? "primary" : ""}`}
						onClick={() => setFilter("needs_review")}
					>
						Needs lyrics
					</button>
					<button
						type="button"
						className={`btn ${filter === "instrumental" ? "primary" : ""}`}
						onClick={() => setFilter("instrumental")}
					>
						Instrumental
					</button>
				</div>
			</Card>

			{reviews.length === 0 ? (
				<div className="card span-12">
					<div className="empty">{EMPTY_COPY[filter]}</div>
				</div>
			) : (
				<div className="ar-list span-12">
					{reviews.map((r) => (
						<SongCard key={r.songId} r={r} onActioned={refetch} />
					))}
				</div>
			)}
		</div>
	);
}
