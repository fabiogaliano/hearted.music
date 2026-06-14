import { fonts } from "@/lib/theme/fonts";

interface VoicesLineProps {
	/** The saved intent; the line only shows once there's something to reinforce. */
	description: string | null;
	/** Drives the hairline pull tick — more genres, a longer pull. */
	genreCount: number;
}

/**
 * Faithful to the live PlaylistVoices: a sentence, not a dashboard. A hairline
 * tick hints at how strongly songs are pulled toward this home.
 */
export function VoicesLine({ description, genreCount }: VoicesLineProps) {
	if (!description) return null;
	const pull = Math.min(100, 34 + genreCount * 16);
	return (
		<div className="flex items-center gap-3">
			<span
				className="theme-text-muted text-xs leading-normal text-pretty"
				style={{ fontFamily: fonts.body }}
			>
				New songs find their way here from what you write.
			</span>
			<span
				aria-hidden="true"
				className="theme-border-bg block h-0.5 w-[54px] flex-none overflow-hidden rounded-full"
			>
				<i
					className="theme-primary-bg block h-full rounded-full"
					style={{
						width: `${pull}%`,
						transition: "width 280ms var(--ease-out-quart)",
					}}
				/>
			</span>
		</div>
	);
}
