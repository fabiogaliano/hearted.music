/**
 * useShortcut - Hook for registering individual keyboard shortcuts
 *
 * Usage:
 * ```tsx
 * useShortcut({
 *   key: 'escape',
 *   handler: handleClose,
 *   description: 'Close detail view',
 *   scope: 'liked-detail',
 *   enabled: isExpanded,
 * })
 * ```
 */
import { useEffect, useMemo, useRef } from "react";

import { useShortcutContext } from "@/lib/keyboard/KeyboardShortcutProvider";
import type { ShortcutRegistration } from "@/lib/keyboard/types";

export function useShortcut(options: ShortcutRegistration): void {
	const { register, unregister } = useShortcutContext();
	const idRef = useRef<string | null>(null);

	// Ref prevents re-registration when only handler changes
	const handlerRef = useRef(options.handler);
	handlerRef.current = options.handler;

	// Destructure options for stable dependencies
	const { key, scope, enabled, description, category, preventDefault } =
		options;

	useEffect(() => {
		if (enabled === false) {
			if (idRef.current) {
				unregister(idRef.current);
				idRef.current = null;
			}
			return;
		}

		// Stable wrapper avoids re-registration on handler change
		const id = register({
			key,
			scope,
			enabled,
			description,
			category,
			preventDefault,
			handler: () => handlerRef.current(),
		});
		idRef.current = id;

		return () => {
			if (idRef.current) {
				unregister(idRef.current);
				idRef.current = null;
			}
		};
	}, [
		register,
		unregister,
		key,
		scope,
		enabled,
		description,
		category,
		preventDefault,
	]);
}

/**
 * Creates a stable fingerprint for a shortcut's configuration (excluding handler).
 * Used for diffing to avoid unnecessary re-registrations.
 */
function getShortcutFingerprint(s: ShortcutRegistration): string {
	return `${s.key}|${s.scope}|${s.enabled ?? true}|${s.category ?? ""}|${s.preventDefault ?? true}`;
}

/**
 * useShortcuts - Batch registration with stable key comparison.
 *
 * Only re-registers shortcuts when their configuration actually changes,
 * not when the array reference changes. Handlers are stored in a ref
 * to avoid re-registration when only closures update.
 */
export function useShortcuts(shortcuts: ShortcutRegistration[]): void {
	const { register, unregister } = useShortcutContext();
	const registeredRef = useRef<Map<string, string>>(new Map()); // fingerprint → id
	const handlersRef = useRef<Map<string, () => void>>(new Map());

	// Always update handlers ref (cheap, no re-render)
	for (const s of shortcuts) {
		handlersRef.current.set(s.key + s.scope, s.handler);
	}

	// Compute current fingerprints for comparison
	const currentFingerprints = useMemo(
		() => new Set(shortcuts.map(getShortcutFingerprint)),
		[shortcuts],
	);

	useEffect(() => {
		const registered = registeredRef.current;
		const toUnregister: string[] = [];
		const toRegister: ShortcutRegistration[] = [];

		// Find shortcuts to remove (registered but no longer in current set)
		for (const [fingerprint, id] of registered) {
			if (!currentFingerprints.has(fingerprint)) {
				toUnregister.push(id);
				registered.delete(fingerprint);
			}
		}

		// Find shortcuts to add (in current set but not registered)
		for (const shortcut of shortcuts) {
			const fingerprint = getShortcutFingerprint(shortcut);
			if (!registered.has(fingerprint) && shortcut.enabled !== false) {
				toRegister.push(shortcut);
			}
		}

		// Apply changes
		for (const id of toUnregister) {
			unregister(id);
		}

		for (const shortcut of toRegister) {
			const fingerprint = getShortcutFingerprint(shortcut);
			const id = register({
				key: shortcut.key,
				scope: shortcut.scope,
				enabled: shortcut.enabled,
				description: shortcut.description,
				category: shortcut.category,
				preventDefault: shortcut.preventDefault,
				handler: () => {
					const handler = handlersRef.current.get(
						shortcut.key + shortcut.scope,
					);
					handler?.();
				},
			});
			registered.set(fingerprint, id);
		}

		return () => {
			// Cleanup all on unmount
			for (const id of registered.values()) {
				unregister(id);
			}
			registered.clear();
		};
	}, [register, unregister, currentFingerprints]);
}
