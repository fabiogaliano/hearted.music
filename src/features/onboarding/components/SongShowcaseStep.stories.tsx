import type { Story } from "@ladle/react";
import { SongShowcaseStep } from "./SongShowcaseStep";

/**
 * SongShowcaseStep fetches a demo song from the server on mount.
 * In Ladle (no server), it gracefully falls back to the "unavailable" UI
 * after the request fails — so you see the product's fallback copy.
 */
export const Default: Story = () => <SongShowcaseStep />;
Default.meta = {
	description:
		"Falls to unavailable state in Ladle (no server). Shows fallback copy for when demo data isn't ready.",
};
