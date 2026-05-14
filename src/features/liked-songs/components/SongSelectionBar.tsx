import { LockSimple, X } from "@phosphor-icons/react";
import type { Ref } from "react";

import { fonts } from "@/lib/theme/fonts";

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
	const canAfford = selectedCount <= remainingBalance;

	return (
		<div
			ref={containerRef}
			className="theme-bg theme-border-color sticky top-0 z-50 -mx-3 flex items-center justify-between border-t px-9 py-4"
		>
			<div className="flex items-center gap-4">
				<button
					type="button"
					onClick={onCancel}
					className="theme-text-muted flex cursor-pointer items-center gap-1 border-0 bg-transparent px-3 py-1.5 text-xs transition-[transform,opacity] duration-150 hover:opacity-70 active:scale-[0.98]"
					style={{ fontFamily: fonts.body }}
				>
					<X size={14} />
					Cancel
				</button>
				<span
					className="theme-text text-sm tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{selectedCount} {selectedCount === 1 ? "song" : "songs"} selected
				</span>
				<span
					className="theme-text-muted text-xs tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					· {remainingBalance} songs to explore remaining
				</span>
			</div>

			<button
				type="button"
				onClick={onConfirm}
				disabled={selectedCount === 0 || !canAfford}
				className="theme-primary-action flex cursor-pointer items-center gap-2 rounded-full px-5 py-2 text-sm transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
				style={{ fontFamily: fonts.body }}
			>
				<LockSimple size={13} weight="regular" />
				Unlock {selectedCount > 0 ? selectedCount : ""}{" "}
				{selectedCount === 1 ? "song" : "songs"}
			</button>
		</div>
	);
}
