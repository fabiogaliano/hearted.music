/**
 * Keyboard shortcut provider for dashboard
 *
 * Manages keyboard shortcuts with scope-based priority.
 * Press ? to toggle help modal.
 */

import {
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useEffect,
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

function normalizeKey(key: string): string {
	return key.toLowerCase().trim();
}

function matchesKey(event: KeyboardEvent, shortcutKey: string): boolean {
	const key = normalizeKey(shortcutKey);
	const eventKey = event.key.toLowerCase();

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

	if (key === "escape") return eventKey === "escape";
	if (key === "enter") return eventKey === "enter";
	if (key === "space") return eventKey === " " || event.code === "Space";
	if (key === "up") return eventKey === "arrowup";
	if (key === "down") return eventKey === "arrowdown";
	if (key === "left") return eventKey === "arrowleft";
	if (key === "right") return eventKey === "arrowright";

	return eventKey === key;
}

const SCOPE_PRIORITY: Record<ShortcutScope, number> = {
	global: 0,
	"liked-list": 1,
	"liked-detail": 2,
	"playlists-list": 1,
	"playlists-detail": 2,
	matching: 2,
	modal: 10,
	"onboarding-welcome": 1,
	"onboarding-colors": 1,
	"onboarding-playlists": 1,
	"onboarding-ready": 1,
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

	const activeScopes: ShortcutScope[] = [
		"global",
		...Array.from(
			new Set(shortcuts.filter((s) => s.enabled !== false).map((s) => s.scope)),
		).filter((scope) => scope !== "global"),
	];

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

			setShortcuts((prev) => [...prev, shortcut]);
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
				matchesKey(event, s.key),
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

	const contextValue: ShortcutContextValue = {
		register,
		unregister,
		activeScopes,
		shortcuts,
		isHelpOpen,
		openHelp,
		closeHelp,
	};

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
