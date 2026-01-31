/** Timeline feed showing recent activity, sorted by timestamp descending. */
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { ActivityItem as ActivityItemType } from "../types";
import { ActivityItem } from "./ActivityItem";

interface ActivityFeedProps {
	theme: ThemeConfig;
	activities: ActivityItemType[];
}

export function ActivityFeed({ theme, activities }: ActivityFeedProps) {
	if (activities.length === 0) return null;

	return (
		<div className="space-y-1">
			<p
				className="mb-4 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Recent Activity
			</p>

			{activities.map((item, idx) => (
				<ActivityItem
					key={item.id}
					theme={theme}
					item={item}
					showBorder={idx > 0}
				/>
			))}

			{/* <Link
				to="/liked-songs"
				className="block py-3 text-xs tracking-widest uppercase transition-opacity hover:opacity-70"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				View all activity →
			</Link> */}
		</div>
	);
}

export default ActivityFeed;
