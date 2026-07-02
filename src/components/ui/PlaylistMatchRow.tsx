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
	/** Pre-rendered score node — caller decides plain span vs NumberFlow */
	scoreDisplay: ReactNode;
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
	scoreDisplay,
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
	const paddingBottom = size === "lg" ? "1.5rem" : "0.875rem";

	const actionElement =
		action.type === "added" ? (
			<span
				className="theme-text-muted text-xs tracking-widest uppercase opacity-60"
				style={{ fontFamily: fonts.body }}
			>
				Added
			</span>
		) : action.type === "custom" ? (
			action.node
		) : (
			<Button
				variant="secondary"
				size="sm"
				disabled={action.disabled}
				onClick={() => action.onAdd(playlistId)}
			>
				Add
			</Button>
		);

	return (
		<div
			className="theme-border-color group border-b"
			style={{ paddingBottom }}
		>
			<div className="flex items-center gap-6 py-1 pr-1">
				<div className="shrink-0">{scoreDisplay}</div>

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
							className="theme-text-muted inline-flex size-8 cursor-pointer items-center justify-center rounded-full opacity-60 transition-opacity hover:opacity-100 disabled:pointer-events-none disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
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
