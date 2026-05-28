export interface PromptVersion {
	version: string;
	kind: "lyrical" | "instrumental";
	// Why this version exists and what changed from the prior one — the changelog
	// lives next to the prompt so a version is never separated from its rationale.
	notes: string;
	// Template with {artist} {title} {genres} {audio_features} {lyrics} placeholders.
	template: string;
}
