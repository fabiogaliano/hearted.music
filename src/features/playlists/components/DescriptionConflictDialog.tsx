import { createPortal } from "react-dom";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";

interface DescriptionConflictDialogProps {
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
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Use Spotify description"
				className="dialog-backdrop absolute inset-0 cursor-default appearance-none border-0 bg-black/45 p-0 backdrop-blur-sm"
				onClick={onUseSpotifys}
			/>
			<div
				role="alertdialog"
				aria-labelledby="conflict-title"
				className="theme-surface-bg theme-border-color dialog-content relative w-full max-w-[360px] border p-8"
			>
				<h3
					id="conflict-title"
					className="theme-text mb-6 text-2xl font-light leading-snug tracking-tight italic"
					style={{ fontFamily: fonts.display }}
				>
					This description <em>changed</em> on Spotify
				</h3>

				<p
					className="theme-text-muted mb-2 text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					On Spotify now
				</p>
				<p
					className="theme-border-color theme-text mb-6 border-t pt-2 text-sm leading-relaxed"
					style={{ fontFamily: fonts.body }}
				>
					{previewText(latestDescription)}
				</p>

				<p
					className="theme-text-muted mb-2 text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Yours
				</p>
				<p
					className="theme-border-color theme-text mb-8 border-t pt-2 text-sm leading-relaxed"
					style={{ fontFamily: fonts.body }}
				>
					{previewText(draftDescription)}
				</p>

				<div className="flex items-center justify-end gap-3">
					<button
						type="button"
						onClick={onUseSpotifys}
						className="theme-border-color theme-text cursor-pointer border px-4 py-1.5 text-xs font-normal tracking-widest uppercase transition-[transform,background-color] duration-150 hover:bg-white/15 active:scale-[0.98]"
						style={{ fontFamily: fonts.body }}
					>
						Use Spotify's
					</button>
					<button
						type="button"
						onClick={onKeepMine}
						className="theme-primary-action cursor-pointer px-6 py-2 text-sm font-medium tracking-widest uppercase transition-[transform,opacity] duration-150 hover:opacity-90 active:scale-[0.98]"
						style={{ fontFamily: fonts.body }}
					>
						Keep mine
					</button>
				</div>
			</div>
		</div>,
		document.body,
	);
}
