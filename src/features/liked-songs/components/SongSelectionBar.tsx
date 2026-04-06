import { Lock, X } from "lucide-react";

import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

interface SongSelectionBarProps {
	selectedCount: number;
	remainingBalance: number;
	onConfirm: () => void;
	onCancel: () => void;
}

export function SongSelectionBar({
	selectedCount,
	remainingBalance,
	onConfirm,
	onCancel,
}: SongSelectionBarProps) {
	const theme = useTheme();
	const canAfford = selectedCount <= remainingBalance;

	return (
		<div
			className="fixed right-0 bottom-0 left-0 z-50 flex items-center justify-between px-6 py-4 backdrop-blur-md"
			style={{
				background: `${theme.surface}f0`,
				borderTop: `1px solid ${theme.border}`,
			}}
		>
			<div className="flex items-center gap-4">
				<button
					type="button"
					onClick={onCancel}
					className="flex cursor-pointer items-center gap-1 rounded-full border-0 bg-transparent px-3 py-1.5 text-xs transition-opacity hover:opacity-80"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					<X size={14} />
					Cancel
				</button>
				<span
					className="text-sm tabular-nums"
					style={{ fontFamily: fonts.body, color: theme.text }}
				>
					{selectedCount} {selectedCount === 1 ? "song" : "songs"} selected
				</span>
				<span
					className="text-xs tabular-nums"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					· {remainingBalance} songs to explore remaining
				</span>
			</div>

			<button
				type="button"
				onClick={onConfirm}
				disabled={selectedCount === 0 || !canAfford}
				className="flex cursor-pointer items-center gap-2 rounded-full border-0 px-5 py-2 text-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
				style={{
					fontFamily: fonts.body,
					background: theme.primary,
					color: theme.bg,
				}}
			>
				<Lock size={13} />
				Unlock {selectedCount > 0 ? selectedCount : ""}{" "}
				{selectedCount === 1 ? "song" : "songs"}
			</button>
		</div>
	);
}
