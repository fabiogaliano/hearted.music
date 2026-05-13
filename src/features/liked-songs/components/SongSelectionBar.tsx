import { Lock, X } from "lucide-react";
import type { Ref } from "react";

import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

interface SongSelectionBarProps {
	selectedCount: number;
	remainingBalance: number;
	onConfirm: () => void;
	onCancel: () => void;
	containerRef?: Ref<HTMLDivElement>;
}

export function SongSelectionBar({
	selectedCount,
	remainingBalance,
	onConfirm,
	onCancel,
	containerRef,
}: SongSelectionBarProps) {
	const theme = useTheme();
	const canAfford = selectedCount <= remainingBalance;

	return (
		<div
			ref={containerRef}
			className="sticky top-0 z-50 -mx-3 flex items-center justify-between px-9 py-4"
			style={{
				background: theme.bg,
				borderTop: `1px solid ${theme.border}`,
			}}
		>
			<div className="flex items-center gap-4">
				<button
					type="button"
					onClick={onCancel}
					className="flex cursor-pointer items-center gap-1 border-0 bg-transparent px-3 py-1.5 text-xs transition-[transform,opacity] duration-150 hover:opacity-70 active:scale-[0.98]"
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
				className="flex cursor-pointer items-center gap-2 rounded-full border-0 px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
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
