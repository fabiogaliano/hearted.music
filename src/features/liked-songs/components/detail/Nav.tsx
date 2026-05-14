/**
 * Navigation controls for song detail view
 * Supports both light and dark modes via isDark prop
 */
interface NavProps {
	onClose: () => void;
	onNext: () => void;
	onPrevious: () => void;
	hasNext: boolean;
	hasPrevious: boolean;
	isDark?: boolean;
}

export function Nav({
	onClose,
	onNext,
	onPrevious,
	hasNext,
	hasPrevious,
	isDark = false,
}: NavProps) {
	const colorClass = isDark ? "text-white/70" : "theme-text-muted";

	return (
		<div className="flex items-center gap-0.5">
			<button
				type="button"
				onClick={onPrevious}
				disabled={!hasPrevious}
				className={`${colorClass} p-1.5 transition-[transform,opacity] duration-100 hover:opacity-100 active:scale-[0.9] disabled:opacity-30`}
				aria-label="Previous song"
			>
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
				>
					<path d="M15 18l-6-6 6-6" />
				</svg>
			</button>
			<button
				type="button"
				onClick={onNext}
				disabled={!hasNext}
				className={`${colorClass} p-1.5 transition-[transform,opacity] duration-100 hover:opacity-100 active:scale-[0.9] disabled:opacity-30`}
				aria-label="Next song"
			>
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="1.5"
				>
					<path d="M9 18l6-6-6-6" />
				</svg>
			</button>
			<button
				type="button"
				onClick={onClose}
				className={`${colorClass} ml-1 p-1.5 transition-[transform,opacity] duration-100 hover:opacity-100 active:scale-[0.9]`}
				aria-label="Close song detail"
			>
				<svg
					aria-hidden="true"
					width="14"
					height="14"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
				>
					<path d="M18 6L6 18M6 6l12 12" />
				</svg>
			</button>
		</div>
	);
}
