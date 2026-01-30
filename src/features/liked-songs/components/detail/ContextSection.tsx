/**
 * ContextSection: "Perfect For" - Listening contexts where song fits
 */
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";

interface ContextSectionProps {
	theme: ThemeConfig;
	bestMoments?: string[];
}

export function ContextSection({ theme, bestMoments }: ContextSectionProps) {
	if (!bestMoments || bestMoments.length === 0) return null;

	return (
		<section>
			<h4
				className="mb-4 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Perfect For
			</h4>
			<div className="flex flex-wrap gap-2">
				{bestMoments.map((moment) => (
					<span
						key={moment}
						className="px-3 py-1.5 text-xs"
						style={{
							fontFamily: fonts.body,
							background: theme.surface,
							color: theme.text,
						}}
					>
						{moment}
					</span>
				))}
			</div>
		</section>
	);
}
