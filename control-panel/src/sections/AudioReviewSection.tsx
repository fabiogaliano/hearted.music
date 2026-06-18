import {
	ArrowSquareOutIcon,
	CheckCircleIcon,
	MusicNotesIcon,
	SwapIcon,
	TrashIcon,
	WaveformIcon,
	YoutubeLogoIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Badge, Card, ErrorState, Loading } from "../components/primitives";
import { postJson, useApi } from "../lib/api";
import { noAutofill } from "../lib/form";

interface AudioFeatureReviewRow {
	id: string;
	status: "pending" | "approved" | "rejected";
	sourceType: "youtube_search" | "youtube_url";
	createdAt: string;

	songId: string;
	songName: string;
	artists: string[];
	albumName: string | null;
	imageUrl: string | null;
	spotifyDurationMs: number | null;

	audioFeatureId: string | null;
	acousticness: number | null;
	danceability: number | null;
	energy: number | null;
	instrumentalness: number | null;
	liveness: number | null;
	loudness: number | null;
	speechiness: number | null;
	tempo: number | null;
	valence: number | null;

	youtubeUrl: string | null;
	youtubeVideoId: string | null;
	youtubeTitle: string | null;
	youtubeChannel: string | null;
	youtubeDurationSeconds: number | null;
	youtubeThumbnailUrl: string | null;

	searchQuery: string | null;
	matchScore: number | null;
	matchReasons: string[];
	clipStartsSeconds: number[];
	aggregationMetadata: Record<string, unknown>;
}

// The shared duration() helper collapses to coarse units ("4m"), which is
// useless when the whole point is comparing 3:42 against 3:39. Format precisely.
function clock(seconds: number | null): string {
	if (seconds == null) return "—";
	const total = Math.round(seconds);
	const m = Math.floor(total / 60);
	const s = total % 60;
	return `${m}:${s.toString().padStart(2, "0")}`;
}

// The duration gap is the single strongest "does this match" signal — a YouTube
// result that's minutes off is almost certainly the wrong video.
function durationDelta(spotifyMs: number | null, ytSec: number | null) {
	if (spotifyMs == null || ytSec == null) return null;
	const delta = Math.round(Math.abs(spotifyMs / 1000 - ytSec));
	const tone = delta <= 2 ? "success" : delta <= 8 ? "warning" : "danger";
	return { delta, tone };
}

const FEATURE_KEYS: {
	key: keyof AudioFeatureReviewRow;
	label: string;
	digits: number;
}[] = [
	{ key: "danceability", label: "Dance", digits: 2 },
	{ key: "energy", label: "Energy", digits: 2 },
	{ key: "valence", label: "Valence", digits: 2 },
	{ key: "acousticness", label: "Acoustic", digits: 2 },
	{ key: "instrumentalness", label: "Instr.", digits: 2 },
	{ key: "liveness", label: "Live", digits: 2 },
	{ key: "speechiness", label: "Speech", digits: 2 },
	{ key: "loudness", label: "Loud (dB)", digits: 1 },
	{ key: "tempo", label: "Tempo", digits: 0 },
];

function FeatureGrid({ r }: { r: AudioFeatureReviewRow }) {
	return (
		<div
			style={{
				display: "grid",
				gridTemplateColumns: "repeat(3, 1fr)",
				gap: 8,
				marginTop: 10,
			}}
		>
			{FEATURE_KEYS.map(({ key, label, digits }) => {
				const value = r[key] as number | null;
				return (
					<div key={String(key)} className="stat" style={{ padding: 8 }}>
						<div className="stat-label">{label}</div>
						<div className="stat-value" style={{ fontSize: 18 }}>
							{value == null ? "—" : value.toFixed(digits)}
						</div>
					</div>
				);
			})}
		</div>
	);
}

function SpotifyPanel({ r }: { r: AudioFeatureReviewRow }) {
	const artistLabel = r.artists.join(", ");
	const songName = r.songName || "Unknown song";
	// Em dash, not hyphen: song names here often already contain " - " (e.g.
	// "Some Might Say - Remastered"), so a hyphen separator would blur together.
	const title = artistLabel ? `${artistLabel} — ${songName}` : songName;
	return (
		<div className="ar-panel">
			{r.imageUrl ? (
				<img className="ar-art cover" src={r.imageUrl} alt="" loading="lazy" />
			) : (
				<span className="ar-art cover placeholder" />
			)}
			<div className="ar-body">
				<div className="ar-eyebrow">
					<MusicNotesIcon className="sp" size={12} weight="fill" />
					Spotify song
				</div>
				<div className="ar-title">{title}</div>
				<div className="ar-sub">
					{r.albumName ?? "—"}
					{r.spotifyDurationMs != null && (
						<>
							{" · "}
							<span className="ar-clock">
								{clock(r.spotifyDurationMs / 1000)}
							</span>
						</>
					)}
				</div>
			</div>
		</div>
	);
}

function YoutubePanel({ r }: { r: AudioFeatureReviewRow }) {
	const sourceLabel =
		r.sourceType === "youtube_url" ? "manual url" : "via search";
	return (
		<div className="ar-panel">
			{r.youtubeThumbnailUrl ? (
				<img
					className="ar-art thumb"
					src={r.youtubeThumbnailUrl}
					alt=""
					loading="lazy"
				/>
			) : (
				<span className="ar-art thumb placeholder" />
			)}
			<div className="ar-body">
				<div className="ar-eyebrow">
					<YoutubeLogoIcon className="yt" size={13} weight="fill" />
					YouTube match
					<span className="tag">· {sourceLabel}</span>
				</div>
				<div className="ar-title">{r.youtubeTitle ?? "(no title)"}</div>
				<div className="ar-sub">
					{r.youtubeChannel ?? "—"}
					{r.youtubeDurationSeconds != null && (
						<>
							{" · "}
							<span className="ar-clock">
								{clock(r.youtubeDurationSeconds)}
							</span>
						</>
					)}
				</div>
				{r.youtubeUrl && (
					<a
						href={r.youtubeUrl}
						target="_blank"
						rel="noreferrer"
						className="user-link ar-link"
					>
						<ArrowSquareOutIcon size={13} weight="bold" /> open on YouTube
					</a>
				)}
			</div>
		</div>
	);
}

function Verdict({
	r,
	reasons,
}: {
	r: AudioFeatureReviewRow;
	reasons: string[];
}) {
	const delta = durationDelta(r.spotifyDurationMs, r.youtubeDurationSeconds);
	return (
		<div className="ar-verdict">
			<div className="ar-verdict-line">
				{r.matchScore != null && (
					<span className="ar-score">
						{(r.matchScore * 100).toFixed(0)}% match
					</span>
				)}
				{r.matchScore != null && delta && <span className="conn">·</span>}
				{delta && (
					<span className={`ar-delta ${delta.tone}`}>Δ {delta.delta}s</span>
				)}
			</div>
			{reasons.length > 0 && (
				<div className="ar-reasons">{reasons.join(" · ")}</div>
			)}
		</div>
	);
}

function ReviewCard({
	r,
	onActioned,
}: {
	r: AudioFeatureReviewRow;
	onActioned: () => void;
}) {
	const [busy, setBusy] = useState<null | "approve" | "reject" | "replace">(
		null,
	);
	const [error, setError] = useState<string | null>(null);
	const [notice, setNotice] = useState<string | null>(null);
	const [replaceOpen, setReplaceOpen] = useState(false);
	const [replaceUrl, setReplaceUrl] = useState("");

	async function run(
		action: "approve" | "reject" | "replace",
		fn: () => Promise<unknown>,
	) {
		setBusy(action);
		setError(null);
		setNotice(null);
		try {
			await fn();
			onActioned();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(null);
		}
	}

	function approve() {
		void run("approve", () =>
			postJson(`/api/audio-feature-reviews/${r.id}/approve`, {}),
		);
	}

	function reject() {
		if (
			!window.confirm(
				`Reject and DELETE the live audio feature for "${r.songName}"?\n\nThis also invalidates any analysis/embedding generated from it and re-queues the song.`,
			)
		)
			return;
		void run("reject", () =>
			postJson(`/api/audio-feature-reviews/${r.id}/reject`, {}),
		);
	}

	function replace() {
		if (
			!window.confirm(
				`Replace the feature for "${r.songName}" with this YouTube URL?\n\nThe current feature is deleted and a manual backfill job is queued.`,
			)
		)
			return;
		void run("replace", () =>
			postJson(`/api/audio-feature-reviews/${r.id}/replace-youtube`, {
				url: replaceUrl,
			}).then((res) => {
				setReplaceOpen(false);
				setReplaceUrl("");
				const job = (res as { manualJobId?: string }).manualJobId;
				setNotice(
					`Replacement queued${job ? ` · job ${job.slice(0, 8)}` : ""}.`,
				);
			}),
		);
	}

	return (
		<Card
			title="Audio match"
			icon={WaveformIcon}
			span={12}
			action={<Badge tone="warning">pending · live</Badge>}
		>
			<div className="ar-compare">
				<SpotifyPanel r={r} />
				<YoutubePanel r={r} />
			</div>

			<Verdict r={r} reasons={r.matchReasons} />

			<div className="btn-row" style={{ marginTop: 14 }}>
				<button
					type="button"
					className="btn primary"
					disabled={busy !== null}
					onClick={approve}
				>
					<CheckCircleIcon size={14} weight="fill" />
					{busy === "approve" ? "Approving…" : "Looks correct"}
				</button>
				<button
					type="button"
					className="btn"
					disabled={busy !== null}
					onClick={() => setReplaceOpen((o) => !o)}
				>
					<SwapIcon size={14} weight="bold" /> Replace URL
				</button>
				<button
					type="button"
					className="btn"
					disabled={busy !== null}
					onClick={reject}
					style={{ color: "var(--danger)" }}
				>
					<TrashIcon size={14} weight="bold" />
					{busy === "reject" ? "Rejecting…" : "Reject & delete"}
				</button>
			</div>

			{replaceOpen && (
				<div className="field" style={{ marginTop: 12 }}>
					<label htmlFor={`replace-${r.id}`}>YouTube URL</label>
					<input
						id={`replace-${r.id}`}
						className="input"
						placeholder="https://www.youtube.com/watch?v=…"
						value={replaceUrl}
						{...noAutofill}
						onChange={(e) => setReplaceUrl(e.target.value)}
					/>
					<div className="btn-row" style={{ marginTop: 8 }}>
						<button
							type="button"
							className="btn primary"
							disabled={busy !== null || replaceUrl.trim().length === 0}
							onClick={replace}
						>
							{busy === "replace" ? "Queuing…" : "Queue replacement"}
						</button>
					</div>
				</div>
			)}

			<details className="ar-extra">
				<summary>Audio features</summary>
				<FeatureGrid r={r} />
			</details>

			{Object.keys(r.aggregationMetadata).length > 0 && (
				<details className="ar-extra">
					<summary>
						Aggregation metadata ({Object.keys(r.aggregationMetadata).length})
					</summary>
					<pre
						style={{
							marginTop: 8,
							fontSize: 12,
							maxHeight: 180,
							overflow: "auto",
						}}
					>
						{JSON.stringify(r.aggregationMetadata, null, 2)}
					</pre>
				</details>
			)}

			{error && (
				<div className="result err" style={{ marginTop: 10 }}>
					{error}
				</div>
			)}
			{notice && (
				<div className="result ok" style={{ marginTop: 10 }}>
					{notice}
				</div>
			)}
		</Card>
	);
}

export function AudioReviewSection({ refreshKey }: { refreshKey: number }) {
	const { data, error, refetch } = useApi<{ reviews: AudioFeatureReviewRow[] }>(
		"/api/audio-feature-reviews?status=pending",
		refreshKey,
	);

	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const reviews = data.reviews;

	return (
		<div className="grid">
			<Card
				title="Pending audio reviews"
				icon={WaveformIcon}
				span={12}
				action={
					reviews.length > 0 ? (
						<Badge tone="warning">{reviews.length} live & unreviewed</Badge>
					) : (
						<Badge tone="success">all clear</Badge>
					)
				}
			>
				<p className="muted-text">
					Each card pairs a <strong>Spotify song</strong> with the{" "}
					<strong>YouTube video</strong> its audio was pulled from. Confirm the
					video is the right one — approve the good ones, reject the bad ones.
					Rejection deletes the feature and any analysis/embedding derived from
					it, then re-queues the song.
				</p>
			</Card>

			{reviews.length === 0 ? (
				<div className="card span-12">
					<div className="empty">No pending audio reviews.</div>
				</div>
			) : (
				<div className="ar-list span-12">
					{reviews.map((r) => (
						<ReviewCard key={r.id} r={r} onActioned={refetch} />
					))}
				</div>
			)}
		</div>
	);
}
