/**
 * Dice coefficient over character bigrams — a small, dependency-free string
 * similarity that's forgiving of remaster tags and punctuation. Shared by the
 * external-metadata fetchers (lyrics, release years) whose ranking only needs a
 * rough "is this the same record" signal; the operator makes the real call.
 */

/** Lowercase, strip punctuation to spaces — cheap normalization for matching. */
export function normalize(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

export function diceSimilarity(a: string, b: string): number {
	const x = normalize(a);
	const y = normalize(b);
	if (!x || !y) return 0;
	if (x === y) return 1;
	if (x.length < 2 || y.length < 2) return x === y ? 1 : 0;
	const bigrams = new Map<string, number>();
	for (let i = 0; i < x.length - 1; i++) {
		const g = x.slice(i, i + 2);
		bigrams.set(g, (bigrams.get(g) ?? 0) + 1);
	}
	let intersection = 0;
	for (let i = 0; i < y.length - 1; i++) {
		const g = y.slice(i, i + 2);
		const count = bigrams.get(g) ?? 0;
		if (count > 0) {
			bigrams.set(g, count - 1);
			intersection++;
		}
	}
	return (2 * intersection) / (x.length - 1 + (y.length - 1));
}
