import {
	ArrowSquareOutIcon,
	CalendarBlankIcon,
	CheckCircleIcon,
	InfoIcon,
	MusicNotesIcon,
	VinylRecordIcon,
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

interface ReleaseYearGroupSong {
	songId: string;
	songName: string;
	artistLabel: string;
	imageUrl: string | null;
}

interface ReleaseYearGroupRow {
	albumId: string;
	albumName: string | null;
	artistLabel: string;
	artistCount: number;
	imageUrl: string | null;
	songCount: number;
	firstCreatedAt: string;
	songs: ReleaseYearGroupSong[];
}

// Mirror of server/release-year-fetch.ts YearCandidate.
interface YearCandidate {
	source: "itunes" | "deezer";
	year: number;
	releaseDate: string | null;
	albumName: string;
	artistName: string;
	similarity: number;
}

interface AlbumCandidatesEntry {
	fetchedAt: string;
	candidates: YearCandidate[];
}

interface AlbumCandidatesResult {
	candidates: Record<string, AlbumCandidatesEntry>;
	remaining: string[];
	throttled: boolean;
}

// Below this the best external match is probably a different record, so it may
// suggest but never silently prefill. Mirrors the server's CONFIDENT_SIMILARITY.
const CONFIDENT_SIMILARITY = 0.65;

type Filter = "unresolved" | "pending" | "set";
type FilterKey = "yearFrom" | "yearTo";
type Shape = "albums" | "songs";

interface ReleaseYearPage extends PageResult<ReleaseYearReviewRow> {
	pendingTotal: number;
	unresolvedTotal: number;
}

interface ReleaseYearGroupsPage extends PageResult<ReleaseYearGroupRow> {
	songTotal: number;
	pendingTotal: number;
	unresolvedTotal: number;
}

// Same durable-preference treatment as the queue's focus/list mode: which shape
// the operator drains in is not investigation state, so it skips the URL.
const SHAPE_STORAGE_KEY =
	"hearted-control-panel.review-preferences.v1.release-year.shape";

function readShape(): Shape {
	try {
		return window.localStorage.getItem(SHAPE_STORAGE_KEY) === "songs"
			? "songs"
			: "albums";
	} catch {
		return "albums";
	}
}

/**
 * Trickle-fetches external year candidates for the albums on screen. The server
 * caps fetches per call and hands back the remainder, so this chains requests
 * until the page is covered — unless the upstream throttles, in which case it
 * stops and waits for a deliberate retry instead of hammering.
 */
function useYearCandidates(albumIds: string[]) {
	const [entries, setEntries] = useState<Record<string, AlbumCandidatesEntry>>(
		{},
	);
	const [stalled, setStalled] = useState(false);
	const requested = useRef(new Set<string>());
	const [tick, setTick] = useState(0);

	const key = albumIds.join(",");
	// biome-ignore lint/correctness/useExhaustiveDependencies: key stands in for albumIds' contents; tick re-arms after a manual retry
	useEffect(() => {
		const missing = albumIds.filter((id) => !requested.current.has(id));
		if (missing.length === 0) return;
		for (const id of missing) requested.current.add(id);
		const unresolved = new Set(missing);
		let cancelled = false;
		(async () => {
			let ids = missing;
			while (!cancelled && ids.length > 0) {
				let res: AlbumCandidatesResult;
				try {
					res = await postJson<AlbumCandidatesResult>(
						"/api/release-year-reviews/candidates",
						{ albumIds: ids },
					);
				} catch {
					if (!cancelled) {
						for (const id of ids) requested.current.delete(id);
						setStalled(true);
					}
					return;
				}
				if (cancelled) return;
				const remaining = new Set(res.remaining);
				for (const id of ids) {
					if (!remaining.has(id)) unresolved.delete(id);
				}
				setEntries((prev) => ({ ...prev, ...res.candidates }));
				if (res.throttled) {
					for (const id of res.remaining) requested.current.delete(id);
					setStalled(true);
					return;
				}
				ids = res.remaining;
			}
		})();
		return () => {
			cancelled = true;
			for (const id of unresolved) requested.current.delete(id);
		};
	}, [key, tick]);

	const retry = () => {
		setStalled(false);
		setTick((t) => t + 1);
	};

	return { entries, stalled, retry };
}

function externalLinks(g: ReleaseYearGroupRow) {
	const name = g.albumName ?? g.songs[0]?.songName ?? "";
	const artist = g.artistCount > 1 ? "" : (g.artistLabel.split(",")[0] ?? "");
	const q = encodeURIComponent(`${artist} ${name}`.trim());
	return [
		{ label: "Spotify", href: `https://open.spotify.com/album/${g.albumId}` },
		{
			label: "Google",
			href: `https://www.google.com/search?q=${encodeURIComponent(`${artist} ${name} release year`.trim())}`,
		},
		{
			label: "MusicBrainz",
			href: `https://musicbrainz.org/search?query=${q}&type=release`,
		},
		{
			// Sorted oldest-first so the original release (the year we want) tops the
			// list ahead of reissues and represses.
			label: "Discogs",
			href: `https://www.discogs.com/search/?q=${q}&type=release&sort=year%2Casc&page=1`,
		},
	];
}

/**
 * One member song inside an expanded group: full identity (cover, artist,
 * title) plus its own year field. On compilations the members can genuinely
 * deserve different years — set the outliers here first, then the group save
 * sweeps up the rest (it only ever touches songs still missing a year).
 */
function GroupSongRow({
	s,
	albumName,
	onSaved,
}: {
	s: ReleaseYearGroupSong;
	albumName: string | null;
	onSaved: () => void;
}) {
	const [year, setYear] = useState("");
	const [busy, setBusy] = useState(false);
	const valid = /^\d{4}$/.test(year.trim());

	async function save() {
		setBusy(true);
		try {
			const res = await postJson<{ releaseYear: number }>(
				`/api/release-year-reviews/${s.songId}`,
				{ year: Number(year.trim()) },
			);
			toast.success(`${res.releaseYear} · ${s.songName}`);
			onSaved();
		} catch (e) {
			toast.error(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<li className="ry-song-row">
			{s.imageUrl ? (
				<img className="ry-song-thumb" src={s.imageUrl} alt="" loading="lazy" />
			) : (
				<span className="ry-song-thumb placeholder" />
			)}
			<span className="ry-song-body">
				<span className="ry-song-title">
					{s.artistLabel ? `${s.artistLabel} — ${s.songName}` : s.songName}
				</span>
				<span className="ry-song-sub">{albumName ?? "—"}</span>
			</span>
			<span className="ry-song-actions">
				<input
					className="input"
					inputMode="numeric"
					maxLength={4}
					placeholder="year"
					aria-label={`Release year for ${s.songName}`}
					value={year}
					{...noAutofill}
					onChange={(e) => setYear(e.target.value.replace(/[^\d]/g, ""))}
					onKeyDown={(e) => {
						if (e.key === "Enter" && valid && !busy) save();
						if (e.key === "Escape") e.currentTarget.blur();
					}}
				/>
				<button
					type="button"
					className="btn mini"
					disabled={busy || !valid}
					onClick={save}
				>
					{busy ? "…" : "Set"}
				</button>
			</span>
		</li>
	);
}

function AlbumCard({
	g,
	entry,
	onSaved,
	solo,
}: {
	g: ReleaseYearGroupRow;
	entry: AlbumCandidatesEntry | undefined;
	onSaved: () => void;
	solo: boolean;
}) {
	const [year, setYear] = useState("");
	// Once the operator touches the field, candidate arrival must never overwrite it.
	const [dirty, setDirty] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const best = entry?.candidates[0];
	const confident =
		best !== undefined && best.similarity >= CONFIDENT_SIMILARITY;
	useEffect(() => {
		if (!dirty && confident && best) setYear(String(best.year));
	}, [confident, best, dirty]);

	const trimmed = year.trim();
	const valid = /^\d{4}$/.test(trimmed);

	const artist =
		g.artistCount > 1
			? `${g.artistLabel.split(",")[0]?.trim() ?? ""} +${g.artistCount - 1} more`
			: g.artistLabel;

	async function save() {
		setBusy(true);
		setError(null);
		try {
			const res = await postJson<{
				releaseYear: number;
				songCount: number;
				albumName: string | null;
			}>(`/api/release-year-reviews/album/${g.albumId}`, {
				year: Number(trimmed),
			});
			toast.success(
				`${res.releaseYear} → ${res.songCount} song${res.songCount === 1 ? "" : "s"} · ${res.albumName ?? "album"}`,
			);
			onSaved();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		} finally {
			setBusy(false);
		}
	}

	return (
		<Card
			title="Album"
			icon={VinylRecordIcon}
			span={12}
			action={
				g.songCount > 1 ? (
					<Badge tone="accent">{g.songCount} songs</Badge>
				) : (
					<Badge tone="warning">1 song</Badge>
				)
			}
		>
			<div className="rv-sparse">
				<div className="ar-panel">
					{g.imageUrl ? (
						<img
							className="ar-art cover"
							src={g.imageUrl}
							alt=""
							loading="lazy"
						/>
					) : (
						<span className="ar-art cover placeholder" />
					)}
					<div className="ar-body">
						<div className="ar-title">{g.albumName ?? "(no album name)"}</div>
						<div className="ar-sub">{artist || "—"}</div>
					</div>
				</div>

				{g.songCount === 1 ? (
					<div className="ry-songs">
						<MusicNotesIcon size={12} weight="bold" />{" "}
						{g.songs[0]?.artistLabel
							? `${g.songs[0].artistLabel} — ${g.songs[0].songName}`
							: g.songs[0]?.songName}
					</div>
				) : (
					<details className="ry-songs">
						<summary>
							<MusicNotesIcon size={12} weight="bold" /> {g.songCount} songs get
							this year — expand to set outliers individually
						</summary>
						<ul className="ry-song-list">
							{g.songs.map((s) => (
								<GroupSongRow
									key={s.songId}
									s={s}
									albumName={g.albumName}
									onSaved={onSaved}
								/>
							))}
						</ul>
					</details>
				)}

				<div className="field" style={{ marginTop: 12 }}>
					<label htmlFor={`ry-year-${g.albumId}`}>Release year</label>
					<div className="btn-row">
						<input
							id={`ry-year-${g.albumId}`}
							className="input"
							inputMode="numeric"
							maxLength={4}
							placeholder="e.g. 2019"
							value={year}
							{...noAutofill}
							// In focus mode the field is pre-focused with the prefill
							// selected, so the whole interaction is Enter (accept) or
							// type-over (correct) — Escape releases the keys to J/K.
							// biome-ignore lint/a11y/noAutofocus: solo focus-mode is the intended keyboard entry point
							autoFocus={solo}
							onFocus={(e) => e.currentTarget.select()}
							style={{ maxWidth: 140 }}
							onChange={(e) => {
								setYear(e.target.value.replace(/[^\d]/g, ""));
								setDirty(true);
							}}
							onKeyDown={(e) => {
								if (e.key === "Enter" && valid && !busy) save();
								if (e.key === "Escape") e.currentTarget.blur();
							}}
						/>
						<button
							type="button"
							className="btn primary"
							disabled={busy || !valid}
							onClick={save}
						>
							<CheckCircleIcon size={14} weight="fill" />
							{busy
								? "Saving…"
								: g.songCount > 1
									? `Save → ${g.songCount} songs`
									: "Save"}
						</button>
					</div>
				</div>

				{entry === undefined ? (
					<div className="ry-cands muted-text">Looking up year…</div>
				) : entry.candidates.length === 0 ? (
					<div className="ry-cands muted-text">
						No match on iTunes/Deezer — check a source below.
					</div>
				) : (
					<div className="ry-cands">
						{entry.candidates.map((c) => (
							<button
								type="button"
								key={`${c.source}-${c.albumName}-${c.artistName}-${c.releaseDate ?? ""}`}
								className={c.similarity >= CONFIDENT_SIMILARITY ? "on" : ""}
								title={`${c.albumName} — ${c.artistName}${c.releaseDate ? ` (${c.releaseDate.slice(0, 10)})` : ""}`}
								onClick={() => {
									setYear(String(c.year));
									setDirty(true);
								}}
							>
								<span className="num">{c.year}</span>
								{c.source === "itunes" ? "iTunes" : "Deezer"}
								<span className="num">{Math.round(c.similarity * 100)}%</span>
							</button>
						))}
					</div>
				)}

				<div className="ry-links">
					{externalLinks(g).map((l) => (
						<a
							key={l.label}
							className="btn mini"
							href={l.href}
							target="_blank"
							rel="noreferrer"
						>
							<ArrowSquareOutIcon size={12} weight="bold" /> {l.label}
						</a>
					))}
				</div>

				{error && (
					<div className="result err" style={{ marginTop: 10 }}>
						{error}
					</div>
				)}
			</div>
		</Card>
	);
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
			<div className="rv-sparse">
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
			</div>
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
	const [shape, setShapeState] = useState<Shape>(readShape);
	const setShape = (next: Shape) => {
		setShapeState(next);
		try {
			window.localStorage.setItem(SHAPE_STORAGE_KEY, next);
		} catch {
			// A private-mode localStorage failure shouldn't break the toggle.
		}
	};

	const isAlbums = queue.tab === "unresolved" && shape === "albums";

	const params = new URLSearchParams(queue.listParams);
	params.set("filter", queue.tab);
	const path = isAlbums
		? `/api/release-year-reviews/groups?${queue.listParams.toString()}`
		: `/api/release-year-reviews?${params.toString()}`;
	const { data, error, loading, refreshing, refetch } = useApi<
		ReleaseYearPage | ReleaseYearGroupsPage
	>(path, refreshKey);

	const groupsData = isAlbums ? (data as ReleaseYearGroupsPage | null) : null;
	const songsData = isAlbums ? null : (data as ReleaseYearPage | null);
	const groupRows = groupsData?.rows ?? [];
	const songRows = songsData?.rows ?? [];
	const rowCount = isAlbums ? groupRows.length : songRows.length;
	const total = data?.total ?? 0;
	const pageCount = Math.max(1, Math.ceil(total / queue.pageSize));

	const { entries, stalled, retry } = useYearCandidates(
		groupRows.map((g) => g.albumId),
	);

	// Keep the focused card in range as the page shrinks (after a save) or when a
	// backward page-cross overshoots a partial page. Drop to the previous page
	// when an action empties the current one.
	const { page, focusIndex, setPage, setFocusIndex } = queue;
	useEffect(() => {
		if (loading) return;
		if (rowCount === 0) {
			if (page > 1) setPage(page - 1);
			return;
		}
		if (focusIndex > rowCount - 1) {
			setFocusIndex(rowCount - 1);
		}
	}, [rowCount, loading, page, focusIndex, setPage, setFocusIndex]);

	const globalIndex = (queue.page - 1) * queue.pageSize + queue.focusIndex;
	const isFocus = queue.mode === "focus";

	function goNext() {
		if (isFocus) {
			if (queue.focusIndex < rowCount - 1) {
				queue.setFocusIndex(queue.focusIndex + 1);
			} else if (queue.page < pageCount) {
				queue.setFocusIndex(0);
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

	const hasNext = isFocus ? globalIndex < total - 1 : queue.page < pageCount;
	const hasPrev = isFocus ? globalIndex > 0 : queue.page > 1;
	const focusGroup =
		groupRows[Math.min(queue.focusIndex, groupRows.length - 1)];
	const focusSong = songRows[Math.min(queue.focusIndex, songRows.length - 1)];

	return (
		<div className="queue-page">
			<div className="card queue-head span-12">
				<CalendarBlankIcon className="icon" size={15} weight="bold" />
				<h2>Release year review</h2>
				<details className="queue-info">
					<summary aria-label="About this queue">
						<InfoIcon size={15} weight="bold" />
					</summary>
					<div className="queue-info-panel">
						<strong>Needs entry</strong> — songs Spotify's auto-lookup can't
						reach, grouped by album: a song's release year is its album's
						release date, so one save clears every song in the group. Years are
						prefilled from iTunes/Deezer when the match is confident — in focus
						mode just press Enter to accept, or type over to correct (Escape
						frees J/K). <strong>Pending lookup</strong> songs should resolve on
						a future sync. <strong>Recently set</strong> is for spot-checks and
						corrections.
					</div>
				</details>
				<div className="queue-head-tabs">
					<button
						type="button"
						className={`btn ${queue.tab === "unresolved" ? "primary" : ""}`}
						onClick={() => queue.setTab("unresolved")}
					>
						Needs entry · {data.unresolvedTotal}
					</button>
					<button
						type="button"
						className={`btn ${queue.tab === "pending" ? "primary" : ""}`}
						onClick={() => queue.setTab("pending")}
					>
						Pending lookup · {data.pendingTotal}
					</button>
					<button
						type="button"
						className={`btn ${queue.tab === "set" ? "primary" : ""}`}
						onClick={() => queue.setTab("set")}
					>
						Recently set
					</button>
				</div>
				{queue.tab === "unresolved" && (
					// biome-ignore lint/a11y/useSemanticElements: styled button toggle group, not a form fieldset
					<div
						className="queue-head-tabs ry-shape"
						role="group"
						aria-label="Group by"
					>
						<button
							type="button"
							className={`btn ${shape === "albums" ? "primary" : ""}`}
							aria-pressed={shape === "albums"}
							onClick={() => setShape("albums")}
						>
							<VinylRecordIcon size={13} weight="bold" /> Albums
							{groupsData ? ` · ${groupsData.total}` : ""}
						</button>
						<button
							type="button"
							className={`btn ${shape === "songs" ? "primary" : ""}`}
							aria-pressed={shape === "songs"}
							onClick={() => setShape("songs")}
						>
							<MusicNotesIcon size={13} weight="bold" /> Songs
						</button>
					</div>
				)}
				{data.unresolvedTotal > 0 ? (
					<Badge tone="warning">{data.unresolvedTotal} to enter</Badge>
				) : (
					<Badge tone="success">all resolved</Badge>
				)}
			</div>

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
				activeFilterCount={queue.activeFilterCount}
				filters={
					queue.tab === "set" ? (
						<>
							<input
								className="input"
								type="number"
								aria-label="Year from"
								placeholder="Year from"
								value={queue.filters.yearFrom}
								onChange={(e) => queue.setFilter("yearFrom", e.target.value)}
							/>
							<input
								className="input"
								type="number"
								aria-label="Year to"
								placeholder="Year to"
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

			{stalled && isAlbums && (
				<div className="card span-12 ry-stalled">
					<span className="muted-text">
						Year lookups paused — the external source is rate-limiting.
					</span>
					<button type="button" className="btn mini" onClick={retry}>
						Resume lookups
					</button>
				</div>
			)}

			{rowCount === 0 ? (
				<div className="card span-12">
					<div className="empty">
						{queue.q ? "No songs match your search." : EMPTY_COPY[queue.tab]}
					</div>
				</div>
			) : isAlbums ? (
				isFocus ? (
					focusGroup && (
						<div className="ar-list solo span-12">
							<AlbumCard
								key={focusGroup.albumId}
								g={focusGroup}
								entry={entries[focusGroup.albumId]}
								onSaved={refetch}
								solo
							/>
						</div>
					)
				) : (
					<div className="ar-list span-12">
						{groupRows.map((g) => (
							<AlbumCard
								key={g.albumId}
								g={g}
								entry={entries[g.albumId]}
								onSaved={refetch}
								solo={false}
							/>
						))}
					</div>
				)
			) : isFocus ? (
				focusSong && (
					<div className="ar-list solo span-12">
						<SongCard key={focusSong.songId} r={focusSong} onSaved={refetch} />
					</div>
				)
			) : (
				<div className="ar-list span-12">
					{songRows.map((r) => (
						<SongCard key={r.songId} r={r} onSaved={refetch} />
					))}
				</div>
			)}
		</div>
	);
}
