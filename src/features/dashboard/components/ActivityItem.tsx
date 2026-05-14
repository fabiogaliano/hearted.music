/**
 * Polymorphic activity item using discriminated union.
 * Switch on `item.type` for exhaustive handling; TypeScript enforces coverage.
 */

import type { ReactNode } from "react";
import { formatRelativeTime } from "@/lib/shared/utils/format-time";
import { fonts } from "@/lib/theme/fonts";
import type { ActivityItem as ActivityItemType } from "../types";

interface ActivityItemProps {
	item: ActivityItemType;
	showBorder: boolean;
}

function renderDescription(item: ActivityItemType): ReactNode {
	switch (item.type) {
		case "liked":
			return <>liked at {formatRelativeTime(item.timestamp)}</>;
		case "matched":
			return (
				<>
					matched to <span className="theme-text">{item.playlistName}</span> ·{" "}
					{formatRelativeTime(item.timestamp)}
				</>
			);
		default: {
			const exhaustiveCheck: never = item;
			throw new Error(`Unhandled activity type: ${exhaustiveCheck}`);
		}
	}
}

export function ActivityItem({ item, showBorder }: ActivityItemProps) {
	const imageUrl = item.imageUrl ?? "";
	const songName = item.songName;

	return (
		<div
			className={`${showBorder ? "theme-border-color border-t" : ""} theme-hover-surface group -mx-4 flex items-start gap-4 px-4 py-4 transition-colors`}
		>
			{imageUrl ? (
				<img
					src={imageUrl}
					alt={songName}
					className="h-14 w-14 shrink-0 object-cover"
				/>
			) : (
				<div className="theme-surface-bg flex h-14 w-14 shrink-0 items-center justify-center">
					<span className="theme-text-muted text-2xl">♪</span>
				</div>
			)}
			<div className="min-w-0 flex-1 pt-1">
				<p
					className="theme-text truncate text-lg font-light"
					style={{ fontFamily: fonts.display }}
				>
					{songName}
				</p>
				<p
					className="theme-text-muted mt-0.5 text-sm"
					style={{ fontFamily: fonts.body }}
				>
					{item.artistName}
				</p>
				<p
					className="theme-text-muted mt-2 text-xs"
					style={{ fontFamily: fonts.body }}
				>
					{renderDescription(item)}
				</p>
			</div>
		</div>
	);
}
