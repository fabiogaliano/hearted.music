/**
 * Loader for the YouTube IFrame Player API.
 *
 * Audio review used to link out to youtube.com for every listen, which is the
 * single biggest thing pulling an operator off-task. Embedding the player keeps
 * the listen on-site. The API script is a global singleton (it calls one global
 * ready callback), so this hands back a shared promise: every <AudioPlayer> mounts
 * against a single load instead of racing its own script tag.
 */

export interface YTPlayer {
	playVideo(): void;
	pauseVideo(): void;
	seekTo(seconds: number, allowSeekAhead: boolean): void;
	getCurrentTime(): number;
	getDuration(): number;
	loadVideoById(id: string, startSeconds?: number): void;
	cueVideoById(id: string, startSeconds?: number): void;
	getPlayerState(): number;
	destroy(): void;
}

interface YTPlayerEvent {
	target: YTPlayer;
	data: number;
}

export interface YTPlayerOptions {
	videoId?: string;
	playerVars?: Record<string, string | number>;
	events?: {
		onReady?: (event: YTPlayerEvent) => void;
		onStateChange?: (event: YTPlayerEvent) => void;
	};
}

export interface YTNamespace {
	Player: new (el: HTMLElement, opts: YTPlayerOptions) => YTPlayer;
	PlayerState: {
		UNSTARTED: number;
		ENDED: number;
		PLAYING: number;
		PAUSED: number;
		BUFFERING: number;
		CUED: number;
	};
}

declare global {
	interface Window {
		YT?: YTNamespace;
		onYouTubeIframeAPIReady?: () => void;
	}
}

let apiPromise: Promise<YTNamespace> | null = null;

export function loadYouTubeApi(): Promise<YTNamespace> {
	if (typeof window === "undefined") {
		return Promise.reject(
			new Error("YouTube API unavailable outside a browser"),
		);
	}
	if (window.YT?.Player) return Promise.resolve(window.YT);
	if (apiPromise) return apiPromise;

	apiPromise = new Promise<YTNamespace>((resolve) => {
		// Chain rather than clobber: something else may already own the callback.
		const previous = window.onYouTubeIframeAPIReady;
		window.onYouTubeIframeAPIReady = () => {
			previous?.();
			if (window.YT?.Player) resolve(window.YT);
		};
		const tag = document.createElement("script");
		tag.src = "https://www.youtube.com/iframe_api";
		tag.async = true;
		document.head.appendChild(tag);
	});
	return apiPromise;
}
