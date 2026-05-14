import type { ReactNode } from "react";
import { fonts } from "@/lib/theme/fonts";

type PlaylistMatchRowAction =
	| { type: "added" }
	| { type: "add"; onAdd: (playlistId: string) => void }
	| { type: "custom"; node: ReactNode };

interface PlaylistMatchRowProps {
	playlistId: string;
	name: string;
	/** Pre-rendered score node — caller decides plain span vs NumberFlow */
	scoreDisplay: ReactNode;
	/** Optional subtitle below the name (e.g. playlist description) */
	reason?: string;
	/** "lg" for full-page match view, "sm" (default) for panel context */
	size?: "sm" | "lg";
	action: PlaylistMatchRowAction;
}

export function PlaylistMatchRow({
	playlistId,
	name,
	scoreDisplay,
	reason,
	size = "sm",
	action,
}: PlaylistMatchRowProps) {
	const nameFontSize = size === "lg" ? "1.125rem" : "0.875rem";
	const paddingBottom = size === "lg" ? "1.25rem" : "0.75rem";

	return (
		<div
			className="theme-border-color group border-b"
			style={{ paddingBottom }}
		>
			<div className="flex items-start justify-between gap-4">
				<div className="flex min-w-0 flex-1 items-start gap-2">
					{scoreDisplay}
					<div className="min-w-0 pt-0.5">
						<span
							className="theme-text font-light"
							style={{
								fontFamily: fonts.display,
								fontSize: nameFontSize,
							}}
						>
							{name}
						</span>
						{reason && (
							<p
								className="theme-text-muted mt-0.5 text-xs"
								style={{ fontFamily: fonts.body }}
							>
								{reason}
							</p>
						)}
					</div>
				</div>

				<div className="shrink-0">
					{action.type === "added" ? (
						<span
							className="theme-text-muted text-xs tracking-widest uppercase opacity-50"
							style={{ fontFamily: fonts.body }}
						>
							Added
						</span>
					) : action.type === "custom" ? (
						action.node
					) : (
						<button
							type="button"
							onClick={() => action.onAdd(playlistId)}
							className="theme-text text-xs tracking-widest uppercase opacity-0 transition-opacity group-hover:opacity-100"
							style={{ fontFamily: fonts.body }}
						>
							Add
						</button>
					)}
				</div>
			</div>
		</div>
	);
}
