import type { ReactNode } from "react";
import { Button } from "@/components/ui/Button";
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
			<div className="flex items-center gap-6">
				<div className="shrink-0">{scoreDisplay}</div>

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
						<p
							className="theme-text-muted mt-1.5 text-xs leading-snug"
							style={{ fontFamily: fonts.body }}
						>
							{reason}
						</p>
					)}
				</div>

				<div className="shrink-0">{actionElement}</div>
			</div>
		</div>
	);
}
