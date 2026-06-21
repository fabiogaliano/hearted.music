/**
 * Ladle stories for the two LikedDateTimeline directions.
 *
 * Each story uses local state so the control is fully interactive.
 * The sparse-bounds story (oldest=null) verifies that both directions
 * hide their add/edit affordance when the library bound is unavailable.
 *
 * Schema verification: every emitted filter is validated against
 * parseSaveMatchFilters — the result badge confirms round-trip validity.
 */

import type { Story } from "@ladle/react";
import { useState } from "react";
import { parseSaveMatchFilters } from "@/lib/domains/taste/match-filters/schemas";
import type {
	PlaylistMatchFilterOptions,
	PlaylistMatchFiltersV1,
} from "@/lib/domains/taste/match-filters/types";
import { LikedDateTimelineA } from "./LikedDateTimelineA";
import { LikedDateTimelineB } from "./LikedDateTimelineB";
import { MOCK_FILTER_OPTIONS } from "./mock-filter-options";

export default {
	title: "Match Filters/Liked Date",
};

/** Sparse options — oldest=null → affordance hidden in both directions. */
const SPARSE_OPTIONS: PlaylistMatchFilterOptions = {
	...MOCK_FILTER_OPTIONS,
	likedAt: { oldest: null, today: "2026-06-21", yearCounts: [] },
};

/** Wraps a control and surfaces parseSaveMatchFilters results inline. */
function ValidatingHarness({
	initial,
	options,
	Control,
	disabled,
}: {
	initial: PlaylistMatchFiltersV1;
	options: PlaylistMatchFilterOptions;
	Control: typeof LikedDateTimelineA | typeof LikedDateTimelineB;
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
		<div className="flex flex-col gap-3 p-4" style={{ maxWidth: 340 }}>
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
				style={{ maxHeight: 100 }}
			>
				{JSON.stringify(filters.likedAt ?? null, null, 2)}
			</pre>
		</div>
	);
}

export const DirectionA_Empty: Story = () => (
	<ValidatingHarness
		key="a-empty"
		initial={{ version: 1 }}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineA}
	/>
);
DirectionA_Empty.meta = {
	description: "Direction A — year preset pills + mode tabs, no filter active",
};

export const DirectionA_YearPreset: Story = () => (
	<ValidatingHarness
		key="a-preset"
		initial={{
			version: 1,
			likedAt: {
				kind: "range",
				startDate: "2023-01-01",
				end: { kind: "date", date: "2023-12-31" },
			},
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineA}
	/>
);
DirectionA_YearPreset.meta = {
	description:
		"Direction A — 2023 year preset active (fixed Jan 1 – Dec 31 UTC range, end.kind=date)",
};

export const DirectionA_BeforeMode: Story = () => (
	<ValidatingHarness
		key="a-before"
		initial={{
			version: 1,
			likedAt: { kind: "before", endDate: "2022-06-15" },
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineA}
	/>
);

export const DirectionA_AfterMode: Story = () => (
	<ValidatingHarness
		key="a-after"
		initial={{
			version: 1,
			likedAt: { kind: "after", startDate: "2024-01-01" },
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineA}
	/>
);

export const DirectionA_CustomRange: Story = () => (
	<ValidatingHarness
		key="a-custom-range"
		initial={{
			version: 1,
			likedAt: {
				kind: "range",
				startDate: "2021-03-01",
				end: { kind: "date", date: "2023-08-31" },
			},
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineA}
	/>
);
DirectionA_CustomRange.meta = {
	description: "Direction A — custom date range, end.kind=date",
};

export const DirectionA_ThroughToday: Story = () => (
	<ValidatingHarness
		key="a-today"
		initial={{
			version: 1,
			likedAt: {
				kind: "range",
				startDate: "2024-01-01",
				end: { kind: "today" },
			},
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineA}
	/>
);
DirectionA_ThroughToday.meta = {
	description:
		'Direction A — explicit "through today" range (end.kind="today", dynamic)',
};

export const DirectionA_Disabled: Story = () => (
	<ValidatingHarness
		key="a-disabled"
		initial={{ version: 1 }}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineA}
		disabled
	/>
);
DirectionA_Disabled.meta = {
	description:
		"Direction A — disabled (options loading/error); all inputs disabled",
};

export const DirectionA_SparseBounds: Story = () => (
	<div className="p-4">
		<p className="text-sm theme-text-muted mb-3">
			oldest = null → add/edit affordance hidden. Active chips (if saved) remain
			via ActiveFilterChips outside this control.
		</p>
		<ValidatingHarness
			key="a-sparse"
			initial={{ version: 1 }}
			options={SPARSE_OPTIONS}
			Control={LikedDateTimelineA}
		/>
		<p className="text-[11px] theme-text-muted mt-2">
			(Nothing rendered below — correct behavior.)
		</p>
	</div>
);
DirectionA_SparseBounds.meta = {
	description: "Direction A — null oldest hides the control",
};

export const DirectionA_OutOfBoundsSaved: Story = () => (
	<ValidatingHarness
		key="a-oob"
		initial={{
			version: 1,
			likedAt: { kind: "before", endDate: "2015-12-31" },
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineA}
	/>
);
DirectionA_OutOfBoundsSaved.meta = {
	description:
		"Direction A — saved filter (before 2015) is outside library oldest (2019). Preserved and editable.",
};

export const DirectionA_Narrow: Story = () => (
	<div style={{ maxWidth: 240 }}>
		<ValidatingHarness
			key="a-narrow"
			initial={{ version: 1 }}
			options={MOCK_FILTER_OPTIONS}
			Control={LikedDateTimelineA}
		/>
	</div>
);
DirectionA_Narrow.meta = { description: "Direction A — narrow drawer (240px)" };

export const DirectionB_Empty: Story = () => (
	<ValidatingHarness
		key="b-empty"
		initial={{ version: 1 }}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineB}
	/>
);
DirectionB_Empty.meta = {
	description:
		"Direction B — horizontal timeline bar + draggable handles, no filter active",
};

export const DirectionB_YearSnap: Story = () => (
	<ValidatingHarness
		key="b-year-snap"
		initial={{
			version: 1,
			likedAt: {
				kind: "range",
				startDate: "2023-01-01",
				end: { kind: "date", date: "2023-12-31" },
			},
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineB}
	/>
);
DirectionB_YearSnap.meta = {
	description: "Direction B — 2023 range pre-set; year ticks show below bar",
};

export const DirectionB_ThroughToday: Story = () => (
	<ValidatingHarness
		key="b-today"
		initial={{
			version: 1,
			likedAt: {
				kind: "range",
				startDate: "2024-01-01",
				end: { kind: "today" },
			},
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineB}
	/>
);
DirectionB_ThroughToday.meta = {
	description:
		'Direction B — "through today" toggled on; high handle pinned to track end',
};

export const DirectionB_BeforeMode: Story = () => (
	<ValidatingHarness
		key="b-before"
		initial={{
			version: 1,
			likedAt: { kind: "before", endDate: "2022-06-15" },
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineB}
	/>
);

export const DirectionB_AfterMode: Story = () => (
	<ValidatingHarness
		key="b-after"
		initial={{
			version: 1,
			likedAt: { kind: "after", startDate: "2024-03-01" },
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineB}
	/>
);

export const DirectionB_Disabled: Story = () => (
	<ValidatingHarness
		key="b-disabled"
		initial={{ version: 1 }}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineB}
		disabled
	/>
);
DirectionB_Disabled.meta = {
	description: "Direction B — disabled; sliders and inputs are inert",
};

export const DirectionB_SparseBounds: Story = () => (
	<div className="p-4">
		<p className="text-sm theme-text-muted mb-3">
			oldest = null → timeline hidden.
		</p>
		<ValidatingHarness
			key="b-sparse"
			initial={{ version: 1 }}
			options={SPARSE_OPTIONS}
			Control={LikedDateTimelineB}
		/>
		<p className="text-[11px] theme-text-muted mt-2">
			(Nothing rendered below — correct behavior.)
		</p>
	</div>
);
DirectionB_SparseBounds.meta = {
	description: "Direction B — null oldest hides the timeline bar",
};

export const DirectionB_OutOfBoundsSaved: Story = () => (
	<ValidatingHarness
		key="b-oob"
		initial={{
			version: 1,
			likedAt: { kind: "before", endDate: "2015-12-31" },
		}}
		options={MOCK_FILTER_OPTIONS}
		Control={LikedDateTimelineB}
	/>
);
DirectionB_OutOfBoundsSaved.meta = {
	description:
		"Direction B — saved filter (before 2015) outside library oldest; preserved and editable",
};

export const DirectionB_Narrow: Story = () => (
	<div style={{ maxWidth: 240 }}>
		<ValidatingHarness
			key="b-narrow"
			initial={{ version: 1 }}
			options={MOCK_FILTER_OPTIONS}
			Control={LikedDateTimelineB}
		/>
	</div>
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
					Direction A — Year pills + mode tabs
				</p>
				<LikedDateTimelineA
					filters={filtersA}
					onFiltersChange={setFiltersA}
					options={MOCK_FILTER_OPTIONS}
				/>
			</div>
			<div>
				<p className="text-[11px] tracking-[0.08em] uppercase theme-text-muted mb-3">
					Direction B — Timeline bar + handles
				</p>
				<LikedDateTimelineB
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
