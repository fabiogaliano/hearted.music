/**
 * Activity item component
 *
 * Single row showing a matched song with album art, details, and timestamp.
 */

import { useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { RecentActivityItem } from "../types";

interface ActivityItemProps {
	theme: ThemeConfig;
	item: RecentActivityItem;
	showBorder: boolean;
}

export function ActivityItem({ theme, item, showBorder }: ActivityItemProps) {
	const [isHovered, setIsHovered] = useState(false);

	return (
		<div
			className="group -mx-4 flex cursor-pointer items-start gap-4 px-4 py-4 transition-colors"
			style={{
				borderTop: showBorder ? `1px solid ${theme.border}` : "none",
				background: isHovered ? theme.surface : "transparent",
			}}
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			<img
				src={item.image}
				alt={item.song}
				className="h-14 w-14 flex-shrink-0 object-cover"
			/>
			<div className="min-w-0 flex-1 pt-1">
				<p
					className="truncate text-lg font-light"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					{item.song}
				</p>
				<p
					className="mt-0.5 text-sm"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{item.artist}
				</p>
				<p
					className="mt-2 text-xs"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Matched to <span style={{ color: theme.text }}>{item.playlist}</span>{" "}
					· {item.time}
				</p>
			</div>
		</div>
	);
}
