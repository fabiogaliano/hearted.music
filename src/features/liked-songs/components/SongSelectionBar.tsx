import { LockSimpleIcon, XIcon } from "@phosphor-icons/react";
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
	const projectedRemaining = Math.max(0, remainingBalance - selectedCount);

	return (
		<div
			ref={containerRef}
			className="theme-bg theme-border-color sticky top-0 z-50 -mt-6 flex items-center justify-between border-b py-4"
		>
			<Button
				variant="ghost"
				size="sm"
				onClick={onCancel}
				className="flex items-center gap-1"
				style={{ fontFamily: fonts.body }}
			>
				<XIcon size={14} />
				Cancel
			</Button>

			<div className="flex items-center gap-3">
				<span
					className="theme-text-muted text-xs tabular-nums"
					style={{ fontFamily: fonts.body }}
				>
					{projectedRemaining} left after this
				</span>
				<Button
					onClick={onConfirm}
					disabled={selectedCount === 0 || !canAfford}
					className="flex items-center gap-2 rounded-full"
					style={{ fontFamily: fonts.body }}
				>
					<LockSimpleIcon size={13} weight="regular" />
					Unlock {selectedCount > 0 ? selectedCount : ""}{" "}
					{selectedCount === 1 ? "song" : "songs"}
				</Button>
			</div>
		</div>
	);
}
