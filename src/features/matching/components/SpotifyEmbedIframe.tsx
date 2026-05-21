import { useEffect, useRef, useState } from "react";

interface EmbedController {
	play: () => void;
	pause: () => void;
	togglePlay: () => void;
	loadUri: (uri: string) => void;
	destroy: () => void;
	addListener: (event: string, cb: (payload: unknown) => void) => void;
}

interface IFrameAPI {
	createController: (
		element: HTMLElement,
		options: {
			uri: string;
			width?: string | number;
			height?: string | number;
			theme?: 0 | 1;
		},
		callback: (controller: EmbedController) => void,
	) => void;
}

declare global {
	interface Window {
		onSpotifyIframeApiReady?: (api: IFrameAPI) => void;
	}
}

// Spotify's Iframe API ships a single global `window.onSpotifyIframeApiReady`
// callback. Loading the script twice would clobber it, so we cache the load
// promise at module scope and let every embed instance await the same one.
let apiPromise: Promise<IFrameAPI> | null = null;

function loadIFrameAPI(): Promise<IFrameAPI> {
	if (apiPromise) return apiPromise;
	if (typeof window === "undefined") {
		return Promise.reject(
			new Error("Spotify Iframe API unavailable on server"),
		);
	}

	apiPromise = new Promise<IFrameAPI>((resolve) => {
		window.onSpotifyIframeApiReady = (api) => resolve(api);
		const script = document.createElement("script");
		script.src = "https://open.spotify.com/embed/iframe-api/v1";
		script.async = true;
		document.body.appendChild(script);
	});

	return apiPromise;
}

/**
 * Fire-and-forget warmup. Call on hover/focus to start the SDK script download
 * before the click — by the time the user activates the embed, the module-level
 * `apiPromise` is already resolved and controller setup runs immediately.
 */
export function preloadSpotifyEmbedAPI(): void {
	void loadIFrameAPI().catch(() => {});
}

interface SpotifyEmbedIframeProps {
	spotifyId: string;
	/**
	 * Calls `controller.play()` when true, `controller.pause()` when false.
	 * Decoupled from controller creation so toggling it does NOT remount the
	 * iframe — the iframe stays warm and only playback state changes.
	 * The transition false→true must happen inside a user-gesture chain
	 * (browsers reject programmatic playback without recent user activation).
	 */
	playWhenReady?: boolean;
	className?: string;
}

export function SpotifyEmbedIframe({
	spotifyId,
	playWhenReady,
	className,
}: SpotifyEmbedIframeProps) {
	const wrapperRef = useRef<HTMLDivElement>(null);
	const placeholderRef = useRef<HTMLDivElement>(null);
	const controllerRef = useRef<EmbedController | null>(null);
	const [isReady, setIsReady] = useState(false);

	useEffect(() => {
		const placeholder = placeholderRef.current;
		const wrapper = wrapperRef.current;
		if (!placeholder || !wrapper) return;

		let cancelled = false;

		loadIFrameAPI().then((api) => {
			if (cancelled) return;
			api.createController(
				placeholder,
				{
					uri: `spotify:track:${spotifyId}`,
					width: "100%",
					height: "100%",
				},
				(controller) => {
					if (cancelled) {
						controller.destroy();
						return;
					}
					controllerRef.current = controller;

					// Spotify's SDK pins the iframe to ~660px max-width with rounded
					// corners. Override with !important inline styles so the embed
					// truly fills its parent slot and matches the editorial square.
					const iframe = wrapper.querySelector("iframe");
					if (iframe) {
						iframe.style.setProperty("width", "100%", "important");
						iframe.style.setProperty("height", "100%", "important");
						iframe.style.setProperty("max-width", "none", "important");
						iframe.style.setProperty("max-height", "none", "important");
						iframe.style.setProperty("border-radius", "0", "important");
					}

					setIsReady(true);
				},
			);
		});

		return () => {
			cancelled = true;
			controllerRef.current?.destroy();
			controllerRef.current = null;
			setIsReady(false);
		};
	}, [spotifyId]);

	useEffect(() => {
		const controller = controllerRef.current;
		if (!isReady || !controller) return;
		if (playWhenReady) controller.play();
		else controller.pause();
	}, [playWhenReady, isReady]);

	return (
		<div
			ref={wrapperRef}
			className={className}
			style={{
				outline: "1px solid rgba(255, 255, 255, 0.1)",
				width: "100%",
				height: "100%",
			}}
		>
			<div ref={placeholderRef} style={{ width: "100%", height: "100%" }} />
		</div>
	);
}
