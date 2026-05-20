/** Timeline feed showing recent activity, sorted by timestamp descending. */

import { fonts } from "@/lib/theme/fonts";
import type { ActivityItem as ActivityItemType } from "../types";
import { ActivityItem } from "./ActivityItem";

interface ActivityFeedProps {
	activities: ActivityItemType[];
}

export function ActivityFeed({ activities = [] }: ActivityFeedProps) {
	if (activities.length === 0) return null;

	return (
		<section>
			<p
				className="theme-text-muted mb-6 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Recent Activity
			</p>

			<ul className="flex flex-col">
				{activities.map((item) => (
					<li key={item.id}>
						<ActivityItem item={item} />
					</li>
				))}
			</ul>
		</section>
	);
}
