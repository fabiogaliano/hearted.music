import { useState } from "react";
import { createPortal } from "react-dom";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { Button } from "@/components/ui/Button";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";

interface DescriptionRoleDialogProps {
	onClose: () => void;
}

// Lowercase, conversational examples that span the shapes a real user might
// write: genre + mood, pure activity, activity + genre + occasion, emotional
// purpose, mood + occasion. Adding more here just deepens the rotation.
const EXAMPLES = [
	"my indie rock broken heart playlist",
	"songs i run to",
	"slow jazz for sunday cooking",
	"songs that make me cry on purpose",
	"synthwave for night drives",
];

function pickExample(): string {
	return EXAMPLES[Math.floor(Math.random() * EXAMPLES.length)];
}

export function DescriptionRoleDialog({ onClose }: DescriptionRoleDialogProps) {
	// useState's lazy initializer runs once per mount, so the example stays
	// stable while the dialog is open and rerandomizes the next time it opens.
	const [example] = useState(pickExample);

	useShortcut({
		key: "escape",
		handler: onClose,
		description: "Close description-role dialog",
		scope: "modal",
		category: "actions",
		enabled: true,
	});

	return createPortal(
		<div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
			<button
				type="button"
				aria-label="Close"
				className="dialog-backdrop absolute inset-0 cursor-default appearance-none border-0 bg-black/50 p-0 backdrop-blur-sm"
				onClick={onClose}
			/>
			<div
				role="dialog"
				aria-labelledby="description-role-title"
				className="theme-surface-bg theme-border-color dialog-content relative w-full max-w-[540px] border p-8"
			>
				<h3
					id="description-role-title"
					className="theme-text mb-6 text-2xl leading-snug font-light tracking-tight"
					style={{ fontFamily: fonts.display }}
				>
					How songs find their way <em style={{ fontStyle: "italic" }}>home</em>
				</h3>

				<p
					className="theme-text mb-6 text-sm leading-relaxed text-pretty"
					style={{ fontFamily: fonts.body }}
				>
					Write a description to set the{" "}
					<em style={{ fontFamily: fonts.display, fontStyle: "italic" }}>
						intent
					</em>{" "}
					of this playlist. Mix any of these: a moment, a feeling, a sound, a
					genre.
				</p>

				<DetailViewMirror example={example} />

				<ul
					className="theme-border-color theme-text-muted mt-8 mb-8 space-y-1.5 border-t pt-4 text-xs leading-relaxed"
					style={{ fontFamily: fonts.body }}
				>
					<li className="flex gap-3">
						<span className="theme-text-muted flex-shrink-0" aria-hidden="true">
							·
						</span>
						<span>The songs in this playlist</span>
					</li>
					<li className="flex gap-3">
						<span className="theme-text-muted flex-shrink-0" aria-hidden="true">
							·
						</span>
						<span>The description you wrote</span>
					</li>
					<li className="flex gap-3">
						<span className="theme-text-muted flex-shrink-0" aria-hidden="true">
							·
						</span>
						<span>Synced to your Spotify playlist</span>
					</li>
				</ul>

				<div className="flex items-center justify-end">
					<Button
						size="sm"
						onClick={onClose}
						style={{ fontFamily: fonts.body }}
					>
						Got it
					</Button>
				</div>
			</div>
		</div>,
		document.body,
	);
}

// Non-interactive replica of the playlist detail hero. The description block
// renders in its always-hovered state so the user's eye lands on the field
// the dialog is teaching about. Everything else (cover, title, chip, button)
// is here only as visual context — recognisable, but quieter.
function DetailViewMirror({ example }: { example: string }) {
	return (
		<div
			aria-hidden="true"
			className="theme-surface-dim-bg pointer-events-none flex items-start gap-5 p-4 select-none"
		>
			<div className="image-outline size-24 flex-shrink-0 overflow-hidden">
				<AlbumPlaceholder />
			</div>

			<div className="min-w-0 flex-1">
				<h4
					className="theme-text mb-2 text-2xl leading-tight font-extralight tracking-tight"
					style={{ fontFamily: fonts.display }}
				>
					Playlist name
				</h4>

				<div className="theme-surface-bg -mx-2 mb-3 flex items-start gap-3 px-2 py-1.5">
					<p
						className="theme-text flex-1 text-sm leading-relaxed text-pretty"
						style={{ fontFamily: fonts.body }}
					>
						{example}
					</p>
					<span
						className="theme-text flex-shrink-0 self-center text-[10px] tracking-widest uppercase opacity-100"
						style={{ fontFamily: fonts.body }}
					>
						Edit
					</span>
				</div>

				<p
					className="theme-text-muted mb-3 flex items-center gap-2 text-[11px] leading-relaxed"
					style={{ fontFamily: fonts.body }}
				>
					<span
						aria-hidden="true"
						className="theme-primary-bg inline-block size-1.5 rounded-full opacity-70"
					/>
					New songs find their way here by what you{" "}
					<em style={{ fontFamily: fonts.display, fontStyle: "italic" }}>
						wrote
					</em>
					.
				</p>

				<span
					className="theme-target-toggle inline-flex min-h-8 items-center gap-1.5 px-3 text-[10px] tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
					data-selected="false"
				>
					<span aria-hidden="true">+</span>Add to Matching
				</span>
			</div>
		</div>
	);
}
