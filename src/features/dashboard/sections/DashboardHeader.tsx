/** Welcome greeting, with the session's connection state beside it. */

import type { ReactNode } from "react";
import { fonts } from "@/lib/theme/fonts";

interface DashboardHeaderProps {
	handle: string | null;
	/** Sits where the library counts used to. A slot rather than a verdict prop:
	 * Dashboard already subscribes to the connection, and the header has no other
	 * reason to know the extension exists. Renders nothing while the connection
	 * is healthy, which is the point — this corner only speaks up when something
	 * needs the user. */
	trailing?: ReactNode;
}

export function DashboardHeader({ handle, trailing }: DashboardHeaderProps) {
	return (
		<div className="mb-10 flex flex-wrap items-start justify-between gap-x-8 gap-y-4">
			<div>
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Welcome back
				</p>
				{handle && (
					<h2
						className="theme-text mt-3 text-page-title font-extralight tracking-tight text-balance"
						style={{ fontFamily: fonts.display }}
					>
						@{handle}
					</h2>
				)}
			</div>
			{trailing}
		</div>
	);
}
