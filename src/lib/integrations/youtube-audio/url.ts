/**
 * YouTube URL validation + video-id extraction. Used to canonicalize an
 * operator-provided URL and to whitelist hosts; never accept a non-YouTube host.
 */

const ALLOWED_HOSTS = new Set([
	"youtube.com",
	"www.youtube.com",
	"music.youtube.com",
	"m.youtube.com",
	"youtu.be",
]);

export interface ParsedYoutubeUrl {
	videoId: string;
	canonicalUrl: string;
}

export function extractYoutubeVideoId(input: string): ParsedYoutubeUrl | null {
	let url: URL;
	try {
		url = new URL(input.trim());
	} catch {
		return null;
	}
	if (url.protocol !== "https:" && url.protocol !== "http:") return null;
	const host = url.hostname.toLowerCase();
	if (!ALLOWED_HOSTS.has(host)) return null;

	let videoId: string | null = null;
	if (host === "youtu.be") {
		videoId = url.pathname.slice(1).split("/")[0] || null;
	} else if (url.pathname === "/watch") {
		videoId = url.searchParams.get("v");
	} else if (url.pathname.startsWith("/shorts/")) {
		videoId = url.pathname.split("/")[2] || null;
	} else if (url.pathname.startsWith("/embed/")) {
		videoId = url.pathname.split("/")[2] || null;
	}

	if (!videoId || !/^[A-Za-z0-9_-]{6,20}$/.test(videoId)) return null;
	return {
		videoId,
		canonicalUrl: `https://www.youtube.com/watch?v=${videoId}`,
	};
}
