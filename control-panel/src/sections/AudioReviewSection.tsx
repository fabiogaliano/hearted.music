import {
	ArrowSquareOutIcon,
	CheckCircleIcon,
	SwapIcon,
	TrashIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Badge, Card, ErrorState, Loading } from "../components/primitives";
import { postJson, useApi } from "../lib/api";
import { noAutofill } from "../lib/form";
import { duration } from "../lib/format";

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
				marginTop: 12,
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

function MetadataNotes({ meta }: { meta: Record<string, unknown> }) {
	const entries = Object.entries(meta);
	if (entries.length === 0) return null;
	return (
		<details style={{ marginTop: 12 }}>
			<summary className="dim" style={{ cursor: "pointer" }}>
				Aggregation metadata ({entries.length})
			</summary>
			<pre
				style={{
					marginTop: 8,
					fontSize: 12,
					maxHeight: 180,
					overflow: "auto",
				}}
			>
				{JSON.stringify(meta, null, 2)}
			</pre>
		</details>
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
			title={r.songName || "Unknown song"}
			icon={WaveformIcon}
			span={6}
			action={<Badge tone="warning">pending · live</Badge>}
		>
			<div className="song-cell" style={{ marginBottom: 8 }}>
				{r.imageUrl ? (
					<img className="song-cover" src={r.imageUrl} alt="" loading="lazy" />
				) : (
					<span className="song-cover placeholder" />
				)}
				<span className="song-meta">
					<span className="primary">{r.artists.join(", ") || "—"}</span>
					<span className="dim">
						{r.albumName ?? "—"}
						{r.spotifyDurationMs != null &&
							` · ${duration(r.spotifyDurationMs / 1000)}`}
					</span>
				</span>
			</div>

			<div
				className="dim"
				style={{ display: "flex", alignItems: "center", gap: 8 }}
			>
				<Badge tone="default">{r.sourceType.replace("youtube_", "yt ")}</Badge>
				{r.matchScore != null && (
					<span>match {(r.matchScore * 100).toFixed(0)}%</span>
				)}
			</div>

			<div style={{ marginTop: 10 }}>
				<div className="primary">{r.youtubeTitle ?? "(no title)"}</div>
				<div className="dim">
					{r.youtubeChannel ?? "—"}
					{r.youtubeDurationSeconds != null &&
						` · ${duration(r.youtubeDurationSeconds)}`}
				</div>
				{r.youtubeUrl && (
					<a
						href={r.youtubeUrl}
						target="_blank"
						rel="noreferrer"
						className="user-link"
						style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
					>
						<ArrowSquareOutIcon size={13} weight="bold" /> open on YouTube
					</a>
				)}
			</div>

			{r.matchReasons.length > 0 && (
				<div className="dim" style={{ marginTop: 8, fontSize: 12 }}>
					{r.matchReasons.join(" · ")}
				</div>
			)}

			<FeatureGrid r={r} />
			<MetadataNotes meta={r.aggregationMetadata} />

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
					Auto-backfilled audio features (YouTube → ReccoBeats) are{" "}
					<strong>live immediately</strong>. Approve the good ones, reject the
					bad ones — rejection deletes the feature and any analysis/embedding
					derived from it, then re-queues the song.
				</p>
			</Card>

			{reviews.length === 0 ? (
				<div className="card span-12">
					<div className="empty">No pending audio reviews.</div>
				</div>
			) : (
				reviews.map((r) => <ReviewCard key={r.id} r={r} onActioned={refetch} />)
			)}
		</div>
	);
}
