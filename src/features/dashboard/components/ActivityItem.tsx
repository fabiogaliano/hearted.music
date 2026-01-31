/**
 * Polymorphic activity item using discriminated union.
 * Switch on `item.type` for exhaustive handling; TypeScript enforces coverage.
 */

import type { CSSProperties, ReactNode } from "react";
import type { ActivityItem as ActivityItemType } from "../types";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import { formatRelativeTime } from "@/lib/shared/utils/format-time";

interface ActivityItemProps {
	theme: ThemeConfig;
	item: ActivityItemType;
	showBorder: boolean;
}

function renderDescription(
	item: ActivityItemType,
	theme: ThemeConfig,
): ReactNode {
	switch (item.type) {
		case "liked":
			return <>liked at {formatRelativeTime(item.timestamp)}</>;
		case "matched":
			return (
				<>
					matched to{" "}
					<span style={{ color: theme.text }}>{item.playlistName}</span> ·{" "}
					{formatRelativeTime(item.timestamp)}
				</>
			);
		default: {
			const exhaustiveCheck: never = item;
			throw new Error(`Unhandled activity type: ${exhaustiveCheck}`);
		}
	}
}

export function ActivityItem({ theme, item, showBorder }: ActivityItemProps) {
	const imageUrl = item.imageUrl ?? "";
	const songName = item.songName;

	return (
		<div
			className="group -mx-4 flex cursor-pointer items-start gap-4 px-4 py-4 transition-colors hover:bg-(--surface)"
			style={
				{
					"--surface": theme.surface,
					borderTop: showBorder ? `1px solid ${theme.border}` : "none",
				} as CSSProperties
			}
		>
			{imageUrl ? (
				<img
					src={imageUrl}
					alt={songName}
					className="h-14 w-14 shrink-0 object-cover"
				/>
			) : (
				<div
					className="flex h-14 w-14 shrink-0 items-center justify-center"
					style={{ background: theme.surface }}
				>
					<span style={{ color: theme.textMuted, fontSize: "1.5rem" }}>♪</span>
				</div>
			)}
			<div className="min-w-0 flex-1 pt-1">
				<p
					className="truncate text-lg font-light"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					{songName}
				</p>
				<p
					className="mt-0.5 text-sm"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{item.artistName}
				</p>
				<p
					className="mt-2 text-xs"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{renderDescription(item, theme)}
				</p>
			</div>
		</div>
	);
}

export default ActivityItem;
