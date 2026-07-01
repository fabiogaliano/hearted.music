import type { Story } from "@ladle/react";
import { useState } from "react";

import type { Reason } from "../queue-helpers";
import type { MatchViewMode } from "../types";
import { MatchingEmptyState } from "./MatchingEmptyState";

// These are the route-level empty states (rendered by match.tsx via
// deriveEmptyStateReason), one per Reason. They never appear inside the Matching
// page component, so they get their own group here rather than living under
// Match/Page.
export default {
	title: "Match/Empty States",
};

// match.tsx always mounts MatchingEmptyState inside this centered wrapper and
// always passes onModeChange, so the orientation toggle is present. Mirror both
// so each story reads like the real /match empty view. mode is interactive so
// the filtered story shows the H9 noun switch (song ↔ playlist).
function EmptyStatePreview({
	reason,
	hiddenCount,
}: {
	reason: Reason;
	hiddenCount?: number;
}) {
	const [mode, setMode] = useState<MatchViewMode>("playlist");
	return (
		<div className="mx-auto w-full max-w-[min(1600px,100%)]">
			<MatchingEmptyState
				reason={reason}
				hiddenCount={hiddenCount}
				mode={mode}
				onModeChange={setMode}
			/>
		</div>
	);
}

export const NoContext: Story = () => <EmptyStatePreview reason="no-context" />;
NoContext.meta = {
	description:
		"No snapshot or session and nothing processing — genuinely no setup. Prompts the user to set a matching intent on a playlist.",
};

export const Building: Story = () => <EmptyStatePreview reason="building" />;
Building.meta = {
	description:
		"Enrichment or match-refresh is running and no first card is ready yet — shown instead of a false 'nothing found' during first setup.",
};

export const BuildingMore: Story = () => (
	<EmptyStatePreview reason="building-more" />
);
BuildingMore.meta = {
	description:
		"Jobs still running but the queue already had items — caught up on what's surfaced so far, more on the way.",
};

export const Filtered: Story = () => (
	<EmptyStatePreview reason="filtered" hiddenCount={3} />
);
Filtered.meta = {
	description:
		"Every undecided item's only matches sit below the strictness bar. hiddenCount drives the copy; the orientation toggle flips the noun (song ↔ playlist, H9).",
};

export const NoneYet: Story = () => <EmptyStatePreview reason="none-yet" />;
NoneYet.meta = {
	description:
		"Matching ran but surfaced nothing — distinct from caught-up, which means a real pile was worked through.",
};

export const CaughtUp: Story = () => <EmptyStatePreview reason="caught-up" />;
CaughtUp.meta = {
	description:
		"Worked through a real pile; new matches appear here after the next sync.",
};
