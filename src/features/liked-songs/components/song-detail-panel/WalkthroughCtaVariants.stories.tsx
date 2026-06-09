import type { Story } from "@ladle/react";
import { useEffect, useState } from "react";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { getThemedDarkColors } from "../detail/themed-dark-colors";

// A chooser harness for the song-walkthrough "See where this song belongs" CTA.
// The four enhancements compose, so the floating switcher toggles each one
// independently against a realistic, scrollable read — flip them on/off to find
// the combination that reads best, then we wire the winner into WalkthroughCta.

interface Enhancements {
	frosted: boolean;
	elevation: boolean;
	entrance: boolean;
	glow: boolean;
}

const colors = getThemedDarkColors(themes.rose);

// Accent-tinted shadows reused by both the static "elevation" treatment and the
// breathing "glow" keyframe so the two read as the same family of lift.
const elevationShadow = `0 12px 32px -8px color-mix(in srgb, ${colors.accent} 42%, transparent), 0 3px 10px -3px color-mix(in srgb, ${colors.accent} 28%, transparent)`;
const glowStaticShadow = `0 12px 34px -6px color-mix(in srgb, ${colors.accent} 48%, transparent)`;

const KEYFRAMES = `
	@keyframes wcta-arrow {
		0%, 100% { transform: translateX(0); }
		50% { transform: translateX(3px); }
	}
	@keyframes wcta-in {
		from { opacity: 0; transform: translateY(8px); }
		to { opacity: 1; transform: translateY(0); }
	}
	@keyframes wcta-glow {
		0%, 100% { box-shadow: 0 10px 24px -8px color-mix(in srgb, ${colors.accent} 24%, transparent); }
		50% { box-shadow: 0 12px 36px -4px color-mix(in srgb, ${colors.accent} 52%, transparent); }
	}
`;

function usePrefersReducedMotion() {
	const [prefers, setPrefers] = useState(false);
	useEffect(() => {
		const media = window.matchMedia("(prefers-reduced-motion: reduce)");
		setPrefers(media.matches);
		const onChange = (e: MediaQueryListEvent) => setPrefers(e.matches);
		media.addEventListener("change", onChange);
		return () => media.removeEventListener("change", onChange);
	}, []);
	return prefers;
}

function VariantCta({
	enh,
	entranceNonce,
}: {
	enh: Enhancements;
	entranceNonce: number;
}) {
	const reducedMotion = usePrefersReducedMotion();
	const [hovered, setHovered] = useState(false);
	const [pressed, setPressed] = useState(false);

	const stickyBackground = enh.frosted
		? `linear-gradient(to bottom, transparent 0%, color-mix(in srgb, ${colors.bg} 72%, transparent) 45%, color-mix(in srgb, ${colors.bg} 92%, transparent) 100%)`
		: `linear-gradient(to bottom, transparent, ${colors.bg} 32%)`;

	// Glow owns box-shadow while it animates (so it supersedes elevation, reading
	// as a breathing version of the same lift); under reduced motion it falls back
	// to a static lifted shadow rather than pulsing.
	const buttonBoxShadow =
		enh.glow && reducedMotion
			? glowStaticShadow
			: enh.elevation
				? elevationShadow
				: "none";
	const buttonAnimation =
		enh.glow && !reducedMotion ? "wcta-glow 3s ease-in-out infinite" : "none";

	return (
		<div
			style={{
				position: "sticky",
				bottom: 0,
				paddingTop: 24,
				paddingBottom: 28,
				background: stickyBackground,
				borderTop: enh.frosted
					? `1px solid color-mix(in srgb, ${colors.border} 85%, transparent)`
					: "none",
				backdropFilter: enh.frosted ? "blur(10px)" : "none",
				WebkitBackdropFilter: enh.frosted ? "blur(10px)" : "none",
			}}
		>
			<div
				// Keyed on the entrance toggle + replay nonce so flipping it on (or
				// hitting Replay) re-triggers the one-shot animation.
				key={`${enh.entrance}-${entranceNonce}`}
				style={{
					animation:
						enh.entrance && !reducedMotion
							? "wcta-in 0.45s cubic-bezier(0.22, 1, 0.36, 1) both"
							: "none",
				}}
			>
				<button
					type="button"
					onMouseEnter={() => setHovered(true)}
					onMouseLeave={() => {
						setHovered(false);
						setPressed(false);
					}}
					onMouseDown={() => setPressed(true)}
					onMouseUp={() => setPressed(false)}
					aria-label="See where this song belongs"
					style={{
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						gap: 10,
						width: "100%",
						padding: "15px 24px",
						fontFamily: fonts.body,
						fontSize: 12,
						fontWeight: 600,
						letterSpacing: "0.12em",
						textTransform: "uppercase",
						color: colors.bg,
						background: colors.accent,
						border: "none",
						borderRadius: 12,
						cursor: "pointer",
						boxShadow: buttonBoxShadow,
						animation: buttonAnimation,
						transform: pressed && !reducedMotion ? "scale(0.98)" : "scale(1)",
						filter: hovered ? "brightness(1.06)" : "none",
						transition: reducedMotion
							? "opacity 150ms ease, filter 150ms ease"
							: "opacity 150ms ease, transform 150ms ease, filter 150ms ease",
					}}
				>
					See where this song belongs
					<span
						aria-hidden
						style={{
							display: "inline-block",
							animation:
								reducedMotion || hovered
									? "none"
									: "wcta-arrow 2s ease-in-out infinite",
							transform:
								hovered && !reducedMotion ? "translateX(3px)" : "translateX(0)",
							transition: reducedMotion ? "none" : "transform 180ms ease",
						}}
					>
						&rarr;
					</span>
				</button>
			</div>
		</div>
	);
}

const PROSE: ReadonlyArray<{ heading: string; body: string }> = [
	{
		heading: "Anxious Nostalgia",
		body: "The kind of song that remembers a room you can't go back to. Bright on the surface, with something tightening underneath the whole time.",
	},
	{
		heading: "What it's reaching for",
		body: "Synths pulse like a racing heartbeat. The verses hold their breath; the chorus is where the dam breaks and all the anxiety finally floods out into the open.",
	},
	{
		heading: "The turn",
		body: "Halfway through, the production thins out — just a voice and a held chord — and you realize the bravado was never the point. She's already gone, and the song knows it before you do.",
	},
	{
		heading: "Why it stuck with you",
		body: "The isolating realization that growing up means growing apart, dressed up as a song you can scream in the car. That contrast is the whole trick.",
	},
	{
		heading: "Where it sits",
		body: "Moody and introspective, made for late-night thoughts — but with enough lift that it never collapses into the sad. It's a song about the ache, not a sad song.",
	},
];

function Switcher({
	enh,
	setEnh,
	onReplay,
}: {
	enh: Enhancements;
	setEnh: (next: Enhancements) => void;
	onReplay: () => void;
}) {
	const rows: ReadonlyArray<{ key: keyof Enhancements; label: string }> = [
		{ key: "frosted", label: "Frosted backdrop" },
		{ key: "elevation", label: "Elevation shadow" },
		{ key: "entrance", label: "Entrance fade + rise" },
		{ key: "glow", label: "Breathing glow" },
	];

	return (
		<div
			style={{
				position: "fixed",
				top: 16,
				right: 16,
				zIndex: 50,
				width: 232,
				padding: 16,
				borderRadius: 14,
				background: "rgba(18, 18, 22, 0.92)",
				backdropFilter: "blur(8px)",
				WebkitBackdropFilter: "blur(8px)",
				border: "1px solid rgba(255, 255, 255, 0.1)",
				boxShadow: "0 16px 40px -12px rgba(0, 0, 0, 0.6)",
				color: "#f5f5f5",
				fontFamily: fonts.body,
				display: "flex",
				flexDirection: "column",
				gap: 8,
			}}
		>
			<div
				style={{
					fontSize: 10,
					letterSpacing: "0.16em",
					textTransform: "uppercase",
					opacity: 0.6,
					marginBottom: 2,
				}}
			>
				CTA variants
			</div>
			{rows.map((row) => {
				const active = enh[row.key];
				return (
					<button
						key={row.key}
						type="button"
						aria-pressed={active}
						onClick={() => setEnh({ ...enh, [row.key]: !active })}
						style={{
							display: "flex",
							alignItems: "center",
							justifyContent: "space-between",
							gap: 8,
							padding: "8px 10px",
							borderRadius: 9,
							border: active
								? `1px solid ${colors.accent}`
								: "1px solid rgba(255, 255, 255, 0.12)",
							background: active
								? `color-mix(in srgb, ${colors.accent} 22%, transparent)`
								: "transparent",
							color: "#f5f5f5",
							fontSize: 12,
							cursor: "pointer",
							textAlign: "left",
						}}
					>
						<span>{row.label}</span>
						<span style={{ opacity: 0.7, fontSize: 11 }}>
							{active ? "on" : "off"}
						</span>
					</button>
				);
			})}

			<div style={{ display: "flex", gap: 6, marginTop: 4 }}>
				<button
					type="button"
					onClick={onReplay}
					style={switcherUtilButtonStyle}
				>
					Replay entrance
				</button>
			</div>
			<div style={{ display: "flex", gap: 6 }}>
				<button
					type="button"
					onClick={() =>
						setEnh({
							frosted: false,
							elevation: false,
							entrance: false,
							glow: false,
						})
					}
					style={switcherUtilButtonStyle}
				>
					Reset
				</button>
				<button
					type="button"
					onClick={() =>
						setEnh({
							frosted: true,
							elevation: true,
							entrance: true,
							glow: true,
						})
					}
					style={switcherUtilButtonStyle}
				>
					All on
				</button>
			</div>
			<p style={{ fontSize: 10, lineHeight: 1.4, opacity: 0.5, margin: 0 }}>
				Arrow nudge is always on (the shipped baseline). Glow supersedes the
				elevation shadow while it pulses.
			</p>
		</div>
	);
}

const switcherUtilButtonStyle: React.CSSProperties = {
	flex: 1,
	padding: "7px 8px",
	borderRadius: 8,
	border: "1px solid rgba(255, 255, 255, 0.12)",
	background: "transparent",
	color: "#f5f5f5",
	fontFamily: fonts.body,
	fontSize: 11,
	cursor: "pointer",
};

export const Chooser: Story = () => {
	const [enh, setEnh] = useState<Enhancements>({
		frosted: false,
		elevation: false,
		entrance: false,
		glow: false,
	});
	const [entranceNonce, setEntranceNonce] = useState(0);

	return (
		<div style={{ position: "relative", height: "100vh", overflow: "hidden" }}>
			<style>{KEYFRAMES}</style>

			<div
				style={{
					width: 460,
					maxWidth: "100%",
					height: "100%",
					margin: "0 auto",
					overflowY: "auto",
					background: colors.bg,
					color: colors.text,
					display: "flex",
					flexDirection: "column",
				}}
			>
				<div style={{ flex: 1, padding: "48px 32px 0" }}>
					{PROSE.map((section) => (
						<section key={section.heading} style={{ marginBottom: 40 }}>
							<h3
								style={{
									fontFamily: fonts.display,
									fontWeight: 300,
									fontSize: 22,
									letterSpacing: "-0.01em",
									margin: "0 0 10px",
									color: colors.text,
								}}
							>
								{section.heading}
							</h3>
							<p
								style={{
									fontFamily: fonts.body,
									fontSize: 15,
									lineHeight: 1.7,
									margin: 0,
									color: colors.textMuted,
								}}
							>
								{section.body}
							</p>
						</section>
					))}
				</div>

				<div style={{ padding: "0 32px" }}>
					<VariantCta enh={enh} entranceNonce={entranceNonce} />
				</div>
			</div>

			<Switcher
				enh={enh}
				setEnh={(next) => {
					// Replay only on the off → on transition, so toggling other options
					// while entrance is already on doesn't re-fire it.
					if (next.entrance && !enh.entrance) setEntranceNonce((n) => n + 1);
					setEnh(next);
				}}
				onReplay={() => setEntranceNonce((n) => n + 1)}
			/>
		</div>
	);
};

export default {
	title: "Liked Songs/Walkthrough CTA",
};
