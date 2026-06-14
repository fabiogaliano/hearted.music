import { useState } from "react";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import { CoverFlowShelf } from "./CoverFlowShelf";
import { RailRow } from "./RailRow";
import type { PlaylistSummary } from "./types";

interface CoverFlowPlaylistsProps {
	playlists: PlaylistSummary[];
	onOpen?: (id: string) => void;
	onAdd?: (id: string) => void;
	onRemove?: (id: string) => void;
}

/**
 * The CoverFlow listing: the Matching shelf stays a full-width cover flow up top —
 * the page's hero, for the handful that matter — while the Library drops below it
 * to a calm, scannable rail of rows. The "integrated but spatially distinct"
 * separation model: cover flow for the few, a list for the long tail. Both
 * sections are titled as editorial "chapters" — label left, count floated to the
 * far end of a hairline rule. Keyboard drives the cover flow via the app's
 * shortcut system (←/→ or h/l to move, Enter to open the centred candidate).
 */
export function CoverFlowPlaylists({
	playlists,
	onOpen = () => {},
	onAdd = () => {},
	onRemove = () => {},
}: CoverFlowPlaylistsProps) {
	const matching = playlists.filter((p) => p.isTarget);
	const library = playlists.filter((p) => !p.isTarget);

	const [center, setCenter] = useState(0);
	const max = Math.max(0, matching.length - 1);
	const clampCenter = (next: number) =>
		setCenter(Math.max(0, Math.min(max, next)));

	// Keyboard nav drives the matching cover flow through the shared shortcut
	// registry (scope "matching"), so ←/→ and the Vim h/l pair stay in sync with
	// the wheel / drag / click nav the shelf owns, and show up in the ? help modal.
	const goPrev = () => clampCenter(center - 1);
	const goNext = () => clampCenter(center + 1);
	const openCentered = () => {
		const playlist = matching[Math.min(center, matching.length - 1)];
		if (playlist) onOpen(playlist.id);
	};
	const navEnabled = matching.length > 0;
	useShortcut({
		key: "left",
		handler: goPrev,
		description: "Previous candidate",
		scope: "matching",
		category: "navigation",
		enabled: navEnabled,
	});
	useShortcut({
		key: "h",
		handler: goPrev,
		description: "Previous candidate",
		scope: "matching",
		category: "navigation",
		enabled: navEnabled,
	});
	useShortcut({
		key: "right",
		handler: goNext,
		description: "Next candidate",
		scope: "matching",
		category: "navigation",
		enabled: navEnabled,
	});
	useShortcut({
		key: "l",
		handler: goNext,
		description: "Next candidate",
		scope: "matching",
		category: "navigation",
		enabled: navEnabled,
	});
	useShortcut({
		key: "enter",
		handler: openCentered,
		description: "Open candidate",
		scope: "matching",
		category: "actions",
		enabled: navEnabled,
		// Don't hijack Enter when a real control is focused (a RailRow's Add/Remove,
		// the playlist-name link) — let that button do its own job.
		shouldHandle: () => {
			const el = document.activeElement;
			if (!el || el === document.body) return true;
			return !(
				el.tagName === "BUTTON" ||
				el.tagName === "A" ||
				el.getAttribute("role") === "button"
			);
		},
	});

	return (
		<div className="mx-auto max-w-[1180px]">
			<header className="mb-2">
				<h1
					className="theme-text text-page-title leading-[0.95] font-extralight tracking-tight text-balance"
					style={{ fontFamily: fonts.display }}
				>
					Playlists{" "}
					<span className="theme-text-muted align-[0.32em] text-[0.5em] tabular-nums">
						{playlists.length}
					</span>
				</h1>
			</header>

			<CoverFlowShelf
				label="Matching candidates"
				playlists={matching}
				center={center}
				onCenterChange={clampCenter}
				onActivate={() => {}}
				onOpen={onOpen}
				onAdd={onAdd}
				onRemove={onRemove}
				chrome="chapter"
			/>

			<section className="mt-8">
				<div className="flex items-center gap-4 px-1">
					<span
						className="theme-text-muted text-xs tracking-[0.2em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Library
					</span>
					<div className="theme-border-color h-px flex-1 self-center border-t" />
					<span
						className="theme-text-muted text-xs tabular-nums"
						style={{ fontFamily: fonts.body }}
					>
						{library.length}
					</span>
				</div>

				<div className="mt-4">
					{library.length > 0 ? (
						library.map((playlist) => (
							<RailRow
								key={playlist.id}
								playlist={playlist}
								onOpen={onOpen}
								onAdd={onAdd}
								onRemove={onRemove}
							/>
						))
					) : (
						<p
							className="theme-text-muted py-6 text-[13px]"
							style={{ fontFamily: fonts.body }}
						>
							Nothing here yet.
						</p>
					)}
				</div>
			</section>
		</div>
	);
}
