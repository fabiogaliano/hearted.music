import {
	CalendarBlankIcon,
	CheckCircleIcon,
	MusicNotesIcon,
} from "@phosphor-icons/react";
import { useState } from "react";
import { Badge, Card, ErrorState, Loading } from "../components/primitives";
import { postJson, useApi } from "../lib/api";
import { noAutofill } from "../lib/form";

interface ReleaseYearReviewRow {
	songId: string;
	songName: string;
	artistLabel: string;
	albumName: string | null;
	imageUrl: string | null;
	releaseYear: number | null;
	checkedAt: string | null;
	createdAt: string;
}

type Filter = "unresolved" | "pending" | "set";

function SongCard({
	r,
	onSaved,
}: {
	r: ReleaseYearReviewRow;
	onSaved: () => void;
}) {
	const [year, setYear] = useState(
		r.releaseYear != null ? String(r.releaseYear) : "",
	);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);

	// Em dash, not hyphen: song names here often already contain " - " (e.g.
	// "Bohemian Rhapsody - Remastered"), so a hyphen separator would blur together.
	const title = r.artistLabel ? `${r.artistLabel} — ${r.songName}` : r.songName;

	const trimmed = year.trim();
	const parsed = Number(trimmed);
	const valid = /^\d{4}$/.test(trimmed) && Number.isInteger(parsed);
	const unchanged = r.releaseYear != null && parsed === r.releaseYear;

	async function save() {
		setBusy(true);
		setError(null);
		try {
			await postJson(`/api/release-year-reviews/${r.songId}`, { year: parsed });
			setSaved(true);
			onSaved();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Card
			title="Song"
			icon={MusicNotesIcon}
			span={12}
			action={
				r.releaseYear != null ? (
					<Badge tone="success">{r.releaseYear}</Badge>
				) : (
					<Badge tone="warning">no year</Badge>
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
				<label htmlFor={`year-${r.songId}`}>Release year</label>
				<div className="btn-row">
					<input
						id={`year-${r.songId}`}
						className="input"
						inputMode="numeric"
						maxLength={4}
						placeholder="e.g. 2019"
						value={year}
						{...noAutofill}
						style={{ maxWidth: 140 }}
						onChange={(e) => {
							setYear(e.target.value.replace(/[^\d]/g, ""));
							setSaved(false);
						}}
						onKeyDown={(e) => {
							if (e.key === "Enter" && valid && !unchanged && !busy) save();
						}}
					/>
					<button
						type="button"
						className="btn primary"
						disabled={busy || !valid || unchanged}
						onClick={save}
					>
						<CheckCircleIcon size={14} weight="fill" />
						{busy ? "Saving…" : saved ? "Saved" : "Save"}
					</button>
				</div>
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
	unresolved: "No checked-but-unresolved songs — nothing to enter by hand.",
	pending: "No songs awaiting an automatic lookup.",
	set: "No songs with a release year yet.",
};

export function ReleaseYearSection({ refreshKey }: { refreshKey: number }) {
	const [filter, setFilter] = useState<Filter>("unresolved");
	const { data, error, refetch } = useApi<{
		reviews: ReleaseYearReviewRow[];
		pendingTotal: number;
		unresolvedTotal: number;
	}>(`/api/release-year-reviews?filter=${filter}`, refreshKey);

	if (error) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const { reviews, pendingTotal, unresolvedTotal } = data;

	return (
		<div className="grid">
			<Card
				title="Release year review"
				icon={CalendarBlankIcon}
				span={12}
				action={
					unresolvedTotal > 0 ? (
						<Badge tone="warning">{unresolvedTotal} to enter</Badge>
					) : (
						<Badge tone="success">all resolved</Badge>
					)
				}
			>
				<p className="muted-text">
					Liked songs are hydrated with <code>getTrack</code> during sync.{" "}
					<strong>Needs entry</strong> are songs we already checked and Spotify
					still had no usable year, plus songs outside that liked-song
					auto-lookup path (for example playlist-only songs with no current
					liker) — the real manual cases; type the correct year and save (writes
					straight to <code>song.release_year</code> on prod).{" "}
					<strong>Pending lookup</strong> ({pendingTotal}) are still actively
					liked and haven't been checked yet, so they should resolve
					automatically on a future sync. Switch to{" "}
					<strong>Recently set</strong> to spot-check or correct a captured
					year.
				</p>
				<div className="btn-row" style={{ marginTop: 12 }}>
					<button
						type="button"
						className={`btn ${filter === "unresolved" ? "primary" : ""}`}
						onClick={() => setFilter("unresolved")}
					>
						Needs entry
					</button>
					<button
						type="button"
						className={`btn ${filter === "pending" ? "primary" : ""}`}
						onClick={() => setFilter("pending")}
					>
						Pending lookup
					</button>
					<button
						type="button"
						className={`btn ${filter === "set" ? "primary" : ""}`}
						onClick={() => setFilter("set")}
					>
						Recently set
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
						<SongCard key={r.songId} r={r} onSaved={refetch} />
					))}
				</div>
			)}
		</div>
	);
}
