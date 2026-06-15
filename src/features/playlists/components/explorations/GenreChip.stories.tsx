import type { Story } from "@ladle/react";
import { fonts } from "@/lib/theme/fonts";
import { GenreChip } from "./GenreChip";

/**
 * The genre chip atom in isolation: read-only by default, removable when given an
 * `onRemove`. Toggle `removable` to compare the two — the picker uses the second,
 * the collapsed writing surface uses the first.
 */
export default { title: "Playlists/Explorations/Components" };

export const Chip: Story<{ label: string; removable: boolean }> = ({
	label,
	removable,
}) => (
	<div className="theme-bg flex flex-wrap items-center gap-2 p-10">
		<GenreChip onRemove={removable ? () => {} : undefined}>{label}</GenreChip>
		<span
			className="theme-text-muted text-xs"
			style={{ fontFamily: fonts.body }}
		>
			{removable ? "removable" : "read-only"}
		</span>
	</div>
);
Chip.args = { label: "dream pop", removable: false };
Chip.argTypes = {
	label: { control: { type: "text" } },
	removable: { control: { type: "boolean" } },
};
