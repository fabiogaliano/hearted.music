import { ArrowUpRightIcon, CheckIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";
import { type PlaylistSummary, playlistPurpose } from "./types";

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
						className={`shrink-0 transition-transform duration-150 ease-out motion-reduce:transition-none motion-safe:group-focus-visible/open:-translate-y-0.5 motion-safe:group-focus-visible/open:translate-x-0.5 ${
							openActive
								? "motion-safe:-translate-y-0.5 motion-safe:translate-x-0.5"
								: ""
						}`}
					/>
				</button>
				{purpose && (
					<div
						className="theme-text-muted mt-1.5 max-w-full truncate text-center text-[13px]"
						style={{ fontFamily: fonts.body }}
					>
						{purpose}
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
						<span className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-150 group-hover/match:opacity-100 motion-reduce:transition-none">
							Remove
						</span>
					</button>
				) : (
					<button
						type="button"
						onClick={() => onAdd(playlist.id)}
						className="inline-flex min-h-10 cursor-pointer items-center gap-1.5 rounded-full border border-(--t-primary)/50 bg-(--t-surface) px-4 text-[11px] tracking-[0.14em] text-(--t-primary) uppercase transition-[color,border-color,background-color,transform] duration-150 hover:border-(--t-primary) hover:bg-(--t-primary) hover:text-(--t-text-on-primary) active:scale-[0.96]"
						style={{ fontFamily: fonts.body }}
					>
						<span aria-hidden="true">＋</span> Add to matching
					</button>
				)}
			</div>
		</div>
	);
}
