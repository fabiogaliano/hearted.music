import { Button } from "@/components/ui/Button";

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
			<Button
				variant="icon"
				onClick={onPrevious}
				disabled={!hasPrevious}
				className={colorClass}
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
			</Button>
			<Button
				variant="icon"
				onClick={onNext}
				disabled={!hasNext}
				className={colorClass}
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
			</Button>
			<Button
				variant="icon"
				onClick={onClose}
				className={`${colorClass} ml-1`}
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
			</Button>
		</div>
	);
}
