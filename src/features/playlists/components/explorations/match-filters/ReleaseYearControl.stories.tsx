/**
 * Ladle stories for the two ReleaseYearControl directions.
 *
 * Each story uses local state so the control is fully interactive.
 * The sparse-bounds story (null min/max) verifies that both directions
 * hide their add/edit affordance when library bounds are unavailable.
 *
 * Schema verification: every filter emitted by Apply is validated against
 * parseSaveMatchFilters in the harness — if validation fails the error
 * surfaces as a red caption below the control.
 */

import type { Story } from "@ladle/react";
import { useState } from "react";
import { parseSaveMatchFilters } from "@/lib/domains/taste/match-filters/schemas";
import type {
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
} from "@/lib/domains/taste/match-filters/types";
import { MOCK_FILTER_OPTIONS } from "./mock-filter-options";
import { ReleaseYearControlA } from "./ReleaseYearControlA";
import { ReleaseYearControlB } from "./ReleaseYearControlB";

export default {
	title: "Match Filters/Release Year",
};

/** Sparse mock — min/max null to test hidden affordance. */
const SPARSE_OPTIONS: PlaylistMatchFilterOptions = {
	...MOCK_FILTER_OPTIONS,
	releaseYears: { min: null, max: null },
};

/** Narrow-width wrapper for narrow-drawer story. */
function NarrowWrapper({ children }: { children: React.ReactNode }) {
	return <div style={{ maxWidth: 240 }}>{children}</div>;
}

/**
 * Wraps a control and validates every emitted filter against
 * parseSaveMatchFilters. Shows a validation result badge so the reviewer
 * can confirm the output is always a valid save payload.
 */
function ValidatingHarness({
	initial,
	options,
	Control,
	disabled,
}: {
	initial: PlaylistMatchFiltersV1;
	options: PlaylistMatchFilterOptions;
	Control: typeof ReleaseYearControlA | typeof ReleaseYearControlB;
	disabled?: boolean;
}) {
	const [filters, setFilters] = useState<PlaylistMatchFiltersV1>(initial);
	const [lastResult, setLastResult] = useState<string | null>(null);

	const handleChange = (next: PlaylistMatchFiltersV1) => {
		setFilters(next);
		const result = parseSaveMatchFilters(next);
		setLastResult(result.ok ? "valid" : `INVALID: ${result.error}`);
	};

	return (
		<div className="flex flex-col gap-3 p-4" style={{ maxWidth: 320 }}>
			<Control
				filters={filters}
				onFiltersChange={handleChange}
				options={options}
				disabled={disabled}
			/>
			{lastResult && (
				<p
					className="text-[11px] tracking-[0.04em]"
					style={{
						color:
							lastResult === "valid"
								? "color-mix(in srgb, var(--t-primary) 80%, var(--t-text))"
								: "var(--t-primary)",
					}}
				>
					parseSaveMatchFilters: {lastResult}
				</p>
			)}
			<pre
				className="text-[10px] theme-text-muted overflow-auto"
				style={{ maxHeight: 80 }}
			>
				{JSON.stringify(filters.releaseYear ?? null, null, 2)}
			</pre>
		</div>
	);
}

export const DirectionA_Empty: Story = () => (
	<ValidatingHarness
		key="a-empty"
		initial={{ version: 1 }}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlA}
	/>
);
DirectionA_Empty.meta = {
	description: "Direction A — segmented mode tabs + inputs, no filter active",
};

export const DirectionA_ExactYear: Story = () => (
	<ValidatingHarness
		key="a-exact"
		initial={{ version: 1, releaseYear: { kind: "exact", year: 1998 } }}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlA}
	/>
);
DirectionA_ExactYear.meta = {
	description: "Direction A — pre-set to exact year 1998",
};

export const DirectionA_BeforeMode: Story = () => (
	<ValidatingHarness
		key="a-before"
		initial={{ version: 1, releaseYear: { kind: "before", end: 2000 } }}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlA}
	/>
);

export const DirectionA_AfterMode: Story = () => (
	<ValidatingHarness
		key="a-after"
		initial={{ version: 1, releaseYear: { kind: "after", start: 2015 } }}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlA}
	/>
);

export const DirectionA_RangeMode: Story = () => (
	<ValidatingHarness
		key="a-range"
		initial={{
			version: 1,
			releaseYear: { kind: "range", start: 1990, end: 1999 },
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlA}
	/>
);

export const DirectionA_Disabled: Story = () => (
	<ValidatingHarness
		key="a-disabled"
		initial={{ version: 1 }}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlA}
		disabled
	/>
);
DirectionA_Disabled.meta = {
	description:
		"Direction A — disabled (options loading/error state); control is fully disabled",
};

export const DirectionA_SparseBounds: Story = () => (
	<div className="p-4">
		<p className="text-sm theme-text-muted mb-3">
			min/max = null → add/edit affordance hidden. Existing chips (if any)
			handled by ActiveFilterChips outside this control.
		</p>
		<ValidatingHarness
			key="a-sparse"
			initial={{ version: 1 }}
			options={SPARSE_OPTIONS}
			Control={ReleaseYearControlA}
		/>
		<p className="text-[11px] theme-text-muted mt-2">
			(Nothing rendered below — correct behavior.)
		</p>
	</div>
);
DirectionA_SparseBounds.meta = {
	description:
		"Direction A — null min/max hides the control. Existing chips remain via ActiveFilterChips.",
};

export const DirectionA_OutOfBoundsSaved: Story = () => (
	<ValidatingHarness
		key="a-oob"
		initial={{ version: 1, releaseYear: { kind: "exact", year: 1955 } }}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlA}
	/>
);
DirectionA_OutOfBoundsSaved.meta = {
	description:
		"Direction A — saved filter (1955) is outside library min/max (1968). Control still renders and allows editing.",
};

export const DirectionA_Narrow: Story = () => (
	<NarrowWrapper>
		<ValidatingHarness
			key="a-narrow"
			initial={{ version: 1 }}
			options={MOCK_FILTER_OPTIONS}
			Control={ReleaseYearControlA}
		/>
	</NarrowWrapper>
);
DirectionA_Narrow.meta = { description: "Direction A — narrow drawer (240px)" };

export const DirectionB_Empty: Story = () => (
	<ValidatingHarness
		key="b-empty"
		initial={{ version: 1 }}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlB}
	/>
);
DirectionB_Empty.meta = {
	description:
		"Direction B — dual-handle slider + mode chips, no filter active",
};

export const DirectionB_RangePreset: Story = () => (
	<ValidatingHarness
		key="b-range"
		initial={{
			version: 1,
			releaseYear: { kind: "range", start: 1990, end: 1999 },
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlB}
	/>
);

export const DirectionB_BeforeMode: Story = () => (
	<ValidatingHarness
		key="b-before"
		initial={{ version: 1, releaseYear: { kind: "before", end: 2000 } }}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlB}
	/>
);

export const DirectionB_AfterMode: Story = () => (
	<ValidatingHarness
		key="b-after"
		initial={{ version: 1, releaseYear: { kind: "after", start: 2010 } }}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlB}
	/>
);

export const DirectionB_Disabled: Story = () => (
	<ValidatingHarness
		key="b-disabled"
		initial={{ version: 1 }}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlB}
		disabled
	/>
);
DirectionB_Disabled.meta = {
	description: "Direction B — disabled; sliders and inputs are inert",
};

export const DirectionB_SparseBounds: Story = () => (
	<div className="p-4">
		<p className="text-sm theme-text-muted mb-3">
			min/max = null → add/edit affordance hidden.
		</p>
		<ValidatingHarness
			key="b-sparse"
			initial={{ version: 1 }}
			options={SPARSE_OPTIONS}
			Control={ReleaseYearControlB}
		/>
		<p className="text-[11px] theme-text-muted mt-2">
			(Nothing rendered below — correct behavior.)
		</p>
	</div>
);
DirectionB_SparseBounds.meta = {
	description: "Direction B — null bounds hide the slider control",
};

export const DirectionB_OutOfBoundsSaved: Story = () => (
	<ValidatingHarness
		key="b-oob"
		initial={{ version: 1, releaseYear: { kind: "exact", year: 1955 } }}
		options={MOCK_FILTER_OPTIONS}
		Control={ReleaseYearControlB}
	/>
);
DirectionB_OutOfBoundsSaved.meta = {
	description:
		"Direction B — saved filter (1955) outside library bounds; control renders and is editable",
};

export const DirectionB_Narrow: Story = () => (
	<NarrowWrapper>
		<ValidatingHarness
			key="b-narrow"
			initial={{ version: 1 }}
			options={MOCK_FILTER_OPTIONS}
			Control={ReleaseYearControlB}
		/>
	</NarrowWrapper>
);
DirectionB_Narrow.meta = { description: "Direction B — narrow drawer (240px)" };

export const SideBySide: Story = () => {
	const [filtersA, setFiltersA] = useState<PlaylistMatchFiltersV1>({
		version: 1,
	});
	const [filtersB, setFiltersB] = useState<PlaylistMatchFiltersV1>({
		version: 1,
	});
	return (
		<div className="grid gap-8 p-4" style={{ gridTemplateColumns: "1fr 1fr" }}>
			<div>
				<p className="text-[11px] tracking-[0.08em] uppercase theme-text-muted mb-3">
					Direction A — Segmented tabs + inputs
				</p>
				<ReleaseYearControlA
					filters={filtersA}
					onFiltersChange={setFiltersA}
					options={MOCK_FILTER_OPTIONS}
				/>
			</div>
			<div>
				<p className="text-[11px] tracking-[0.08em] uppercase theme-text-muted mb-3">
					Direction B — Dual-handle slider
				</p>
				<ReleaseYearControlB
					filters={filtersB}
					onFiltersChange={setFiltersB}
					options={MOCK_FILTER_OPTIONS}
				/>
			</div>
		</div>
	);
};
SideBySide.meta = {
	description:
		"Both directions side-by-side at natural width for visual comparison",
};
