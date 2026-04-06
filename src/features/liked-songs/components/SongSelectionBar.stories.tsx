import type { Story } from "@ladle/react";
import { SongSelectionBar } from "./SongSelectionBar";

const noop = () => {};

export const NoneSelected: Story = () => (
	<SongSelectionBar
		selectedCount={0}
		remainingBalance={50}
		onConfirm={noop}
		onCancel={noop}
	/>
);

export const OneSelected: Story = () => (
	<SongSelectionBar
		selectedCount={1}
		remainingBalance={50}
		onConfirm={noop}
		onCancel={noop}
	/>
);

export const ManySelected: Story = () => (
	<SongSelectionBar
		selectedCount={7}
		remainingBalance={50}
		onConfirm={noop}
		onCancel={noop}
	/>
);

export const OverBudget: Story = () => (
	<SongSelectionBar
		selectedCount={12}
		remainingBalance={5}
		onConfirm={noop}
		onCancel={noop}
	/>
);
OverBudget.meta = {
	description:
		"Selected count exceeds remaining balance — Unlock button is disabled.",
};

export const ExactlyAtBudget: Story = () => (
	<SongSelectionBar
		selectedCount={5}
		remainingBalance={5}
		onConfirm={noop}
		onCancel={noop}
	/>
);
ExactlyAtBudget.meta = { description: "Selection exactly matches balance." };
