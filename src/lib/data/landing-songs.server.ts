/**
 * Server-only landing song data — bundled at build time via Vite.
 *
 * Uses import.meta.glob so the JSON from public/ is embedded in the
 * server bundle. No runtime fetch or filesystem access needed,
 * which means this works on Cloudflare Workers, Node, or any runtime.
 */
import type { LandingSongManifest, LandingSongDetail } from "./landing-songs";

const allModules = import.meta.glob<
	LandingSongDetail | { songs: LandingSongManifest[] }
>("/public/landing-songs/*.json", { eager: true, import: "default" });

// Separate manifest from detail files
let manifest: LandingSongManifest[] = [];
const detailsByTrackId = new Map<string, LandingSongDetail>();

for (const [path, data] of Object.entries(allModules)) {
	if (path.endsWith("/index.json")) {
		manifest = (data as { songs: LandingSongManifest[] }).songs;
	} else {
		const detail = data as LandingSongDetail;
		const trackId = path.split("/").pop()?.replace(".json", "");
		if (trackId && detail.spotifyTrackId) {
			detailsByTrackId.set(trackId, detail);
		}
	}
}

function shuffleArray<T>(arr: T[]): T[] {
	const shuffled = [...arr];
	for (let i = shuffled.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[shuffled[i]!, shuffled[j]!] = [shuffled[j]!, shuffled[i]!];
	}
	return shuffled;
}

export function getShuffledLandingData(): {
	manifest: LandingSongManifest[];
	initialDetail: LandingSongDetail;
} {
	const shuffled = shuffleArray(manifest);
	const firstSong = shuffled[0]!;
	const initialDetail = detailsByTrackId.get(firstSong.spotifyTrackId)!;
	return { manifest: shuffled, initialDetail };
}
