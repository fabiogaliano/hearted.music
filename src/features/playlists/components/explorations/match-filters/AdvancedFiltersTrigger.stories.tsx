import type { Story } from "@ladle/react";
import { useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import { AdvancedFiltersTrigger } from "./AdvancedFiltersTrigger";

export default { title: "Match Filters/AdvancedFiltersTrigger" };

function Harness({
	initialOpen,
	activeCount,
}: {
	initialOpen: boolean;
	activeCount: number;
}) {
	const [isOpen, setIsOpen] = useState(initialOpen);
	return (
		<div className="theme-bg p-10" style={{ maxWidth: 440 }}>
			<AdvancedFiltersTrigger
				id="advanced-filters-trigger"
				controlsId="advanced-filters-region"
				isOpen={isOpen}
				activeCount={activeCount}
				onToggle={() => setIsOpen((prev) => !prev)}
			/>
			<p
				className="mt-4 text-xs theme-text-muted"
				style={{ fontFamily: fonts.body }}
			>
				{isOpen ? "expanded" : "collapsed"}
			</p>
		</div>
	);
}

export const Default: Story<{ initialOpen: boolean; activeCount: number }> = ({
	initialOpen,
	activeCount,
}) => (
	<Harness
		key={`${initialOpen}|${activeCount}`}
		initialOpen={initialOpen}
		activeCount={activeCount}
	/>
);
Default.args = { initialOpen: false, activeCount: 0 };
Default.argTypes = {
	initialOpen: { control: { type: "boolean" } },
	activeCount: { control: { type: "range", min: 0, max: 10, step: 1 } },
};
