import type { Story } from "@ladle/react";
import { samplePlaylists } from "./fixtures";
import { RailRow as Row } from "./RailRow";

/**
 * One rail row. Hover to reveal Remove; "In matching" shows on desktop widths.
 * Switch `kind` to compare a matching row against an available one.
 */
export default { title: "Playlists/Explorations/Components" };

const noop = () => {};
const matching = samplePlaylists.find((p) => p.isTarget) ?? samplePlaylists[0];
const available =
	samplePlaylists.find((p) => !p.isTarget) ?? samplePlaylists[0];

export const RailRow: Story<{ kind: string }> = ({ kind }) => (
	<div className="theme-bg mx-auto max-w-3xl p-10">
		<Row
			playlist={kind === "matching" ? matching : available}
			onOpen={noop}
			onAdd={noop}
			onRemove={noop}
		/>
	</div>
);
RailRow.args = { kind: "available" };
RailRow.argTypes = {
	kind: { options: ["available", "matching"], control: { type: "radio" } },
};
