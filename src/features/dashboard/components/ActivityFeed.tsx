/**
 * Activity feed component
 *
 * Timeline of recent matched songs.
 */

import { Link } from "@tanstack/react-router";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { RecentActivityItem } from "../types";
import { ActivityItem } from "./ActivityItem";

interface ActivityFeedProps {
	theme: ThemeConfig;
	activities: RecentActivityItem[];
}

export function ActivityFeed({ theme, activities }: ActivityFeedProps) {
	return (
		<div className="space-y-1">
			<p
				className="mb-4 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Recent Activity
			</p>

			{activities.length === 0 ? (
				<p
					className="py-4 text-sm"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					No recent activity. Start matching songs to see them here.
				</p>
			) : (
				activities.map((item, idx) => (
					<ActivityItem
						key={item.id}
						theme={theme}
						item={item}
						showBorder={idx > 0}
					/>
				))
			)}

			<Link
				to="/dashboard/liked"
				className="block py-3 text-xs tracking-widest uppercase transition-opacity hover:opacity-70"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				View all activity →
			</Link>
		</div>
	);
}
