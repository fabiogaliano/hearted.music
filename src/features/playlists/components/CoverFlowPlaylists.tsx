import {
	ArrowRightIcon,
	MagnifyingGlassIcon,
	XIcon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import { CoverFlowShelf } from "./CoverFlowShelf";
import { PanelSection } from "./PanelSection";
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
	// Expand the guided config into local constants — production defaults are
	// explicit here and the guided path overrides only what it needs.
	const showMasthead = guided == null;
	const hideRailAdd = guided != null;
	// With zero playlists at all, the shelf's default empty copy ("add from your
	// library below") points at a library that's also empty. The masthead's
	// standing invitation is what rescues that now, so the copy only has to name
	// the state and point at it — it used to carry a Create button of its own,
	// which would sit a few rows under an identical one.
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
	const library = useMemo(
		() => playlists.filter((p) => !p.isTarget),
		[playlists],
	);

	// Search is the library's lens, not the page's: it lives on the library
	// panel's own band and filters that rail in place. It used to be a header
	// control that swapped BOTH zones for one flat results rail — a page-wide
	// mode entered from a field the size of a caption. The matching shelf holds a
	// handful of covers you can already see all of, so there was never anything
	// to find up there; the long tail is the only part that needs finding.
	const [query, setQuery] = useState("");
	const searchRef = useRef<HTMLInputElement>(null);
	const trimmedQuery = query.trim().toLowerCase();
	const isSearching = trimmedQuery.length > 0;
	const visibleLibrary = useMemo(() => {
		if (!isSearching) return library;
		return library.filter((p) =>
			`${p.name} ${p.intent ?? ""}`.toLowerCase().includes(trimmedQuery),
		);
	}, [library, isSearching, trimmedQuery]);

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
	// With the detail panel open the covers sit behind it, so h/l/Enter must do
	// nothing here. A query no longer gates them: the shelf stays on screen while
	// you search the library, and a visible shelf that silently stops answering
	// its own keys is worse than one you can still drive. Keystrokes aimed at the
	// field can't reach these anyway — KeyboardShortcutProvider drops events
	// sourced from an INPUT.
	const navEnabled = matching.length > 0 && !detailOpen;
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

	// One message for one empty panel. Searching is the first branch because a
	// no-hits panel must say the query came up empty, not that the library is —
	// the library is fine, the lens is just narrow.
	let emptyLibraryMessage: string;
	if (isSearching)
		emptyLibraryMessage = `No playlists match “${query.trim()}”.`;
	else if (matching.length > 0)
		emptyLibraryMessage = "Every playlist is in matching.";
	else emptyLibraryMessage = "No playlists yet.";

	// The band's lens. Inline rather than a component because it is nothing but
	// this component's query state wearing an input — extracting it would move
	// three props out to buy no simplification.
	//
	// Geometry and focus behaviour are LikedSongsToolbar's field verbatim: same
	// widths, same placeholder brightening, same magnifier nudge. Two searches
	// over two libraries in the same app should be one control a user learns
	// once, so this is a place to copy rather than to have an opinion. The one
	// part not copied is the accent focus line — PanelSection draws that, because
	// on a band it belongs on the band's own seam and only the band knows where
	// that is.
	const librarySearch = (
		<label className="flex items-center gap-2">
			<input
				ref={searchRef}
				type="search"
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Search"
				aria-label="Search library"
				className="peer theme-text w-32 border-0 bg-transparent pl-2 text-sm tracking-wide outline-none transition-[width] duration-200 placeholder:text-(--t-text-muted) placeholder:opacity-70 placeholder:transition-opacity placeholder:duration-200 focus:w-48 focus:placeholder:opacity-100 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
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
				// tap-40 is the one addition: a bare 12px glyph is half a target, and
				// the -4px inset stops exactly at the midpoint of the gap-2 either
				// side, so it never reaches the input's own hit area.
				className={`theme-text-muted tap-40 shrink-0 transition-opacity duration-150 ${
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
		</label>
	);

	return (
		<div className="mx-auto max-w-5xl pb-24">
			{/* items-center, not items-end: the title carries leading-[0.95], so its
			line box ends ABOVE the descender of "Playlists" — anything bottom-aligned
			to it lands visibly high, which is what the card was doing. Sharing a
			centre line instead puts the card's mass level with the word's, and holds
			at any width as text-page-title fluidly resizes. */}
			<header className="mb-2 flex items-center justify-between gap-6">
				<h1
					data-tour="page-title"
					className="theme-text text-page-title leading-[0.95] font-extralight tracking-tight text-balance"
					style={{ fontFamily: fonts.display }}
				>
					Playlists
				</h1>

				{/* The page's one act, at the weight it earns. It used to be an 11px
				muted micro-link paired with the search field — the quietest thing on a
				page of louder rows, which is why creation had drifted to living on the
				dashboard. Same plane tier, eyebrow and words as the dashboard's
				CreatePlaylistCTA, compressed to the masthead's right slot, so the two
				surfaces teach one invitation instead of two. */}
				{showMasthead && (
					<Link
						to="/playlists/new"
						className="surface-raised surface-raised-hover squircle focus-edge group flex items-center justify-between gap-6 rounded-[14px] px-5 py-3.5 motion-safe:active:scale-[0.99]"
					>
						<div>
							<p
								className="theme-text-muted text-[10px] tracking-widest uppercase"
								style={{ fontFamily: fonts.body }}
							>
								From your liked songs
							</p>
							<p
								className="theme-text mt-0.5 text-xl font-extralight"
								style={{ fontFamily: fonts.display }}
							>
								Create a playlist
							</p>
						</div>
						<span
							className="theme-text-muted inline-flex items-center gap-1.5 text-xs transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
							style={{ fontFamily: fonts.body }}
						>
							Start
							<ArrowRightIcon size={13} weight="regular" aria-hidden />
						</span>
					</Link>
				)}
			</header>

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
					emptyTitle={matchingEmptyTitle}
					emptyBody={matchingEmptyBody}
					emptyAction={guided?.matchingEmptyAction}
				/>
			</div>

			<div className="mt-6" data-tour="library">
				{/* The count is the same slot it has always been, but it is live now:
				the library's size at rest, the number of hits while you're typing
				beside it. One figure, and the field next to it explains the change. */}
				<PanelSection
					label="Library"
					count={visibleLibrary.length}
					trailing={showMasthead ? librarySearch : undefined}
				>
					{visibleLibrary.length > 0 ? (
						<div className="p-2">
							{visibleLibrary.map((playlist) => (
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
							className="theme-text-muted px-5 py-6 text-[13px]"
							style={{ fontFamily: fonts.body }}
						>
							{emptyLibraryMessage}
						</p>
					)}
				</PanelSection>
			</div>
		</div>
	);
}
