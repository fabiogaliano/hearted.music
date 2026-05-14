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
		<div className="space-y-1">
			<p
				className="theme-text-muted mb-4 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Recent Activity
			</p>

			{activities.map((item, idx) => (
				<ActivityItem key={item.id} item={item} showBorder={idx > 0} />
			))}
		</div>
	);
}

export default ActivityFeed;
