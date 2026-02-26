export const PANEL_KEYFRAMES = `
@keyframes hearted-slide-fwd {
	from { opacity: 0; transform: translateX(12px); }
	to { opacity: 1; transform: translateX(0); }
}
@keyframes hearted-slide-back {
	from { opacity: 0; transform: translateX(-12px); }
	to { opacity: 1; transform: translateX(0); }
}
@keyframes hearted-fade {
	from { opacity: 0; }
	to { opacity: 1; }
}
@keyframes hearted-push-up {
	from { opacity: 0; transform: translateY(14px); }
	to { opacity: 1; transform: translateY(0); }
}
@keyframes hearted-push-down {
	from { opacity: 0; transform: translateY(-14px); }
	to { opacity: 1; transform: translateY(0); }
}
@keyframes hearted-tick-pulse {
	from { transform: scaleY(0.68); }
	to { transform: scaleY(1); }
}
`;

export const LAYOUT = {
	heroHeight: 450,
	collapsedHeaderHeight: 108,
	albumArtExpanded: 112,
	albumArtCollapsed: 56,
	imagePositionY: 30,
	paddingX: 20,
} as const;

export const ANIMATION_TIMING = {
	staggerDelay: 60,
	staggerDuration: 250,
	crossfadeDuration: 180,
	parallaxRatio: 0.4,
	clusterToContentGap: 10,
} as const;

export const mockPlaylists = [
	{
		id: 1,
		name: "Late Night Feels",
		matchScore: 0.94,
		reason: "Moody and introspective — made for late night thoughts",
	},
	{
		id: 2,
		name: "Soul & Groove",
		matchScore: 0.89,
		reason: "The groove and warmth fit right in",
	},
	{
		id: 3,
		name: "Relationship Therapy",
		matchScore: 0.82,
		reason: "Emotionally resonant — perfect for processing",
	},
	{
		id: 4,
		name: "Morning Coffee",
		matchScore: 0.45,
		reason: "A bit too intense for easy mornings",
	},
];
