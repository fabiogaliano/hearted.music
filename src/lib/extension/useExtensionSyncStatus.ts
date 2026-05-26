/**
 * Shared GET_STATUS polling against the extension.
 *
 * One source of truth for both onboarding and the dashboard. Onboarding uses
 * it as a live sync-progress feed and can auto-trigger/retry while waiting.
 * The dashboard keeps a low-frequency poll running while the extension is
 * installed so it can observe pairing state (`hasToken`), current sync status,
 * errors, and `lastSyncAt`, then callers can raise the cadence while a sync is
 * actively running. The extension's reported sync state — not the server's
 * phase_job_ids — is the live truth; phase_job_ids is only a persistence
 * fallback.
 */

import { useEffect, useRef, useState } from "react";
import {
	type ExtensionSyncState,
	getExtensionStatus,
	triggerExtensionSync,
} from "@/lib/extension/detect";

const DEFAULT_POLL_MS = 1_000;
const DEFAULT_RETRIGGER_MS = 2_000;

interface UseExtensionSyncStatusOptions {
	/** When false, polling stops and the hook idles. Defaults to true. */
	enabled?: boolean;
	/** Status poll cadence. Defaults to 1s. */
	pollMs?: number;
	/**
	 * When true (onboarding), fires a sync on mount and re-fires while the
	 * extension reports idle/no-state — bridging "ready" to "syncing". The
	 * dashboard leaves this off and triggers explicitly on CTA click.
	 */
	autoTrigger?: boolean;
	/** Re-trigger cadence while idle, only used when autoTrigger is true. */
	retriggerMs?: number;
}

export interface ExtensionSyncStatus {
	sync: ExtensionSyncState | null;
	hasToken: boolean;
}

export function useExtensionSyncStatus(
	options: UseExtensionSyncStatusOptions = {},
): ExtensionSyncStatus {
	const {
		enabled = true,
		pollMs = DEFAULT_POLL_MS,
		autoTrigger = false,
		retriggerMs = DEFAULT_RETRIGGER_MS,
	} = options;

	const [sync, setSync] = useState<ExtensionSyncState | null>(null);
	const [hasToken, setHasToken] = useState(false);
	// Read inside the retrigger interval without re-subscribing the effect on
	// every poll — keeps a single stable interval like the original onboarding
	// implementation.
	const latestStateRef = useRef<ExtensionSyncState | null>(null);

	useEffect(() => {
		if (!enabled) {
			return;
		}

		let isCancelled = false;

		const pollStatus = async () => {
			const response = await getExtensionStatus();
			if (isCancelled) {
				return;
			}
			const nextState = response?.sync ?? null;
			latestStateRef.current = nextState;
			setSync(nextState);
			setHasToken(response?.hasToken ?? false);
		};

		const triggerIfIdle = () => {
			const status = latestStateRef.current?.status;
			if (status == null || status === "idle") {
				triggerExtensionSync();
			}
		};

		if (autoTrigger) {
			triggerExtensionSync();
		}
		void pollStatus();

		const pollInterval = setInterval(() => {
			void pollStatus();
		}, pollMs);
		const triggerInterval = autoTrigger
			? setInterval(triggerIfIdle, retriggerMs)
			: null;

		return () => {
			isCancelled = true;
			clearInterval(pollInterval);
			if (triggerInterval) {
				clearInterval(triggerInterval);
			}
		};
	}, [enabled, pollMs, autoTrigger, retriggerMs]);

	return { sync, hasToken };
}
