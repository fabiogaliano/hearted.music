import {
	CalendarBlankIcon,
	CheckCircleIcon,
	MusicNotesIcon,
} from "@phosphor-icons/react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Badge, Card, ErrorState, Loading } from "../components/primitives";
import { QueueToolbar } from "../components/QueueToolbar";
import { postJson, useApi } from "../lib/api";
import { noAutofill } from "../lib/form";
import { useQueueKeyboard } from "../lib/queue-keyboard";
import { useQueueState } from "../lib/queue-state";
import type { PageResult } from "../lib/types";

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
type FilterKey = "yearFrom" | "yearTo";

interface ReleaseYearPage extends PageResult<ReleaseYearReviewRow> {
	pendingTotal: number;
	unresolvedTotal: number;
}

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
			const res = await postJson<{
				releaseYear: number;
				previousYear: number | null;
				runId: string | null;
			}>(`/api/release-year-reviews/${r.songId}`, { year: parsed });
			setSaved(true);
			onSaved();
			// A correction of an existing year is reversible for a bounded window; a
			// first-time set (previousYear null) is not, since the preservation
			// trigger blocks restoring null.
			if (res.runId && res.previousYear != null) {
				const { runId, previousYear } = res;
				toast.success(`Release year set to ${res.releaseYear}`, {
					duration: 10_000,
					action: {
						label: `Revert to ${previousYear}`,
						onClick: () => {
							void postJson(`/api/release-year-reviews/${r.songId}/revert`, {
								runId,
							})
								.then(() => {
									toast.success(`Reverted to ${previousYear}`);
									onSaved();
								})
								.catch((e: unknown) =>
									toast.error(e instanceof Error ? e.message : String(e)),
								);
						},
					},
				});
			} else {
				toast.success(`Release year set to ${res.releaseYear}`);
			}
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
	const queue = useQueueState<Filter, FilterKey>({
		storageKey: "release-year",
		tabs: ["unresolved", "pending", "set"],
		defaultTab: "unresolved",
		filterKeys: ["yearFrom", "yearTo"],
		filterDefaults: { yearFrom: "", yearTo: "" },
	});
	const searchRef = useRef<HTMLInputElement>(null);

	const params = new URLSearchParams(queue.listParams);
	params.set("filter", queue.tab);
	const { data, error, loading, refreshing, refetch } = useApi<ReleaseYearPage>(
		`/api/release-year-reviews?${params.toString()}`,
		refreshKey,
	);

	const rows = data?.rows ?? [];
	const total = data?.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / queue.pageSize));

	// Keep the focused card in range as the page shrinks (after a save) or when a
	// backward page-cross overshoots a partial page. Drop to the previous page
	// when an action empties the current one.
	const { page, focusIndex, setPage, setFocusIndex } = queue;
	useEffect(() => {
		if (loading) return;
		if (rows.length === 0) {
			if (page > 1) setPage(page - 1);
			return;
		}
		if (focusIndex > rows.length - 1) {
			setFocusIndex(rows.length - 1);
		}
	}, [rows.length, loading, page, focusIndex, setPage, setFocusIndex]);

	const globalIndex = (queue.page - 1) * queue.pageSize + queue.focusIndex;
	const isFocus = queue.mode === "focus";

	function goNext() {
		if (isFocus) {
			if (queue.focusIndex < rows.length - 1) {
				queue.setFocusIndex(queue.focusIndex + 1);
			} else if (queue.page < pageCount) {
				queue.setPage(queue.page + 1);
			}
		} else if (queue.page < pageCount) {
			queue.setPage(queue.page + 1);
		}
	}
	function goPrev() {
		if (isFocus) {
			if (queue.focusIndex > 0) {
				queue.setFocusIndex(queue.focusIndex - 1);
			} else if (queue.page > 1) {
				queue.setFocusIndex(queue.pageSize - 1);
				queue.setPage(queue.page - 1);
			}
		} else if (queue.page > 1) {
			queue.setPage(queue.page - 1);
		}
	}

	useQueueKeyboard({
		onNext: goNext,
		onPrev: goPrev,
		onSearch: () => searchRef.current?.focus(),
	});

	if (error && !data) return <ErrorState message={error} />;
	if (!data) return <Loading />;

	const focusRow = rows[Math.min(queue.focusIndex, rows.length - 1)];
	const hasNext = isFocus ? globalIndex < total - 1 : queue.page < pageCount;
	const hasPrev = isFocus ? globalIndex > 0 : queue.page > 1;

	return (
		<div className="grid">
			<Card
				title="Release year review"
				icon={CalendarBlankIcon}
				span={12}
				action={
					data.unresolvedTotal > 0 ? (
						<Badge tone="warning">{data.unresolvedTotal} to enter</Badge>
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
					<strong>Pending lookup</strong> ({data.pendingTotal}) are still
					actively liked and haven't been checked yet, so they should resolve
					automatically on a future sync. Switch to{" "}
					<strong>Recently set</strong> to spot-check or correct a captured
					year.
				</p>
				<div className="btn-row" style={{ marginTop: 12 }}>
					<button
						type="button"
						className={`btn ${queue.tab === "unresolved" ? "primary" : ""}`}
						onClick={() => queue.setTab("unresolved")}
					>
						Needs entry
					</button>
					<button
						type="button"
						className={`btn ${queue.tab === "pending" ? "primary" : ""}`}
						onClick={() => queue.setTab("pending")}
					>
						Pending lookup
					</button>
					<button
						type="button"
						className={`btn ${queue.tab === "set" ? "primary" : ""}`}
						onClick={() => queue.setTab("set")}
					>
						Recently set
					</button>
				</div>
			</Card>

			<Card span={12}>
				<QueueToolbar
					searchRef={searchRef}
					search={queue.q}
					onSearchChange={queue.setSearch}
					order={queue.order}
					onOrderChange={queue.setOrder}
					mode={queue.mode}
					onModeChange={queue.setMode}
					pageSize={queue.pageSize}
					onPageSizeChange={queue.setPageSize}
					onReset={queue.reset}
					refreshing={refreshing}
					filters={
						queue.tab === "set" ? (
							<>
								<input
									className="input"
									type="number"
									aria-label="Year from"
									placeholder="Year from"
									style={{ maxWidth: 120 }}
									value={queue.filters.yearFrom}
									onChange={(e) => queue.setFilter("yearFrom", e.target.value)}
								/>
								<input
									className="input"
									type="number"
									aria-label="Year to"
									placeholder="Year to"
									style={{ maxWidth: 120 }}
									value={queue.filters.yearTo}
									onChange={(e) => queue.setFilter("yearTo", e.target.value)}
								/>
							</>
						) : undefined
					}
					total={total}
					page={queue.page}
					focusIndex={isFocus ? queue.focusIndex : undefined}
					onPrev={goPrev}
					onNext={goNext}
					hasPrev={hasPrev}
					hasNext={hasNext}
				/>
			</Card>

			{rows.length === 0 ? (
				<div className="card span-12">
					<div className="empty">
						{queue.q ? "No songs match your search." : EMPTY_COPY[queue.tab]}
					</div>
				</div>
			) : isFocus ? (
				focusRow && (
					<div className="ar-list span-12">
						<SongCard key={focusRow.songId} r={focusRow} onSaved={refetch} />
					</div>
				)
			) : (
				<div className="ar-list span-12">
					{rows.map((r) => (
						<SongCard key={r.songId} r={r} onSaved={refetch} />
					))}
				</div>
			)}
		</div>
	);
}
