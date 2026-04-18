/**
 * ShortcutsHelpModal - Shows available keyboard shortcuts
 *
 * Triggered by pressing ?
 * Groups shortcuts by scope, active scopes shown first with badge.
 */
import { useEffect } from "react";

import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { fonts } from "@/lib/theme/fonts";

import { SHORTCUT_CATALOG, type CatalogEntry } from "./catalog";
import { useShortcutContext } from "./KeyboardShortcutProvider";
import type { ShortcutScope } from "./types";

const SCOPE_LABELS: Record<ShortcutScope, string> = {
	global: "Global",
	"liked-list": "Liked Songs",
	"liked-detail": "Song Detail",
	"liked-detail-analysis": "Song Analysis",
	"playlists-list": "Playlists",
	"playlists-detail": "Playlist Detail",
	matching: "Matching Flow",
	modal: "Modal",
	"onboarding-welcome": "Onboarding",
	"onboarding-colors": "Onboarding",
	"onboarding-extension": "Onboarding",
	"onboarding-playlists": "Onboarding",
	"onboarding-pick-demo-song": "Onboarding",
	"onboarding-plan-selection": "Onboarding",
};

/** 'mod+s' → '⌘S' on Mac, 'Ctrl+S' on Windows */
function formatKey(key: string): string {
	const isMac =
		typeof navigator !== "undefined" &&
		/Mac|iPhone|iPad|iPod/.test(navigator.userAgent);

	return key
		.split(", ")
		.map((k) => {
			let formatted = k
				.replace("mod+", isMac ? "⌘" : "Ctrl+")
				.replace("shift+", "⇧")
				.replace("alt+", isMac ? "⌥" : "Alt+")
				.replace("escape", "ESC")
				.replace("enter", "↵")
				.replace("up", "↑")
				.replace("down", "↓")
				.replace("left", "←")
				.replace("right", "→")
				.replace("space", "␣");

			if (formatted.length === 1) {
				formatted = formatted.toUpperCase();
			}

			return formatted;
		})
		.join(" / ");
}

interface MergedShortcut {
	description: string;
	keys: string[];
}

/** Letters/digits sort before special keys (arrows, ESC, etc.) */
function isLiteralKey(key: string): boolean {
	return /^[a-z0-9]$/i.test(key.replace(/^(mod|shift|alt)\+/, ""));
}

function groupByScope(
	entries: CatalogEntry[],
): Map<ShortcutScope, MergedShortcut[]> {
	const groups = new Map<ShortcutScope, MergedShortcut[]>();

	const seen = new Set<string>();
	const unique = entries.filter((e) => {
		const key = `${e.key}-${e.scope}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});

	for (const entry of unique) {
		const existing = groups.get(entry.scope) ?? [];
		const match = existing.find((m) => m.description === entry.description);
		if (match) {
			match.keys.push(entry.key);
			match.keys.sort((a, b) => {
				const aLiteral = isLiteralKey(a);
				const bLiteral = isLiteralKey(b);
				if (aLiteral !== bLiteral) return aLiteral ? -1 : 1;
				return 0;
			});
		} else {
			groups.set(entry.scope, [
				...existing,
				{ description: entry.description, keys: [entry.key] },
			]);
		}
	}

	return groups;
}

const SCOPE_ORDER: ShortcutScope[] = [
	"global",
	"liked-list",
	"liked-detail",
	"liked-detail-analysis",
	"playlists-list",
	"playlists-detail",
	"matching",
	"modal",
];

export function ShortcutsHelpModal() {
	const { isHelpOpen, closeHelp, activeScopes } = useShortcutContext();
	const theme = useTheme();

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

	const grouped = groupByScope(SHORTCUT_CATALOG);

	// Active scopes first, then remaining in fixed order
	const orderedScopes: ShortcutScope[] = [
		...activeScopes,
		...SCOPE_ORDER.filter((s) => !activeScopes.includes(s)),
	];

	return (
		<>
			<div
				className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm"
				onClick={closeHelp}
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
					style={{ background: theme.bg, borderColor: theme.border }}
				>
					<h2
						className="text-lg font-light"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						Keyboard Shortcuts
					</h2>
					<button
						onClick={closeHelp}
						className="p-1 transition-opacity hover:opacity-70 cursor-pointer"
						style={{ color: theme.textMuted }}
					>
						<span className="text-xl leading-none">×</span>
					</button>
				</div>

				<div className="space-y-6 px-6 py-4">
					{orderedScopes.map((scope) => {
						const scopeShortcuts = grouped.get(scope);
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
											key={`${shortcut.description}-${i}`}
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
											<div className="flex items-center gap-1.5">
												{shortcut.keys.map((key, ki) => (
													<>
														{ki > 0 && (
															<span
																key={`sep-${ki}`}
																className="text-xs"
																style={{
																	fontFamily: fonts.body,
																	color: theme.textMuted,
																}}
															>
																or
															</span>
														)}
														<kbd
															key={ki}
															className="rounded px-2 py-1 text-xs"
															style={{
																fontFamily: fonts.body,
																background: theme.surface,
																color: theme.text,
																border: `1px solid ${theme.border}`,
															}}
														>
															{formatKey(key)}
														</kbd>
													</>
												))}
											</div>
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
