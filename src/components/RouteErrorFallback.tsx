import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { Button } from "@/components/ui/Button";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";

// Rose is used for error states regardless of the user's active theme — it
// keeps the error screen visually distinct from the app chrome.
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

export const roseThemeStyle: ThemeTokenStyle = {
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

/**
 * Themed "a wrong note" error screen shared by all route-level error boundaries.
 * Standalone so each boundary can render it without duplicating the JSX and so
 * the Ladle story can render it in isolation.
 */
export function RouteErrorFallback() {
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
