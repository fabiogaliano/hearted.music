import {
	CheckCircleIcon,
	MusicNotesIcon,
	TrashIcon,
	WaveformIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Badge, Card, ErrorState, Loading } from "../components/primitives";
import { postJson, useApi } from "../lib/api";

interface InstrumentalReviewRow {
	id: string;
	status: "pending" | "approved" | "rejected";
	signal: "instrumentalness" | "genre";
	instrumentalness: number | null;
	matchedGenre: string | null;
	createdAt: string;

	songId: string;
	songName: string;
	artistLabel: string;
	albumName: string | null;
	imageUrl: string | null;
	durationMs: number | null;
}

// Plain-language reason the classifier called this instrumental, so the operator
// can sanity-check the guess at a glance.
function reasonText(r: InstrumentalReviewRow): string {
	if (r.signal === "genre") {
		return r.matchedGenre
			? `Instrumental genre: ${r.matchedGenre}`
			: "Instrumental genre";
	}
	return r.instrumentalness != null
		? `Instrumentalness ${r.instrumentalness.toFixed(2)}`
		: "High instrumentalness";
}

function ReviewCard({
	r,
	onActioned,
}: {
	r: InstrumentalReviewRow;
	onActioned: () => void;
}) {
	const [busy, setBusy] = useState<null | "approve" | "reject">(null);
	const [error, setError] = useState<string | null>(null);

	// Em dash, not hyphen: song names here often already contain " - " (e.g.
	// "Intro - Live"), so a hyphen separator would blur together.
	const title = r.artistLabel ? `${r.artistLabel} — ${r.songName}` : r.songName;

	async function run(action: "approve" | "reject", fn: () => Promise<unknown>) {
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

	function approve() {
		void run("approve", () =>
			postJson(`/api/instrumental-reviews/${r.id}/approve`, {}),
		);
	}

	function reject() {
		if (
			!window.confirm(
				`Mark "${r.songName}" as having vocals?\n\nThis removes the instrumental tag and its analysis, and sends the song back to the lyrics queue for manual entry. The system won't auto-mark it instrumental again.`,
			)
		)
			return;
		void run("reject", () =>
			postJson(`/api/instrumental-reviews/${r.id}/reject`, {}),
		);
	}

	return (
		<Card
			title="Instrumental guess"
			icon={WaveformIcon}
			span={12}
			action={<Badge tone="warning">pending · live</Badge>}
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

			<div className="ar-verdict">
				<div className="ar-verdict-line">
					<span className="ar-score">{reasonText(r)}</span>
				</div>
			</div>

			<div className="btn-row" style={{ marginTop: 14 }}>
				<button
					type="button"
					className="btn primary"
					disabled={busy !== null}
					onClick={approve}
				>
					<CheckCircleIcon size={14} weight="fill" />
					{busy === "approve" ? "Approving…" : "Instrumental — correct"}
				</button>
				<button
					type="button"
					className="btn"
					disabled={busy !== null}
					onClick={reject}
					style={{ color: "var(--danger)" }}
				>
					<TrashIcon size={14} weight="bold" />
					{busy === "reject" ? "Rejecting…" : "Has vocals — reject"}
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

export function InstrumentalReviewSection({
	refreshKey,
}: {
	refreshKey: number;
}) {
	const { data, error, refetch } = useApi<{
		reviews: InstrumentalReviewRow[];
		pendingTotal: number;
	}>("/api/instrumental-reviews?status=pending", refreshKey);

	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const { reviews } = data;

	return (
		<div className="grid">
			<Card
				title="Instrumental review"
				icon={WaveformIcon}
				span={12}
				action={
					reviews.length > 0 ? (
						<Badge tone="warning">{reviews.length} to review</Badge>
					) : (
						<Badge tone="success">all clear</Badge>
					)
				}
			>
				<p className="muted-text">
					When a song has no lyrics, analysis guesses{" "}
					<strong>instrumental</strong> from its genre or Spotify
					instrumentalness — usually right, occasionally wrong for a vocal track
					tagged with an instrumental-ish genre. Each guess is{" "}
					<strong>already live</strong>. <strong>Approve</strong> the correct
					ones; <strong>Reject</strong> a vocal track to strip the instrumental
					tag and its analysis and send it to the lyrics queue for manual entry
					(it won't be auto-guessed instrumental again).
				</p>
			</Card>

			{reviews.length === 0 ? (
				<div className="card span-12">
					<div className="empty">
						No pending instrumental guesses to review.
					</div>
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
