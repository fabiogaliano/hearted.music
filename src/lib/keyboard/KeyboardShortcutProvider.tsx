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
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";

import type {
	Shortcut,
	ShortcutActionsValue,
	ShortcutHelpStateValue,
	ShortcutRegistration,
	ShortcutRegistryStateValue,
	ShortcutScope,
} from "@/lib/keyboard/types";
import { ShortcutsHelpModal } from "./ShortcutsHelpModal";

const ShortcutActionsContext = createContext<ShortcutActionsValue | undefined>(
	undefined,
);

const ShortcutRegistryStateContext = createContext<
	ShortcutRegistryStateValue | undefined
>(undefined);

const ShortcutHelpStateContext = createContext<
	ShortcutHelpStateValue | undefined
>(undefined);

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

	const alias = KEY_ALIASES[key];
	if (alias) {
		return typeof alias === "function" ? alias(event) : eventKey === alias;
	}

	return eventKey === key;
}

/** Scope priority - higher number = higher priority */
const SCOPE_PRIORITY: Record<ShortcutScope, number> = {
	global: 0,
	"liked-list": 1,
	"liked-detail": 2,
	"liked-detail-analysis": 2.5,
	"playlists-list": 1,
	"playlists-detail": 2,
	matching: 2,
	"onboarding-welcome": 3,
	"onboarding-colors": 3,
	"onboarding-extension": 3,
	"onboarding-playlists": 3,
	"onboarding-pick-demo-song": 3,
	"onboarding-plan-selection": 3,
	modal: 10,
};

interface KeyboardShortcutProviderProps {
	children: ReactNode;
}

export function KeyboardShortcutProvider({
	children,
}: KeyboardShortcutProviderProps) {
	const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
	const shortcutsRef = useRef<Shortcut[]>([]);
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
				const next = [...prev, shortcut];
				shortcutsRef.current = next;
				return next;
			});

			return id;
		},
		[generateId],
	);

	const unregister = useCallback((id: string) => {
		setShortcuts((prev) => {
			const next = prev.filter((s) => s.id !== id);
			shortcutsRef.current = next;
			return next;
		});
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

			const enabledShortcuts = shortcutsRef.current.filter(
				(s) => s.enabled !== false,
			);
			const matchingShortcuts = enabledShortcuts.filter((s) =>
				eventMatchesShortcut(event, s.key),
			);

			if (matchingShortcuts.length === 0) return;

			const sorted = matchingShortcuts.toSorted((a, b) => {
				const priorityA = SCOPE_PRIORITY[a.scope] ?? 0;
				const priorityB = SCOPE_PRIORITY[b.scope] ?? 0;
				return priorityB - priorityA;
			});

			const shortcut = sorted[0];
			if (shortcut.preventDefault) {
				event.preventDefault();
			}
			shortcut.handler();
		};

		window.addEventListener("keydown", handleKeyDown);
		return () => window.removeEventListener("keydown", handleKeyDown);
	}, []);

	const actionsValue = useMemo<ShortcutActionsValue>(
		() => ({ register, unregister }),
		[register, unregister],
	);

	const registryStateValue = useMemo<ShortcutRegistryStateValue>(
		() => ({ activeScopes, shortcuts }),
		[activeScopes, shortcuts],
	);

	const helpStateValue = useMemo<ShortcutHelpStateValue>(
		() => ({ isHelpOpen, openHelp, closeHelp }),
		[isHelpOpen, openHelp, closeHelp],
	);

	return (
		<ShortcutActionsContext.Provider value={actionsValue}>
			<ShortcutRegistryStateContext.Provider value={registryStateValue}>
				<ShortcutHelpStateContext.Provider value={helpStateValue}>
					{children}
					<ShortcutsHelpModal />
				</ShortcutHelpStateContext.Provider>
			</ShortcutRegistryStateContext.Provider>
		</ShortcutActionsContext.Provider>
	);
}

export function useShortcutActions(): ShortcutActionsValue {
	const context = useContext(ShortcutActionsContext);
	if (!context) {
		throw new Error(
			"useShortcutActions must be used within a KeyboardShortcutProvider",
		);
	}
	return context;
}

export function useShortcutRegistryState(): ShortcutRegistryStateValue {
	const context = useContext(ShortcutRegistryStateContext);
	if (!context) {
		throw new Error(
			"useShortcutRegistryState must be used within a KeyboardShortcutProvider",
		);
	}
	return context;
}

export function useShortcutHelpState(): ShortcutHelpStateValue {
	const context = useContext(ShortcutHelpStateContext);
	if (!context) {
		throw new Error(
			"useShortcutHelpState must be used within a KeyboardShortcutProvider",
		);
	}
	return context;
}
