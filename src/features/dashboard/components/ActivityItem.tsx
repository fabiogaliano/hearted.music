/**
 * Polymorphic activity item using discriminated union.
 * Switch on `item.type` for exhaustive handling; TypeScript enforces coverage.
 */

import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { formatRelativeTime } from "@/lib/shared/utils/format-time";
import { fonts } from "@/lib/theme/fonts";
import { generateSongSlug } from "@/lib/utils/slug";
import type { ActivityItem as ActivityItemType } from "../types";

interface ActivityItemProps {
	item: ActivityItemType;
}

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

// "3 hours ago" within the week; "4 Jul" same year; "4 Jul 2024" older.
// Rendered on the server and re-derived at hydration from a later clock, so
// the hosting <p> carries suppressHydrationWarning: a one-second drift must not
// discard the server tree (React #418).
// Abbreviated month is unambiguous between US/EU readers and pairs cleanly
// with the uppercase kicker; the all-numeric locale fallback reads as data.
function formatActivityDate(isoDate: string): string {
	const date = new Date(isoDate);
	const now = new Date();

	if (now.getTime() - date.getTime() < ONE_WEEK_MS) {
		return formatRelativeTime(isoDate);
	}

	const sameYear = date.getFullYear() === now.getFullYear();
	return new Intl.DateTimeFormat("en-GB", {
		day: "numeric",
		month: "short",
		...(sameYear ? {} : { year: "numeric" }),
	}).format(date);
}

function renderMeta(item: ActivityItemType): ReactNode {
	const when = formatActivityDate(item.timestamp);

	switch (item.type) {
		case "liked":
			return (
				<>
					<p
						className="theme-text-muted text-[10px] tracking-[0.2em] uppercase opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						Liked
					</p>
					<p
						className="theme-text-muted mt-2 text-xs tabular-nums"
						style={{ fontFamily: fonts.body }}
						suppressHydrationWarning
					>
						{when}
					</p>
				</>
			);
		case "matched":
			return (
				<>
					<p
						className="theme-text-muted text-[10px] tracking-[0.2em] uppercase opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						Matched to
					</p>
					<p
						className="theme-text mt-1.5 truncate text-sm"
						style={{ fontFamily: fonts.display }}
						title={item.playlistName}
					>
						{item.playlistName}
					</p>
					<p
						className="theme-text-muted mt-1 text-xs tabular-nums"
						style={{ fontFamily: fonts.body }}
						suppressHydrationWarning
					>
						{when}
					</p>
				</>
			);
		default: {
			const exhaustiveCheck: never = item;
			throw new Error(`Unhandled activity type: ${exhaustiveCheck}`);
		}
	}
}

export function ActivityItem({ item }: ActivityItemProps) {
	const imageUrl = item.imageUrl ?? "";
	const songName = item.songName;
	const songSlug = generateSongSlug(item.artistName, songName);

	return (
		<Link
			to="/liked-songs"
			search={{ song: songSlug }}
			// Modelled on the vision tracklist's evolved SongRow: transparent at rest
			// (a feed row is not a card — a resting fill would stack the timeline into
			// cards), radius 10 so the hover lands as a rounded row rather than a
			// full-bleed band, and the hover itself is the shared plane temperature, so
			// "hovered" reads the same here as on the CTAs above.
			className="surface-raised-hover squircle focus-edge -mx-4 flex items-center gap-6 rounded-[10px] px-4 py-5 transition-[background-color] duration-150 ease-out"
		>
			{imageUrl ? (
				// Square on purpose — cover art stays a photograph here. image-outline
				// rather than the hardcoded white `outline` this carried, which is a
				// 10%-white hairline that simply doesn't show on the light themes; the
				// shared utility (used by every other cover in the app) flips per theme.
				<img
					src={imageUrl}
					alt={songName}
					loading="lazy"
					className="image-outline size-20 shrink-0 object-cover"
				/>
			) : (
				<div className="theme-surface-bg image-outline flex size-20 shrink-0 items-center justify-center">
					<span className="theme-text-muted text-3xl">♪</span>
				</div>
			)}
			<div className="min-w-0 flex-1">
				<p
					className="theme-text truncate text-xl font-light leading-[1.1]"
					style={{ fontFamily: fonts.display }}
					title={songName}
				>
					{songName}
				</p>
				<p
					className="theme-text-muted mt-0.5 truncate text-sm leading-tight"
					style={{ fontFamily: fonts.body }}
				>
					{item.artistName}
				</p>
			</div>
			<div className="w-32 shrink-0 text-right">{renderMeta(item)}</div>
		</Link>
	);
}
