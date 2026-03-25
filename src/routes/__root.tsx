// react-scan must be imported before React

import { TanStackDevtools } from "@tanstack/react-devtools";
import type { QueryClient } from "@tanstack/react-query";
import {
	createRootRouteWithContext,
	type ErrorComponentProps,
	HeadContent,
	Link,
	Outlet,
	Scripts,
} from "@tanstack/react-router";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import { useEffect, useRef, useState } from "react";
import { scan } from "react-scan";
import { Toaster } from "sonner";
import {
	HeartRippleBackground,
	type HeartRippleHandle,
} from "@/components/ui/HeartRippleBackground";
import { HeartRipplePlaceholder } from "@/components/ui/HeartRipplePlaceholder";
import { KeyboardShortcutProvider } from "@/lib/keyboard/KeyboardShortcutProvider";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import {
	ThemeHueProvider,
	useRegisterTheme,
} from "@/lib/theme/ThemeHueProvider";
import { extractHue, getPastelColor } from "@/lib/utils/color";
import TanStackQueryDevtools from "../integrations/tanstack-query/devtools";
import appCss from "../styles.css?url";

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

function RootErrorComponent({ error, reset }: ErrorComponentProps) {
	const theme = themes.rose;
	const themeHue = extractHue(theme.primary);
	const pastelColor = getPastelColor(themeHue);

	useEffect(() => {
		console.error("[RootError]", error);
	}, [error]);

	return (
		<div
			className="flex min-h-screen flex-col items-center justify-center px-8"
			style={{ background: theme.bg }}
		>
			<p
				className="text-xs tracking-widest uppercase"
				style={{
					fontFamily: fonts.body,
					color: theme.textOnPrimary,
					opacity: 0.7,
				}}
			>
				Something broke
			</p>

			<h1
				className="mt-4 text-4xl leading-tight font-extralight md:text-5xl"
				style={{ fontFamily: fonts.display, color: pastelColor }}
			>
				a wrong <span className="italic">note</span>
			</h1>

			<p
				className="mt-6 max-w-md text-center text-lg leading-relaxed"
				style={{
					fontFamily: fonts.body,
					color: theme.textOnPrimary,
					opacity: 0.8,
				}}
			>
				{error.message || "An unexpected error occurred."}
			</p>

			<div className="mt-10 flex items-center gap-6">
				<button
					type="button"
					onClick={reset}
					className="group inline-flex items-center gap-2"
					style={{ fontFamily: fonts.body, color: theme.textOnPrimary }}
				>
					<span className="text-lg font-medium tracking-wide">Try again</span>
					<span
						className="inline-block transition-transform group-hover:rotate-45"
						style={{ opacity: 0.7 }}
					>
						↻
					</span>
				</button>

				<Link
					to="/"
					className="text-sm underline"
					style={{
						fontFamily: fonts.body,
						color: theme.textOnPrimary,
						opacity: 0.7,
					}}
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

	useRegisterTheme(theme);

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
			className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden"
			style={{ background: theme.bg }}
		>
			{/* Static background (always visible initially) */}
			<div className="absolute inset-0 z-0">
				<HeartRipplePlaceholder />
			</div>

			{/* WebGL background (fades in when ready) */}
			<div
				className={`absolute inset-0 z-10 transition-opacity duration-1000 ${isBackgroundReady ? "opacity-100" : "opacity-0"}`}
			>
				<HeartRippleBackground
					ref={heartRippleRef}
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

				<p
					className="mt-6 text-lg leading-relaxed lg:text-xl"
					style={{
						color: theme.textOnPrimary,
						opacity: 0.9,
					}}
				>
					The page you're looking for doesn't exist.
					<br />
					Maybe it was never meant to be found.
				</p>

				<Link
					to="/"
					className="group mt-10 inline-flex items-center gap-3"
					style={{ fontFamily: fonts.body, color: theme.textOnPrimary }}
				>
					<span className="text-lg font-medium tracking-wide">
						Back to hearted.
					</span>
					<span
						className="inline-block transition-transform group-hover:translate-x-1"
						style={{ opacity: 0.7 }}
					>
						→
					</span>
				</Link>
			</div>
		</div>
	);
}

function RootDocument({ children }: { children: React.ReactNode }) {
	useEffect(() => {
		if (import.meta.env.DEV && import.meta.env.VITE_DEVTOOLS !== "false") {
			scan({
				enabled: true,
				showToolbar: true,
				log: true,
				animationSpeed: "fast",
			});
		}
	}, []);

	return (
		<html lang="en">
			<head>
				<HeadContent />
			</head>
			<body>
				{children}
				<Toaster richColors position="top-right" />
				{import.meta.env.VITE_DEVTOOLS !== "false" && (
					<TanStackDevtools
						config={{
							position: "bottom-right",
						}}
						plugins={[
							{
								name: "Tanstack Router",
								render: <TanStackRouterDevtoolsPanel />,
							},
							TanStackQueryDevtools,
						]}
					/>
				)}
				<Scripts />
			</body>
		</html>
	);
}
