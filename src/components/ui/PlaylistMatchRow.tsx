import { XIcon } from "@phosphor-icons/react";
import type { HTMLAttributes, ReactNode } from "react";
import { Button } from "@/components/ui/Button";
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
	/** Spread onto the cover+name group so the caller can make that whole region a
	 *  single hover trigger (cover, name, and the gap between them). */
	leadProps?: HTMLAttributes<HTMLDivElement>;
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
	leadProps,
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

				<div className="flex min-w-0 flex-1 items-center gap-4" {...leadProps}>
					{media && <div className="shrink-0">{media}</div>}

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
							// the row; the full text is revealed in the hover/focus preview
							// card (usePlaylistTrackPreview) that this whole lead region opens.
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
