import { MagnifyingGlassIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import { CoverFlowShelf } from "./CoverFlowShelf";
import { RailRow } from "./RailRow";
import type { GuidedPlaylistsConfig, PlaylistSummary } from "./types";

interface CoverFlowPlaylistsProps {
	playlists: PlaylistSummary[];
	onOpen?: (id: string) => void;
	onAdd?: (id: string) => void;
	onRemove?: (id: string) => void;
	/**
	 * The Spotlight detail panel is open (route is /playlists/$playlistRef). The
	 * cover flow stays mounted behind it, so keyboard nav must stand down — h/l
	 * would otherwise slide the covers around underneath the open panel.
	 */
	detailOpen?: boolean;
	/** Onboarding rehearsal config. Presence activates guided mode; absence =
	 *  production defaults. See GuidedPlaylistsConfig for the full contract. */
	guided?: GuidedPlaylistsConfig;
}

/**
 * The CoverFlow listing: the Matching shelf stays a full-width cover flow up top —
 * the page's hero, for the handful that matter — while the Library drops below it
 * to a calm, scannable rail of rows. The "integrated but spatially distinct"
 * separation model: cover flow for the few, a list for the long tail. Both
 * sections are titled as editorial "chapters" — label left, count floated to the
 * far end of a hairline rule. Keyboard drives the cover flow via the app's
 * shortcut system (←/→ or h/l to move, Enter to open the centred candidate).
 */
export function CoverFlowPlaylists({
	playlists,
	onOpen = () => {},
	onAdd = () => {},
	onRemove = () => {},
	detailOpen = false,
	guided,
}: CoverFlowPlaylistsProps) {
	const navigate = useNavigate();

	// Expand the guided config into local constants — production defaults are
	// explicit here and the guided path overrides only what it needs.
	const showSearch = guided == null;
	const hideRailAdd = guided != null;
	// With zero playlists at all, the shelf's default empty copy ("add from your
	// library below") points at a library that's also empty — a dead end for the
	// user who needs creation most. Swap in a create-first invitation instead.
	// Guided mode keeps its own copy; other cases keep the shelf defaults.
	const noPlaylistsAtAll = guided == null && playlists.length === 0;
	const matchingEmptyTitle =
		guided?.matchingEmptyTitle ??
		(noPlaylistsAtAll ? "No playlists yet" : undefined);
	const matchingEmptyBody =
		guided?.matchingEmptyBody ??
		(noPlaylistsAtAll
			? "Start one from your liked songs — hearted drafts it, you curate it."
			: undefined);
	const matchingEmptyAction =
		guided?.matchingEmptyAction ??
		(noPlaylistsAtAll ? (
			<Button
				variant="secondary"
				size="sm"
				onClick={() => void navigate({ to: "/playlists/new" })}
			>
				Create playlist
			</Button>
		) : undefined);
	const library = playlists.filter((p) => !p.isTarget);

	// Searching collapses the two-zone layout into one flat rail across the whole
	// library — the cover flow is a browsing affordance, useless once you know what
	// you're after. Matching state still reads from each row's add/remove action.
	const [query, setQuery] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);
	const trimmedQuery = query.trim().toLowerCase();
	const isSearching = trimmedQuery.length > 0;
	const searchResults = useMemo(() => {
		if (!isSearching) return [];
		return playlists.filter((p) =>
			`${p.name} ${p.intent ?? ""}`.toLowerCase().includes(trimmedQuery),
		);
	}, [playlists, isSearching, trimmedQuery]);

	// The matching shelf is ordered by when each playlist was added, not by the
	// underlying library order — otherwise adding one out of sequence would slot its
	// cover into the middle and shove the others around. Newly added ids append to
	// the end; ids already matching at mount keep their original relative order.
	const [order, setOrder] = useState<string[]>(() =>
		playlists.flatMap((p) => (p.isTarget ? [p.id] : [])),
	);
	const matching = useMemo(() => {
		const rank = new Map(order.map((id, index) => [id, index]));
		return playlists
			.filter((p) => p.isTarget)
			.sort(
				(a, b) =>
					(rank.get(a.id) ?? Number.POSITIVE_INFINITY) -
					(rank.get(b.id) ?? Number.POSITIVE_INFINITY),
			);
	}, [playlists, order]);

	const [center, setCenter] = useState(0);
	const max = Math.max(0, matching.length - 1);
	const clampCenter = (next: number) =>
		setCenter(Math.max(0, Math.min(max, next)));

	// The just-added id, so its sleeve flies in instead of popping. Cleared once the
	// enter animation has played so a later re-render doesn't re-trigger it.
	const [enteringId, setEnteringId] = useState<string | null>(null);
	const enterTimer = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (enterTimer.current) window.clearTimeout(enterTimer.current);
		},
		[],
	);

	// Adding appends the playlist to the end of the matching order and glides the
	// flow to it — so it always enters at a predictable spot (the end) rather than
	// reshuffling the existing covers. Its new slot is the current matching count.
	const handleAdd = (id: string) => {
		onAdd(id);
		setOrder((prev) => [...prev.filter((x) => x !== id), id]);
		setCenter(matching.length);
		setEnteringId(id);
		if (enterTimer.current) window.clearTimeout(enterTimer.current);
		enterTimer.current = window.setTimeout(() => setEnteringId(null), 480);
	};

	// Keyboard nav drives the matching cover flow through the shared shortcut
	// registry (scope "matching"), so ←/→ and the Vim h/l pair stay in sync with
	// the wheel / drag / click nav the shelf owns, and show up in the ? help modal.
	const goPrev = () => clampCenter(center - 1);
	const goNext = () => clampCenter(center + 1);
	const openCentered = () => {
		const playlist = matching[Math.min(center, matching.length - 1)];
		if (playlist) onOpen(playlist.id);
	};
	// Only the bare /playlists list drives the cover flow. While searching, the
	// shelf is swapped for a flat results rail; with the detail panel open the
	// covers sit behind it — in both cases h/l/Enter must do nothing here.
	const navEnabled = matching.length > 0 && !isSearching && !detailOpen;
	useShortcut({
		key: "left",
		handler: goPrev,
		description: "Previous candidate",
		scope: "matching",
		category: "navigation",
		enabled: navEnabled,
	});
	useShortcut({
		key: "h",
		handler: goPrev,
		description: "Previous candidate",
		scope: "matching",
		category: "navigation",
		enabled: navEnabled,
	});
	useShortcut({
		key: "right",
		handler: goNext,
		description: "Next candidate",
		scope: "matching",
		category: "navigation",
		enabled: navEnabled,
	});
	useShortcut({
		key: "l",
		handler: goNext,
		description: "Next candidate",
		scope: "matching",
		category: "navigation",
		enabled: navEnabled,
	});
	useShortcut({
		key: "enter",
		handler: openCentered,
		description: "Open candidate",
		scope: "matching",
		category: "actions",
		enabled: navEnabled,
		// Don't hijack Enter when a real control is focused (a RailRow's Add/Remove,
		// the playlist-name link) — let that button do its own job.
		shouldHandle: () => {
			const el = document.activeElement;
			if (!el || el === document.body) return true;
			return !(
				el.tagName === "BUTTON" ||
				el.tagName === "A" ||
				el.getAttribute("role") === "button"
			);
		},
	});

	return (
		<div className="mx-auto max-w-5xl pb-24">
			<header className="mb-2 flex items-end justify-between gap-6">
				<h1
					data-tour="page-title"
					className="theme-text text-page-title leading-[0.95] font-extralight tracking-tight text-balance"
					style={{ fontFamily: fonts.display }}
				>
					Playlists
				</h1>

				{showSearch && (
					<div className="flex items-center gap-6 pb-2.5">
						<button
							type="button"
							onClick={() => void navigate({ to: "/playlists/new" })}
							className="theme-text-muted inline-flex cursor-pointer items-center gap-1.5 text-[11px] tracking-widest uppercase transition-opacity duration-150 hover:opacity-70"
							style={{ fontFamily: fonts.body }}
						>
							<PlusIcon size={11} weight="regular" aria-hidden />
							Create playlist
						</button>
						<label className="relative flex items-center gap-2">
							<input
								ref={searchRef}
								type="search"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Search"
								aria-label="Search playlists"
								className="peer theme-text w-24 border-0 bg-transparent pl-2 text-sm tracking-wide outline-none transition-[width] duration-200 placeholder:text-(--t-text-muted) placeholder:opacity-70 placeholder:transition-opacity placeholder:duration-200 focus:w-32 focus:placeholder:opacity-100 sm:w-32 sm:focus:w-48 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
								style={{ fontFamily: fonts.body }}
							/>
							<button
								type="button"
								onClick={() => {
									setQuery("");
									searchRef.current?.focus();
								}}
								aria-label="Clear search"
								aria-hidden={query.length === 0}
								tabIndex={query.length === 0 ? -1 : 0}
								className={`theme-text-muted shrink-0 transition-opacity duration-150 ${
									query.length > 0
										? "cursor-pointer opacity-70 hover:opacity-100"
										: "pointer-events-none opacity-0"
								}`}
							>
								<XIcon size={12} weight="regular" />
							</button>
							<MagnifyingGlassIcon
								size={13}
								weight="regular"
								className="theme-text-muted shrink-0 transition-[color,transform] duration-200 peer-focus:scale-110 peer-focus:text-(--t-text)"
							/>
							<span
								aria-hidden="true"
								className="theme-primary-bg pointer-events-none absolute inset-x-0 -bottom-px h-px opacity-0 transition-opacity duration-200 peer-focus:opacity-100"
							/>
						</label>
					</div>
				)}
			</header>

			{isSearching ? (
				<section className="mt-8">
					{searchResults.length > 0 ? (
						<div className="mt-4">
							{searchResults.map((playlist) => (
								<RailRow
									key={playlist.id}
									playlist={playlist}
									onOpen={onOpen}
									onAdd={handleAdd}
									onRemove={onRemove}
									hideAdd={hideRailAdd}
								/>
							))}
						</div>
					) : (
						<p
							className="theme-text-muted py-6 text-[13px]"
							style={{ fontFamily: fonts.body }}
						>
							No playlists match “{query.trim()}”.
						</p>
					)}
				</section>
			) : (
				<>
					{/* data-tour marks onboarding spotlight targets; inert in production. */}
					<div data-tour="matching">
						<CoverFlowShelf
							label="Matching candidates"
							playlists={matching}
							center={center}
							onCenterChange={clampCenter}
							onActivate={() => {}}
							onOpen={onOpen}
							onAdd={handleAdd}
							onRemove={onRemove}
							enterId={enteringId}
							chrome="chapter"
							emptyTitle={matchingEmptyTitle}
							emptyBody={matchingEmptyBody}
							emptyAction={matchingEmptyAction}
						/>
					</div>

					<section className="mt-8" data-tour="library">
						<div className="flex items-center gap-4 px-1">
							<span
								className="theme-text-muted text-xs tracking-[0.2em] uppercase"
								style={{ fontFamily: fonts.body }}
							>
								Library
							</span>
							<div className="theme-border-color h-px flex-1 self-center border-t" />
							<span
								className="theme-text-muted text-xs tabular-nums"
								style={{ fontFamily: fonts.body }}
							>
								{library.length}
							</span>
						</div>

						<div className="mt-4">
							{library.length > 0 ? (
								library.map((playlist) => (
									<RailRow
										key={playlist.id}
										playlist={playlist}
										onOpen={onOpen}
										onAdd={handleAdd}
										onRemove={onRemove}
										hideAdd={hideRailAdd}
									/>
								))
							) : (
								<p
									className="theme-text-muted py-6 text-[13px]"
									style={{ fontFamily: fonts.body }}
								>
									{matching.length > 0
										? "Every playlist is in matching."
										: "No playlists yet."}
								</p>
							)}
						</div>
					</section>
				</>
			)}
		</div>
	);
}
