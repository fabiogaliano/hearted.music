/**
 * Dev tool for tuning CD case image positioning.
 * Floating panel with real-time adjustments - like react-scan.
 *
 * Press 'T' to toggle visibility.
 */

import { useEffect, useState, useCallback } from "react";

export interface CDCaseConfig {
	top: number;
	right: number;
	bottom: number;
	left: number;
}

interface CDCaseTunerProps {
	onChange: (config: CDCaseConfig) => void;
	initialConfig?: CDCaseConfig;
}

const DEFAULT_CONFIG: CDCaseConfig = {
	top: 1,
	right: 1,
	bottom: 1,
	left: 10,
};

export function CDCaseTuner({ onChange, initialConfig }: CDCaseTunerProps) {
	const [isVisible, setIsVisible] = useState(true);
	const [isMinimized, setIsMinimized] = useState(false);
	const [config, setConfig] = useState<CDCaseConfig>(initialConfig ?? DEFAULT_CONFIG);

	// Toggle with 'T' key
	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "t" && !e.metaKey && !e.ctrlKey && !e.altKey) {
				const target = e.target as HTMLElement;
				if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
				setIsVisible((v) => !v);
			}
		};
		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	// Notify parent of changes
	useEffect(() => {
		onChange(config);
	}, [config, onChange]);

	const updateConfig = useCallback((key: keyof CDCaseConfig, value: number) => {
		setConfig((prev) => ({ ...prev, [key]: value }));
	}, []);

	const copyToClipboard = useCallback(() => {
		const output = `{ top: ${config.top}, right: ${config.right}, bottom: ${config.bottom}, left: ${config.left} }`;
		navigator.clipboard.writeText(output);
	}, [config]);

	if (!isVisible) return null;

	return (
		<div
			className="fixed bottom-4 right-4 z-[9999] font-mono text-xs"
			style={{
				background: "rgba(0, 0, 0, 0.9)",
				backdropFilter: "blur(8px)",
				border: "1px solid rgba(255, 255, 255, 0.1)",
				borderRadius: "8px",
				color: "#fff",
				minWidth: isMinimized ? "auto" : "280px",
			}}
		>
			{/* Header */}
			<div
				className="flex items-center justify-between px-3 py-2"
				style={{ borderBottom: isMinimized ? "none" : "1px solid rgba(255, 255, 255, 0.1)" }}
			>
				<span className="font-semibold tracking-wide" style={{ color: "#a78bfa" }}>
					CD Case Tuner
				</span>
				<div className="flex gap-2">
					<button
						onClick={() => setIsMinimized((m) => !m)}
						className="opacity-60 hover:opacity-100"
						title={isMinimized ? "Expand" : "Minimize"}
					>
						{isMinimized ? "+" : "−"}
					</button>
					<button
						onClick={() => setIsVisible(false)}
						className="opacity-60 hover:opacity-100"
						title="Close (press T to reopen)"
					>
						×
					</button>
				</div>
			</div>

			{!isMinimized && (
				<div className="p-3">
					{/* Sliders */}
					<div className="space-y-2">
						{(["top", "right", "bottom", "left"] as const).map((key) => (
							<div key={key} className="flex items-center gap-2">
								<label className="w-12 text-right opacity-60">{key}</label>
								<input
									type="range"
									min="0"
									max="20"
									step="0.5"
									value={config[key]}
									onChange={(e) => updateConfig(key, parseFloat(e.target.value))}
									className="flex-1"
									style={{ accentColor: "#a78bfa" }}
								/>
								<input
									type="number"
									min="0"
									max="20"
									step="0.5"
									value={config[key]}
									onChange={(e) => updateConfig(key, parseFloat(e.target.value) || 0)}
									className="w-14 rounded border-none bg-white/10 px-2 py-1 text-right"
								/>
								<span className="opacity-40">%</span>
							</div>
						))}
					</div>

					{/* Preview dimensions */}
					<div className="mt-3 rounded bg-white/5 p-2 text-center" style={{ color: "#a78bfa" }}>
						<div>
							W: {(100 - config.left - config.right).toFixed(1)}% |
							H: {(100 - config.top - config.bottom).toFixed(1)}%
						</div>
					</div>

					{/* Copy button */}
					<button
						onClick={copyToClipboard}
						className="mt-3 w-full rounded py-1.5 transition-colors"
						style={{ background: "#a78bfa", color: "#000" }}
					>
						Copy Config
					</button>

					{/* Hint */}
					<p className="mt-2 text-center opacity-40">Press T to toggle</p>
				</div>
			)}
		</div>
	);
}
