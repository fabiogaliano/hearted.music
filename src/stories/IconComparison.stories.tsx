import type { Story } from "@ladle/react";
import {
	ArrowSquareOutIcon,
	CheckIcon,
	LockSimpleIcon,
	SparkleIcon,
} from "@phosphor-icons/react";
import { SongSelectionBar } from "@/features/liked-songs/components/SongSelectionBar";
import { ExtensionSetupTrail } from "@/features/onboarding/components/ExtensionSetupTrail";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

export default {
	title: "Foundations/Icons",
};

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	const theme = useTheme();
	return (
		<div style={{ marginBottom: 40 }}>
			<p
				className="text-xs uppercase tracking-widest"
				style={{
					fontFamily: fonts.body,
					color: theme.textMuted,
					marginBottom: 12,
				}}
			>
				{title}
			</p>
			{children}
		</div>
	);
}

export const Components: Story = () => {
	const theme = useTheme();
	const noop = () => {};

	return (
		<div style={{ padding: 48, maxWidth: 700, fontFamily: fonts.body }}>
			<h1
				className="mb-2 text-2xl font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				Phosphor Icons — In Use
			</h1>
			<p className="mb-12 text-xs" style={{ color: theme.textMuted }}>
				Real components using Phosphor icons.
			</p>

			{/* SongSelectionBar — uses LockSimple, X */}
			<Section title="SongSelectionBar — LockSimple, X">
				<SongSelectionBar
					selectedCount={3}
					remainingBalance={47}
					onConfirm={noop}
					onCancel={noop}
				/>
			</Section>

			{/* ExtensionSetupTrail — uses Check */}
			<Section title="ExtensionSetupTrail — Check (bold)">
				<div style={{ maxWidth: 300 }}>
					<ExtensionSetupTrail
						isExtensionInstalled={true}
						isSpotifyConnected={true}
					/>
				</div>
				<div style={{ maxWidth: 300, marginTop: 16 }}>
					<ExtensionSetupTrail
						isExtensionInstalled={true}
						isSpotifyConnected={false}
					/>
				</div>
			</Section>

			{/* Panel locked state — LockSimple light */}
			<Section title="Panel Locked State — LockSimple (light)">
				<div className="flex items-center gap-4">
					<div
						className="flex size-12 shrink-0 items-center justify-center rounded-full"
						style={{
							background: `color-mix(in srgb, ${theme.primary} 15%, transparent)`,
						}}
					>
						<LockSimpleIcon size={20} color={theme.primary} weight="light" />
					</div>
					<div>
						<p
							className="text-lg"
							style={{ fontFamily: fonts.display, color: theme.text }}
						>
							This song is locked
						</p>
						<p className="text-sm" style={{ color: theme.textMuted }}>
							Unlock to see its full analysis, themes, and playlist matches.
						</p>
					</div>
				</div>
			</Section>

			{/* Song card icons — LockSimple, Check */}
			<Section title="Song Card Icons — LockSimple, Check (bold)">
				<div style={{ display: "flex", gap: 16, alignItems: "center" }}>
					<div
						className="relative flex size-16 items-center justify-center rounded-sm"
						style={{ background: "rgba(0,0,0,0.5)" }}
					>
						<LockSimpleIcon size={16} color="white" weight="regular" />
					</div>
					<span className="theme-border-color flex size-5 shrink-0 items-center justify-center border" />
					<span
						className="theme-primary-bg flex size-5 shrink-0 items-center justify-center border"
						style={{ borderColor: theme.primary }}
					>
						<CheckIcon
							size={12}
							color="var(--t-text-on-primary)"
							weight="bold"
						/>
					</span>
					<button
						type="button"
						className="theme-primary-action inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium tracking-wider uppercase"
					>
						<LockSimpleIcon size={11} weight="regular" />
						Unlock
					</button>
				</div>
			</Section>

			{/* External link — ArrowSquareOut */}
			<Section title="Billing Link — ArrowSquareOut (light)">
				<button
					type="button"
					className="theme-text-muted inline-flex items-center gap-1.5 text-xs tracking-wider uppercase hover:opacity-70"
					style={{ fontFamily: fonts.body }}
				>
					Manage subscription
					<ArrowSquareOutIcon size={12} weight="light" />
				</button>
			</Section>

			{/* Sparkle — PaywallCTA icon */}
			<Section title="PaywallCTA Icon — Sparkle">
				<div className="flex flex-col items-center gap-3">
					<SparkleIcon size={24} color={theme.primary} weight="regular" />
					<p
						className="text-base"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						Unlock your library
					</p>
					<p className="text-sm" style={{ color: theme.textMuted }}>
						See the full analysis for every song.
					</p>
				</div>
			</Section>
		</div>
	);
};
