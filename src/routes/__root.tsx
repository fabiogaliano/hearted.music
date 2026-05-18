import { ArrowRight } from "@phosphor-icons/react";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	type ErrorComponentProps,
	HeadContent,
	Link,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { type CSSProperties, lazy, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/Button";
import type { HeartRippleHandle } from "@/components/ui/HeartRippleBackground";
import { HeartRipplePlaceholder } from "@/components/ui/HeartRipplePlaceholder";
import { LazyHeartRippleBackground } from "@/components/ui/LazyHeartRippleBackground";
import { captureRouteError } from "@/lib/observability/sentry";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { ThemeHueProvider } from "@/lib/theme/ThemeHueProvider";
import { extractHue, getPastelColor } from "@/lib/utils/color";
import appCss from "../styles.css?url";

const DevToolsShell = import.meta.env.DEV
	? lazy(() => import("@/components/dev/DevToolsShell"))
	: null;

interface MyRouterContext {
	queryClient: QueryClient;
}

type ThemeTokenStyle = CSSProperties &
	Record<
		| "--t-bg"
		| "--t-surface"
		| "--t-surface-dim"
		| "--t-border"
		| "--t-text"
		| "--t-text-muted"
		| "--t-text-on-primary"
		| "--t-primary"
		| "--t-primary-hover",
		string
	>;

const roseThemeStyle: ThemeTokenStyle = {
	"--t-bg": themes.rose.bg,
	"--t-surface": themes.rose.surface,
	"--t-surface-dim": themes.rose.surfaceDim,
	"--t-border": themes.rose.border,
	"--t-text": themes.rose.text,
	"--t-text-muted": themes.rose.textMuted,
	"--t-text-on-primary": themes.rose.textOnPrimary,
	"--t-primary": themes.rose.primary,
	"--t-primary-hover": themes.rose.primaryHover,
};

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
		if (!ssr?.nonce || import.meta.env.DEV) return;
		const nonce = ssr.nonce;
		return {
			"Content-Security-Policy": [
				"default-src 'self'",
				"base-uri 'self'",
				"form-action 'self'",
				"frame-ancestors 'none'",
				`script-src 'strict-dynamic' 'nonce-${nonce}'`,
				`style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
				"font-src 'self' https://fonts.gstatic.com",
				`img-src 'self' data: https://i.scdn.co https://*.googleusercontent.com`,
				"connect-src 'self'",
				"object-src 'none'",
				"upgrade-insecure-requests",
			].join("; "),
			"X-Frame-Options": "DENY",
			"X-Content-Type-Options": "nosniff",
			"Referrer-Policy": "strict-origin-when-cross-origin",
			"X-XSS-Protection": "0",
		};
	},

	component: RootComponent,
	errorComponent: RootErrorComponent,
	notFoundComponent: NotFoundPage,
	shellComponent: RootDocument,
});

function RootComponent() {
	return (
		<ThemeHueProvider>
			<Outlet />
		</ThemeHueProvider>
	);
}

function RootErrorComponent({ error }: ErrorComponentProps) {
	useEffect(() => {
		console.error("[RootError]", error);
		captureRouteError(error, { route: "__root" });
	}, [error]);

	return (
		<div
			className="theme-bg flex min-h-screen flex-col items-center justify-center px-8"
			style={roseThemeStyle}
		>
			<p
				className="theme-text-muted text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Something broke
			</p>

			<h1
				className="theme-primary mt-4 text-4xl leading-tight font-extralight md:text-5xl"
				style={{ fontFamily: fonts.display }}
			>
				a wrong <span className="italic">note</span>
			</h1>

			<div className="mt-10 flex flex-col items-center gap-4">
				<Button
					variant="link"
					onClick={() => window.location.reload()}
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-lg font-medium tracking-wide">Try again</span>
					<span
						className="inline-block transition-transform group-hover:rotate-45"
						style={{ opacity: 0.7 }}
					>
						↻
					</span>
				</Button>

				<Link
					to="/"
					className="theme-text-muted text-sm underline"
					style={{ fontFamily: fonts.body }}
				>
					Back to hearted.
				</Link>
			</div>
		</div>
	);
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
					<ArrowRight
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
	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				{DevToolsShell && <DevToolsShell />}
				<Scripts />
			</body>
		</html>
	);
}
