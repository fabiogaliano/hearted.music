const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

/**
 * @example
 * formatRelativeTime("2024-01-15T12:00:00Z") // "2 hours ago"
 * formatRelativeTime("2024-01-14T12:00:00Z") // "yesterday"
 */
export function formatRelativeTime(isoDate: string): string {
	const diffSecs = Math.floor(
		(Date.now() - new Date(isoDate).getTime()) / 1000,
	);

	if (diffSecs < 60) return rtf.format(-diffSecs, "second");
	if (diffSecs < 3600) return rtf.format(-Math.floor(diffSecs / 60), "minute");
	if (diffSecs < 86400) return rtf.format(-Math.floor(diffSecs / 3600), "hour");
	if (diffSecs < 604800)
		return rtf.format(-Math.floor(diffSecs / 86400), "day");

	return new Date(isoDate).toLocaleDateString();
}
