export function splitSentences(text: string): string[] {
	return text
		.split(/(?<=[.!?])\s+/)
		.map((s) => s.trim())
		.filter((s) => s.length > 0);
}

export function coefficientOfVariation(lengths: number[]): number | null {
	if (lengths.length < 3) return null;
	const n = lengths.length;
	const mean = lengths.reduce((a, b) => a + b, 0) / n;
	if (mean === 0) return null;
	const variance = lengths.reduce((acc, l) => acc + (l - mean) ** 2, 0) / n;
	return Math.sqrt(variance) / mean;
}

export function sentenceLengthCV(text: string): number | null {
	const lengths = splitSentences(text).map((s) => s.split(/\s+/).length);
	return coefficientOfVariation(lengths);
}
