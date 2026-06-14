import type { Story } from "@ladle/react";
import { useState } from "react";
import { TargetToggle as Toggle } from "./TargetToggle";

/**
 * The matching toggle. `isTarget` seeds the starting state; clicking flips it.
 */
export default { title: "Playlists/Explorations/Components" };

function Harness({ initial }: { initial: boolean }) {
	const [isTarget, setIsTarget] = useState(initial);
	return (
		<div className="theme-bg p-10">
			<Toggle isTarget={isTarget} onToggle={() => setIsTarget((v) => !v)} />
		</div>
	);
}

// Key to the control so flipping it remounts with the new seed.
export const TargetToggle: Story<{ isTarget: boolean }> = ({ isTarget }) => (
	<Harness key={String(isTarget)} initial={isTarget} />
);
TargetToggle.args = { isTarget: false };
TargetToggle.argTypes = { isTarget: { control: { type: "boolean" } } };
