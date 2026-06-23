/**
 * ConfigSurface — assembles IntentEditor, GenreConfig, FiltersConfig, and
 * MaxSongsSlider into the left column of the config region.
 *
 * All state and actions come from the draft hook; this component is purely
 * presentational — no local state, no debounce (that's the hook's job).
 */

import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { MaxSongsSlider } from "../MaxSongsSlider";
import { FiltersConfig } from "./FiltersConfig";
import { GenreConfig } from "./GenreConfig";
import { IntentEditor } from "./IntentEditor";

export interface ConfigSurfaceProps {
	accountId: string;
	/** Whether the account may use the natural-language intent field. */
	isIntentEligible: boolean;
	intent: string | undefined;
	genrePills: string[];
	matchFilters: PlaylistMatchFiltersV1;
	maxSongs: number;
	onIntentChange: (next: string | undefined) => void;
	onGenrePillsChange: (next: string[]) => void;
	onMatchFiltersChange: (next: PlaylistMatchFiltersV1) => void;
	onMaxSongsChange: (next: number) => void;
	/** Opens the upgrade/paywall dialog (passed to IntentEditor's locked state). */
	onOpenPaywall: () => void;
}

export function ConfigSurface({
	accountId,
	isIntentEligible,
	intent,
	genrePills,
	matchFilters,
	maxSongs,
	onIntentChange,
	onGenrePillsChange,
	onMatchFiltersChange,
	onMaxSongsChange,
	onOpenPaywall,
}: ConfigSurfaceProps) {
	return (
		<div className="grid grid-cols-[1fr_280px] gap-10">
			<div className="flex flex-col gap-8">
				<IntentEditor
					isEligible={isIntentEligible}
					value={intent}
					onChange={onIntentChange}
					onOpenPaywall={onOpenPaywall}
				/>

				<GenreConfig
					accountId={accountId}
					value={genrePills}
					onChange={onGenrePillsChange}
				/>

				<FiltersConfig
					accountId={accountId}
					value={matchFilters}
					onChange={onMatchFiltersChange}
				/>
			</div>

			<div className="flex flex-col gap-2">
				<MaxSongsSlider value={maxSongs} onChange={onMaxSongsChange} />
			</div>
		</div>
	);
}
