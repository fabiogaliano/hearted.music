import type { RefObject } from "react";
import { fonts } from "@/lib/theme/fonts";
import { Cover } from "./Cover";
import { dropShadow, sleeveStyle } from "./coverFlowGeometry";
import type { PlaylistSummary } from "./types";

interface CoverFlowStageProps {
	stageRef: RefObject<HTMLDivElement | null>;
	playlists: PlaylistSummary[];
	/** The committed (clamped) centre index — drives the centred-cover treatment. */
	clamped: number;
	/** Fractional centre the geometry renders against (committed centre + drag). */
	renderCenter: number;
	reduce: boolean;
	dragging: boolean;
	/** Id of a just-added playlist whose sleeve should fly in rather than pop. */
	enterId?: string | null;
	onSleeveClick: (index: number, id: string) => void;
	/** The centred cover and the caption's open arrow share one hover state. */
	onCenterHoverChange: (hovering: boolean) => void;
}

/**
 * The cover-flow stage: the centred sleeve sits front-and-large, neighbours angle
 * back and recede. Geometry follows the fractional drag centre; the centred-cover
 * treatment (no dim, hover-linked open) tracks the committed centre so it doesn't
 * flicker mid-drag.
 */
export function CoverFlowStage({
	stageRef,
	playlists,
	clamped,
	renderCenter,
	reduce,
	dragging,
	enterId,
	onSleeveClick,
	onCenterHoverChange,
}: CoverFlowStageProps) {
	return (
		<div
			ref={stageRef}
			className="relative mt-3 h-[220px] cursor-grab overflow-x-clip overflow-y-visible active:cursor-grabbing md:h-[268px]"
			style={{
				perspective: "1500px",
				perspectiveOrigin: "50% 46%",
				touchAction: "pan-y",
			}}
		>
			{playlists.length === 0 ? (
				<p
					className="theme-text-muted absolute inset-0 grid place-items-center text-[13px]"
					style={{ fontFamily: fonts.body }}
				>
					Nothing here yet.
				</p>
			) : (
				playlists.map((playlist, index) => {
					const offset = index - renderCenter;
					const isCenter = index === clamped;
					const isEntering = !reduce && playlist.id === enterId;
					return (
						<button
							key={playlist.id}
							type="button"
							tabIndex={-1}
							aria-label={playlist.name}
							onClick={() => onSleeveClick(index, playlist.id)}
							onPointerEnter={
								isCenter ? () => onCenterHoverChange(true) : undefined
							}
							onPointerLeave={
								isCenter ? () => onCenterHoverChange(false) : undefined
							}
							className="group/sleeve absolute top-6 left-1/2 -ml-[84px] block size-[168px] cursor-pointer border-0 bg-transparent p-0 md:-ml-[108px] md:size-[216px]"
							style={sleeveStyle(offset, reduce, dragging)}
						>
							<div
								className="relative h-full w-full transition-transform duration-100 ease-out group-active/sleeve:scale-[0.96] motion-reduce:transition-none"
								style={{ boxShadow: dropShadow(isCenter) }}
							>
								<div
									className={
										isEntering
											? "xpl-sleeve-enter h-full w-full"
											: "h-full w-full"
									}
								>
									<Cover
										src={playlist.imageUrl}
										size="fill"
										style={
											isCenter
												? undefined
												: { filter: "brightness(0.82) saturate(0.9)" }
										}
									/>
								</div>
							</div>
						</button>
					);
				})
			)}
		</div>
	);
}
