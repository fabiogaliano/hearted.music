import { fonts } from "@/lib/theme/fonts";

interface LibraryEmptyStateProps {
	isWarming?: boolean;
	onClearFilters?: () => void;
}

export function LibraryEmptyState({
	isWarming = false,
	onClearFilters,
}: LibraryEmptyStateProps) {
	return (
		<div
			className="flex flex-col items-center py-6 text-center"
			role="status"
			aria-live="polite"
		>
			<span
				className="theme-text block leading-none"
				style={{ fontFamily: fonts.display, fontSize: "1.125rem" }}
			>
				{isWarming ? "Warming up" : "Nothing matches"}
			</span>
			<p
				className="theme-text-muted mt-2 text-xs"
				style={{ fontFamily: fonts.body }}
			>
				{isWarming
					? "Preparing your library for the first time."
					: "No songs match the current filters."}
			</p>
			{!isWarming && onClearFilters && (
				<button
					type="button"
					onClick={onClearFilters}
					className="chip-raised chip-raised-hover squircle focus-edge mt-3 inline-flex cursor-pointer items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] tracking-widest uppercase active:scale-[0.98]"
					style={{ fontFamily: fonts.body }}
				>
					Clear filters
				</button>
			)}
		</div>
	);
}
