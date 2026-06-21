import type { Story } from "@ladle/react";
import { useState } from "react";
import type { PlaylistMatchFiltersV1 } from "@/lib/domains/taste/match-filters/types";
import { fonts } from "@/lib/theme/fonts";
import { VocalsControl } from "./VocalsControl";

export default { title: "Match Filters/VocalsControl" };

const PRESETS: Record<string, PlaylistMatchFiltersV1> = {
	unset: { version: 1 },
	female: { version: 1, vocalGender: "female" },
	male: { version: 1, vocalGender: "male" },
};

type VocalsArgs = { preset: string; disabled: boolean };

function Harness({ preset, disabled }: VocalsArgs) {
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>(
		PRESETS[preset] ?? { version: 1 },
	);

	return (
		<div
			className="theme-bg p-8"
			style={{ maxWidth: 360, fontFamily: fonts.body }}
		>
			<VocalsControl
				filters={filters}
				onFiltersChange={setFilters}
				disabled={disabled}
			/>
			<pre
				className="mt-4 text-xs theme-text-muted"
				style={{ fontFamily: "monospace" }}
			>
				vocalGender: {JSON.stringify(filters.vocalGender)}
			</pre>
		</div>
	);
}

export const Default: Story<VocalsArgs> = ({ preset, disabled }) => (
	<Harness key={preset} preset={preset} disabled={disabled} />
);
Default.args = { preset: "unset", disabled: false };
Default.argTypes = {
	preset: {
		options: Object.keys(PRESETS),
		control: { type: "select" },
	},
	disabled: { control: { type: "boolean" } },
};
Default.meta = {
	description:
		"Female/Male toggle. Selecting sets vocalGender; the X on the active chip clears it — no separate Clear button. Keyboard operable: Tab to focus, Enter/Space selects, the chip X is a focusable button.",
};
