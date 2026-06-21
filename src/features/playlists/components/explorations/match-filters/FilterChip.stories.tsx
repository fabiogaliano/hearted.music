import type { Story } from "@ladle/react";
import { FilterChip } from "./FilterChip";

export default { title: "Match Filters/FilterChip" };

export const Default: Story<{ label: string; removable: boolean }> = ({
	label,
	removable,
}) => (
	<div className="theme-bg flex flex-wrap items-center gap-2 p-10">
		<FilterChip label={label} onRemove={removable ? () => {} : undefined} />
	</div>
);
Default.args = { label: "English", removable: true };
Default.argTypes = {
	label: { control: { type: "text" } },
	removable: { control: { type: "boolean" } },
};
