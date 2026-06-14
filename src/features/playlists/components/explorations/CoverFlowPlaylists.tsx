import { useEffect, useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import { CoverFlowShelf } from "./CoverFlowShelf";
import type { PlaylistSummary } from "./types";

type Shelf = "matching" | "library";

interface CoverFlowPlaylistsProps {
	playlists: PlaylistSummary[];
	onOpen?: (id: string) => void;
	onAdd?: (id: string) => void;
	onRemove?: (id: string) => void;
}

/**
 * The CoverFlow listing: two stacked, full-width shelves (Matching above,
 * Library below — the "integrated but spatially distinct" separation model,
 * never cramped columns). Arrow keys flip the active shelf (←/→), switch shelf
 * (↑/↓), and Enter opens the centered playlist.
 */
export function CoverFlowPlaylists({
	playlists,
	onOpen = () => {},
	onAdd = () => {},
	onRemove = () => {},
}: CoverFlowPlaylistsProps) {
	const matching = playlists.filter((p) => p.isTarget);
	const library = playlists.filter((p) => !p.isTarget);
	const lists: Record<Shelf, PlaylistSummary[]> = { matching, library };

	const [active, setActive] = useState<Shelf>("matching");
	const [centers, setCenters] = useState<Record<Shelf, number>>({
		matching: 0,
		library: 0,
	});

	const setCenter = (shelf: Shelf, next: number) =>
		setCenters((current) => ({
			...current,
			[shelf]: Math.max(0, Math.min(lists[shelf].length - 1, next)),
		}));

	// Cross-shelf keyboard nav. Re-binds each render so it reads fresh state.
	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement | null;
			if (
				target &&
				(target.tagName === "INPUT" || target.tagName === "TEXTAREA")
			)
				return;
			if (event.key === "ArrowRight") {
				event.preventDefault();
				setCenter(active, centers[active] + 1);
			} else if (event.key === "ArrowLeft") {
				event.preventDefault();
				setCenter(active, centers[active] - 1);
			} else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
				event.preventDefault();
				setActive((shelf) => (shelf === "matching" ? "library" : "matching"));
			} else if (event.key === "Enter") {
				const list = lists[active];
				const playlist = list[Math.min(centers[active], list.length - 1)];
				if (playlist) {
					event.preventDefault();
					onOpen(playlist.id);
				}
			}
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	});

	return (
		<div className="mx-auto max-w-[1180px]">
			<header className="mb-2">
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Library
				</p>
				<h1
					className="theme-text text-page-title mt-3 leading-[0.95] font-extralight tracking-tight text-balance"
					style={{ fontFamily: fonts.display }}
				>
					Playlists{" "}
					<span className="theme-text-muted align-[0.32em] text-[0.5em] tabular-nums">
						{playlists.length}
					</span>
				</h1>
			</header>

			<CoverFlowShelf
				label="Matching"
				playlists={matching}
				center={centers.matching}
				onCenterChange={(next) => setCenter("matching", next)}
				onActivate={() => setActive("matching")}
				onOpen={onOpen}
				onAdd={onAdd}
				onRemove={onRemove}
			/>
			<CoverFlowShelf
				label="Library"
				playlists={library}
				center={centers.library}
				onCenterChange={(next) => setCenter("library", next)}
				onActivate={() => setActive("library")}
				onOpen={onOpen}
				onAdd={onAdd}
				onRemove={onRemove}
			/>
		</div>
	);
}
