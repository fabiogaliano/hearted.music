import { useCallback, useEffect, useRef, useState } from "react";
import {
	getBrowserTarget,
	getExtensionStoreUrl,
} from "@/lib/extension/browser-target";
import { fonts } from "@/lib/theme/fonts";

interface ExtensionUnavailablePromptProps {
	onRecheck: () => Promise<void>;
}

export function ExtensionUnavailablePrompt({
	onRecheck,
}: ExtensionUnavailablePromptProps) {
	const [isChecking, setIsChecking] = useState(false);
	const [checkedOnce, setCheckedOnce] = useState(false);
	const mountedRef = useRef(true);
	useEffect(() => {
		mountedRef.current = true;
		return () => {
			mountedRef.current = false;
		};
	}, []);

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
			className="flex flex-col gap-2 px-5 py-4"
			role="status"
			aria-live="polite"
			style={{ borderLeft: "2px solid var(--t-primary)" }}
		>
			<div className="flex items-center gap-4">
				<p className="theme-text text-xs" style={{ fontFamily: fonts.body }}>
					<strong className="font-medium">Extension not detected.</strong>{" "}
					<span className="theme-text-muted">
						hearted saves playlists through the browser extension.
					</span>
				</p>
				<div className="flex flex-none items-center gap-2">
					<a
						href={getExtensionStoreUrl(getBrowserTarget())}
						target="_blank"
						rel="noopener noreferrer"
						className="hover-border-brighten inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs tracking-widest uppercase active:scale-[0.98]"
						style={{ fontFamily: fonts.body }}
					>
						Install
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
			</div>
			{checkedOnce && !isChecking && needsReloadHint && (
				<p
					className="theme-text-muted text-[11px]"
					style={{ fontFamily: fonts.body }}
				>
					Already installed? Reload this page so the extension can connect.
				</p>
			)}
		</div>
	);
}
