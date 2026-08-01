/**
 * Why --t-border stops working once a control sits on a raised plane.
 *
 * The story measures itself: every ΔL printed below is read out of the DOM with
 * getComputedStyle and composited in JS, not copied from a spreadsheet. Switch
 * the theme in Ladle's control panel and the numbers re-measure.
 *
 * Throwaway: delete once a treatment is picked.
 */

import { useLayoutEffect, useRef, useState } from "react";
import { fonts } from "@/lib/theme/fonts";

export default { title: "Plane Border Controls" };

// --- colour maths ------------------------------------------------------------

type Rgba = { r: number; g: number; b: number; a: number };

/** Parses what getComputedStyle actually hands back: rgb(), rgba(), color(srgb …). */
function parseColor(input: string): Rgba {
	const srgb = input.match(
		/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/,
	);
	if (srgb) {
		return {
			r: Number(srgb[1]) * 255,
			g: Number(srgb[2]) * 255,
			b: Number(srgb[3]) * 255,
			a: srgb[4] === undefined ? 1 : Number(srgb[4]),
		};
	}
	const rgb = input.match(
		/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.%]+))?/,
	);
	if (!rgb) return { r: 0, g: 0, b: 0, a: 0 };
	const rawA = rgb[4];
	return {
		r: Number(rgb[1]),
		g: Number(rgb[2]),
		b: Number(rgb[3]),
		a:
			rawA === undefined
				? 1
				: rawA.endsWith("%")
					? Number(rawA.slice(0, -1)) / 100
					: Number(rawA),
	};
}

/** sRGB → OKLab lightness (Björn Ottosson). */
function oklabL({ r, g, b }: Rgba): number {
	const lin = (c: number) => {
		const v = c / 255;
		return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
	};
	const [lr, lg, lb] = [lin(r), lin(g), lin(b)];
	const l = Math.cbrt(
		0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb,
	);
	const m = Math.cbrt(
		0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb,
	);
	const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.629978709 * lb);
	return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
}

/** What the eye actually receives: a translucent edge painted onto its ground. */
function composite(edge: Rgba, ground: Rgba): Rgba {
	return {
		r: edge.r * edge.a + ground.r * (1 - edge.a),
		g: edge.g * edge.a + ground.g * (1 - edge.a),
		b: edge.b * edge.a + ground.b * (1 - edge.a),
		a: 1,
	};
}

// --- what's being compared ---------------------------------------------------

/**
 * The four grounds a control in this app can land on. --t-plane / --t-plane-lit
 * only resolve to the raised values inside .surface-raised, so those two probes
 * are nested in one.
 */
const GROUNDS = [
	{ key: "page", label: "Page" },
	{ key: "plane", label: "Plane" },
	{ key: "chip", label: "Chip" },
	{ key: "lit", label: "Lit row" },
] as const;

const TREATMENTS = [
	{
		key: "border",
		label: "--t-border",
		note: "today — opaque, fixed against the page",
		value: "var(--t-border)",
	},
	{
		key: "ink9",
		label: "ink 9%",
		note: "same as .plane-rule, the internal seam",
		value: "color-mix(in srgb, var(--t-text) 9%, transparent)",
	},
	{
		key: "ink12",
		label: "ink 12%",
		note: "",
		value: "color-mix(in srgb, var(--t-text) 12%, transparent)",
	},
	{
		key: "ink14",
		// Reads the shipped token rather than a copy of its value, so this row
		// re-measures whatever --t-control-edge currently resolves to.
		label: "ink 14% — var(--t-control-edge)",
		note: "shipped",
		value: "var(--t-control-edge)",
	},
	{
		key: "ink18",
		label: "ink 18%",
		note: "",
		value: "color-mix(in srgb, var(--t-text) 18%, transparent)",
	},
] as const;

type Measurements = {
	grounds: Record<string, number>;
	/** treatmentKey -> groundKey -> ΔL of the edge against that ground */
	deltas: Record<string, Record<string, number>>;
};

/**
 * Reads the real painted colours out of probe nodes. Done in a layout effect so
 * the numbers reflect the theme Ladle currently has applied, not a build-time
 * guess.
 */
function useMeasurements(
	groundRefs: React.RefObject<Record<string, HTMLElement | null>>,
	edgeRefs: React.RefObject<Record<string, HTMLElement | null>>,
	themeKey: string,
): Measurements | null {
	const [result, setResult] = useState<Measurements | null>(null);

	useLayoutEffect(() => {
		const groundColors: Record<string, Rgba> = {};
		const grounds: Record<string, number> = {};
		for (const g of GROUNDS) {
			const el = groundRefs.current?.[g.key];
			if (!el) return;
			const c = parseColor(getComputedStyle(el).backgroundColor);
			groundColors[g.key] = c;
			grounds[g.key] = oklabL(c);
		}

		const deltas: Record<string, Record<string, number>> = {};
		for (const t of TREATMENTS) {
			const el = edgeRefs.current?.[t.key];
			if (!el) return;
			const edge = parseColor(getComputedStyle(el).backgroundColor);
			deltas[t.key] = {};
			for (const g of GROUNDS) {
				const painted = composite(edge, groundColors[g.key]);
				deltas[t.key][g.key] = grounds[g.key] - oklabL(painted);
			}
		}

		setResult({ grounds, deltas });
	}, [groundRefs, edgeRefs, themeKey]);

	return result;
}

// --- the controls, copied from their real call sites -------------------------

/** SongCard's selection checkbox (size-5, square, 1px border). */
function Checkbox({ edge, checked }: { edge: string; checked: boolean }) {
	return (
		<span
			className="flex size-5 shrink-0 items-center justify-center border"
			style={{
				borderColor: checked ? "var(--t-primary)" : edge,
				background: checked ? "var(--t-primary)" : "transparent",
			}}
		>
			{checked && (
				<svg viewBox="0 0 16 16" className="size-3" aria-hidden="true">
					<title>checked</title>
					<path
						d="M3 8.5l3.5 3.5L13 5"
						fill="none"
						stroke="var(--t-text-on-primary)"
						strokeWidth="2.5"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</svg>
			)}
		</span>
	);
}

/** SettingsPage's strictness radio dot (size-4, round, inset ring). */
function RadioDot({ edge, checked }: { edge: string; checked: boolean }) {
	return (
		<span
			aria-hidden="true"
			className="inline-block size-4 shrink-0 rounded-full"
			style={{
				boxShadow: checked
					? "inset 0 0 0 5px var(--t-text)"
					: `inset 0 0 0 1px ${edge}`,
			}}
		/>
	);
}

// --- layout helpers ----------------------------------------------------------

function Label({
	children,
	dim,
}: {
	children: React.ReactNode;
	dim?: boolean;
}) {
	return (
		<span
			style={{
				fontFamily: fonts.body,
				fontSize: 11,
				letterSpacing: "0.08em",
				textTransform: "uppercase",
				color: dim ? "var(--t-text-muted)" : "var(--t-text)",
			}}
		>
			{children}
		</span>
	);
}

function Note({ children }: { children: React.ReactNode }) {
	return (
		<p
			style={{
				fontFamily: fonts.body,
				fontSize: 13,
				lineHeight: 1.55,
				color: "var(--t-text-muted)",
				maxWidth: "62ch",
				margin: 0,
			}}
		>
			{children}
		</p>
	);
}

/** A swatch of one ground, with the control drawn on it. */
function GroundCell({
	groundKey,
	children,
}: {
	groundKey: string;
	children: React.ReactNode;
}) {
	const base: React.CSSProperties = {
		display: "grid",
		placeItems: "center",
		height: 56,
		borderRadius: 10,
	};
	if (groundKey === "page") {
		return <div style={{ ...base, background: "var(--t-bg)" }}>{children}</div>;
	}
	if (groundKey === "plane") {
		return (
			<div className="surface-raised squircle" style={base}>
				{children}
			</div>
		);
	}
	if (groundKey === "chip") {
		return (
			<div className="chip-raised squircle" style={base}>
				{children}
			</div>
		);
	}
	return (
		<div className="surface-raised squircle" style={base}>
			<div
				style={{
					...base,
					width: "100%",
					background: "var(--t-plane-lit)",
				}}
			>
				{children}
			</div>
		</div>
	);
}

// --- story 1: the problem ----------------------------------------------------

export const EdgeOnEveryGround = () => {
	const groundRefs = useRef<Record<string, HTMLElement | null>>({});
	const edgeRefs = useRef<Record<string, HTMLElement | null>>({});
	const [themeKey, setThemeKey] = useState("");

	// Ladle swaps the theme by rewriting :root, which fires no React update, so
	// the probes are re-read whenever --t-bg changes.
	useLayoutEffect(() => {
		const read = () =>
			getComputedStyle(document.documentElement).getPropertyValue("--t-bg");
		setThemeKey(read());
		const id = window.setInterval(() => setThemeKey(read()), 400);
		return () => window.clearInterval(id);
	}, []);

	const m = useMeasurements(groundRefs, edgeRefs, themeKey);
	const fmt = (n: number | undefined) => (n === undefined ? "—" : n.toFixed(3));

	return (
		<div
			style={{
				padding: 40,
				display: "flex",
				flexDirection: "column",
				gap: 28,
				minHeight: "100vh",
			}}
		>
			{/* Hidden probes — the source of every number on screen. */}
			<div style={{ position: "absolute", opacity: 0, pointerEvents: "none" }}>
				<div
					ref={(el) => {
						groundRefs.current.page = el;
					}}
					style={{ background: "var(--t-bg)", width: 4, height: 4 }}
				/>
				<div className="surface-raised">
					<div
						ref={(el) => {
							groundRefs.current.plane = el;
						}}
						style={{ background: "var(--t-plane)", width: 4, height: 4 }}
					/>
					<div
						ref={(el) => {
							groundRefs.current.lit = el;
						}}
						style={{ background: "var(--t-plane-lit)", width: 4, height: 4 }}
					/>
				</div>
				<div
					className="chip-raised"
					ref={(el) => {
						groundRefs.current.chip = el;
					}}
					style={{ width: 4, height: 4 }}
				/>
				{TREATMENTS.map((t) => (
					<div
						key={t.key}
						ref={(el) => {
							edgeRefs.current[t.key] = el;
						}}
						style={{ background: t.value, width: 4, height: 4 }}
					/>
				))}
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
				<h1
					style={{
						fontFamily: fonts.display,
						fontWeight: 200,
						fontSize: 34,
						margin: 0,
						lineHeight: 1.05,
					}}
				>
					Look at the top row first.
				</h1>
				<Note>
					It is the <strong>same checkbox with the same token</strong> four
					times — only the surface under it changes. Left to right the edge gets
					harder, because <code>--t-border</code> is an opaque colour picked
					against the page, and the plane is lighter than the page. The number
					under each is the measured ΔL between the edge and its own ground.
				</Note>
				<Note>
					Every row below it is <code>--t-text</code> mixed into transparency.
					Those are translucent, so they composite onto whatever is behind them
					and stay the same weight on all four grounds. Read the{" "}
					<strong>spread</strong> column on the right: that is the whole
					argument.
				</Note>
			</div>

			{/* Column headers */}
			<div
				style={{
					display: "grid",
					gridTemplateColumns: `200px repeat(${GROUNDS.length}, 1fr) 120px`,
					gap: 14,
					alignItems: "end",
				}}
			>
				<span />
				{GROUNDS.map((g) => (
					<div
						key={g.key}
						style={{ display: "flex", flexDirection: "column", gap: 3 }}
					>
						<Label>{g.label}</Label>
						<span
							style={{
								fontFamily: fonts.body,
								fontSize: 11,
								color: "var(--t-text-muted)",
								fontVariantNumeric: "tabular-nums",
							}}
						>
							L {fmt(m?.grounds[g.key])}
						</span>
					</div>
				))}
				<Label dim>spread</Label>
			</div>

			{TREATMENTS.map((t) => {
				const row = m?.deltas[t.key];
				const values = row ? GROUNDS.map((g) => row[g.key]) : [];
				const spread = values.length
					? Math.max(...values) - Math.min(...values)
					: undefined;
				const isCurrent = t.key === "border";
				const isPick = t.key === "ink14";

				return (
					<div
						key={t.key}
						style={{
							display: "grid",
							gridTemplateColumns: `200px repeat(${GROUNDS.length}, 1fr) 120px`,
							gap: 14,
							alignItems: "center",
							padding: "10px 12px",
							marginLeft: -12,
							borderRadius: 12,
							background: isPick
								? "color-mix(in srgb, var(--t-primary) 7%, transparent)"
								: "transparent",
						}}
					>
						<div style={{ display: "flex", flexDirection: "column", gap: 3 }}>
							<Label>
								{t.label}
								{isPick ? " ✓" : ""}
							</Label>
							{t.note && (
								<span
									style={{
										fontFamily: fonts.body,
										fontSize: 11,
										color: "var(--t-text-muted)",
										textTransform: "none",
										letterSpacing: 0,
									}}
								>
									{t.note}
								</span>
							)}
						</div>

						{GROUNDS.map((g) => (
							<div
								key={g.key}
								style={{ display: "flex", flexDirection: "column", gap: 5 }}
							>
								<GroundCell groundKey={g.key}>
									<div style={{ display: "flex", gap: 12 }}>
										<Checkbox edge={t.value} checked={false} />
										<RadioDot edge={t.value} checked={false} />
									</div>
								</GroundCell>
								<span
									style={{
										fontFamily: fonts.body,
										fontSize: 11,
										textAlign: "center",
										fontVariantNumeric: "tabular-nums",
										color: "var(--t-text-muted)",
									}}
								>
									{fmt(row?.[g.key])}
								</span>
							</div>
						))}

						<span
							style={{
								fontFamily: fonts.body,
								fontSize: 15,
								fontVariantNumeric: "tabular-nums",
								color: isCurrent ? "var(--t-text)" : "var(--t-text-muted)",
								fontWeight: isCurrent ? 500 : 400,
							}}
						>
							{fmt(spread)}
						</span>
					</div>
				);
			})}

			<Note>
				<code>--t-border</code> roughly doubles in weight from page to lit row.
				Any ink mix holds within about 0.01 of itself everywhere. That is the
				difference between an edge that was chosen for one surface and an edge
				that is defined <em>relative to</em> whatever surface it lands on.
			</Note>
		</div>
	);
};

// --- story 2: the two real controls ------------------------------------------

export const InContext = () => {
	const [checked, setChecked] = useState(true);

	return (
		<div
			style={{
				padding: 40,
				display: "flex",
				flexDirection: "column",
				gap: 28,
				minHeight: "100vh",
			}}
		>
			<div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
				<h1
					style={{
						fontFamily: fonts.display,
						fontWeight: 200,
						fontSize: 34,
						margin: 0,
						lineHeight: 1.05,
					}}
				>
					The two controls, in their real homes.
				</h1>
				<Note>
					Left column is what ships today, right column is ink 14%. Both states
					are painted in — nothing to hover for. The selected states are
					identical in both columns on purpose: they use{" "}
					<code>--t-primary</code> and <code>--t-text</code>, so only the{" "}
					<strong>unselected</strong> control changes.
				</Note>
				<button
					type="button"
					onClick={() => setChecked((v) => !v)}
					className="chip-raised chip-raised-hover squircle focus-edge"
					style={{
						fontFamily: fonts.body,
						fontSize: 11,
						letterSpacing: "0.12em",
						textTransform: "uppercase",
						borderRadius: 999,
						padding: "7px 14px",
						cursor: "pointer",
						alignSelf: "flex-start",
						color: "var(--t-text)",
					}}
				>
					{checked ? "Showing both states" : "Showing unselected only"}
				</button>
			</div>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 1fr",
					gap: 24,
					alignItems: "start",
				}}
			>
				{[
					{ label: "Before — var(--t-border)", edge: "var(--t-border)" },
					{
						label: "Now — var(--t-control-edge)",
						edge: "var(--t-control-edge)",
					},
				].map((col) => (
					<div
						key={col.label}
						style={{ display: "flex", flexDirection: "column", gap: 14 }}
					>
						<Label>{col.label}</Label>

						{/* SongCard: rows on the library plane, selection mode on. */}
						<div
							className="surface-raised squircle"
							style={{ borderRadius: 18 }}
						>
							<div
								className="plane-rule"
								style={{ borderBottomWidth: 1, padding: "10px 16px" }}
							>
								<Label dim>Liked songs — selection mode</Label>
							</div>
							<div style={{ padding: 8 }}>
								{[
									{ name: "Weightless", artist: "Marconi Union", on: false },
									{
										name: "Motion Picture Soundtrack",
										artist: "Radiohead",
										on: checked,
									},
									{ name: "Alone in Kyoto", artist: "Air", on: false },
								].map((song, i) => (
									<div
										key={song.name}
										className="squircle"
										style={{
											display: "flex",
											alignItems: "center",
											gap: 16,
											padding: 12,
											borderRadius: 10,
											// Middle row painted lit, so the edge is visible on the
											// hover ground without anyone having to hover.
											background:
												i === 1 ? "var(--t-plane-lit)" : "transparent",
										}}
									>
										<div
											className="image-outline"
											style={{
												width: 48,
												height: 48,
												flexShrink: 0,
												background: "var(--t-surface-dim)",
												display: "grid",
												placeItems: "center",
												color: "var(--t-text-muted)",
											}}
										>
											♫
										</div>
										<div style={{ minWidth: 0, flex: 1 }}>
											<div
												style={{
													fontFamily: fonts.display,
													fontSize: 17,
													fontWeight: 300,
												}}
											>
												{song.name}
											</div>
											<div
												style={{
													fontFamily: fonts.body,
													fontSize: 13,
													color: "var(--t-text-muted)",
													marginTop: 2,
												}}
											>
												{song.artist}
											</div>
										</div>
										<Checkbox edge={col.edge} checked={song.on} />
									</div>
								))}
							</div>
						</div>

						{/* SettingsPage: strictness options, chip tier on a plane. */}
						<div
							className="surface-raised squircle"
							style={{ borderRadius: 18, padding: 24 }}
						>
							<div style={{ marginBottom: 14 }}>
								<Label dim>Settings — match strictness</Label>
							</div>
							<div
								style={{ display: "flex", flexDirection: "column", gap: 10 }}
							>
								{[
									{ label: "Balanced", score: 70, on: false },
									{ label: "Strict", score: 85, on: checked },
								].map((opt) => (
									<div
										key={opt.label}
										className="chip-raised squircle"
										style={{
											display: "flex",
											alignItems: "flex-start",
											gap: 14,
											padding: 16,
											borderRadius: 14,
											borderColor: opt.on ? "var(--t-text)" : "transparent",
										}}
									>
										<span style={{ marginTop: 2 }}>
											<RadioDot edge={col.edge} checked={opt.on} />
										</span>
										<div
											style={{
												display: "flex",
												flexDirection: "column",
												gap: 4,
											}}
										>
											<span
												style={{
													fontFamily: fonts.body,
													fontSize: 12,
													fontStyle: "italic",
													opacity: 0.7,
													color: "var(--t-text-muted)",
												}}
											>
												above {opt.score}%
											</span>
											<span
												style={{
													fontFamily: fonts.body,
													fontSize: 16,
													fontWeight: opt.on ? 500 : 400,
												}}
											>
												{opt.label}
											</span>
										</div>
									</div>
								))}
							</div>
						</div>
					</div>
				))}
			</div>
		</div>
	);
};
