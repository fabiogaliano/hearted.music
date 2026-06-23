import { ArrowRightIcon } from "@phosphor-icons/react";
import { PostHogProvider } from "@posthog/react";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	type ErrorComponentProps,
	HeadContent,
	Link,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import type { PostHogConfig } from "posthog-js";
import { lazy, useEffect, useRef, useState } from "react";
import {
	RouteErrorFallback,
	roseThemeStyle,
} from "@/components/RouteErrorFallback";
import type { HeartRippleHandle } from "@/components/ui/HeartRippleBackground";
import { HeartRipplePlaceholder } from "@/components/ui/HeartRipplePlaceholder";
import { LazyHeartRippleBackground } from "@/components/ui/LazyHeartRippleBackground";
import { clientEnv } from "@/env.public";
import { CURRENT_CONSENT_VERSION } from "@/lib/consent/consent-policy";
import { CONSENT_MAX_AGE_SECONDS } from "@/lib/consent/consent-storage";
import { KeyboardShortcutProvider } from "@/lib/keyboard/KeyboardShortcutProvider";
import {
	POSTHOG_TUNNEL_PATH,
	resolvePostHogHosts,
} from "@/lib/observability/posthog-hosts";
import { linkPostHogToSentry } from "@/lib/observability/posthog-sentry-link";
import { captureRouteError } from "@/lib/observability/sentry";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import { extractHue, getPastelColor } from "@/lib/utils/color";
import appCss from "../styles.css?url";

const DevToolsShell = import.meta.env.DEV
	? lazy(() => import("@/components/dev/DevToolsShell"))
	: null;

function getPostHogConfig(): {
	apiKey: string;
	apiHost: string;
	uiHost: string;
} | null {
	// PostHog is production-only. Keeps dev consoles quiet and avoids
	// polluting prod analytics with local sessions even if a token leaks
	// into a dev .env.
	if (!import.meta.env.PROD) return null;

	const apiKey = clientEnv.VITE_PUBLIC_POSTHOG_PROJECT_TOKEN;
	if (!apiKey) {
		throw new Error(
			"PostHog is required in production. Set VITE_PUBLIC_POSTHOG_PROJECT_TOKEN.",
		);
	}

	const resolvedHosts = resolvePostHogHosts(
		clientEnv.VITE_PUBLIC_POSTHOG_HOST,
		{
			strict: import.meta.env.PROD,
		},
	);
	if (resolvedHosts.kind === "invalid") {
		throw new Error(resolvedHosts.reason);
	}

	return {
		apiKey,
		apiHost: POSTHOG_TUNNEL_PATH,
		uiHost: resolvedHosts.value.uiHost,
	};
}

// cookieless_mode exists in posthog-js at runtime but is missing from the
// published PostHogConfig type in this version, so we declare it locally.
type PostHogInitOptions = Partial<PostHogConfig> & {
	cookieless_mode?: "always" | "on_reject";
};

const POSTHOG_CONSENT_PERSISTENCE_NAME = `hearted_posthog_consent_v${CURRENT_CONSENT_VERSION}`;

function buildPostHogOptions(
	config: NonNullable<ReturnType<typeof getPostHogConfig>>,
): PostHogInitOptions {
	return {
		api_host: config.apiHost,
		ui_host: config.uiHost,
		defaults: "2025-05-24",
		capture_exceptions: true,
		// Dead-click autocapture lazy-fetches /static/dead-clicks-autocapture.js,
		// which blockers match by filename. Unlike the recorder, its loader always
		// fetches even when the script is bundled (only the global
		// disable_external_dependency_loading flag stops it, and that flag would
		// break the recorder's lazy load), so it can't be self-hosted cleanly. The
		// signal is marginal next to our event capture, so we turn it off rather
		// than emit a blocked request on every session.
		capture_dead_clicks: false,
		debug: import.meta.env.DEV,
		loaded: (posthog) => {
			// Segment analytics by deploy — PostHog's equivalent of a release tag.
			if (clientEnv.VITE_APP_RELEASE) {
				posthog.register({ app_release: clientEnv.VITE_APP_RELEASE });
			}
			linkPostHogToSentry(posthog);
		},
		// Keep PostHog's own explicit opt-in marker on a versioned cookie with the
		// same lifetime as our app cookie. That prevents an old SDK-side grant from
		// surviving a consent expiry or policy-version bump before ConsentProvider
		// gets a chance to reconcile state.
		consent_persistence_name: POSTHOG_CONSENT_PERSISTENCE_NAME,
		opt_out_capturing_persistence_type: "cookie",
		cookie_expiration: CONSENT_MAX_AGE_SECONDS / (60 * 60 * 24),
		// Consent gate (ePrivacy/GDPR) via cookieless_mode "on_reject":
		//  • pending (no choice yet): nothing captured, no cookies/localStorage.
		//  • Decline: users are still counted anonymously via a server-side
		//    daily-rotating hash (no device storage, no identify, no replay) —
		//    consent-exempt audience measurement.
		//  • Accept: ConsentProvider opts in for full identified capture and
		//    session replay.
		// GeoIP/person enrichment only applies to accepted (identified)
		// sessions; cookieless events carry no person profile.
		cookieless_mode: "on_reject",
		// Replay never auto-starts; ConsentProvider starts it only on Accept.
		disable_session_recording: true,
	};
}

interface MyRouterContext {
	queryClient: QueryClient;
}

export const Route = createRootRouteWithContext<MyRouterContext>()({
	head: () => ({
		meta: [
			{
				charSet: "utf-8",
			},
			{
				name: "viewport",
				content: "width=device-width, initial-scale=1",
			},
			{
				title: "hearted.",
			},
			{
				name: "description",
				content: "the stories inside your liked songs",
			},
		],
		links: [
			{
				rel: "icon",
				href: "/favicon.ico",
				sizes: "48x48 32x32 16x16",
			},
			{
				rel: "apple-touch-icon",
				href: "/logo192.png",
			},
			{
				rel: "stylesheet",
				href: appCss,
			},
			{
				rel: "preconnect",
				href: "https://fonts.googleapis.com",
			},
			{
				rel: "preconnect",
				href: "https://fonts.gstatic.com",
				crossOrigin: "anonymous",
			},
			{
				rel: "stylesheet",
				href: "https://fonts.googleapis.com/css2?family=Instrument+Serif:ital@0;1&family=Geist:wght@100..900&display=swap",
			},
		],
	}),
	headers: ({ ssr }) => {
		const baseHeaders = {
			"X-Frame-Options": "DENY",
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "strict-origin-when-cross-origin",
			"X-XSS-Protection": "0",
			"Strict-Transport-Security":
				"max-age=63072000; includeSubDomains; preload",
			"Permissions-Policy":
				"camera=(), microphone=(), geolocation=(), payment=(), usb=()",
		};
		const cspDirectives = [
			"default-src 'self'",
			"base-uri 'self'",
			"form-action 'self'",
			"frame-ancestors 'none'",
			`style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://cdn.userjot.com`,
			"font-src 'self' https://fonts.gstatic.com",
			`img-src 'self' data: https://i.scdn.co https://*.scdn.co https://*.spotifycdn.com https://*.googleusercontent.com https://*.bcbits.com https://*.userjot.com https://*.fbsbx.com`,
			"frame-src https://open.spotify.com https://*.userjot.com",
			// Session replay (Sentry rrweb, and PostHog's recorder) compresses events
			// in a Web Worker spun up from a blob: URL. Without an explicit worker-src
			// the browser falls back to script-src — which has no blob: — and blocks
			// the worker. Scoped here so workers are allowed without letting script-src
			// execute blob: code.
			"worker-src 'self' blob:",
			"object-src 'none'",
			"upgrade-insecure-requests",
		];

		getPostHogConfig();

		if (import.meta.env.DEV) {
			return {
				...baseHeaders,
				"Content-Security-Policy": [
					...cspDirectives,
					[
						"script-src",
						"'self'",
						"'unsafe-eval'",
						"'unsafe-inline'",
						"https://open.spotify.com",
						"https://*.spotifycdn.com",
						"https://cdn.userjot.com",
						"http://localhost:*",
						"http://127.0.0.1:*",
					].join(" "),
					[
						"connect-src",
						"'self'",
						"https://*.userjot.com",
						"ws://localhost:*",
						"ws://127.0.0.1:*",
						"http://localhost:*",
						"http://127.0.0.1:*",
					].join(" "),
				].join("; "),
			};
		}

		if (!ssr?.nonce) {
			return {
				...baseHeaders,
				"Content-Security-Policy": [
					...cspDirectives,
					// TODO: build/research the sandboxed-frame approach to drop
					// 'unsafe-eval' when there's more time.
					// Spotify's embed IFrame API evals internally; 'unsafe-eval' is
					// document-scoped (not origin-scoped), so allowlisting
					// open.spotify.com in script-src alone does not permit it.
					[
						"script-src",
						"'self'",
						"'unsafe-eval'",
						"https://open.spotify.com",
						"https://*.spotifycdn.com",
						"https://cdn.userjot.com",
					].join(" "),
					["connect-src", "'self'", "https://*.userjot.com"].join(" "),
				].join("; "),
			};
		}

		const nonce = ssr.nonce;
		return {
			...baseHeaders,
			"Content-Security-Policy": [
				...cspDirectives,
				// Nonce + 'self'/host allowlist, deliberately WITHOUT 'strict-dynamic'.
				// The nonce authorizes TanStack Start's inline hydration/streaming
				// scripts; 'self' authorizes the code-split route chunks the router
				// pulls in via dynamic import(). iOS Safari (WebKit) does not propagate
				// 'strict-dynamic' trust to dynamically-imported ES modules, so under
				// 'strict-dynamic' it blocked every route chunk loaded on client-side
				// navigation, throwing "Importing a module script failed" on most
				// routes. Listing 'self' keeps those same-origin chunks loadable.
				// TODO: build/research the sandboxed-frame approach to drop
				// 'unsafe-eval' when there's more time.
				// 'unsafe-eval' is required by Spotify's embed IFrame API, which
				// evals in this document. It is document-scoped, not origin-scoped,
				// so the open.spotify.com allowlist below does not cover it.
				[
					"script-src",
					"'self'",
					`'nonce-${nonce}'`,
					"'unsafe-eval'",
					"https://open.spotify.com",
					"https://*.spotifycdn.com",
					"https://cdn.userjot.com",
				].join(" "),
				["connect-src", "'self'", "https://*.userjot.com"].join(" "),
			].join("; "),
		};
	},

	// Resolved server-side so an authenticated user with valid DB consent never
	// sees a banner flash, even when their cookie is gone.
	component: RootComponent,
	errorComponent: RootErrorComponent,
	notFoundComponent: NotFoundPage,
	shellComponent: RootDocument,
});

function RootComponent() {
	return (
		<ThemeHueProvider>
			<KeyboardShortcutProvider>
				<Outlet />
			</KeyboardShortcutProvider>
		</ThemeHueProvider>
	);
}

function RootErrorComponent({ error }: ErrorComponentProps) {
	useEffect(() => {
		console.error("[RootError]", error);
		captureRouteError(error, { route: "__root" });
	}, [error]);

	return <RouteErrorFallback />;
}

function NotFoundPage() {
	const theme = themes.rose;
	const [isBackgroundReady, setIsBackgroundReady] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);
	const heartRippleRef = useRef<HeartRippleHandle>(null);

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		let pending: { x: number; y: number } | null = null;
		let rafId: number | null = null;

		const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

		const scheduleUpdate = () => {
			if (rafId != null) return;
			rafId = requestAnimationFrame(() => {
				rafId = null;
				if (!pending) return;
				heartRippleRef.current?.setPointer(pending);
				pending = null;
			});
		};

		const handlePointerMove = (ev: PointerEvent) => {
			const rect = container.getBoundingClientRect();
			const x = clamp01((ev.clientX - rect.left) / rect.width);
			const y = clamp01(1 - (ev.clientY - rect.top) / rect.height);
			pending = { x, y };
			scheduleUpdate();
		};

		window.addEventListener("pointermove", handlePointerMove);

		return () => {
			window.removeEventListener("pointermove", handlePointerMove);
			if (rafId != null) {
				cancelAnimationFrame(rafId);
			}
		};
	}, []);

	const themeHue = extractHue(theme.primary);
	const pastelColor = getPastelColor(themeHue);

	return (
		<div
			ref={containerRef}
			className="theme-bg relative flex min-h-screen flex-col items-center justify-center overflow-hidden"
			style={roseThemeStyle}
		>
			{/* Static background (always visible initially) */}
			<div className="absolute inset-0 z-0">
				<HeartRipplePlaceholder />
			</div>

			{/* WebGL background (fades in when ready) */}
			<div
				className={`absolute inset-0 z-10 transition-opacity duration-1000 ${isBackgroundReady ? "opacity-100" : "opacity-0"}`}
			>
				<LazyHeartRippleBackground
					rippleRef={heartRippleRef}
					onReady={() => setIsBackgroundReady(true)}
				/>
			</div>

			<div
				className={`relative z-20 px-8 text-center transition-opacity duration-700 ${isBackgroundReady ? "opacity-100" : "opacity-0"}`}
			>
				<p
					className="text-[12rem] leading-none font-extralight tracking-tight md:text-[16rem]"
					style={{
						fontFamily: fonts.display,
						color: pastelColor,
						opacity: 0.6,
					}}
				>
					404
				</p>

				<h1
					className="-mt-8 text-4xl leading-tight font-extralight md:text-5xl lg:text-6xl"
					style={{
						fontFamily: fonts.display,
						color: pastelColor,
					}}
				>
					this song got <span className="italic">lost</span>
				</h1>

				<p className="theme-text-on-primary mt-6 text-lg leading-relaxed opacity-90 lg:text-xl">
					The page you're looking for doesn't exist.
					<br />
					Maybe it was never meant to be found.
				</p>

				<Link
					to="/"
					className="theme-text-on-primary group mt-10 inline-flex items-center gap-3"
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-lg font-medium tracking-wide">
						Back to hearted.
					</span>
					<ArrowRightIcon
						size={16}
						className="inline-block transition-transform group-hover:translate-x-1"
						style={{ opacity: 0.7 }}
					/>
				</Link>
			</div>
		</div>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	const posthogConfig = getPostHogConfig();

	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{posthogConfig ? (
					<PostHogProvider
						apiKey={posthogConfig.apiKey}
						options={buildPostHogOptions(posthogConfig)}
					>
						{children}
						{DevToolsShell && <DevToolsShell />}
					</PostHogProvider>
				) : (
					<>
						{children}
						{DevToolsShell && <DevToolsShell />}
					</>
				)}
				<Scripts />
			</body>
		</html>
	);
}
