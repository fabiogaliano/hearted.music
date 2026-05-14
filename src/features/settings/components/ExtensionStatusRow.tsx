import { useEffect, useState } from "react";
import { isExtensionInstalled } from "@/lib/extension/detect";
import { fonts } from "@/lib/theme/fonts";

type Status = "checking" | "connected" | "not-found";

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
		<div className="flex items-center justify-between py-3">
			<div>
				<div>
					<p
						className="theme-text text-xl font-light"
						style={{ fontFamily: fonts.display }}
					>
						Chrome extension
					</p>
					<p
						className="theme-text-muted mt-1 text-sm"
						style={{ fontFamily: fonts.body }}
					>
						{status === "checking" && "Looking for the extension…"}
						{status === "connected" && "Syncs your Spotify library"}
						{status === "not-found" && "Install to sync your library"}
					</p>
				</div>
			</div>
			<span
				className="theme-text-muted flex items-center gap-2 text-xs tracking-widest uppercase transition-colors duration-150"
				style={{ fontFamily: fonts.body }}
			>
				<span
					className="h-2 w-2 rounded-full transition-colors duration-150"
					style={{
						background: status === "connected" ? "#1DB954" : "var(--t-border)",
					}}
				/>
				{status === "checking" && "Checking"}
				{status === "connected" && "Connected"}
				{status === "not-found" && "Not detected"}
			</span>
		</div>
	);
}
