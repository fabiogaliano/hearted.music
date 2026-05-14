import type React from "react";
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
	return (
		<div className="theme-bg theme-text min-h-dvh">
			<nav className="theme-border-color flex w-full items-center justify-between border-b px-8 py-6">
				<a
					href="/"
					style={{ fontFamily: fonts.display, opacity: 0.8 }}
					className="theme-text text-lg italic transition-opacity duration-200 hover:opacity-100"
				>
					hearted.
				</a>
				<div className="flex items-center gap-6">
					{navLinks.map(({ href, label, page }) => (
						<a
							key={page}
							href={href}
							className={`${activePage === page ? "theme-text" : "theme-text-muted"} text-xs font-medium tracking-widest uppercase transition-colors duration-200`}
						>
							{label}
						</a>
					))}
				</div>
			</nav>

			<main className="theme-bg theme-text">{children}</main>

			<footer className="theme-border-color theme-text-muted border-t p-8 text-center text-sm">
				<p className="flex items-center justify-center gap-4">
					{navLinks.map(({ href, label, page }, i) => (
						<span key={page} className="flex items-center gap-4">
							{i > 0 && (
								<span className="theme-border-bg size-1 rounded-full" />
							)}
							<a
								href={href}
								className={`${activePage === page ? "theme-text" : "theme-text-muted"} underline-offset-2 transition-colors duration-200 hover:underline`}
							>
								{label}
							</a>
						</span>
					))}
				</p>
				<p
					className="theme-text-muted mt-3 text-sm italic"
					style={{
						fontFamily: fonts.display,
						opacity: 0.7,
					}}
				>
					hearted. by{" "}
					<a
						href="https://fabiogaliano.com"
						target="_blank"
						rel="noopener noreferrer"
						className="underline underline-offset-2 transition-opacity duration-200 hover:opacity-100"
					>
						fábio galiano
					</a>
				</p>
			</footer>
		</div>
	);
}
