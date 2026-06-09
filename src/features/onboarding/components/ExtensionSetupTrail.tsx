import { CheckIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";

type TrailRowProps = {
	isDone: boolean;
	doneLabel: string;
	waitingLabel: string;
};

function TrailRow({ isDone, doneLabel, waitingLabel }: TrailRowProps) {
	return (
		<div className="flex items-center gap-2.5">
			<div
				style={{ position: "relative", width: 12, height: 12, flexShrink: 0 }}
			>
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
						background: "var(--t-text-muted)",
						opacity: isDone ? 0 : 0.3,
						transform: isDone ? "scale(0.7)" : "scale(1)",
						transition: "opacity 150ms ease-out, transform 150ms ease-out",
					}}
				/>
				<CheckIcon
					size={12}
					weight="bold"
					style={{
						position: "absolute",
						inset: 0,
						margin: "auto",
						display: "block",
						color: "var(--t-primary)",
						opacity: isDone ? 1 : 0,
						transform: isDone ? "scale(1)" : "scale(0.7)",
						transition: "opacity 150ms ease-out, transform 150ms ease-out",
					}}
				/>
			</div>
			<span
				className="text-xs"
				style={{
					fontFamily: fonts.body,
					color: isDone ? "var(--t-text)" : "var(--t-text-muted)",
					transition: "color 150ms ease-out",
				}}
			>
				{isDone ? doneLabel : waitingLabel}
			</span>
		</div>
	);
}

function ConnectorLine() {
	return (
		<>
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
					className="trail-connector theme-border-bg"
					style={{
						width: 1,
						height: 20,
						opacity: 0.6,
						transformOrigin: "top",
						animation: "trailScaleIn 200ms var(--ease-out-quart) 50ms both",
					}}
				/>
			</div>
		</>
	);
}

type ExtensionSetupTrailProps = {
	isExtensionInstalled: boolean;
	isSpotifyConnected: boolean;
};

export function ExtensionSetupTrail({
	isExtensionInstalled,
	isSpotifyConnected,
}: ExtensionSetupTrailProps) {
	return (
		<div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
			<TrailRow
				isDone={isExtensionInstalled}
				doneLabel="extension found"
				waitingLabel="looking for the extension…"
			/>
			{isExtensionInstalled && (
				<>
					<ConnectorLine />
					<div
						className="trail-row-enter"
						style={{
							opacity: 0,
							transform: "translateY(4px)",
							animation: "trailRowEnter 200ms var(--ease-out-quart) 50ms both",
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
						/>
					</div>
				</>
			)}
		</div>
	);
}
