import type { Story } from "@ladle/react";
import { VoicesLine as Voices } from "./VoicesLine";

/**
 * The voices line + pull meter. Clear `description` to see it render nothing (it
 * only appears once there's a description to reinforce); raise `genreCount` to
 * grow the meter. Presentational, so the controls take effect immediately.
 */
export default { title: "Playlists/Explorations/Components" };

export const VoicesLine: Story<{ description: string; genreCount: number }> = ({
	description,
	genreCount,
}) => (
	<div className="theme-bg mx-auto max-w-md p-10">
		<Voices description={description || null} genreCount={genreCount} />
	</div>
);
VoicesLine.args = { description: "songs for a slow sunday", genreCount: 3 };
VoicesLine.argTypes = {
	description: { control: { type: "text" } },
	genreCount: { control: { type: "range", min: 0, max: 8, step: 1 } },
};
