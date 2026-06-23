import { type ReactNode, useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import { CoverFlowEmptyState } from "./CoverFlowEmptyState";
import { CoverFlowStage } from "./CoverFlowStage";
import { prefersReduced } from "./coverFlowGeometry";
import { ShelfCaption } from "./ShelfCaption";
import type { PlaylistSummary } from "./types";
import { useCoverFlowDrag } from "./useCoverFlowDrag";
import "./playlist-ui.css";

interface CoverFlowShelfProps {
	label: string;
	playlists: PlaylistSummary[];
	center: number;
	onCenterChange: (next: number) => void;
	onActivate: () => void;
	onOpen: (id: string) => void;
	onAdd: (id: string) => void;
	onRemove: (id: string) => void;
	/** Id of a just-added playlist whose sleeve should fly in rather than pop. */
	enterId?: string | null;
	/**
	 * The chrome around the (fixed) stage. `plain` keeps the label left + arrows
	 * right. `chapter` rides the label on a hairline rule with the count floated to
	 * its far end (no arrow buttons — sleeves are navigated by click / wheel / drag
	 * / keys). The sleeve geometry is identical in both.
	 */
	chrome?: "plain" | "chapter";
	/**
	 * Empty-state copy, overridable so the onboarding preview can teach the concept
	 * ("what's a matching candidate?") while production keeps the terse default.
	 */
	emptyTitle?: string;
	emptyBody?: string;
	/** Action rendered below the empty-state copy — the onboarding "Next" button
	 *  that advances the walkthrough from the concept step. */
	emptyAction?: ReactNode;
}

/**
 * One cover-flow shelf: the centered sleeve sits front-and-large, neighbors
 * angle back and recede. Browse by wheel, drag, the ‹ › arrows, or click a
 * neighbor to center it (click the centered sleeve to open). reduced-motion
 * keeps every control but drops the 3-D rotation/recession.
 */
export function CoverFlowShelf({
	label,
	playlists,
	center,
	onCenterChange,
	onActivate,
	onOpen,
	onAdd,
	onRemove,
	enterId,
	chrome = "plain",
	emptyTitle = "No matching candidates yet",
	emptyBody = "Add playlists from your library below — each one's description is how your liked songs find their homes.",
	emptyAction,
}: CoverFlowShelfProps) {
	const reduce = prefersReduced();
	// The name is the open link; hovering the centered cover OR the name drifts the
	// same arrow, so the two — in separate subtrees — share one hover state.
	const [openHover, setOpenHover] = useState(false);
	const max = Math.max(0, playlists.length - 1);
	const clamped = Math.max(0, Math.min(center, max));
	const centered = playlists[clamped];

	const { stageRef, dragSteps, dragging, step, justDraggedRef } =
		useCoverFlowDrag({ clamped, max, onCenterChange, onActivate });

	// Fractional centre the geometry renders against: the committed centre shifted
	// by the live drag, kept within the real range so the ends don't overscroll.
	const renderCenter = Math.max(0, Math.min(max, clamped + dragSteps));

	const onSleeveClick = (index: number, id: string) => {
		// onUp clears dragRef before this click fires, so the just-dragged flag (not
		// the now-null ref) is what tells a drag-release apart from a real tap.
		if (justDraggedRef.current) {
			justDraggedRef.current = false;
			return;
		}
		onActivate();
		if (index === clamped) onOpen(id);
		else onCenterChange(index);
	};

	const arrowButton = (dir: -1 | 1) => (
		<button
			key={dir}
			type="button"
			aria-label={dir < 0 ? "Previous" : "Next"}
			onClick={() => step(dir)}
			className="theme-text-muted theme-border-color grid size-[34px] place-items-center rounded-full border text-lg leading-none transition-[color,border-color,transform] duration-150 hover:border-(--t-text-muted) hover:text-(--t-text) active:scale-[0.92]"
		>
			{dir < 0 ? "‹" : "›"}
		</button>
	);

	return (
		<section className="mt-8">
			{chrome === "chapter" ? (
				<div className="flex items-center gap-4 px-1">
					<span
						className="theme-text-muted text-xs tracking-[0.2em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						{label}
					</span>
					<div className="theme-border-color h-px flex-1 self-center border-t" />
					<span
						className="theme-text-muted text-xs tabular-nums"
						style={{ fontFamily: fonts.body }}
					>
						{playlists.length}
					</span>
				</div>
			) : (
				<div className="flex items-center justify-between px-1">
					<span
						className="theme-text-muted flex items-baseline gap-2.5 text-xs tracking-[0.2em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						{label} <span className="tabular-nums">{playlists.length}</span>
					</span>
					<div className="flex gap-1.5">
						{arrowButton(-1)}
						{arrowButton(1)}
					</div>
				</div>
			)}

			{playlists.length === 0 ? (
				<CoverFlowEmptyState
					title={emptyTitle}
					body={emptyBody}
					action={emptyAction}
				/>
			) : (
				<>
					<CoverFlowStage
						stageRef={stageRef}
						playlists={playlists}
						clamped={clamped}
						renderCenter={renderCenter}
						reduce={reduce}
						dragging={dragging}
						enterId={enterId}
						onSleeveClick={onSleeveClick}
						onCenterHoverChange={setOpenHover}
					/>

					<div
						className="mt-4 flex min-h-[116px] items-center justify-center px-1"
						aria-live="polite"
					>
						{centered ? (
							// Keyed to the centred id so the settle animation re-fires on each
							// navigation; the covers' own glide is untouched.
							<div key={centered.id} className="xpl-caption-enter w-full">
								<ShelfCaption
									playlist={centered}
									onOpen={onOpen}
									onAdd={onAdd}
									onRemove={onRemove}
									openActive={openHover}
									onOpenHoverChange={setOpenHover}
								/>
							</div>
						) : null}
					</div>
				</>
			)}
		</section>
	);
}
