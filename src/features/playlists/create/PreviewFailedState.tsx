import { fonts } from "@/lib/theme/fonts";

interface PreviewFailedStateProps {
	onRetry: () => void;
}

/**
 * Rendered when the preview request itself failed. Distinct from
 * LibraryEmptyState on purpose: an empty result is about the user's filters,
 * a failed request is about us.
 */
export function PreviewFailedState({ onRetry }: PreviewFailedStateProps) {
	return (
		<div className="flex flex-col items-center py-6 text-center" role="alert">
			<span
				className="theme-text block leading-none"
				style={{ fontFamily: fonts.display, fontSize: "1.125rem" }}
			>
				Couldn't load the preview
			</span>
			<p
				className="theme-text-muted mt-2 text-xs"
				style={{ fontFamily: fonts.body }}
			>
				Something went wrong on our side. Your filters are still here.
			</p>
			<button
				type="button"
				onClick={onRetry}
				className="chip-raised chip-raised-hover squircle focus-edge mt-3 inline-flex cursor-pointer items-center whitespace-nowrap rounded-full px-3 py-1.5 text-[11px] tracking-widest uppercase active:scale-[0.98]"
				style={{ fontFamily: fonts.body }}
			>
				Try again
			</button>
		</div>
	);
}
