import NumberFlow from "@number-flow/react";
import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";
import { compact } from "../lib/format";
import { useSelectUser } from "../lib/user-selection";

export function UserLink({
	id,
	label,
	handle,
}: {
	id: string;
	label: string;
	handle?: string | null;
}) {
	const select = useSelectUser();
	return (
		<button type="button" className="user-link" onClick={() => select(id)}>
			<span className="primary">{label}</span>
			{handle && <span className="dim"> · @{handle}</span>}
		</button>
	);
}

export function Card({
	title,
	icon: IconCmp,
	action,
	span = 12,
	children,
}: {
	title?: string;
	icon?: Icon;
	action?: ReactNode;
	span?: 3 | 4 | 5 | 6 | 7 | 8 | 12;
	children: ReactNode;
}) {
	return (
		<section className={`card enter span-${span}`}>
			{title && (
				<header className="card-head">
					{IconCmp && <IconCmp className="icon" size={15} weight="bold" />}
					<h2>{title}</h2>
					{action && <div className="action">{action}</div>}
				</header>
			)}
			{children}
		</section>
	);
}

export function Stat({
	label,
	value,
	sub,
	icon: IconCmp,
}: {
	label: string;
	value: number;
	sub?: ReactNode;
	icon?: Icon;
}) {
	return (
		<div className="stat">
			<div className="stat-label">
				{IconCmp && (
					<span className="stat-icon">
						<IconCmp size={13} weight="bold" />
					</span>
				)}
				{label}
			</div>
			<NumberFlow className="stat-value" value={value} />
			{sub && <div className="stat-sub">{sub}</div>}
		</div>
	);
}

export function Badge({
	tone = "default",
	children,
}: {
	tone?: "default" | "accent" | "success" | "warning" | "danger";
	children: ReactNode;
}) {
	return <span className={`badge ${tone}`}>{children}</span>;
}

export function Bar({
	label,
	value,
	max,
	tone,
	onClick,
}: {
	label: string;
	value: number;
	max: number;
	tone?: "muted" | "danger" | "warning";
	onClick?: () => void;
}) {
	const width = max > 0 ? Math.max(2, (value / max) * 100) : 0;
	const inner = (
		<>
			<span className="bar-label">{label}</span>
			<div className="bar-track">
				<div
					className={`bar-fill ${tone ?? ""}`}
					style={{ width: `${width}%` }}
				/>
			</div>
			<span className="bar-value">{compact(value)}</span>
		</>
	);
	if (onClick) {
		return (
			<button
				type="button"
				className="bar-row bar-btn"
				onClick={onClick}
				disabled={value === 0}
			>
				{inner}
			</button>
		);
	}
	return <div className="bar-row">{inner}</div>;
}

export function Sparkline({ points }: { points: number[] }) {
	if (points.length < 2) {
		return <div className="empty">Not enough data yet.</div>;
	}
	const w = 100;
	const h = 40;
	const max = Math.max(...points, 1);
	const step = w / (points.length - 1);
	const coords = points.map((p, i) => [i * step, h - 2 - (p / max) * (h - 6)]);
	const line = coords
		.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`)
		.join(" ");
	const area = `${line} L${w},${h} L0,${h} Z`;
	return (
		<svg
			className="spark"
			viewBox={`0 0 ${w} ${h}`}
			preserveAspectRatio="none"
			role="img"
		>
			<title>Trend</title>
			<path className="area" d={area} />
			<path d={line} />
		</svg>
	);
}

export interface Column<T> {
	key: string;
	header: string;
	right?: boolean;
	render: (row: T) => ReactNode;
}

export function Table<T>({
	columns,
	rows,
	empty = "Nothing here yet.",
}: {
	columns: Column<T>[];
	rows: T[];
	empty?: string;
}) {
	if (rows.length === 0) return <div className="empty">{empty}</div>;
	return (
		<table className="table">
			<thead>
				<tr>
					{columns.map((c) => (
						<th key={c.key} className={c.right ? "right" : undefined}>
							{c.header}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{rows.map((row, i) => (
					// biome-ignore lint/suspicious/noArrayIndexKey: rows are read-only snapshots
					<tr key={i}>
						{columns.map((c) => (
							<td key={c.key} className={c.right ? "right" : undefined}>
								{c.render(row)}
							</td>
						))}
					</tr>
				))}
			</tbody>
		</table>
	);
}

export function Loading() {
	return (
		<div className="grid">
			{[0, 1, 2, 3].map((i) => (
				<div key={i} className="skeleton span-3" />
			))}
		</div>
	);
}

export function ErrorState({ message }: { message: string }) {
	return (
		<div className="card span-12">
			<div className="result err">Failed to load: {message}</div>
		</div>
	);
}
