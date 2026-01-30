/**
 * Label generation helpers for SongDetailPanel sections
 * Convert quantitative audio data into qualitative descriptions
 */

export function getMatchQuality(score: number): {
	label: string;
	showProminent: boolean;
} {
	if (score >= 0.9) return { label: "Perfect fit", showProminent: true };
	if (score >= 0.75) return { label: "Strong match", showProminent: true };
	if (score >= 0.6) return { label: "Good match", showProminent: true };
	return { label: "Might work", showProminent: false };
}

export function getIntensityLabel(intensity: number): string {
	if (intensity > 0.8) return "Hits hard";
	if (intensity > 0.6) return "Builds intensity";
	if (intensity > 0.4) return "Steady presence";
	return "Gentle";
}

export function getAudioQualityLabel(
	value: number,
	type: "energy" | "valence" | "danceability" | "acousticness",
): string {
	const labels = {
		energy: value > 0.7 ? "Explosive" : value > 0.4 ? "Steady" : "Subdued",
		valence:
			value > 0.7 ? "Uplifting" : value > 0.4 ? "Bittersweet" : "Melancholic",
		danceability:
			value > 0.7 ? "Irresistible" : value > 0.4 ? "Groovy" : "Swaying",
		acousticness:
			value > 0.7 ? "Organic" : value > 0.4 ? "Blended" : "Produced",
	};
	return labels[type];
}

export function getTempoFeel(tempo: number): string {
	if (tempo > 140) return "Racing";
	if (tempo > 120) return "Driving";
	if (tempo > 100) return "Steady";
	if (tempo > 80) return "Relaxed";
	return "Slow";
}
