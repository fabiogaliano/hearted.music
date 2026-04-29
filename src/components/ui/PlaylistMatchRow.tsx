import type { ReactNode } from "react";
import { fonts } from "@/lib/theme/fonts";

export interface PlaylistMatchRowColors {
	text: string;
	textMuted: string;
	border: string;
}

export interface PlaylistMatchRowProps {
	playlistId: string;
	name: string;
	/** Pre-rendered score node — caller decides plain span vs NumberFlow */
	scoreDisplay: ReactNode;
	/** Optional subtitle below the name (e.g. playlist description) */
	reason?: string;
	isAdded: boolean;
	onAdd: (playlistId: string) => void;
	colors: PlaylistMatchRowColors;
	/** "lg" for full-page match view, "sm" (default) for panel context */
	size?: "sm" | "lg";
}

export function PlaylistMatchRow({
	playlistId,
	name,
	scoreDisplay,
	reason,
	isAdded,
	onAdd,
	colors,
	size = "sm",
}: PlaylistMatchRowProps) {
	const nameFontSize = size === "lg" ? "1.125rem" : "0.875rem";
	const paddingBottom = size === "lg" ? "1.25rem" : "0.75rem";

	return (
		<div
			className="group"
			style={{
				borderBottom: `1px solid ${colors.border}`,
				paddingBottom,
			}}
		>
			<div className="flex items-start justify-between">
				<div className="flex items-start gap-2">
					{scoreDisplay}
					<div className="pt-0.5">
						<span
							className="font-light"
							style={{
								fontFamily: fonts.display,
								color: colors.text,
								fontSize: nameFontSize,
							}}
						>
							{name}
						</span>
						{reason && (
							<p
								className="mt-0.5 text-xs"
								style={{ fontFamily: fonts.body, color: colors.textMuted }}
							>
								{reason}
							</p>
						)}
					</div>
				</div>

				{isAdded ? (
					<span
						className="text-xs tracking-widest uppercase opacity-50"
						style={{ fontFamily: fonts.body, color: colors.textMuted }}
					>
						Added
					</span>
				) : (
					<button
						type="button"
						onClick={() => onAdd(playlistId)}
						className="text-xs tracking-widest uppercase opacity-0 transition-opacity group-hover:opacity-100"
						style={{ fontFamily: fonts.body, color: colors.text }}
					>
						Add
					</button>
				)}
			</div>
		</div>
	);
}
