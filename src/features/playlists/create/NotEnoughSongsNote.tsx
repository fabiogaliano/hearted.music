import { fonts } from "@/lib/theme/fonts";

interface NotEnoughSongsNoteProps {
	totalEligible: number;
	maxSongs: number;
	onClearFilters?: () => void;
}

export function NotEnoughSongsNote({
	totalEligible,
	maxSongs,
	onClearFilters,
}: NotEnoughSongsNoteProps) {
	return (
		<div
			className="theme-border-color flex items-center justify-between gap-3 border-t px-1 py-3"
			role="note"
		>
			<span className="theme-text text-xs" style={{ fontFamily: fonts.body }}>
				Only{" "}
				<span style={{ fontFamily: fonts.display, fontSize: "0.9375rem" }}>
					{totalEligible}
				</span>{" "}
				{totalEligible === 1 ? "song matches" : "songs match"} — you asked for{" "}
				{maxSongs}.
			</span>
			{onClearFilters && (
				<button
					type="button"
					onClick={onClearFilters}
					className="hover-border-brighten focus-edge inline-flex flex-none cursor-pointer items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] tracking-widest uppercase active:scale-[0.98]"
					style={{ fontFamily: fonts.body }}
				>
					Clear filters
				</button>
			)}
		</div>
	);
}
