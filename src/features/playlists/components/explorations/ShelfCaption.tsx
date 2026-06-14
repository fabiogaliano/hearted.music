import { ArrowUpRightIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";
import { TargetToggle } from "./TargetToggle";
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
 * The line under a cover-flow stage. The playlist name IS the open affordance — a
 * serif link whose arrow drifts up-right on hover/focus — followed by its song
 * count + purpose, with the matching toggle on the right. The arrow's hover is
 * shared with the cover via `openActive`, so hovering either reads as one target.
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
		<>
			<div className="min-w-0">
				<button
					type="button"
					onClick={open}
					onPointerEnter={() => onOpenHoverChange?.(true)}
					onPointerLeave={() => onOpenHoverChange?.(false)}
					className={`group/open flex min-w-0 max-w-full cursor-pointer items-center gap-2 text-left transition-colors duration-150 ease focus-visible:text-(--t-text-muted) motion-reduce:transition-none ${
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
				<div
					className="theme-text-muted mt-1 flex min-w-0 items-center gap-2 text-[13px] tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					<span className="flex-none">
						{playlist.songCount} {playlist.songCount === 1 ? "song" : "songs"}
					</span>
					{purpose && (
						<>
							<span className="size-[3px] flex-none rounded-full bg-current opacity-50" />
							<span className="truncate">{purpose}</span>
						</>
					)}
				</div>
			</div>
			<div className="flex flex-none items-center gap-2.5">
				<TargetToggle
					isTarget={playlist.isTarget}
					onToggle={() =>
						playlist.isTarget ? onRemove(playlist.id) : onAdd(playlist.id)
					}
				/>
			</div>
		</>
	);
}
