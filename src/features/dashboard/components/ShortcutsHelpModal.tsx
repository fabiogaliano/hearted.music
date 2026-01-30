/**
 * Keyboard shortcuts help modal
 *
 * Displays available shortcuts grouped by scope.
 * Triggered by pressing ? key.
 */

import { useEffect } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";
import type { Shortcut, ShortcutScope } from "@/lib/keyboard/types";
import { useShortcutContext } from "./KeyboardShortcutProvider";

interface ShortcutsHelpModalProps {
	theme: ThemeConfig;
}

function formatKey(key: string): string {
	const isMac =
		typeof navigator !== "undefined" &&
		/Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

	return key
		.split(", ")
		.map((k) => {
			let formatted = k
				.replace("mod+", isMac ? "\u2318" : "Ctrl+")
				.replace("shift+", "\u21E7")
				.replace("alt+", isMac ? "\u2325" : "Alt+")
				.replace("escape", "ESC")
				.replace("enter", "\u21B5")
				.replace("up", "\u2191")
				.replace("down", "\u2193")
				.replace("left", "\u2190")
				.replace("right", "\u2192")
				.replace("space", "\u2423");

			if (formatted.length === 1) {
				formatted = formatted.toUpperCase();
			}

			return formatted;
		})
		.join(" / ");
}

const SCOPE_LABELS: Record<ShortcutScope, string> = {
	global: "Global",
	"liked-list": "Liked Songs",
	"liked-detail": "Song Detail",
	"playlists-list": "Playlists",
	"playlists-detail": "Playlist Detail",
	matching: "Matching Flow",
	modal: "Modal",
	"onboarding-welcome": "Onboarding",
	"onboarding-colors": "Onboarding",
	"onboarding-playlists": "Onboarding",
	"onboarding-ready": "Onboarding",
};

function groupByScope(shortcuts: Shortcut[]): Map<ShortcutScope, Shortcut[]> {
	const groups = new Map<ShortcutScope, Shortcut[]>();

	const seen = new Set<string>();
	const uniqueShortcuts = shortcuts.filter((s) => {
		if (s.enabled === false) return false;
		const key = `${s.key}-${s.scope}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	for (const shortcut of uniqueShortcuts) {
		const existing = groups.get(shortcut.scope) || [];
		groups.set(shortcut.scope, [...existing, shortcut]);
	}

	return groups;
}

export function ShortcutsHelpModal({ theme }: ShortcutsHelpModalProps) {
	const { isHelpOpen, closeHelp, shortcuts, activeScopes } =
		useShortcutContext();

	useEffect(() => {
		if (!isHelpOpen) return;

		const handleKeyDown = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				e.preventDefault();
				closeHelp();
			}
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [isHelpOpen, closeHelp]);

	if (!isHelpOpen) return null;

	const groupedShortcuts = groupByScope(shortcuts);

	const scopeOrder: ShortcutScope[] = [
		...activeScopes,
		...(
			[
				"global",
				"liked-list",
				"liked-detail",
				"playlists-list",
				"playlists-detail",
				"matching",
				"modal",
			] as ShortcutScope[]
		).filter((s) => !activeScopes.includes(s)),
	];

	return (
		<>
			<div
				className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
				onClick={closeHelp}
				onKeyDown={(e) => e.key === "Enter" && closeHelp()}
			/>

			<div
				className="fixed top-1/2 left-1/2 z-[101] max-h-[80vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto"
				style={{
					background: theme.bg,
					border: `1px solid ${theme.border}`,
					boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
				}}
			>
				<div
					className="sticky top-0 flex items-center justify-between border-b px-6 py-4"
					style={{
						background: theme.bg,
						borderColor: theme.border,
					}}
				>
					<h2
						className="text-lg font-light"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						Keyboard Shortcuts
					</h2>
					<button
						type="button"
						onClick={closeHelp}
						className="p-1 transition-opacity hover:opacity-70"
						style={{ color: theme.textMuted }}
					>
						<span className="text-xl leading-none">&times;</span>
					</button>
				</div>

				<div className="space-y-6 px-6 py-4">
					{scopeOrder.map((scope) => {
						const scopeShortcuts = groupedShortcuts.get(scope);
						if (!scopeShortcuts || scopeShortcuts.length === 0) return null;

						const isActive = activeScopes.includes(scope);

						return (
							<div key={scope}>
								<h3
									className="mb-3 flex items-center gap-2 text-xs tracking-widest uppercase"
									style={{
										fontFamily: fonts.body,
										color: isActive ? theme.text : theme.textMuted,
									}}
								>
									{SCOPE_LABELS[scope]}
									{isActive && (
										<span
											className="rounded px-1.5 py-0.5 text-[10px]"
											style={{
												background: theme.primary,
												color: theme.textOnPrimary,
											}}
										>
											Active
										</span>
									)}
								</h3>

								<div className="space-y-2">
									{scopeShortcuts.map((shortcut, i) => (
										<div
											key={`${shortcut.key}-${i}`}
											className="flex items-center justify-between py-1.5"
										>
											<span
												className="text-sm"
												style={{
													fontFamily: fonts.body,
													color: isActive ? theme.text : theme.textMuted,
												}}
											>
												{shortcut.description}
											</span>
											<kbd
												className="rounded px-2 py-1 text-xs"
												style={{
													fontFamily: fonts.body,
													background: theme.surface,
													color: theme.text,
													border: `1px solid ${theme.border}`,
												}}
											>
												{formatKey(shortcut.key)}
											</kbd>
										</div>
									))}
								</div>
							</div>
						);
					})}

					<div className="border-t pt-4" style={{ borderColor: theme.border }}>
						<div className="flex items-center justify-between py-1.5">
							<span
								className="text-sm"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								Show this help
							</span>
							<kbd
								className="rounded px-2 py-1 text-xs"
								style={{
									fontFamily: fonts.body,
									background: theme.surface,
									color: theme.text,
									border: `1px solid ${theme.border}`,
								}}
							>
								?
							</kbd>
						</div>
					</div>
				</div>
			</div>
		</>
	);
}
