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
	children: ReactNode;
}

export function PanelSection({ label, count, children }: PanelSectionProps) {
	return (
		<section className="surface-raised squircle rounded-[18px]">
			<div className="plane-rule flex items-center justify-between gap-4 border-b px-5 py-3">
				<span
					className="theme-text-muted text-xs tracking-[0.2em] uppercase"
					style={{ fontFamily: fonts.body }}
				>
					{label}
				</span>
				<span
					className="theme-text-muted text-xs tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{count}
				</span>
			</div>
			{children}
		</section>
	);
}
