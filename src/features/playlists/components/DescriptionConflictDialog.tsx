import { createPortal } from "react-dom";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";

interface DescriptionConflictDialogProps {
	theme: ThemeConfig;
	latestDescription: string | null;
	draftDescription: string | null;
	onKeepMine: () => void;
	onUseSpotifys: () => void;
}

function previewText(description: string | null): string {
	if (description === null || description.length === 0) return "No description";
	return description;
}

export function DescriptionConflictDialog({
	theme,
	latestDescription,
	draftDescription,
	onKeepMine,
	onUseSpotifys,
}: DescriptionConflictDialogProps) {
	useShortcut({
		key: "escape",
		handler: onUseSpotifys,
		description: "Dismiss conflict dialog",
		scope: "modal",
		category: "actions",
		enabled: true,
	});

	useShortcut({
		key: "enter",
		handler: onKeepMine,
		description: "Keep your description",
		scope: "modal",
		category: "actions",
		enabled: true,
	});

	return createPortal(
		<div
			className="dialog-backdrop fixed inset-0 z-[100] flex items-center justify-center p-4 backdrop-blur-sm"
			style={{ background: "rgba(0,0,0,0.45)" }}
			onClick={onUseSpotifys}
		>
			<div
				role="alertdialog"
				aria-labelledby="conflict-title"
				className="dialog-content w-full max-w-[360px] p-8"
				style={{
					background: theme.surface,
					border: `1px solid ${theme.border}`,
				}}
				onClick={(e) => e.stopPropagation()}
			>
				<h3
					id="conflict-title"
					className="mb-6 text-2xl italic font-light leading-snug tracking-tight"
					style={{
						fontFamily: fonts.display,
						color: theme.text,
					}}
				>
					This description <em>changed</em> on Spotify
				</h3>

				<p
					className="mb-2 text-xs uppercase tracking-widest"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					On Spotify now
				</p>
				<p
					className="mb-6 border-t pt-2 text-sm leading-relaxed"
					style={{
						fontFamily: fonts.body,
						color: theme.text,
						borderColor: theme.border,
					}}
				>
					{previewText(latestDescription)}
				</p>

				<p
					className="mb-2 text-xs uppercase tracking-widest"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Yours
				</p>
				<p
					className="mb-8 border-t pt-2 text-sm leading-relaxed"
					style={{
						fontFamily: fonts.body,
						color: theme.text,
						borderColor: theme.border,
					}}
				>
					{previewText(draftDescription)}
				</p>

				<div className="flex items-center justify-end gap-3">
					<button
						type="button"
						onClick={onUseSpotifys}
						className="cursor-pointer border px-4 py-1.5 text-xs font-normal uppercase tracking-widest transition-[transform,filter] duration-150 hover:brightness-95 active:scale-[0.98]"
						style={{
							fontFamily: fonts.body,
							background: "transparent",
							borderColor: theme.border,
							color: theme.text,
						}}
					>
						Use Spotify's
					</button>
					<button
						type="button"
						onClick={onKeepMine}
						className="cursor-pointer border border-transparent px-6 py-2 text-sm font-medium uppercase tracking-widest transition-[transform,filter] duration-150 hover:brightness-95 active:scale-[0.98]"
						style={{
							fontFamily: fonts.body,
							background: theme.primary,
							color: theme.bg,
						}}
					>
						Keep mine
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
