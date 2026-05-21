import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";
import { useRef } from "react";

import { Button } from "@/components/ui/Button";
import type { LikedSongsStatsResult } from "@/lib/server/liked-songs.functions";
import { fonts } from "@/lib/theme/fonts";

import type { SearchFilter } from "../filter";
import { SEARCH_FILTER_VALUES } from "../filter";

interface LikedSongsHeaderProps {
	stats: LikedSongsStatsResult | undefined;
	lockedSongCount: number;
	showSelectionUI: boolean;
	selectionMode: boolean;
	activeFilter: SearchFilter;
	onFilterChange: (filter: SearchFilter) => void;
	onEnterSelectionMode: () => void;
	searchQuery: string;
	onSearchChange: (value: string) => void;
}

const FILTER_LABELS: Record<SearchFilter, string> = {
	all: "All",
	pending: "Pending",
	analyzed: "Unlocked",
	locked: "Locked",
};

export function LikedSongsHeader({
	stats,
	lockedSongCount,
	showSelectionUI,
	selectionMode,
	activeFilter,
	onFilterChange,
	onEnterSelectionMode,
	searchQuery,
	onSearchChange,
}: LikedSongsHeaderProps) {
	const statsReady = stats?.success === true;
	const total = statsReady ? stats.total : null;
	const counts: Record<SearchFilter, number | null> = {
		all: total,
		pending: statsReady ? stats.pending : null,
		analyzed: statsReady ? stats.analyzed : null,
		locked: statsReady ? stats.locked : null,
	};

	const searchInputRef = useRef<HTMLInputElement>(null);
	const visibleFilters = SEARCH_FILTER_VALUES.filter((value) => {
		// Keep the active filter visible even if its count is 0 so the user
		// can always navigate back to "All".
		if (value === activeFilter) return true;
		// Hide Pending when there's nothing pending — the tab adds noise
		// in the steady state where everything has been processed.
		if (value === "pending" && statsReady && stats.pending === 0) return false;
		// Hide Locked when the user has access to everything — no filter target.
		if (value === "locked" && statsReady && stats.locked === 0) return false;
		return true;
	});

	const showUnlockAction =
		showSelectionUI && lockedSongCount > 0 && !selectionMode;

	return (
		<header className="mb-8">
			<p
				className="theme-text-muted text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Library
			</p>

			<div className="mt-3 flex items-end justify-between gap-6">
				<h1
					className="theme-text flex items-baseline gap-4 font-extralight tracking-tight leading-[0.95]"
					style={{ fontFamily: fonts.display }}
					aria-label={
						total != null ? `Liked Songs, ${total} total` : "Liked Songs"
					}
				>
					<span className="text-page-title">Liked Songs</span>
					<span
						aria-hidden="true"
						className="theme-text-muted text-3xl tabular-nums opacity-60"
					>
						{total ?? "—"}
					</span>
				</h1>

				{showUnlockAction && (
					<Button
						variant="surface"
						onClick={onEnterSelectionMode}
						className="hidden sm:inline-flex"
						style={{ fontFamily: fonts.body }}
					>
						Unlock Songs
					</Button>
				)}
			</div>

			<div className="theme-border-color mt-10 flex items-end gap-6 border-b">
				<nav aria-label="Filter liked songs" className="flex items-end gap-6">
					{visibleFilters.map((value) => {
						const isActive = value === activeFilter;
						const count = counts[value];
						return (
							<button
								key={value}
								type="button"
								onClick={() => onFilterChange(value)}
								aria-pressed={isActive}
								className={`relative -mb-px min-w-[6rem] cursor-pointer border-b px-2 py-1.5 text-center transition-[color,border-color] duration-150 ${
									isActive
										? "theme-text border-(--t-primary)"
										: "theme-text-muted border-transparent hover:text-(--t-text)"
								}`}
								style={{ fontFamily: fonts.body }}
							>
								<span className="text-sm tracking-wide">
									{FILTER_LABELS[value]}
								</span>
								{value !== "all" && (
									<span
										className={`ml-1.5 text-xs tabular-nums ${
											isActive ? "theme-text-muted" : "opacity-60"
										}`}
									>
										{count ?? "—"}
									</span>
								)}
							</button>
						);
					})}
				</nav>

				<label className="relative ml-auto flex items-center gap-2 pb-2.5">
					<input
						ref={searchInputRef}
						type="search"
						value={searchQuery}
						onChange={(event) => onSearchChange(event.target.value)}
						placeholder="Search"
						aria-label="Search liked songs"
						className="peer theme-text w-32 border-0 bg-transparent pl-2 text-sm tracking-wide outline-none transition-[width] duration-200 placeholder:text-(--t-text-muted) placeholder:opacity-70 placeholder:transition-opacity placeholder:duration-200 focus:w-48 focus:placeholder:opacity-100 [&::-webkit-search-cancel-button]:appearance-none [&::-webkit-search-decoration]:appearance-none"
						style={{ fontFamily: fonts.body }}
					/>
					<button
						type="button"
						onClick={() => {
							onSearchChange("");
							searchInputRef.current?.focus();
						}}
						aria-label="Clear search"
						aria-hidden={searchQuery.length === 0}
						tabIndex={searchQuery.length === 0 ? -1 : 0}
						className={`theme-text-muted shrink-0 transition-opacity duration-150 ${
							searchQuery.length > 0
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
		</header>
	);
}
