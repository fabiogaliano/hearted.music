import { fonts } from "@/lib/theme/fonts";

export type RailSegment = "all" | "matching" | "library";

const SEGMENTS: { id: RailSegment; label: string }[] = [
	{ id: "all", label: "All" },
	{ id: "matching", label: "Matching" },
	{ id: "library", label: "Library" },
];

interface SegmentedFilterProps {
	value: RailSegment;
	onChange: (next: RailSegment) => void;
	counts: Record<RailSegment, number>;
}

/** The Rail's in-place filter: one pill group, the active segment filled. */
export function SegmentedFilter({
	value,
	onChange,
	counts,
}: SegmentedFilterProps) {
	return (
		<div
			role="tablist"
			aria-label="Filter playlists"
			className="theme-border-color inline-flex gap-0.5 rounded-full border p-[3px]"
		>
			{SEGMENTS.map((segment) => {
				const on = value === segment.id;
				return (
					<button
						key={segment.id}
						type="button"
						role="tab"
						aria-selected={on}
						onClick={() => onChange(segment.id)}
						className={`inline-flex items-center gap-[7px] rounded-full px-[15px] py-[7px] text-xs tracking-[0.04em] transition-[color,background-color,transform] duration-150 active:scale-[0.97] ${
							on
								? "theme-primary-action"
								: "theme-text-muted hover:text-(--t-text)"
						}`}
						style={{ fontFamily: fonts.body }}
					>
						{segment.label}
						<span
							className={`text-[11px] tabular-nums ${on ? "opacity-80" : "opacity-60"}`}
						>
							{counts[segment.id]}
						</span>
					</button>
				);
			})}
		</div>
	);
}
