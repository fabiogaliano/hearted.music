import { useEffect, useState } from "react";
import { Puzzle } from "lucide-react";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { isExtensionInstalled } from "@/lib/extension/detect";

type Status = "checking" | "connected" | "not-found";

export function ExtensionStatusRow() {
	const theme = useTheme();
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
			<div className="flex items-center gap-4">
				<div
					className="flex h-10 w-10 items-center justify-center rounded-full"
					style={{ background: theme.surfaceDim }}
				>
					<Puzzle size={20} strokeWidth={1.5} style={{ color: theme.text }} />
				</div>
				<div>
					<p
						className="text-[20px] font-light"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						Chrome extension
					</p>
					<p
						className="mt-1 text-sm"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{status === "checking" && "Looking for the extension…"}
						{status === "connected" && "Syncs your Spotify library"}
						{status === "not-found" && "Install to sync your library"}
					</p>
				</div>
			</div>
			<span
				className="flex items-center gap-2 text-xs tracking-widest uppercase transition-all duration-200"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				<span
					className="h-2 w-2 rounded-full transition-all duration-200"
					style={{
						background: status === "connected" ? "#1DB954" : theme.border,
					}}
				/>
				{status === "checking" && "Checking"}
				{status === "connected" && "Connected"}
				{status === "not-found" && "Not detected"}
			</span>
		</div>
	);
}
