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

	// Refs prevent re-registration when only callbacks change
	const handlerRef = useRef(options.handler);
	handlerRef.current = options.handler;
	const shouldHandleRef = useRef(options.shouldHandle);
	shouldHandleRef.current = options.shouldHandle;

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
			shouldHandle: (event) => shouldHandleRef.current?.(event) ?? true,
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
