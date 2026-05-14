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
import { useEffect, useRef } from "react";

import { useShortcutActions } from "@/lib/keyboard/KeyboardShortcutProvider";
import type { ShortcutRegistration } from "@/lib/keyboard/types";

export function useShortcut(options: ShortcutRegistration): void {
	const { register, unregister } = useShortcutActions();
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
