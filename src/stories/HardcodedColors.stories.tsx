import type { Story } from "@ladle/react";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { fonts } from "@/lib/theme/fonts";

function SideBySide({
	label,
	file,
	children,
}: {
	label: string;
	file: string;
	children: React.ReactNode;
}) {
	const theme = useTheme();
	return (
		<div style={{ marginBottom: 48 }}>
			<p
				className="text-xs uppercase tracking-widest"
				style={{
					fontFamily: fonts.body,
					color: theme.textMuted,
					marginBottom: 4,
				}}
			>
				{label}
			</p>
			<p
				className="text-xxs"
				style={{
					fontFamily: fonts.body,
					color: theme.primary,
					marginBottom: 16,
					opacity: 0.8,
				}}
			>
				{file}
			</p>
			<div className="flex items-start gap-12">{children}</div>
		</div>
	);
}

function Column({
	heading,
	children,
}: {
	heading: string;
	children: React.ReactNode;
}) {
	const theme = useTheme();
	return (
		<div style={{ flex: 1, maxWidth: 420 }}>
			<p
				className="text-xxs uppercase tracking-widest"
				style={{
					fontFamily: fonts.body,
					color: theme.textMuted,
					marginBottom: 12,
					opacity: 0.6,
				}}
			>
				{heading}
			</p>
			{children}
		</div>
	);
}

function Swatch({ color, label }: { color: string; label: string }) {
	const theme = useTheme();
	return (
		<div className="flex items-center gap-3" style={{ marginBottom: 6 }}>
			<div
				style={{
					width: 24,
					height: 24,
					background: color,
					border: `1px solid ${theme.border}`,
					borderRadius: 4,
					flexShrink: 0,
				}}
			/>
			<code
				className="text-xxs"
				style={{
					fontFamily: "ui-monospace, monospace",
					color: theme.textMuted,
				}}
			>
				{label}
			</code>
		</div>
	);
}

// ─── Hero Section (dark gradient background) ───────────────────────────

function HeroMock({
	logoColor,
	btnBg,
	btnColor,
}: {
	logoColor: string;
	btnBg: string;
	btnColor: string;
}) {
	return (
		<div
			style={{
				background:
					"linear-gradient(135deg, hsl(340, 50%, 20%) 0%, hsl(340, 60%, 10%) 100%)",
				padding: 24,
				borderRadius: 6,
				minWidth: 300,
			}}
		>
			<nav className="flex items-center justify-between">
				<h1
					className="text-xl font-extralight tracking-tight"
					style={{ fontFamily: fonts.display, color: logoColor }}
				>
					hearted.
				</h1>
				<button
					type="button"
					className="px-4 py-1.5 text-xs tracking-widest uppercase"
					style={{
						background: btnBg,
						color: btnColor,
						fontFamily: fonts.body,
						backdropFilter: "blur(10px)",
					}}
				>
					Get early access
				</button>
			</nav>
		</div>
	);
}

// ─── Waitlist Input (dark variant) ─────────────────────────────────────

function WaitlistMock({
	inputBg,
	inputBorder,
	inputColor,
	successColor,
	errorColor,
}: {
	inputBg: string;
	inputBorder: string;
	inputColor: string;
	successColor: string;
	errorColor: string;
}) {
	return (
		<div
			style={{
				background:
					"linear-gradient(135deg, hsl(340, 50%, 20%) 0%, hsl(340, 60%, 10%) 100%)",
				padding: 24,
				borderRadius: 6,
				minWidth: 300,
			}}
		>
			<div className="flex flex-col gap-3">
				<div className="flex gap-3">
					<input
						type="email"
						placeholder="Your email"
						className="flex-1 px-4 py-2.5 text-sm focus:outline-none"
						style={{
							background: inputBg,
							border: `1px solid ${inputBorder}`,
							color: inputColor,
							fontFamily: fonts.body,
							backdropFilter: "blur(10px)",
						}}
					/>
					<button
						type="button"
						className="px-5 py-2.5 text-xs tracking-widest uppercase"
						style={{
							background: "var(--t-text-on-primary)",
							color: "var(--t-primary)",
							fontFamily: fonts.body,
						}}
					>
						TELL ME
					</button>
				</div>
				<p
					className="text-lg font-light"
					style={{ color: successColor, fontFamily: fonts.body }}
				>
					You're on the list.
				</p>
				<p className="text-sm" style={{ color: errorColor }}>
					Something went wrong. Try again.
				</p>
			</div>
		</div>
	);
}

// ─── CD Case Frame ─────────────────────────────────────────────────────

function CDCaseMock({ frameColor }: { frameColor: string }) {
	return (
		<svg width="200" height="176" viewBox="0 0 750 660" fill="none">
			<rect
				x="0"
				y="0"
				width="750"
				height="660"
				rx="8"
				fill={frameColor}
				fillOpacity="0.05"
			/>
			<rect
				x="0.5"
				y="0.5"
				width="749"
				height="659"
				rx="8"
				stroke={frameColor}
				strokeOpacity="0.8"
				strokeWidth="2"
			/>
			<rect
				x="1"
				y="1"
				width="94"
				height="658"
				rx="6"
				fill={frameColor}
				fillOpacity="0.05"
			/>
			<line
				x1="95"
				y1="0"
				x2="95"
				y2="660"
				stroke={frameColor}
				strokeOpacity="0.8"
				strokeWidth="2"
			/>
			{[0, 1, 2, 3, 4].map((i) => (
				<line
					key={i}
					x1="18"
					y1={18 + i * 6}
					x2="78"
					y2={18 + i * 6}
					stroke="var(--t-text)"
					strokeOpacity={0.35 - i * 0.05}
					strokeWidth="1.5"
					strokeLinecap="round"
				/>
			))}
			<rect
				x="100"
				y="10"
				width="640"
				height="640"
				rx="0"
				fill="var(--t-surface-dim)"
				fillOpacity="0.5"
			/>
		</svg>
	);
}

// ─── Status Indicators ─────────────────────────────────────────────────

function StatusDot({ color, label }: { color: string; label: string }) {
	const theme = useTheme();
	return (
		<span
			className="flex items-center gap-2 text-xs tracking-widest uppercase"
			style={{ fontFamily: fonts.body, color: theme.textMuted }}
		>
			<span className="size-2 rounded-full" style={{ background: color }} />
			{label}
		</span>
	);
}

function StatusRow({
	colors,
	rowLabel,
}: {
	colors: Record<string, string>;
	rowLabel: string;
}) {
	const theme = useTheme();
	return (
		<div
			style={{
				padding: 16,
				background: theme.surface,
				borderRadius: 6,
				minWidth: 260,
			}}
		>
			<p
				className="text-xxs uppercase tracking-widest"
				style={{ color: theme.textMuted, marginBottom: 12, opacity: 0.6 }}
			>
				{rowLabel}
			</p>
			<div
				className="flex items-center justify-between"
				style={{ marginBottom: 10 }}
			>
				<span
					className="text-sm font-light"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					Chrome extension
				</span>
				<span
					className="flex items-center gap-2 text-xs tracking-widest uppercase"
					style={{ color: theme.textMuted }}
				>
					<span
						className="size-2 rounded-full"
						style={{ background: colors.connected }}
					/>
					Connected
				</span>
			</div>
			<div style={{ borderTop: `1px solid ${theme.border}`, paddingTop: 10 }}>
				<div
					className="flex items-center justify-between"
					style={{ marginBottom: 6 }}
				>
					<span className="text-sm" style={{ color: theme.text }}>
						Subscription
					</span>
					<span
						className="flex items-center gap-2 text-xs tracking-widest uppercase"
						style={{ color: theme.textMuted }}
					>
						<span
							className="size-2 rounded-full"
							style={{ background: colors.active }}
						/>
						Active
					</span>
				</div>
				<div
					className="flex items-center justify-between"
					style={{ marginBottom: 6 }}
				>
					<span className="text-sm" style={{ color: theme.textMuted }}>
						If canceling
					</span>
					<span
						className="flex items-center gap-2 text-xs tracking-widest uppercase"
						style={{ color: theme.textMuted }}
					>
						<span
							className="size-2 rounded-full"
							style={{ background: colors.canceling }}
						/>
						Canceling
					</span>
				</div>
				<div className="flex items-center justify-between">
					<span className="text-sm" style={{ color: theme.textMuted }}>
						If past due
					</span>
					<span
						className="flex items-center gap-2 text-xs tracking-widest uppercase"
						style={{ color: theme.textMuted }}
					>
						<span
							className="size-2 rounded-full"
							style={{ background: colors.pastDue }}
						/>
						Past due
					</span>
				</div>
			</div>
		</div>
	);
}

// ─── Error Text ────────────────────────────────────────────────────────

function ErrorTextMock({
	lightColor,
	darkColor,
}: {
	lightColor: string;
	darkColor: string;
}) {
	const theme = useTheme();
	return (
		<div className="flex gap-8">
			<div
				style={{
					padding: 16,
					background: theme.surface,
					borderRadius: 6,
					minWidth: 180,
				}}
			>
				<p
					className="text-xxs uppercase tracking-widest"
					style={{ color: theme.textMuted, marginBottom: 8 }}
				>
					Light bg
				</p>
				<p className="text-sm" style={{ color: lightColor }}>
					Something went wrong.
				</p>
			</div>
			<div
				style={{
					padding: 16,
					background:
						"linear-gradient(135deg, hsl(340, 50%, 20%) 0%, hsl(340, 60%, 10%) 100%)",
					borderRadius: 6,
					minWidth: 180,
				}}
			>
				<p
					className="text-xxs uppercase tracking-widest"
					style={{ color: "rgba(255,255,255,0.5)", marginBottom: 8 }}
				>
					Dark bg
				</p>
				<p className="text-sm" style={{ color: darkColor }}>
					Something went wrong.
				</p>
			</div>
		</div>
	);
}

// ═══════════════════════════════════════════════════════════════════════
// Stories
// ═══════════════════════════════════════════════════════════════════════

export const HardcodedColorsAudit: Story = () => {
	const theme = useTheme();

	return (
		<div style={{ padding: 48, maxWidth: 960, fontFamily: fonts.body }}>
			<h1
				className="text-2xl font-extralight"
				style={{
					fontFamily: fonts.display,
					color: theme.text,
					marginBottom: 8,
				}}
			>
				Step 14: Hardcoded Hex Colors
			</h1>
			<p
				className="text-sm"
				style={{ color: theme.textMuted, marginBottom: 48 }}
			>
				Current (hardcoded) vs proposed (token-based). Switch themes above to
				see how tokens adapt.
			</p>

			{/* ── Category 1: Should use tokens ──────────────────────── */}

			<h2
				className="text-xs uppercase tracking-widest"
				style={{
					color: theme.primary,
					marginBottom: 32,
					letterSpacing: "0.15em",
				}}
			>
				Category 1 — Should use theme tokens
			</h2>

			<SideBySide
				label="Hero Logo + Nav Button"
				file="LandingHero.tsx:218,244-245"
			>
				<Column heading="Current — #ffffff">
					<HeroMock
						logoColor="#ffffff"
						btnBg="rgba(255,255,255,0.2)"
						btnColor="#ffffff"
					/>
				</Column>
				<Column heading="Proposed — var(--t-text-on-primary)">
					<HeroMock
						logoColor="var(--t-text-on-primary)"
						btnBg="color-mix(in srgb, var(--t-text-on-primary) 20%, transparent)"
						btnColor="var(--t-text-on-primary)"
					/>
				</Column>
			</SideBySide>

			<SideBySide
				label="Waitlist Input (dark variant)"
				file="WaitlistInput.tsx:49,71-73"
			>
				<Column heading="Current — #ffffff + rgba(255,255,255,…)">
					<WaitlistMock
						inputBg="rgba(255,255,255,0.15)"
						inputBorder="rgba(255,255,255,0.3)"
						inputColor="#ffffff"
						successColor="#ffffff"
						errorColor="#fca5a5"
					/>
				</Column>
				<Column heading="Proposed — var(--t-text-on-primary) + color-mix">
					<WaitlistMock
						inputBg="color-mix(in srgb, var(--t-text-on-primary) 15%, transparent)"
						inputBorder="color-mix(in srgb, var(--t-text-on-primary) 30%, transparent)"
						inputColor="var(--t-text-on-primary)"
						successColor="var(--t-text-on-primary)"
						errorColor="#fca5a5"
					/>
				</Column>
			</SideBySide>

			<SideBySide label="CD Case Frame" file="CDCase.tsx:28">
				<Column heading="Current — #1A1A1A">
					<CDCaseMock frameColor="#1A1A1A" />
					<Swatch color="#1A1A1A" label="#1A1A1A (always near-black)" />
				</Column>
				<Column heading="Proposed — var(--t-text)">
					<CDCaseMock frameColor="var(--t-text)" />
					<Swatch color={theme.text} label="var(--t-text) (follows theme)" />
				</Column>
			</SideBySide>

			{/* ── Category 2: Status color approaches ──────────────────── */}

			<h2
				className="text-xs uppercase tracking-widest"
				style={{
					color: theme.primary,
					marginBottom: 32,
					marginTop: 16,
					letterSpacing: "0.15em",
				}}
			>
				Category 2 — Status colors: three approaches
			</h2>

			<p
				className="text-sm"
				style={{ color: theme.textMuted, marginBottom: 32 }}
			>
				Switch themes to see how each approach adapts. Shown in realistic
				settings context.
			</p>

			<div
				style={{
					display: "grid",
					gridTemplateColumns: "1fr 1fr 1fr",
					gap: 24,
					marginBottom: 48,
				}}
			>
				<div>
					<p
						className="text-xxs uppercase tracking-widest"
						style={{ color: theme.textMuted, marginBottom: 12, opacity: 0.6 }}
					>
						A — Traffic light (current)
					</p>
					<StatusRow
						rowLabel="Standard hex — always same colors"
						colors={{
							connected: "#1DB954",
							active: "#1DB954",
							canceling: "#F5A623",
							pastDue: "#E53E3E",
						}}
					/>
				</div>
				<div>
					<p
						className="text-xxs uppercase tracking-widest"
						style={{ color: theme.textMuted, marginBottom: 12, opacity: 0.6 }}
					>
						B — Primary for active, keep warn/error
					</p>
					<StatusRow
						rowLabel="Active = --t-primary, rest = semantic"
						colors={{
							connected: theme.primary,
							active: theme.primary,
							canceling: "#F5A623",
							pastDue: "#E53E3E",
						}}
					/>
				</div>
				<div>
					<p
						className="text-xxs uppercase tracking-widest"
						style={{ color: theme.textMuted, marginBottom: 12, opacity: 0.6 }}
					>
						C — Fully monochromatic
					</p>
					<StatusRow
						rowLabel="All states from theme text opacity"
						colors={{
							connected: theme.text,
							active: theme.text,
							canceling: theme.textMuted,
							pastDue: `color-mix(in oklch, ${theme.text} 40%, oklch(0.577 0.245 27.325))`,
						}}
					/>
				</div>
			</div>

			{/* ── Error text ──────────────────────────────────────────── */}

			<SideBySide label="Error Text" file="WaitlistInput.tsx:94">
				<Column heading="Current — #dc2626 / #fca5a5">
					<ErrorTextMock lightColor="#dc2626" darkColor="#fca5a5" />
				</Column>
				<Column heading="Same — semantic error red">
					<ErrorTextMock lightColor="#dc2626" darkColor="#fca5a5" />
				</Column>
			</SideBySide>
		</div>
	);
};
HardcodedColorsAudit.storyName = "Hardcoded Colors Audit";
