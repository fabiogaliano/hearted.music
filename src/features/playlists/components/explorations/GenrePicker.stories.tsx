import type { Story } from "@ladle/react";
import { useState } from "react";
import { TOP_GENRES } from "./fixtures";
import { GenrePicker as Picker } from "./GenrePicker";

/**
 * The genre picker in isolation: type to filter suggestions, Enter to add,
 * Backspace on an empty input to drop the last, and a shake at the 6th attempt.
 * The `preset` control seeds the starting pills.
 */
export default { title: "Playlists/Explorations/Components" };

const PRESETS: Record<string, string[]> = {
	empty: [],
	prefilled: ["indie pop", "dream pop"],
	"at capacity": ["indie pop", "dream pop", "alternative", "shoegaze", "lo-fi"],
};

function Harness({ initial }: { initial: string[] }) {
	const [value, setValue] = useState<string[]>(initial);
	return (
		<div className="theme-bg mx-auto max-w-md p-10">
			<Picker value={value} onChange={setValue} topGenres={TOP_GENRES} />
			<pre className="theme-text-muted mt-8 text-xs">
				{JSON.stringify(value)}
			</pre>
		</div>
	);
}

// Seeding happens on mount, so key to the preset to remount when it changes.
export const GenrePicker: Story<{ preset: string }> = ({ preset }) => (
	<Harness key={preset} initial={PRESETS[preset] ?? []} />
);
GenrePicker.args = { preset: "empty" };
GenrePicker.argTypes = {
	preset: {
		options: ["empty", "prefilled", "at capacity"],
		control: { type: "radio" },
	},
};
GenrePicker.meta = {
	description: "At capacity is 5/5 — try adding a sixth to see the shake.",
};
