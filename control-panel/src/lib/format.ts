const compactFmt = new Intl.NumberFormat("en", {
	notation: "compact",
	maximumFractionDigits: 1,
});
const fullFmt = new Intl.NumberFormat("en");

export const fmt = (n: number): string => fullFmt.format(n);
export const compact = (n: number): string => compactFmt.format(n);

export function usd(n: number): string {
	return n.toLocaleString("en", {
		style: "currency",
		currency: "USD",
		minimumFractionDigits: n < 1 && n > 0 ? 4 : 2,
	});
}

export function pct(part: number, total: number): number {
	if (total <= 0) return 0;
	return Math.round((part / total) * 100);
}

export function duration(seconds: number | null): string {
	if (seconds == null) return "—";
	if (seconds < 60) return `${Math.round(seconds)}s`;
	if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
	if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
	return `${Math.round(seconds / 86400)}d`;
}

const humanDateFmt = new Intl.DateTimeFormat("en-GB", {
	day: "numeric",
	month: "long",
	year: "numeric",
});

function parseDate(iso: string): Date {
	// PostgreSQL to_char with OF produces "+HH" without minutes (e.g. "+00"), which
	// is not spec-compliant ISO 8601 — browsers return Invalid Date. Normalize to "+HH:00".
	return new Date(iso.replace(/([+-]\d{2})$/, "$1:00"));
}

export function humanDate(iso: string | null | undefined): string {
	if (!iso) return "—";
	const d = parseDate(iso);
	if (Number.isNaN(d.getTime())) return "—";
	return humanDateFmt.format(d);
}

export function relativeTime(iso: string): string {
	const then = parseDate(iso).getTime();
	if (Number.isNaN(then)) return iso;
	const diff = Math.round((Date.now() - then) / 1000);
	if (diff < 60) return `${diff}s ago`;
	if (diff < 3600) return `${Math.round(diff / 60)}m ago`;
	if (diff < 86400) return `${Math.round(diff / 3600)}h ago`;
	return `${Math.round(diff / 86400)}d ago`;
}
