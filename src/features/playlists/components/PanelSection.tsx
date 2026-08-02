/**
 * A titled panel: label + count on a band, its contents on one raised plane.
 *
 * The listing used to draw each chapter as a label, a long hairline reaching
 * across the page, and a floated count — chrome standing in for a container
 * that wasn't there. The plane IS the container now, so the rule shortens to
 * the band's own underside and stops doing two jobs (separating the title from
 * the rows AND implying a group).
 *
 * Material follows the studio: --t-surface warm-tilted for the plane, an ink
 * mix for the internal seam. Callers own the interior padding, because a rail
 * of rows and a cover-flow stage want different rhythms inside the same box.
 */

import type { ReactNode } from "react";
import { fonts } from "@/lib/theme/fonts";

interface PanelSectionProps {
	label: string;
	count: number;
	/** Optional control for the band's right edge — the library's search field. A
	 *  slot rather than a `searchable` flag, because the band owes the control
	 *  nothing but a place to stand. */
	trailing?: ReactNode;
	children: ReactNode;
}

export function PanelSection({
	label,
	count,
	trailing,
	children,
}: PanelSectionProps) {
	return (
		<section className="surface-raised squircle rounded-[18px]">
			{/* The count sits with its label rather than floated to the far end. It
			read as an anchor only while the far end was empty; once a control lives
			there, a lone figure between the label and that control is a third thing
			competing for the same edge. Beside the label it's what it always was —
			the label's own figure — and the right edge belongs to whoever acts. */}
			<div className="plane-rule flex items-center justify-between gap-4 border-b px-5 py-3">
				<div className="flex items-baseline gap-3">
					<span
						className="theme-text-muted text-xs tracking-[0.2em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						{label}
					</span>
					<span
						className="theme-text-muted text-xs tabular-nums opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						{count}
					</span>
				</div>
				{trailing && (
					// The trailing control's focus line is drawn here rather than inside
					// the control, because it has to land ON the band's bottom seam — the
					// point of the line is that the seam already there lights up under
					// whatever you're using. That offset is this band's own py-3 plus its
					// 1px border, so the two numbers stay in one file where they can't
					// drift apart. self-stretch is what puts the wrapper's bottom edge at
					// the content box's, so the offset is measured from a fixed place
					// instead of from however tall the control happens to be.
					<div className="group relative flex items-center self-stretch">
						{trailing}
						<span
							aria-hidden="true"
							className="theme-primary-bg pointer-events-none absolute inset-x-0 bottom-[calc(-0.75rem-1px)] h-px opacity-0 transition-opacity duration-200 group-focus-within:opacity-100"
						/>
					</div>
				)}
			</div>
			{children}
		</section>
	);
}
