/**
 * Component: AlbumPlaceholder
 *
 * Theme-aware placeholder shown when no album art is available.
 * Displays a music note icon on a subtle background.
 */

import { cn } from "@/lib/shared/utils/utils";

interface AlbumPlaceholderProps {
	/** Additional className for the SVG */
	className?: string;
}

export function AlbumPlaceholder({ className }: AlbumPlaceholderProps) {
	return (
		<svg
			viewBox="0 0 100 100"
			className={cn("h-full w-full", className)}
			aria-hidden="true"
		>
			<rect
				width="100"
				height="100"
				fill="var(--t-surface-dim)"
				fillOpacity="0.6"
			/>
			<text
				x="50"
				y="58"
				textAnchor="middle"
				dominantBaseline="middle"
				fill="var(--t-text-muted)"
				fillOpacity="0.5"
				fontSize="32"
				className="select-none"
			>
				♫
			</text>
		</svg>
	);
}
