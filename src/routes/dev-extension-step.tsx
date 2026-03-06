/**
 * Dev playground for InstallExtensionStep — V3 Dual Column variant.
 * No auth — step through states 1–4 to preview all conditions.
 * Run `bunx tsr generate` after adding this route.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeColor, ThemeConfig } from "@/lib/theme/types";
import { ExtensionSetupTrail } from "@/features/onboarding/components/ExtensionSetupTrail";

const SPOTIFY_LOGIN_URL =
	"https://accounts.spotify.com/en-GB/login?continue=https%3A%2F%2Fopen.spotify.com%2F";
const EXTENSION_STORE_URL =
	"https://chrome.google.com/webstore/detail/hearted-spotify-sync/EXTENSION_ID";

// ── Waveform animation variants ──────────────────────────────────────────

type AnimVariant = "A" | "B" | "C";

const ANIM_LABELS: Record<AnimVariant, string> = {
	A: "symmetric",
	B: "irregular",
	C: "live",
};

function WaveformSymmetric({ theme }: { theme: ThemeConfig }) {
	const heights = [4, 7, 11, 15, 18, 20, 18, 15, 11, 7, 4];

	return (
		<>
			<style>{`
				@keyframes wfSymmetric {
					0%, 100% { transform: scaleY(0.15); }
					50% { transform: scaleY(1); }
				}
				@media (prefers-reduced-motion: reduce) {
					.wf-sym { animation: none !important; transform: scaleY(0.4) !important; }
				}
			`}</style>
			<div
				className="mx-auto flex items-center justify-center"
				style={{ gap: 2, height: 20, opacity: 0.4 }}
			>
				{heights.map((h, i) => (
					<div
						key={i}
						className="wf-sym"
						style={{
							width: 1.5,
							height: h,
							background: theme.textMuted,
							transformOrigin: "center",
							animation: `wfSymmetric 2.2s cubic-bezier(0.4, 0, 0.2, 1) ${i * 100}ms infinite`,
						}}
					/>
				))}
			</div>
		</>
	);
}

function WaveformIrregular({ theme }: { theme: ThemeConfig }) {
	const heights = [3, 9, 5, 16, 8, 20, 6, 18, 11, 4, 14, 7, 19, 10, 5, 12, 3];

	return (
		<>
			<style>{`
				@keyframes wfIrregular {
					0%, 100% { transform: scaleY(0.1); }
					50% { transform: scaleY(1); }
				}
				@media (prefers-reduced-motion: reduce) {
					.wf-irr { animation: none !important; transform: scaleY(0.35) !important; }
				}
			`}</style>
			<div
				className="mx-auto flex items-center justify-center"
				style={{ gap: 1.5, height: 20, opacity: 0.4 }}
			>
				{heights.map((h, i) => (
					<div
						key={i}
						className="wf-irr"
						style={{
							width: 1.5,
							height: h,
							background: theme.textMuted,
							transformOrigin: "center",
							animation: `wfIrregular 2.4s cubic-bezier(0.4, 0, 0.2, 1) ${i * 80}ms infinite`,
						}}
					/>
				))}
			</div>
		</>
	);
}

function WaveformLive({ theme }: { theme: ThemeConfig }) {
	const bars = [
		{ h: 10, dur: 1.3, delay: 0 },
		{ h: 18, dur: 1.7, delay: 200 },
		{ h: 7, dur: 2.1, delay: 80 },
		{ h: 22, dur: 1.4, delay: 340 },
		{ h: 12, dur: 1.9, delay: 130 },
		{ h: 20, dur: 1.3, delay: 50 },
		{ h: 8, dur: 2.3, delay: 270 },
		{ h: 24, dur: 1.5, delay: 400 },
		{ h: 14, dur: 1.8, delay: 110 },
		{ h: 6, dur: 2.0, delay: 310 },
		{ h: 20, dur: 1.4, delay: 170 },
		{ h: 10, dur: 2.2, delay: 240 },
		{ h: 16, dur: 1.6, delay: 60 },
	];

	return (
		<>
			<style>{`
				@keyframes wfLive {
					0%, 100% { transform: scaleY(0.1); }
					40% { transform: scaleY(1); }
					70% { transform: scaleY(0.3); }
				}
				@media (prefers-reduced-motion: reduce) {
					.wf-live { animation: none !important; transform: scaleY(0.35) !important; }
				}
			`}</style>
			<div
				className="mx-auto flex items-center justify-center"
				style={{ gap: 2, height: 24, opacity: 0.45 }}
			>
				{bars.map((bar, i) => (
					<div
						key={i}
						className="wf-live"
						style={{
							width: 1.5,
							height: bar.h,
							background: theme.textMuted,
							transformOrigin: "center",
							animation: `wfLive ${bar.dur}s cubic-bezier(0.165, 0.84, 0.44, 1) ${bar.delay}ms infinite`,
						}}
					/>
				))}
			</div>
		</>
	);
}

const ANIM_COMPONENTS: Record<AnimVariant, React.FC<{ theme: ThemeConfig }>> = {
	A: WaveformSymmetric,
	B: WaveformIrregular,
	C: WaveformLive,
};

// ── Shared action content ──────────────────────────────────────────────────

function ActionContent({
	theme,
	isExtensionInstalled,
	isSpotifyConnected,
	onAccept,
	onSkip,
}: {
	theme: ThemeConfig;
	isExtensionInstalled: boolean;
	isSpotifyConnected: boolean;
	onAccept: () => void;
	onSkip: () => void;
}) {
	const isReadyToSync = isExtensionInstalled && isSpotifyConnected;

	if (isReadyToSync) {
		return (
			<>
				<p
					className="text-[11px] uppercase tracking-[0.12em]"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
						opacity: 0.45,
					}}
				>
					here's what hearted can see.
				</p>
				<ul
					className="flex flex-col gap-3"
					style={{ listStyle: "none", padding: 0 }}
				>
					{["your liked songs", "your playlist names"].map((item) => (
						<li key={item} className="flex items-center gap-2.5">
							<span
								style={{
									width: 4,
									height: 4,
									borderRadius: "100%",
									flexShrink: 0,
									background: theme.textMuted,
									opacity: 0.35,
								}}
							/>
							<span
								className="text-[13px]"
								style={{
									fontFamily: fonts.body,
									color: theme.textMuted,
									opacity: 0.65,
								}}
							>
								{item}
							</span>
						</li>
					))}
				</ul>
				<button
					type="button"
					onClick={onAccept}
					className="self-start inline-flex items-center gap-2 rounded-[24px] px-6 py-2.5 text-sm font-medium uppercase tracking-widest transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
					style={{
						fontFamily: fonts.body,
						background: theme.primary,
						color: theme.textOnPrimary,
						border: "1px solid transparent",
					}}
				>
					allow sync →
				</button>
			</>
		);
	}

	if (!isExtensionInstalled) {
		return (
			<>
				<div>
					<p
						className="text-[15px] font-light"
						style={{ fontFamily: fonts.body, color: theme.text, opacity: 0.7 }}
					>
						the sync starts here.
					</p>
					<p
						className="mt-1 text-[13px] leading-relaxed"
						style={{
							fontFamily: fonts.body,
							color: theme.textMuted,
							opacity: 0.5,
						}}
					>
						reads your liked songs. never your login.
					</p>
				</div>
				<a
					href={EXTENSION_STORE_URL}
					target="_blank"
					rel="noopener noreferrer"
					className="self-start inline-flex items-center gap-2 rounded-[24px] px-5 py-2 text-sm font-medium uppercase tracking-widest transition-all duration-200 hover:opacity-80 active:scale-[0.98]"
					style={{
						fontFamily: fonts.body,
						background: theme.surface,
						border: `1px solid ${theme.border}`,
						color: theme.text,
					}}
				>
					add to Chrome
					<span className="text-xs" style={{ opacity: 0.45 }}>
						↗
					</span>
				</a>
				<button
					type="button"
					onClick={onSkip}
					className="self-start text-xs uppercase tracking-widest transition-opacity duration-200 hover:opacity-60"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
						opacity: 0.35,
					}}
				>
					skip
				</button>
			</>
		);
	}

	return (
		<>
			<div>
				<p
					className="text-[15px] font-light"
					style={{ fontFamily: fonts.body, color: theme.text, opacity: 0.7 }}
				>
					one more thing.
				</p>
				<p
					className="mt-1 text-[13px] leading-relaxed"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
						opacity: 0.5,
					}}
				>
					the sync only works when you're logged into Spotify.
				</p>
			</div>
			<a
				href={SPOTIFY_LOGIN_URL}
				target="_blank"
				rel="noopener noreferrer"
				className="self-start inline-flex items-center gap-2 rounded-[24px] px-5 py-2 text-sm font-medium uppercase tracking-widest transition-all duration-200 hover:opacity-80 active:scale-[0.98]"
				style={{
					fontFamily: fonts.body,
					background: theme.surface,
					border: `1px solid ${theme.border}`,
					color: theme.text,
				}}
			>
				log in to Spotify
				<span className="text-xs" style={{ opacity: 0.45 }}>
					↗
				</span>
			</a>
			<button
				type="button"
				onClick={onSkip}
				className="self-start text-xs uppercase tracking-widest transition-opacity duration-200 hover:opacity-60"
				style={{
					fontFamily: fonts.body,
					color: theme.textMuted,
					opacity: 0.35,
				}}
			>
				skip
			</button>
		</>
	);
}

// ── V3 — dual column layout ───────────────────────────────────────────────

type V3Props = {
	theme: ThemeConfig;
	isExtensionInstalled: boolean;
	isSpotifyConnected: boolean;
	onAccept: () => void;
	onSkip: () => void;
};

function V3({
	theme,
	isExtensionInstalled,
	isSpotifyConnected,
	onAccept,
	onSkip,
}: V3Props) {
	const trail = (
		<ExtensionSetupTrail
			theme={theme}
			isExtensionInstalled={isExtensionInstalled}
			isSpotifyConnected={isSpotifyConnected}
		/>
	);

	const leftColumn = (
		<div className="shrink-0 md:w-[220px]">
			<h2
				className="text-[44px] font-extralight leading-none tracking-tight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				everything you
				<br />
				ever{" "}
				<em className="italic" style={{ fontWeight: 200 }}>
					hearted.
				</em>
			</h2>

			<p
				className="mt-5 text-[14px] leading-relaxed"
				style={{
					fontFamily: fonts.body,
					color: theme.textMuted,
					opacity: 0.55,
					maxWidth: "26ch",
				}}
			>
				a small Chrome extension reads your library and sends it here.
			</p>

			<div className="mt-6">{trail}</div>
		</div>
	);

	const rightColumn = (
		<div className="flex flex-1 flex-col justify-start gap-5 pt-1">
			<ActionContent
				theme={theme}
				isExtensionInstalled={isExtensionInstalled}
				isSpotifyConnected={isSpotifyConnected}
				onAccept={onAccept}
				onSkip={onSkip}
			/>
		</div>
	);

	return (
		<div className="w-full max-w-[760px]">
			<p
				className="text-[11px] uppercase tracking-[0.12em]"
				style={{
					fontFamily: fonts.body,
					color: theme.textMuted,
					opacity: 0.45,
				}}
			>
				step 02
			</p>

			<div className="mt-10 flex flex-col gap-10 md:flex-row md:gap-14">
				{leftColumn}

				<div
					className="hidden md:block w-px self-stretch"
					style={{ background: theme.border }}
				/>

				{rightColumn}
			</div>
		</div>
	);
}

// ── Route ──────────────────────────────────────────────────────────────────

export const Route = createFileRoute("/dev-extension-step")({
	component: DevExtensionStep,
});

const THEME_KEYS: ThemeColor[] = ["blue", "green", "rose", "lavender"];
const THEME_LABELS: Record<ThemeColor, string> = {
	blue: "Calm",
	green: "Fresh",
	rose: "Bloom",
	lavender: "Haze",
};

type Step = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<Step, string> = {
	1: "no extension",
	2: "no spotify",
	3: "ready",
	4: "waiting (pre-sync)",
};

function stepToState(step: Step) {
	return {
		isExtensionInstalled: step >= 2,
		isSpotifyConnected: step >= 3,
	};
}

function DevExtensionStep() {
	const [step, setStep] = useState<Step>(1);
	const [themeKey, setThemeKey] = useState<ThemeColor>("rose");
	const [animVariant, setAnimVariant] = useState<AnimVariant>("A");
	const theme = themes[themeKey];

	const { isExtensionInstalled, isSpotifyConnected } = stepToState(step);

	const SelectedAnimation = ANIM_COMPONENTS[animVariant];

	return (
		<div
			style={{
				background: theme.bg,
				minHeight: "100dvh",
				padding: "48px 32px",
			}}
		>
			{/* Controls bar */}
			<div className="mb-12 flex flex-wrap items-end gap-6">
				<div className="flex flex-col gap-2">
					<span
						className="text-[10px] uppercase tracking-widest"
						style={{
							fontFamily: fonts.body,
							color: theme.textMuted,
							opacity: 0.38,
						}}
					>
						theme
					</span>
					<div className="flex gap-2">
						{THEME_KEYS.map((key) => (
							<button
								key={key}
								type="button"
								onClick={() => setThemeKey(key)}
								className="rounded-[24px] px-3 py-1 text-xs uppercase tracking-widest transition-all duration-200 active:scale-[0.97]"
								style={{
									fontFamily: fonts.body,
									background: themeKey === key ? theme.primary : "transparent",
									color:
										themeKey === key ? theme.textOnPrimary : theme.textMuted,
									border: `1px solid ${themeKey === key ? "transparent" : theme.border}`,
									opacity: themeKey === key ? 1 : 0.55,
								}}
							>
								{THEME_LABELS[key]}
							</button>
						))}
					</div>
				</div>

				<div className="flex flex-col gap-2">
					<span
						className="text-[10px] uppercase tracking-widest"
						style={{
							fontFamily: fonts.body,
							color: theme.textMuted,
							opacity: 0.38,
						}}
					>
						step
					</span>
					<div className="flex gap-2">
						{([1, 2, 3, 4] as Step[]).map((s) => (
							<button
								key={s}
								type="button"
								onClick={() => setStep(s)}
								className="rounded-[24px] px-4 py-1.5 text-xs font-medium uppercase tracking-widest transition-all duration-200 active:scale-[0.97]"
								style={{
									fontFamily: fonts.body,
									background: step === s ? `${theme.primary}18` : "transparent",
									color: step === s ? theme.primary : theme.textMuted,
									border: `1px solid ${step === s ? `${theme.primary}40` : theme.border}`,
									opacity: step === s ? 1 : 0.55,
								}}
							>
								{s} — {STEP_LABELS[s]}
							</button>
						))}
					</div>
				</div>

				{step === 4 && (
					<div className="flex flex-col gap-2">
						<span
							className="text-[10px] uppercase tracking-widest"
							style={{
								fontFamily: fonts.body,
								color: theme.textMuted,
								opacity: 0.38,
							}}
						>
							animation
						</span>
						<div className="flex gap-2">
							{(["A", "B", "C"] as AnimVariant[]).map((v) => (
								<button
									key={v}
									type="button"
									onClick={() => setAnimVariant(v)}
									className="rounded-[24px] px-3 py-1.5 text-xs uppercase tracking-widest transition-all duration-200 active:scale-[0.97]"
									style={{
										fontFamily: fonts.body,
										background:
											animVariant === v ? `${theme.primary}18` : "transparent",
										color: animVariant === v ? theme.primary : theme.textMuted,
										border: `1px solid ${animVariant === v ? `${theme.primary}40` : theme.border}`,
										opacity: animVariant === v ? 1 : 0.55,
									}}
								>
									{v} · {ANIM_LABELS[v]}
								</button>
							))}
						</div>
					</div>
				)}

				<span
					className="ml-auto text-[11px] uppercase tracking-[0.14em]"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
						opacity: 0.28,
					}}
				>
					extension step · v3 dual column
				</span>
			</div>

			<div
				className="rounded-[8px] p-12"
				style={{ border: `1px solid ${theme.border}` }}
			>
				{step === 4 ? (
					<div className="flex min-h-[320px] items-center justify-center">
						<SelectedAnimation theme={theme} />
					</div>
				) : (
					<V3
						theme={theme}
						isExtensionInstalled={isExtensionInstalled}
						isSpotifyConnected={isSpotifyConnected}
						onAccept={() => setStep(4)}
						onSkip={() => setStep(1)}
					/>
				)}
			</div>
		</div>
	);
}
