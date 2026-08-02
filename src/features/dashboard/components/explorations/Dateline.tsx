import { fonts } from "@/lib/theme/fonts";

/** One-line context: greeting + sync state. Each composition places it inside
 * its own brand header, so this stays a single muted line, not a row. */
export function Dateline({ className = "" }: { className?: string }) {
	return (
		<p
			className={`theme-text-muted flex items-center gap-2 text-xs ${className}`}
			style={{ fontFamily: fonts.body }}
		>
			<span className="theme-text-muted-bg size-1.5 rounded-full" />
			Welcome back · Synced 2 hours ago
		</p>
	);
}
