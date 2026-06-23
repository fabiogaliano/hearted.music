import type { ReactNode } from "react";
import { fonts } from "@/lib/theme/fonts";

interface CoverFlowEmptyStateProps {
	title: string;
	body: string;
	/** Rendered below the copy — the onboarding "Next" button, absent in production. */
	action?: ReactNode;
}

/**
 * The shelf's empty branch: skip the tall 3-D stage (a big void reads as broken)
 * for a compact invitation — a ghost sleeve where covers will land, pointing the
 * eye down to the rail it's filled from.
 */
export function CoverFlowEmptyState({
	title,
	body,
	action,
}: CoverFlowEmptyStateProps) {
	return (
		<div
			data-tour="concept"
			className="mt-3 flex min-h-[220px] flex-col items-center justify-center gap-5 text-center md:min-h-[260px]"
		>
			<div
				aria-hidden="true"
				className="theme-border-color theme-text-muted grid size-[120px] place-items-center border border-dashed text-4xl"
			>
				♫
			</div>
			<div className="flex flex-col items-center gap-1.5">
				<p
					className="theme-text text-lg font-light"
					style={{ fontFamily: fonts.display }}
				>
					{title}
				</p>
				<p
					className="theme-text-muted max-w-[46ch] text-[13px] text-pretty"
					style={{ fontFamily: fonts.body }}
				>
					{body}
				</p>
			</div>
			{action ? <div className="mt-1">{action}</div> : null}
		</div>
	);
}
