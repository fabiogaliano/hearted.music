import { useEffect, useState } from "react";
import { isExtensionInstalled } from "@/lib/extension/detect";
import { fonts } from "@/lib/theme/fonts";

type Status = "checking" | "connected" | "not-found";

const PRIMARY_COPY: Record<Status, string> = {
	checking: "Looking for the extension…",
	connected: "Chrome extension is connected",
	"not-found": "Chrome extension not detected",
};

const SECONDARY_COPY: Record<Status, string> = {
	checking: "Just a moment.",
	connected: "Syncs your Spotify library to Hearted.",
	"not-found": "Install it to sync your Spotify library.",
};

const STATUS_LABEL: Record<Status, string> = {
	checking: "Checking",
	connected: "Connected",
	"not-found": "Not detected",
};

/**
 * Renders only the *contents* of the Connections row. The enclosing editorial
 * heading + microcopy live in SettingsPage's SettingsSection.
 */
export function ExtensionStatusRow() {
	const [status, setStatus] = useState<Status>("checking");

	useEffect(() => {
		let cancelled = false;

		isExtensionInstalled().then((installed) => {
			if (!cancelled) setStatus(installed ? "connected" : "not-found");
		});

		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
			<div className="min-w-0">
				<p className="theme-text text-base" style={{ fontFamily: fonts.body }}>
					{PRIMARY_COPY[status]}
				</p>
				<p
					className="theme-text-muted mt-1.5 text-sm"
					style={{ fontFamily: fonts.body }}
				>
					{SECONDARY_COPY[status]}
				</p>
			</div>
			<span
				aria-live="polite"
				className="theme-text-muted flex shrink-0 items-center gap-2 pt-0.5 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				<span
					aria-hidden="true"
					className={`size-2 rounded-full transition-colors duration-200 ${
						status === "checking" ? "animate-pulse" : ""
					}`}
					style={{
						background: status === "connected" ? "#1DB954" : "var(--t-border)",
					}}
				/>
				{STATUS_LABEL[status]}
			</span>
		</div>
	);
}
