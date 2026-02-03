/**
 * Navigation controls for song detail view
 * Supports both light and dark modes via isDark prop
 */
import { useTheme } from "@/lib/theme/ThemeHueProvider";

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
	const theme = useTheme();
	const color = isDark ? "rgba(255,255,255,0.7)" : theme.textMuted;

	return (
		<div className="flex items-center gap-0.5">
			<button
				onClick={onPrevious}
				disabled={!hasPrevious}
				className="p-1.5 transition-opacity hover:opacity-100 disabled:opacity-30"
				style={{ color }}
			>
				<svg
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
				onClick={onNext}
				disabled={!hasNext}
				className="p-1.5 transition-opacity hover:opacity-100 disabled:opacity-30"
				style={{ color }}
			>
				<svg
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
				onClick={onClose}
				className="ml-1 p-1.5 transition-opacity hover:opacity-100"
				style={{ color }}
			>
				<svg
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
