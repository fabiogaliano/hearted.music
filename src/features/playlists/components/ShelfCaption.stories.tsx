import type { Story } from "@ladle/react";
import { samplePlaylists } from "./fixtures";
import { ShelfCaption } from "./ShelfCaption";

/**
 * The caption under a cover-flow stage. `isTarget` flips the matching control
 * between "Add to matching" and the quiet "In matching" state; `hasPurpose`
 * drops the intent so the bare name + count layout can be checked.
 */
export default { title: "Playlists/Explorations/Components" };

export const ShelfCaptionStory: Story<{
	isTarget: boolean;
	hasPurpose: boolean;
}> = ({ isTarget, hasPurpose }) => {
	const base = samplePlaylists[0];
	const playlist = {
		...base,
		isTarget,
		intent: hasPurpose ? base.intent : null,
	};
	return (
		<div className="theme-bg p-10">
			<div className="mx-auto flex max-w-[1180px] items-center justify-between gap-5">
				<ShelfCaption
					playlist={playlist}
					onOpen={() => {}}
					onAdd={() => {}}
					onRemove={() => {}}
				/>
			</div>
		</div>
	);
};
ShelfCaptionStory.storyName = "ShelfCaption";
ShelfCaptionStory.args = { isTarget: false, hasPurpose: true };
ShelfCaptionStory.argTypes = {
	isTarget: { control: { type: "boolean" } },
	hasPurpose: { control: { type: "boolean" } },
};
