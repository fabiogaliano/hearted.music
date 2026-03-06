import { Check } from "lucide-react";
import type { ThemeConfig } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";

type TrailRowProps = {
	isDone: boolean;
	doneLabel: string;
	waitingLabel: string;
	theme: ThemeConfig;
};

function TrailRow({ isDone, doneLabel, waitingLabel, theme }: TrailRowProps) {
	return (
		<div className="flex items-center gap-2.5">
			<div
				style={{ position: "relative", width: 12, height: 12, flexShrink: 0 }}
			>
				{/* pulsing dot — waiting state */}
				<span
					className={isDone ? "" : "motion-safe:animate-pulse"}
					style={{
						position: "absolute",
						inset: 0,
						margin: "auto",
						display: "block",
						width: 6,
						height: 6,
						borderRadius: "100%",
						background: theme.textMuted,
						opacity: isDone ? 0 : 0.3,
						transform: isDone ? "scale(0.7)" : "scale(1)",
						transition: "opacity 150ms ease-out, transform 150ms ease-out",
					}}
				/>
				{/* checkmark — done state */}
				<Check
					size={12}
					strokeWidth={3}
					style={{
						position: "absolute",
						inset: 0,
						margin: "auto",
						display: "block",
						color: theme.primary,
						opacity: isDone ? 1 : 0,
						transform: isDone ? "scale(1)" : "scale(0.7)",
						transition: "opacity 150ms ease-out, transform 150ms ease-out",
					}}
				/>
			</div>
			<span
				className="text-[12px]"
				style={{
					fontFamily: fonts.body,
					color: isDone ? theme.text : theme.textMuted,
					opacity: isDone ? 0.7 : 0.4,
					transition: "opacity 150ms ease-out, color 150ms ease-out",
				}}
			>
				{isDone ? doneLabel : waitingLabel}
			</span>
		</div>
	);
}

type ConnectorLineProps = {
	theme: ThemeConfig;
};

function ConnectorLine({ theme }: ConnectorLineProps) {
	return (
		<>
			{/* keyframe lives inline — scoped to this mount, no global stylesheet needed */}
			<style>{`
        @keyframes trailScaleIn {
          from { transform: scaleY(0); opacity: 0; }
          to   { transform: scaleY(1); opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .trail-connector { animation: none !important; opacity: 1 !important; }
        }
      `}</style>
			<div style={{ paddingLeft: 5 }}>
				<div
					className="trail-connector"
					style={{
						width: 1,
						height: 20,
						background: theme.border,
						opacity: 0.6,
						transformOrigin: "top",
						animation:
							"trailScaleIn 200ms cubic-bezier(0.165, 0.84, 0.44, 1) 50ms both",
					}}
				/>
			</div>
		</>
	);
}

type ExtensionSetupTrailProps = {
	theme: ThemeConfig;
	isExtensionInstalled: boolean;
	isSpotifyConnected: boolean;
};

export function ExtensionSetupTrail({
	theme,
	isExtensionInstalled,
	isSpotifyConnected,
}: ExtensionSetupTrailProps) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			<TrailRow
				isDone={isExtensionInstalled}
				doneLabel="extension found"
				waitingLabel="looking for the extension…"
				theme={theme}
			/>
			{isExtensionInstalled && (
				<>
					<ConnectorLine theme={theme} />
					<div
						className="trail-row-enter"
						style={{
							opacity: 0,
							transform: "translateY(4px)",
							animation:
								"trailRowEnter 200ms cubic-bezier(0.165, 0.84, 0.44, 1) 50ms both",
						}}
					>
						<style>{`
              @keyframes trailRowEnter {
                from { opacity: 0; transform: translateY(4px); }
                to   { opacity: 1; transform: translateY(0); }
              }
              @media (prefers-reduced-motion: reduce) {
                .trail-row-enter { animation: none !important; opacity: 1 !important; transform: none !important; }
              }
            `}</style>
						<TrailRow
							isDone={isSpotifyConnected}
							doneLabel="Spotify connected"
							waitingLabel="open Spotify in your browser"
							theme={theme}
						/>
					</div>
				</>
			)}
		</div>
	);
}
