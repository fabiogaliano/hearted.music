/**
 * NotEnoughSongsNote — an inline note shown when 0 < totalEligible < maxSongs.
 *
 * Non-blocking; never an error. Nudges the user to broaden their settings.
 */

import { fonts } from "@/lib/theme/fonts";

interface NotEnoughSongsNoteProps {
	totalEligible: number;
}

export function NotEnoughSongsNote({ totalEligible }: NotEnoughSongsNoteProps) {
	return (
		<p
			className="theme-text-muted px-1 text-xs"
			style={{ fontFamily: fonts.body }}
			role="note"
		>
			Only {totalEligible}{" "}
			{totalEligible === 1 ? "song matches" : "songs match"} — broaden your
			filters for more.
		</p>
	);
}
