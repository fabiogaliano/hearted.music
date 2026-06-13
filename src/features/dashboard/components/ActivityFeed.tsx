/** Timeline feed showing recent activity, sorted by timestamp descending. */

import type { ReactNode } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { ActivityItem as ActivityItemType } from "../types";
import { ActivityItem } from "./ActivityItem";

interface ActivityFeedProps {
	activities: ActivityItemType[];
	/** Right-aligned slot on the header line — e.g. the sync status/control. */
	trailing?: ReactNode;
}

export function ActivityFeed({ activities = [], trailing }: ActivityFeedProps) {
	if (activities.length === 0 && !trailing) return null;

	return (
		<section>
			<div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Recent Activity
				</p>
				{trailing}
			</div>

			{activities.length > 0 && (
				<ul className="flex flex-col">
					{activities.map((item) => (
						<li key={item.id}>
							<ActivityItem item={item} />
						</li>
					))}
				</ul>
			)}
		</section>
	);
}
