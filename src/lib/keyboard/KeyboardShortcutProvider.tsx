/**
 * KeyboardShortcutProvider
 *
 * Central context for managing keyboard shortcuts across the application.
 * Features:
 * - Single keydown listener for all shortcuts
 * - Scope-based priority (modal > detail > list > global)
 * - Automatic conflict detection
 * - Help modal triggered by ?
 */
import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import type {
	Shortcut,
	ShortcutContextValue,
	ShortcutRegistration,
	ShortcutScope,
} from "@/lib/keyboard/types";

const ShortcutContext = createContext<ShortcutContextValue | undefined>(
	undefined,
);

// ─────────────────────────────────────────────────────────────────────────────
// Key Matching Utilities
// ─────────────────────────────────────────────────────────────────────────────

/** Normalizes key string for consistent comparison */
function normalizeKeyString(key: string): string {
	return key.toLowerCase().trim();
}

/** Maps human-friendly key names to actual event.key values */
const KEY_ALIASES: Record<
	string,
	string | ((event: KeyboardEvent) => boolean)
> = {
	escape: "escape",
	enter: "enter",
	space: (e) => e.key === " " || e.code === "Space",
	up: "arrowup",
	down: "arrowdown",
	left: "arrowleft",
	right: "arrowright",
};

/** Checks if a keyboard event matches a shortcut key definition */
function eventMatchesShortcut(
	event: KeyboardEvent,
	shortcutKey: string,
): boolean {
	const key = normalizeKeyString(shortcutKey);
	const eventKey = event.key.toLowerCase();

	// Handle modifier combinations (e.g., "mod+s", "shift+?")
	if (key.includes("+")) {
		const parts = key.split("+");
		const mainKey = parts[parts.length - 1];
		const modifiers = parts.slice(0, -1);

		if (eventKey !== mainKey && event.code.toLowerCase() !== `key${mainKey}`) {
			return false;
		}

		for (const mod of modifiers) {
			if (mod === "mod" || mod === "cmd" || mod === "ctrl") {
				if (!event.metaKey && !event.ctrlKey) return false;
			} else if (mod === "shift") {
				if (!event.shiftKey) return false;
			} else if (mod === "alt") {
				if (!event.altKey) return false;
			}
		}
		return true;
	}

	// Handle aliased keys (escape, enter, space, arrows)
	const alias = KEY_ALIASES[key];
	if (alias) {
		return typeof alias === "function" ? alias(event) : eventKey === alias;
	}

	return eventKey === key;
}

/**
 * Scope priority - higher number = higher priority
 */
const SCOPE_PRIORITY: Record<ShortcutScope, number> = {
	global: 0,
	"liked-list": 1,
	"liked-detail": 2,
	"playlists-list": 1,
	"playlists-detail": 2,
	matching: 2,
	"onboarding-welcome": 3,
	"onboarding-colors": 3,
	"onboarding-playlists": 3,
	"onboarding-ready": 3,
	modal: 10,
};

interface KeyboardShortcutProviderProps {
	children: ReactNode;
}

export function KeyboardShortcutProvider({
	children,
}: KeyboardShortcutProviderProps) {
	const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
	const [isHelpOpen, setIsHelpOpen] = useState(false);
	const idCounter = useRef(0);

	const activeScopes = useMemo<ShortcutScope[]>(
		() => [
			"global",
			...Array.from(
				new Set(
					shortcuts.filter((s) => s.enabled !== false).map((s) => s.scope),
				),
			).filter((scope) => scope !== "global"),
		],
		[shortcuts],
	);

	const generateId = useCallback(() => {
		idCounter.current += 1;
		return `shortcut-${idCounter.current}`;
	}, []);

	const register = useCallback(
		(registration: ShortcutRegistration): string => {
			const id = registration.id || generateId();
			const shortcut: Shortcut = {
				...registration,
				id,
				enabled: registration.enabled ?? true,
				preventDefault: registration.preventDefault ?? true,
			};

			setShortcuts((prev) => {
				const conflict = prev.find(
					(s) =>
						s.scope === shortcut.scope &&
						normalizeKeyString(s.key) === normalizeKeyString(shortcut.key) &&
						s.enabled,
				);
				if (conflict) {
					console.warn(
						`[Keyboard] Shortcut conflict: "${shortcut.key}" already registered in scope "${shortcut.scope}"`,
					);
				}
				return [...prev, shortcut];
			});

			return id;
		},
		[generateId],
	);

	const unregister = useCallback((id: string) => {
		setShortcuts((prev) => prev.filter((s) => s.id !== id));
	}, []);

	const openHelp = useCallback(() => setIsHelpOpen(true), []);
	const closeHelp = useCallback(() => setIsHelpOpen(false), []);

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			const target = event.target as HTMLElement;
			const isInputField =
				target.tagName === "INPUT" ||
				target.tagName === "TEXTAREA" ||
				target.isContentEditable;

			if (isInputField && event.key !== "Escape") {
				return;
			}

			if (event.key === "?" || (event.shiftKey && event.code === "Slash")) {
				event.preventDefault();
				setIsHelpOpen((prev) => !prev);
				return;
			}

			const enabledShortcuts = shortcuts.filter((s) => s.enabled !== false);
			const matchingShortcuts = enabledShortcuts.filter((s) =>
				eventMatchesShortcut(event, s.key),
			);

			if (matchingShortcuts.length === 0) return;

			matchingShortcuts.sort((a, b) => {
				const priorityA = SCOPE_PRIORITY[a.scope] ?? 0;
				const priorityB = SCOPE_PRIORITY[b.scope] ?? 0;
				return priorityB - priorityA;
			});

			const shortcut = matchingShortcuts[0];
			if (shortcut.preventDefault) {
				event.preventDefault();
			}
			shortcut.handler();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, [shortcuts]);

	const contextValue = useMemo<ShortcutContextValue>(
		() => ({
			register,
			unregister,
			activeScopes,
			shortcuts,
			isHelpOpen,
			openHelp,
			closeHelp,
		}),
		[
			register,
			unregister,
			activeScopes,
			shortcuts,
			isHelpOpen,
			openHelp,
			closeHelp,
		],
	);

	return (
		<ShortcutContext.Provider value={contextValue}>
			{children}
		</ShortcutContext.Provider>
	);
}

export function useShortcutContext(): ShortcutContextValue {
	const context = useContext(ShortcutContext);
	if (!context) {
		throw new Error(
			"useShortcutContext must be used within a KeyboardShortcutProvider",
		);
	}
	return context;
}
