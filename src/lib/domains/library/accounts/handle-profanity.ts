// obscenity is a server-only dependency. Never import this module from browser
// code or any client bundle.
import {
	englishDataset,
	englishRecommendedTransformers,
	RegExpMatcher,
} from "obscenity";

// Instantiate once at module load so we pay the build cost only on cold start.
const matcher = new RegExpMatcher({
	...englishDataset.build(),
	...englishRecommendedTransformers,
});

export function isProfaneHandle(normalizedHandle: string): boolean {
	// Strip separator characters before checking so obfuscated forms like
	// "f.u_c.k" collapse to "fuck" before the matcher sees the input.
	const stripped = normalizedHandle.replace(/[._]/g, "");
	return matcher.hasMatch(stripped);
}
