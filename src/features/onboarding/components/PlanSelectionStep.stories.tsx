import type { Story } from "@ladle/react";
import { PlanSelectionStep } from "./PlanSelectionStep";

/**
 * PlanSelectionStep fetches plan config (quarterly flag) on mount.
 * In Ladle (no server), it shows an error state.
 * No sessionStorage checkout intent in this environment, so post-checkout
 * polling is skipped.
 */
export const Default: Story = () => (
	<PlanSelectionStep
		syncStats={{ songs: 250, playlists: 8 }}
		readyCopyVariant="free"
	/>
);
Default.meta = {
	description:
		"Shows error state in Ladle (server unavailable). Plan cards appear once config loads in production.",
};
