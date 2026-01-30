/**
 * Compact audio features display
 * Shows energy, mood (valence), and BPM
 */
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { AnalysisContent } from "../../types";

interface AudioInfoProps {
	theme: ThemeConfig;
	audioFeatures?: AnalysisContent["audio_features"];
	isDark?: boolean;
}

export function AudioInfo({
	theme,
	audioFeatures,
	isDark = false,
}: AudioInfoProps) {
	if (!audioFeatures) return null;

	const labelColor = isDark ? "rgba(255,255,255,0.5)" : theme.textMuted;
	const valueColor = isDark ? "rgba(255,255,255,0.9)" : theme.text;

	const getLabel = (val: number, type: string) => {
		if (type === "energy")
			return val >= 0.7 ? "High" : val >= 0.4 ? "Med" : "Low";
		if (type === "valence")
			return val >= 0.6 ? "Bright" : val >= 0.4 ? "Balanced" : "Melancholic";
		return "";
	};

	return (
		<div className="flex gap-4 text-[10px]">
			{audioFeatures.energy !== undefined && (
				<span style={{ fontFamily: fonts.body, color: labelColor }}>
					Energy:{" "}
					<span style={{ color: valueColor }}>
						{getLabel(audioFeatures.energy, "energy")}
					</span>
				</span>
			)}
			{audioFeatures.valence !== undefined && (
				<span style={{ fontFamily: fonts.body, color: labelColor }}>
					Mood:{" "}
					<span style={{ color: valueColor }}>
						{getLabel(audioFeatures.valence, "valence")}
					</span>
				</span>
			)}
			{audioFeatures.tempo && (
				<span style={{ fontFamily: fonts.body, color: labelColor }}>
					<span style={{ color: valueColor }}>
						{Math.round(audioFeatures.tempo)}
					</span>{" "}
					BPM
				</span>
			)}
		</div>
	);
}
