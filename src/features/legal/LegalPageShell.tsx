import type React from "react";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { fonts } from "@/lib/theme/fonts";

interface LegalPageShellProps {
	children: React.ReactNode;
	activePage: "faq" | "privacy" | "terms";
}

const navLinks = [
	{ href: "/faq", label: "FAQ", page: "faq" as const },
	{ href: "/privacy", label: "Privacy", page: "privacy" as const },
	{ href: "/terms", label: "Terms", page: "terms" as const },
];

export function LegalPageShell({ children, activePage }: LegalPageShellProps) {
	const theme = useTheme();

	return (
		<div
			style={{
				minHeight: "100dvh",
				backgroundColor: theme.bg,
				color: theme.text,
			}}
		>
			<nav
				style={{ borderBottom: `1px solid ${theme.border}` }}
				className="flex w-full items-center justify-between px-8 py-6"
			>
				<a
					href="/"
					style={{ fontFamily: fonts.display, color: theme.text, opacity: 0.8 }}
					className="italic text-lg transition-opacity duration-200 hover:opacity-100"
				>
					hearted.
				</a>
				<div className="flex items-center gap-6">
					{navLinks.map(({ href, label, page }) => (
						<a
							key={page}
							href={href}
							style={{
								color: activePage === page ? theme.text : theme.textMuted,
							}}
							className="text-xs uppercase tracking-widest font-medium transition-colors duration-200"
						>
							{label}
						</a>
					))}
				</div>
			</nav>

			<main style={{ backgroundColor: theme.bg, color: theme.text }}>
				{children}
			</main>

			<footer
				style={{
					borderTop: `1px solid ${theme.border}`,
					color: theme.textMuted,
				}}
				className="px-8 py-8 text-center text-sm"
			>
				<p className="flex items-center justify-center gap-4">
					{navLinks.map(({ href, label, page }, i) => (
						<span key={page} className="flex items-center gap-4">
							{i > 0 && <span style={{ color: theme.border }}>·</span>}
							<a
								href={href}
								style={{
									color: activePage === page ? theme.text : theme.textMuted,
								}}
								className="transition-colors duration-200 hover:underline underline-offset-2"
							>
								{label}
							</a>
						</span>
					))}
				</p>
				<p
					className="mt-3 italic text-sm"
					style={{
						fontFamily: fonts.display,
						color: theme.textMuted,
						opacity: 0.7,
					}}
				>
					hearted. by{" "}
					<a
						href="https://fabiogaliano.com"
						target="_blank"
						rel="noopener noreferrer"
						className="underline underline-offset-2 hover:opacity-100 transition-opacity duration-200"
					>
						fábio galiano
					</a>
				</p>
			</footer>
		</div>
	);
}
