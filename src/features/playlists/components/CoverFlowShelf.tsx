import { type ReactNode, useState } from "react";
import { CoverFlowEmptyState } from "./CoverFlowEmptyState";
import { CoverFlowStage } from "./CoverFlowStage";
import { prefersReduced } from "./coverFlowGeometry";
import { PanelSection } from "./PanelSection";
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
 * angle back and recede. Browse by wheel, drag, or click a neighbor to center
 * it (click the centered sleeve to open). reduced-motion keeps every control
 * but drops the 3-D rotation/recession.
 *
 * The stage and its caption sit on a raised plane rather than floating on the
 * page, so the shelf reads as a display case the covers stand inside.
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

	const { stageRef, dragSteps, dragging, justDraggedRef } = useCoverFlowDrag({
		clamped,
		max,
		onCenterChange,
		onActivate,
	});

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

	const body =
		playlists.length === 0 ? (
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
		);

	// pb-6 gives the caption room to breathe against the plane's bottom edge — the
	// sleeves' own drop shadows already bleed toward it. Overflow stays visible:
	// the centred sleeve is perspective-transformed and taller than its slot.
	return (
		<div className="mt-8">
			<PanelSection label={label} count={playlists.length}>
				<div className="px-3 pt-2 pb-6">{body}</div>
			</PanelSection>
		</div>
	);
}
