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
		// Wears the panel's own material, not theme-bg: it sticks INSIDE the library
		// plane now, so rows scrolling under it have to disappear into the same
		// fill they were resting on.
		//
		// The seam is an inset shadow rather than .plane-rule + border-b, because
		// .surface-raised reserves all four edges with a `border` shorthand — a
		// border-color utility on top would ring the whole bar instead of ruling
		// its underside. Same 9% ink mix .plane-rule carries.
		<div
			ref={containerRef}
			className="surface-raised sticky top-0 z-50 flex items-center justify-between px-4 py-3.5"
			style={{
				boxShadow:
					"inset 0 -1px 0 0 color-mix(in srgb, var(--t-text) 9%, transparent)",
			}}
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
					className="squircle flex items-center gap-2 rounded-full"
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
