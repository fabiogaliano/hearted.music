import { fonts } from "@/lib/theme/fonts";
import type { Destination } from "./types";

interface NavLineItem {
	destination: Destination;
	label: string;
	count?: number;
}

interface MastheadNavLineProps {
	active: Destination;
	matchCount: number;
	onNavigate: (destination: Destination) => void;
}

/** Sketch B: the sidebar's typography rotated 90° into one quiet line.
 * Same idiom as NavItem — uppercase text-xs, active = full text + medium. */
export function MastheadNavLine({
	active,
	matchCount,
	onNavigate,
}: MastheadNavLineProps) {
	const items: NavLineItem[] = [
		{ destination: "match", label: "Match", count: matchCount },
		{ destination: "liked-songs", label: "Liked Songs" },
		{ destination: "playlists", label: "Playlists" },
	];

	return (
		<nav className="flex items-center gap-8">
			{items.map((item) => {
				const isActive = active === item.destination;
				return (
					<button
						key={item.destination}
						type="button"
						onClick={() => onNavigate(item.destination)}
						aria-current={isActive ? "page" : undefined}
						className={`focus-edge-offset text-xs tracking-widest uppercase transition-colors duration-150 ease-out motion-reduce:transition-none ${
							isActive
								? "theme-text font-medium"
								: "theme-text-muted font-normal hover:text-(--t-text)"
						}`}
						style={{ fontFamily: fonts.body }}
					>
						{item.label}
						{item.count !== undefined && item.count > 0 && (
							<span className="ml-1.5 tabular-nums">· {item.count}</span>
						)}
					</button>
				);
			})}
		</nav>
	);
}
