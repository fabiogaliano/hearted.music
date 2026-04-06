import type { Story } from "@ladle/react";
import { MatchShowcaseStep } from "./MatchShowcaseStep";

/**
 * MatchShowcaseStep polls the server for match results on mount.
 * In Ladle (no server), polling fails and it falls to the "unavailable" UI
 * which explains how matching works without real data.
 */
export const Default: Story = () => <MatchShowcaseStep />;
Default.meta = {
	description:
		"Falls to unavailable state in Ladle (no server). Shows the matching explanation fallback copy.",
};
