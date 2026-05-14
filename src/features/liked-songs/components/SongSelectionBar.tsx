import { LockSimple, X } from "@phosphor-icons/react";
import type { Ref } from "react";

import { Button } from "@/components/ui/Button";
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
				<Button
					variant="ghost"
					size="sm"
					onClick={onCancel}
					className="flex items-center gap-1"
					style={{ fontFamily: fonts.body }}
				>
					<X size={14} />
					Cancel
				</Button>
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

			<Button
				onClick={onConfirm}
				disabled={selectedCount === 0 || !canAfford}
				className="flex items-center gap-2 rounded-full"
				style={{ fontFamily: fonts.body }}
			>
				<LockSimple size={13} weight="regular" />
				Unlock {selectedCount > 0 ? selectedCount : ""}{" "}
				{selectedCount === 1 ? "song" : "songs"}
			</Button>
		</div>
	);
}
