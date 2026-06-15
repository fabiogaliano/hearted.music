import { useEffect, useState } from "react";
import { SpotlightHero } from "./SpotlightHero";
import { TrackList } from "./TrackList";
import type { PlaylistSummary, PlaylistTrackVM } from "./types";
import { WritingSurface } from "./WritingSurface";

interface SpotlightPanelProps {
	playlist: PlaylistSummary | null;
	tracks?: PlaylistTrackVM[];
	open: boolean;
	onClose: () => void;
	onToggleTarget?: (id: string) => void;
	onSave?: (id: string, intent: string | null, genres: string[]) => void;
	topGenres?: readonly string[];
}

/**
 * The Spotlight detail panel as a whole: a right-side slide-in drawer
 * (full-screen below the lg breakpoint — phones and tablets — and a clamped
 * side column on desktop, matching the liked-songs detail panel) with a scrim,
 * the hue-washed hero, then the writing surface, voices line, and track list on
 * plain bg. It owns the writing-surface draft state so it drops into a story or
 * a route the same way; persistence is surfaced via onSave for the caller to wire.
 *
 * A fixed, overflow-hidden frame clips the off-canvas panel so a closed drawer
 * never adds a phantom horizontal scrollbar. The drawer body scrolls inside an
 * inner wrapper while the close button stays pinned to the panel — on a
 * full-screen phone the scrim is fully covered, so the ✕ is the only way out and
 * must never scroll away with the track list.
 */
export function SpotlightPanel({
	playlist,
	tracks = [],
	open,
	onClose,
	onToggleTarget = () => {},
	onSave = () => {},
	topGenres,
}: SpotlightPanelProps) {
	const [description, setDescription] = useState<string | null>(
		playlist?.intent ?? null,
	);
	const [genres, setGenres] = useState<string[]>(playlist?.genres ?? []);
	const [isEditing, setIsEditing] = useState(false);
	const [draftDescription, setDraftDescription] = useState("");
	const [draftGenres, setDraftGenres] = useState<string[]>([]);

	// Reseed the writing surface when a different playlist opens.
	// biome-ignore lint/correctness/useExhaustiveDependencies: reseed only on identity change
	useEffect(() => {
		setDescription(playlist?.intent ?? null);
		setGenres(playlist?.genres ?? []);
		setIsEditing(false);
	}, [playlist?.id]);

	useEffect(() => {
		if (!open) return;
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") onClose();
		};
		document.addEventListener("keydown", onKey);
		return () => document.removeEventListener("keydown", onKey);
	}, [open, onClose]);

	const openEditor = () => {
		setDraftDescription(description ?? "");
		setDraftGenres(genres);
		setIsEditing(true);
	};
	const save = () => {
		const nextDescription = draftDescription.trim() || null;
		setDescription(nextDescription);
		setGenres(draftGenres);
		setIsEditing(false);
		if (playlist) onSave(playlist.id, nextDescription, draftGenres);
	};

	return (
		<div
			aria-hidden={!open}
			className={`fixed inset-0 z-50 overflow-hidden ${open ? "" : "pointer-events-none"}`}
		>
			<button
				type="button"
				aria-label="Close panel"
				tabIndex={open ? 0 : -1}
				onClick={onClose}
				className={`absolute inset-0 cursor-default border-0 transition-opacity duration-200 ease-[var(--ease-out-quart)] motion-reduce:transition-none ${open ? "opacity-100" : "opacity-0"}`}
				style={{
					background: "color-mix(in srgb, var(--t-text) 22%, transparent)",
				}}
			/>

			<aside
				className={`theme-bg theme-border-color absolute top-0 right-0 flex h-full w-full flex-col overflow-hidden transition-transform duration-300 ease-[var(--ease-out-quart)] motion-reduce:transition-none lg:w-[clamp(520px,56vw,760px)] lg:border-l ${open ? "translate-x-0" : "translate-x-full"}`}
				style={{
					boxShadow:
						"-24px 0 60px -30px color-mix(in srgb, var(--t-text) 40%, transparent)",
				}}
			>
				{playlist && (
					<>
						<button
							type="button"
							onClick={onClose}
							aria-label="Close"
							className="theme-text-muted absolute top-[26px] right-[22px] z-30 grid size-10 place-items-center text-[17px] transition-[color,transform] duration-150 hover:text-(--t-text) active:scale-[0.94] md:right-[30px]"
						>
							✕
						</button>

						<div className="flex-1 overflow-y-auto overscroll-contain">
							<div className="relative px-5 pt-[30px] pb-20 md:px-10 md:pt-[34px]">
								<SpotlightHero
									playlist={playlist}
									onToggleTarget={() => onToggleTarget(playlist.id)}
								/>

								<div className="flex flex-col gap-8">
									<div
										className="relative z-20 -mx-5 px-5 pt-1 pb-9 md:-mx-10 md:px-10"
										style={{
											background:
												"color-mix(in srgb, var(--t-primary) 12%, var(--t-surface-dim))",
										}}
									>
										<div className="max-w-[56ch]">
											<WritingSurface
												description={description}
												genres={genres}
												isEditing={isEditing}
												draftDescription={draftDescription}
												draftGenres={draftGenres}
												topGenres={topGenres}
												onEditDescription={openEditor}
												onEditGenres={openEditor}
												onDraftDescriptionChange={setDraftDescription}
												onDraftGenresChange={setDraftGenres}
												onSave={save}
												onCancel={() => setIsEditing(false)}
											/>
										</div>
									</div>

									<TrackList tracks={tracks} songCount={playlist.songCount} />
								</div>
							</div>
						</div>
					</>
				)}
			</aside>
		</div>
	);
}
