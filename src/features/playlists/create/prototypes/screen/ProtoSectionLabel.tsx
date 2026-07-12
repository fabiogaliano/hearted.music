/**
 * Prototype shared atom — the prod screen's section-label idiom (uppercase
 * tracked label + hairline), with an optional trailing meta slot for counts.
 */

import { fonts } from "@/lib/theme/fonts";

interface ProtoSectionLabelProps {
	children: React.ReactNode;
	meta?: string;
}

export function ProtoSectionLabel({ children, meta }: ProtoSectionLabelProps) {
	return (
		<div className="mb-4 flex items-center gap-4 px-1">
			<h2
				className="theme-text-muted m-0 text-xs font-normal tracking-[0.2em] uppercase"
				style={{ fontFamily: fonts.body }}
			>
				{children}
			</h2>
			<div className="theme-border-color h-px flex-1 border-t" />
			{meta && (
				<span
					className="theme-text-muted text-xs tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{meta}
				</span>
			)}
		</div>
	);
}
