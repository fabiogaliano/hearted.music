/**
 * ShortcutsHelpModal - Shows available keyboard shortcuts
 *
 * Triggered by pressing ?
 * Groups shortcuts by scope, active scopes shown first with badge.
 */
import { Fragment, useEffect } from "react";
import { Button } from "@/components/ui/Button";
import { fonts } from "@/lib/theme/fonts";

import { type CatalogEntry, SHORTCUT_CATALOG } from "./catalog";
import {
	useShortcutHelpState,
	useShortcutRegistryState,
} from "./KeyboardShortcutProvider";
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
	const { isHelpOpen, closeHelp } = useShortcutHelpState();
	const { activeScopes } = useShortcutRegistryState();

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

	const orderedScopes: ShortcutScope[] = [
		...activeScopes,
		...SCOPE_ORDER.filter((s) => !activeScopes.includes(s)),
	];

	return (
		<>
			<button
				type="button"
				aria-label="Close keyboard shortcuts"
				className="dialog-backdrop fixed inset-0 z-[100] cursor-default appearance-none border-0 bg-black/50 p-0 backdrop-blur-sm"
				onClick={closeHelp}
			/>
			<div
				className="theme-bg theme-border-color dialog-content fixed top-1/2 left-1/2 z-[101] max-h-[80vh] w-full max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto border"
				style={{ boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)" }}
			>
				<div className="theme-bg theme-border-color sticky top-0 flex items-center justify-between border-b px-6 py-4">
					<h2
						className="theme-text text-lg font-light"
						style={{ fontFamily: fonts.display }}
					>
						Keyboard Shortcuts
					</h2>
					<Button variant="icon" onClick={closeHelp}>
						<span className="text-xl leading-none">×</span>
					</Button>
				</div>

				<div className="space-y-6 px-6 py-4">
					{orderedScopes.map((scope) => {
						const scopeShortcuts = grouped.get(scope);
						if (!scopeShortcuts || scopeShortcuts.length === 0) return null;

						const isActive = activeScopes.includes(scope);

						return (
							<div key={scope}>
								<h3
									className={`${isActive ? "theme-text" : "theme-text-muted"} mb-3 flex items-center gap-2 text-xs tracking-widest uppercase`}
									style={{ fontFamily: fonts.body }}
								>
									{SCOPE_LABELS[scope]}
									{isActive && (
										<span className="theme-primary-action rounded px-1.5 py-0.5 text-xs">
											Active
										</span>
									)}
								</h3>

								<div className="space-y-2">
									{scopeShortcuts.map((shortcut) => (
										<div
											key={shortcut.description}
											className="flex items-center justify-between py-1.5"
										>
											<span
												className={`${isActive ? "theme-text" : "theme-text-muted"} text-sm`}
												style={{ fontFamily: fonts.body }}
											>
												{shortcut.description}
											</span>
											<div className="flex items-center gap-1.5">
												{shortcut.keys.map((key, keyIndex) => (
													<Fragment key={key}>
														{keyIndex > 0 && (
															<span
																className="theme-text-muted text-xs"
																style={{ fontFamily: fonts.body }}
															>
																or
															</span>
														)}
														<kbd
															className="theme-kbd rounded px-2 py-1 text-xs"
															style={{ fontFamily: fonts.body }}
														>
															{formatKey(key)}
														</kbd>
													</Fragment>
												))}
											</div>
										</div>
									))}
								</div>
							</div>
						);
					})}

					<div className="theme-border-color border-t pt-4">
						<div className="flex items-center justify-between py-1.5">
							<span
								className="theme-text-muted text-sm"
								style={{ fontFamily: fonts.body }}
							>
								Show this help
							</span>
							<kbd
								className="theme-kbd rounded px-2 py-1 text-xs"
								style={{ fontFamily: fonts.body }}
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
