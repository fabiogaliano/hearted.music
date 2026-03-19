export function normalizeString(str: string): string {
	return (
		str
			.toLowerCase()
			// Remove special characters and accents
			.normalize("NFD")
			.replace(/[\u0300-\u036f]/g, "")
			// Remove parentheses and their contents
			.replace(/\([^)]*\)/g, "")
			// Remove common artist prefixes/suffixes
			.replace(/(feat\.|ft\.|featuring)/g, "")
			// Remove special characters and extra spaces
			.replace(/[^a-z0-9\s]/g, "")
			.trim()
			// Collapse multiple spaces
			.replace(/\s+/g, " ")
	);
}

export function calculateSimilarity(str1: string, str2: string): number {
	const s1 = normalizeString(str1);
	const s2 = normalizeString(str2);

	// If either string is empty after normalization, return 0
	if (!s1 || !s2) return 0;

	// If strings are identical after normalization, return 1
	if (s1 === s2) return 1;

	// Check if one string contains the other
	if (s1.includes(s2) || s2.includes(s1)) return 0.9;

	// Calculate Levenshtein distance
	const distance = levenshteinDistance(s1, s2);
	const maxLength = Math.max(s1.length, s2.length);

	// Convert distance to similarity score (0 to 1)
	return 1 - distance / maxLength;
}

function levenshteinDistance(str1: string, str2: string): number {
	const m = str1.length;
	const n = str2.length;
	const dp: number[][] = Array(m + 1)
		.fill(null)
		.map(() => Array(n + 1).fill(0));

	for (let i = 0; i <= m; i++) dp[i][0] = i;
	for (let j = 0; j <= n; j++) dp[0][j] = j;

	for (let i = 1; i <= m; i++) {
		for (let j = 1; j <= n; j++) {
			if (str1[i - 1] === str2[j - 1]) {
				dp[i][j] = dp[i - 1][j - 1];
			} else {
				dp[i][j] = Math.min(
					dp[i - 1][j - 1] + 1, // substitution
					dp[i - 1][j] + 1, // deletion
					dp[i][j - 1] + 1, // insertion
				);
			}
		}
	}

	return dp[m][n];
}
