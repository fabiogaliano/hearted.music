/**
 * ExtensionUnavailablePrompt — shown at the create touchpoint when the
 * browser extension isn't installed. Matches the install-extension
 * affordance pattern already in the CreatePlaylistScreen header so the
 * two occurrences feel consistent.
 *
 * Installing in another tab and returning won't always fire this tab's focus/
 * visibility events, and on Firefox the extension's content script only loads
 * on a fresh page, so a "Check again" button lets the user re-run the gate by
 * hand — and, on Firefox only, nudges a reload if the re-check still fails.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
	getBrowserTarget,
	getExtensionStoreUrl,
} from "@/lib/extension/browser-target";
import { fonts } from "@/lib/theme/fonts";

interface ExtensionUnavailablePromptProps {
	/** Re-runs the gate detection; resolves once the check settles. */
	onRecheck: () => Promise<void>;
}

export function ExtensionUnavailablePrompt({
	onRecheck,
}: ExtensionUnavailablePromptProps) {
	const [isChecking, setIsChecking] = useState(false);
	const [checkedOnce, setCheckedOnce] = useState(false);
	const mountedRef = useRef(true);
	useEffect(() => {
		// Reset on effect re-run so StrictMode's mount→cleanup→mount cycle
		// doesn't leave the ref permanently false.
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

	// Chrome answers PINGs over externally_connectable with no content script, so
	// a fresh install responds in already-open tabs. Firefox detection rides on a
	// content script injected at page load, so an install can't be seen until the
	// tab reloads — only there is the reload nudge meaningful.
	const needsReloadHint = getBrowserTarget() === "firefox";

	const handleRecheck = useCallback(async () => {
		setIsChecking(true);
		try {
			await onRecheck();
		} finally {
			if (mountedRef.current) {
				setIsChecking(false);
				setCheckedOnce(true);
			}
		}
	}, [onRecheck]);

	return (
		<div
			className="flex flex-col gap-2 px-6 py-5"
			role="status"
			aria-live="polite"
		>
			<div className="flex items-center gap-4">
				<p
					className="theme-text-muted text-xs"
					style={{ fontFamily: fonts.body }}
				>
					Install the browser extension to create playlists from hearted.
				</p>
				<a
					href={getExtensionStoreUrl(getBrowserTarget())}
					target="_blank"
					rel="noopener noreferrer"
					className="hover-border-brighten inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs tracking-widest uppercase active:scale-[0.98]"
					style={{ fontFamily: fonts.body }}
				>
					Install extension
					<span className="text-xs" style={{ opacity: 0.45 }}>
						↗
					</span>
				</a>
				<button
					type="button"
					onClick={handleRecheck}
					disabled={isChecking}
					aria-busy={isChecking}
					className="theme-text-muted inline-flex cursor-pointer items-center whitespace-nowrap text-[11px] tracking-widest uppercase transition-opacity duration-150 hover:opacity-70 disabled:cursor-default disabled:opacity-40"
					style={{ fontFamily: fonts.body }}
				>
					{isChecking ? "Checking…" : "Check again"}
				</button>
			</div>
			{checkedOnce && !isChecking && needsReloadHint && (
				<p
					className="theme-text-muted text-[11px]"
					style={{ fontFamily: fonts.body }}
				>
					Already installed it? Reload this page so the extension can connect.
				</p>
			)}
		</div>
	);
}
