import { ListBulletsIcon, XIcon } from "@phosphor-icons/react";
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Button } from "@/components/ui/Button";
import { CoverPeekBadge } from "@/components/ui/CoverPeekBadge";
import { fonts } from "@/lib/theme/fonts";

type PlaylistMatchRowAction =
	| { type: "added" }
	| { type: "add"; disabled?: boolean; onAdd: (playlistId: string) => void }
	| { type: "custom"; node: ReactNode };

interface PlaylistMatchRowProps {
	playlistId: string;
	name: string;
	/** Optional subtitle below the name (e.g. playlist description) */
	reason?: string;
	/** Media slot (e.g. the playlist cover) rendered between the score and name. */
	media?: ReactNode;
	/** Spread onto the cover *button* so just the album art is the preview trigger
	 *  — hover opens it, click/tap/Enter pins it. The name and reason stay inert so
	 *  they can be read and selected in peace. Omitted (demo mode) → inert media. */
	coverProps?: ButtonHTMLAttributes<HTMLButtonElement>;
	/** "lg" for full-page match view, "sm" (default) for panel context */
	size?: "sm" | "lg";
	onDismiss?: (playlistId: string) => void;
	dismissDisabled?: boolean;
	dismissLabel?: string;
	action: PlaylistMatchRowAction;
}

export function PlaylistMatchRow({
	playlistId,
	name,
	reason,
	media,
	coverProps,
	size = "sm",
	onDismiss,
	dismissDisabled,
	dismissLabel,
	action,
}: PlaylistMatchRowProps) {
	const nameFontSize = size === "lg" ? "1.5rem" : "1rem";
	// Symmetric now that the divider is gone: the old bottom-heavy padding existed
	// to space the content off the hairline beneath it, not to shape the row.
	const rowPadding = size === "lg" ? "px-2.5 py-3" : "px-2.5 py-2";

	const actionElement =
		action.type === "added" ? (
			<span
				className="theme-text-muted text-xs tracking-widest uppercase opacity-60"
				style={{ fontFamily: fonts.body }}
			>
				Found its home
			</span>
		) : action.type === "custom" ? (
			action.node
		) : (
			// The one action the matching page exists for, so it takes the accent
			// fill. It can't be a raised chip: hovering Add necessarily hovers its row
			// too, and both tiers move lighter, so a chip's hover slid toward the lit
			// row and the primary action got muddier exactly when pointed at. An
			// accent fill separates by hue, which no plane state can converge with.
			// Shape (not the variant's job) comes from the call site, matching the
			// pill language the surface variant already carries.
			<Button
				variant="primary"
				size="sm"
				className="squircle rounded-full"
				disabled={action.disabled}
				onClick={() => action.onAdd(playlistId)}
			>
				Add
			</Button>
		);

	return (
		// The vision tracklist's evolved row (vision/StudioTracklist.stories.tsx):
		// no hairline, transparent at rest, the hover fill carrying the row on its
		// own. Worth more here than in a plain tracklist — this row scatters three
		// separate hit targets (cover preview, dismiss, Add) across its full width,
		// and the plane is what binds them into one row you're acting on. The small
		// horizontal inset is the vision's too; it can't bleed outward the way the
		// dashboard's rows do because MatchingSession clips the card for the reject
		// fling, which would take the corners with it.
		// The transition is the caller's here: .surface-raised-hover is only the
		// hover/focus arms, so a row that is transparent at rest has no base rule to
		// carry one and the fill would snap.
		<div
			className={`surface-raised-hover squircle group rounded-[10px] transition-[background-color] duration-150 ease-out ${rowPadding}`}
		>
			{/* The row opens on the cover. It used to open on a match percentage,
			which put a figure nobody can act on in the position the eye lands
			first — and claimed precision the ranking can't defend. The list is
			ordered by score, so position already says which match is stronger. */}
			<div className="flex items-center gap-6">
				<div className="flex min-w-0 flex-1 items-center gap-4">
					{media &&
						(coverProps ? (
							// Only the cover is the preview trigger — the name and reason stay
							// inert (readable/selectable). A real button so touch/keyboard reach
							// the same preview, not just hover. A small list glyph rests in the
							// corner at all times (the signifier that pulls the hover — a
							// hover-only hint can't advertise itself); on hover it gives way to
							// the full scrim + centered glyph.
							<button
								type="button"
								{...coverProps}
								aria-label={`Preview tracks: ${name}`}
								className="group/peek relative shrink-0 cursor-pointer overflow-hidden border-0 bg-transparent p-0 transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] motion-safe:active:scale-[0.97]"
							>
								{media}
								<CoverPeekBadge
									size={18}
									className="transition-opacity duration-200 group-hover/peek:opacity-0"
								/>
								<span
									aria-hidden="true"
									className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity duration-200 group-hover/peek:opacity-100"
									style={{
										background:
											"color-mix(in srgb, var(--t-text) 42%, transparent)",
									}}
								>
									<ListBulletsIcon
										size={20}
										style={{ color: "var(--t-surface)" }}
									/>
								</span>
							</button>
						) : (
							<div className="shrink-0">{media}</div>
						))}

					<div className="min-w-0 flex-1">
						<p
							className="theme-text truncate font-light leading-[1.15]"
							style={{
								fontFamily: fonts.display,
								fontSize: nameFontSize,
							}}
							title={name}
						>
							{name}
						</p>
						{reason && (
							// Clamped to two lines so a long "what it's for" doesn't dominate
							// the row; the full text is revealed in the preview card that the
							// cover opens (usePlaylistTrackPreview).
							<p
								className="theme-text-muted mt-1.5 line-clamp-2 text-xs leading-snug"
								style={{ fontFamily: fonts.body }}
							>
								{reason}
							</p>
						)}
					</div>
				</div>

				<div className="flex shrink-0 items-center gap-2">
					{onDismiss && action.type !== "added" && (
						<button
							type="button"
							disabled={dismissDisabled}
							onClick={() => onDismiss(playlistId)}
							aria-label={
								dismissLabel ?? `Dismiss playlist suggestion: ${name}`
							}
							className="theme-text-muted tap-40 inline-flex size-8 cursor-pointer items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
						>
							<XIcon size={14} weight="bold" />
						</button>
					)}
					{actionElement}
				</div>
			</div>
		</div>
	);
}
