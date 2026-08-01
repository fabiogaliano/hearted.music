import type { Story } from "@ladle/react";

export default { title: "Vision / Color Temperature" };

import { useState } from "react";

import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import type { ThemeColor } from "@/lib/theme/types";

// Depth is encoded purely as color-temperature offsets from --t-surface —
// never shadow/border. Raised = lighter + warmer hue; recessed = darker + cooler hue.
const raised =
	"oklch(from var(--t-surface) calc(l - 0.025) calc(c + 0.003) calc(h + 3))";
const raisedHover =
	"oklch(from var(--t-surface) calc(l - 0.015) calc(c + 0.005) calc(h + 6))";
const recessed =
	"oklch(from var(--t-surface) calc(l - 0.05) calc(c + 0.002) calc(h - 3))";

const label: React.CSSProperties = {
	fontSize: 10.5,
	textTransform: "uppercase",
	letterSpacing: "0.16em",
	color: "var(--t-text-muted)",
	fontWeight: 500,
};

function Chip({
	children,
	selected = false,
}: {
	children: React.ReactNode;
	selected?: boolean;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				fontFamily: fonts.body,
				fontSize: 13,
				padding: "7px 14px",
				borderRadius: 999,
				border: "none",
				cursor: "pointer",
				color: selected ? "var(--t-text-on-primary)" : "var(--t-text)",
				background: selected
					? "var(--t-primary)"
					: hover
						? raisedHover
						: raised,
				transition: "background 220ms ease",
			}}
		>
			{children}
		</button>
	);
}

function FilterRow({
	label: rowLabel,
	value,
}: {
	label: string;
	value?: string;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				display: "flex",
				justifyContent: "space-between",
				alignItems: "center",
				width: "100%",
				fontFamily: fonts.body,
				fontSize: 14,
				padding: "12px 16px",
				borderRadius: 10,
				border: "none",
				cursor: "pointer",
				textAlign: "left",
				background: hover ? raisedHover : raised,
				color: "var(--t-text)",
				transition: "background 220ms ease",
			}}
		>
			<span>{rowLabel}</span>
			<span style={{ color: value ? "var(--t-text)" : "var(--t-text-muted)" }}>
				{value ?? "Any"}
			</span>
		</button>
	);
}

function Button({
	children,
	primary = false,
}: {
	children: React.ReactNode;
	primary?: boolean;
}) {
	const [hover, setHover] = useState(false);
	return (
		<button
			type="button"
			onMouseEnter={() => setHover(true)}
			onMouseLeave={() => setHover(false)}
			style={{
				fontFamily: fonts.body,
				fontSize: 14,
				fontWeight: 500,
				padding: "11px 20px",
				borderRadius: 10,
				border: "none",
				cursor: "pointer",
				color: primary ? "var(--t-text-on-primary)" : "var(--t-text)",
				background: primary
					? hover
						? "var(--t-primary-hover)"
						: "var(--t-primary)"
					: hover
						? raisedHover
						: raised,
				transition: "background 220ms ease",
			}}
		>
			{children}
		</button>
	);
}

function SectionLabel({ children }: { children: React.ReactNode }) {
	return <div style={label}>{children}</div>;
}

function Sidebar() {
	return (
		<div
			style={{
				width: 340,
				background: "var(--t-bg)",
				padding: 28,
				display: "flex",
				flexDirection: "column",
				gap: 26,
				borderRadius: 20,
			}}
		>
			<div>
				<h2
					style={{
						fontFamily: fonts.display,
						fontWeight: 300,
						fontSize: 26,
						color: "var(--t-text)",
						margin: 0,
						marginBottom: 4,
					}}
				>
					Create playlist
				</h2>
				<p
					style={{
						fontFamily: fonts.body,
						fontSize: 13,
						color: "var(--t-text-muted)",
						margin: 0,
					}}
				>
					From your liked songs
				</p>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				<SectionLabel>Genres</SectionLabel>
				<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
					<Chip selected>Hip-hop</Chip>
					<Chip selected>Electronic</Chip>
					<Chip selected>Rap</Chip>
					<Chip>+ add genre</Chip>
				</div>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				<SectionLabel>Filters</SectionLabel>
				<div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
					<FilterRow label="Language" value="English" />
					<FilterRow label="Vocals" />
					<FilterRow label="Release era" value="2015–2024" />
					<FilterRow label="Liked date" />
				</div>
			</div>

			<div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
				<SectionLabel>Artists</SectionLabel>
				<div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
					<Chip selected>Kendrick Lamar · 24</Chip>
					<Chip>Flume · 12</Chip>
					<Chip>Little Simz · 8</Chip>
					<Chip>+ add artist</Chip>
				</div>
			</div>

			<div
				style={{
					background: recessed,
					borderRadius: 14,
					padding: 18,
					display: "flex",
					flexDirection: "column",
					gap: 10,
					transition: "background 220ms ease",
				}}
			>
				<SectionLabel>Preview</SectionLabel>
				<p
					style={{
						fontFamily: fonts.body,
						fontSize: 13,
						color: "var(--t-text-muted)",
						margin: 0,
						lineHeight: 1.5,
					}}
				>
					142 songs match these filters. A recessed panel sits cooler and darker
					than the surface it holds — the raised chip below still reads as the
					interactive element, with no border or shadow anywhere.
				</p>
				<div>
					<Chip>Refine further</Chip>
				</div>
			</div>

			<div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
				<Button>Cancel</Button>
				<Button primary>Create playlist</Button>
			</div>
		</div>
	);
}

function ThemeSwitcher({
	active,
	onChange,
}: {
	active: ThemeColor;
	onChange: (t: ThemeColor) => void;
}) {
	return (
		<div style={{ display: "flex", gap: 8, marginBottom: 32 }}>
			{(Object.keys(themes) as ThemeColor[]).map((key) => (
				<button
					key={key}
					type="button"
					onClick={() => onChange(key)}
					style={{
						fontFamily: fonts.body,
						fontSize: 12.5,
						padding: "8px 16px",
						borderRadius: 999,
						border: "none",
						cursor: "pointer",
						color:
							active === key ? "var(--t-text-on-primary)" : "var(--t-text)",
						background: active === key ? "var(--t-primary)" : raised,
						transition: "background 220ms ease",
					}}
				>
					{themes[key].name}
				</button>
			))}
		</div>
	);
}

export const ColorTemperature: Story = () => {
	const [activeTheme, setActiveTheme] = useState<ThemeColor>("rose");

	return (
		<ThemeHueProvider theme={themes[activeTheme]}>
			<div
				style={{
					minHeight: "100vh",
					width: "100%",
					background: "var(--t-bg)",
					padding: 48,
					boxSizing: "border-box",
				}}
			>
				<div style={{ maxWidth: 1100, margin: "0 auto" }}>
					<div style={{ marginBottom: 8 }}>
						<h1
							style={{
								fontFamily: fonts.display,
								fontWeight: 200,
								fontSize: 34,
								color: "var(--t-text)",
								margin: 0,
							}}
						>
							Depth via color temperature
						</h1>
						<p
							style={{
								fontFamily: fonts.body,
								fontSize: 13.5,
								color: "var(--t-text-muted)",
								margin: "6px 0 0",
								maxWidth: 560,
							}}
						>
							No shadows, no borders. Raised elements shift slightly lighter and
							warmer; recessed elements shift slightly darker and cooler. Hover
							pushes the temperature warmer still.
						</p>
					</div>

					<ThemeSwitcher active={activeTheme} onChange={setActiveTheme} />

					<div style={{ display: "flex", gap: 32, flexWrap: "wrap" }}>
						<Sidebar />
					</div>
				</div>
			</div>
		</ThemeHueProvider>
	);
};

ColorTemperature.meta = {
	width: "100vw",
};
