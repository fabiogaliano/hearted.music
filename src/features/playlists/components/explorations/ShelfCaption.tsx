import { ArrowUpRightIcon, CheckIcon, MinusIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";
import { InfoTip } from "./InfoTip";
import { isMatchable, type PlaylistSummary, playlistPurpose } from "./types";

interface ShelfCaptionProps {
	playlist: PlaylistSummary;
	onOpen: (id: string) => void;
	onAdd: (id: string) => void;
	onRemove: (id: string) => void;
	/** Drift the name's arrow when the cover (or the name) is hovered. */
	openActive?: boolean;
	onOpenHoverChange?: (hovered: boolean) => void;
}

/**
 * The caption under a cover-flow stage, stacked on the cover's own centre axis:
 * name, purpose, then the membership pill — so the eye never leaves the centred
 * column the stage already drew it to. The playlist name IS the open affordance —
 * a serif link whose arrow drifts up-right on hover/focus. The arrow's hover is
 * shared with the cover via `openActive`, so hovering either reads as one target.
 *
 * Membership uses the rail's own quiet pill rather than the heavier TargetToggle:
 * the shelf only ever holds matching playlists, so "in matching" is redundant here
 * and the real action is Remove. The pill stays context-aware (Add when a
 * non-target slips in) so it speaks the same language as a RailRow either way.
 */
export function ShelfCaption({
	playlist,
	onOpen,
	onAdd,
	onRemove,
	openActive = false,
	onOpenHoverChange,
}: ShelfCaptionProps) {
	const purpose = playlistPurpose(playlist);
	// No intent AND no genres → the matcher has nothing to route by, so teach the
	// fix here rather than only inside the playlist. Genres-but-no-intent still
	// matches, so it stays calm (no nag).
	const unmatchable = !purpose && !isMatchable(playlist);
	const open = () => onOpen(playlist.id);
	return (
		<div className="flex w-full max-w-full flex-col items-center gap-3.5">
			<div className="flex max-w-full flex-col items-center">
				<button
					type="button"
					onClick={open}
					onPointerEnter={() => onOpenHoverChange?.(true)}
					onPointerLeave={() => onOpenHoverChange?.(false)}
					className={`group/open flex max-w-full cursor-pointer items-center gap-2 transition-colors duration-150 ease focus-visible:text-(--t-text-muted) motion-reduce:transition-none ${
						openActive ? "text-(--t-text-muted)" : "theme-text"
					}`}
					style={{ fontFamily: fonts.display }}
				>
					<span className="min-w-0 truncate text-[26px] leading-[1.05] font-extralight tracking-tight">
						{playlist.name}
					</span>
					<ArrowUpRightIcon
						size={18}
						weight="regular"
						aria-hidden
						className={`shrink-0 transition-[opacity,transform] duration-150 ease-out motion-reduce:transition-none group-focus-visible/open:opacity-100 motion-safe:group-focus-visible/open:-translate-y-0.5 motion-safe:group-focus-visible/open:translate-x-0.5 ${
							openActive
								? "opacity-100 motion-safe:-translate-y-0.5 motion-safe:translate-x-0.5"
								: "opacity-0"
						}`}
					/>
				</button>
				{purpose ? (
					<div
						className="theme-text-muted mt-1.5 max-w-full truncate text-center text-[13px]"
						style={{ fontFamily: fonts.body }}
					>
						{purpose}
					</div>
				) : unmatchable ? (
					// Nothing to match by: the fix IS the line, caution badge beside it.
					// The button mirrors the name's open hover exactly (dim on
					// openActive, not its own brighten-on-hover) so the two read as one
					// target moving together rather than in opposite directions.
					<div className="mt-1.5 flex items-center gap-1.5">
						<button
							type="button"
							onClick={open}
							onPointerEnter={() => onOpenHoverChange?.(true)}
							onPointerLeave={() => onOpenHoverChange?.(false)}
							className={`cursor-pointer text-[13px] transition-colors duration-150 ease focus-visible:text-(--t-text-muted) motion-reduce:transition-none ${
								openActive ? "text-(--t-text-muted)" : "theme-text"
							}`}
							style={{ fontFamily: fonts.body }}
						>
							Open to set its intent
						</button>
						<InfoTip
							tone="caution"
							label="Why this playlist can’t be matched yet"
						>
							This playlist can’t be matched yet — give it a matching intent or
							some genres so songs can find their way here.
						</InfoTip>
					</div>
				) : (
					<div
						className="theme-text-muted mt-1.5 text-[13px]"
						style={{ fontFamily: fonts.body }}
					>
						No matching intent yet
					</div>
				)}
				{playlist.genres.length > 0 && (
					<div
						className="theme-text-muted mt-1 max-w-full truncate text-center text-[11px] tracking-wide opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						{playlist.genres.join(" · ")}
					</div>
				)}
			</div>
			<div className="flex justify-center">
				{playlist.isTarget ? (
					<button
						type="button"
						onClick={() => onRemove(playlist.id)}
						aria-label="Remove from matching"
						className="group/match theme-border-color relative inline-flex min-h-10 min-w-[150px] cursor-pointer items-center justify-center rounded-full border bg-(--t-surface) px-4 text-[11px] tracking-[0.14em] text-(--t-text) uppercase transition-[color,border-color,background-color,transform] duration-150 hover:bg-(--t-surface-dim) active:scale-[0.96]"
						style={{ fontFamily: fonts.body }}
					>
						<span className="flex items-center gap-1.5 transition-opacity duration-150 group-hover/match:opacity-0 motion-reduce:transition-none">
							<CheckIcon size={13} weight="bold" aria-hidden />
							In matching
						</span>
						<span className="absolute inset-0 flex items-center justify-center gap-1.5 opacity-0 transition-opacity duration-150 group-hover/match:opacity-100 motion-reduce:transition-none">
							<MinusIcon size={13} weight="bold" aria-hidden />
							Remove
						</span>
					</button>
				) : (
					<button
						type="button"
						onClick={() => onAdd(playlist.id)}
						className="theme-border-color inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border bg-(--t-surface) px-4 text-[11px] tracking-[0.14em] text-(--t-primary) uppercase transition-[color,border-color,background-color,transform] duration-150 hover:border-(--t-primary) hover:bg-(--t-primary) hover:text-(--t-text-on-primary) active:scale-[0.96]"
						style={{ fontFamily: fonts.body }}
					>
						<span aria-hidden="true">＋</span> Add to matching
					</button>
				)}
			</div>
		</div>
	);
}
