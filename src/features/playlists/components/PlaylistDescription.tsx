import { useEffect, useRef } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { ExtensionAvailability } from "../hooks/useExtensionStatus";

interface PlaylistDescriptionProps {
	description: string | null;
	trackCount: number;
	isExpanded: boolean;
	isEditing: boolean;
	draftDescription: string;
	extensionStatus: ExtensionAvailability;
	onEdit: () => void;
	onSave: () => void;
	onCancel: () => void;
	onDraftChange: (value: string) => void;
	enableViewTransition?: boolean;
}

export function PlaylistDescription({
	description,
	trackCount,
	isExpanded,
	isEditing,
	draftDescription,
	extensionStatus,
	onEdit,
	onSave,
	onCancel,
	onDraftChange,
	enableViewTransition = true,
}: PlaylistDescriptionProps) {
	const textareaRef = useRef<HTMLTextAreaElement>(null);

	useEffect(() => {
		if (!isEditing || !isExpanded) return;
		const textarea = textareaRef.current;
		if (!textarea) return;
		textarea.focus();
		const length = textarea.value.length;
		textarea.setSelectionRange(length, length);
	}, [isEditing, isExpanded]);

	if (isEditing && isExpanded) {
		return (
			<div className="mb-6 max-w-lg">
				<textarea
					ref={textareaRef}
					value={draftDescription}
					onChange={(e) => onDraftChange(e.target.value)}
					placeholder="Add a description for this playlist..."
					className="theme-primary theme-border-color w-full resize-none border-b-2 bg-transparent pb-2 text-sm leading-relaxed outline-none"
					style={{ fontFamily: fonts.body }}
					rows={3}
				/>
				<div className="mt-3 flex items-center gap-3">
					<button
						type="button"
						onClick={onSave}
						className="theme-primary-action px-3 py-1.5 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Save
					</button>
					<button
						type="button"
						onClick={onCancel}
						className="theme-text-muted text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Cancel
					</button>
				</div>
			</div>
		);
	}

	return (
		<div className={`group/desc ${isExpanded ? "mb-6" : "mb-0"}`}>
			{isExpanded ? (
				extensionStatus === "available" ? (
					<button
						type="button"
						onClick={onEdit}
						className="group/edit relative w-full max-w-lg text-left"
					>
						{description ? (
							<div className="theme-hover-surface -mx-3 flex items-start gap-4 rounded px-3 py-2 transition-colors">
								<p
									className="theme-text-muted flex-1 text-sm leading-relaxed"
									style={{
										fontFamily: fonts.body,
										viewTransitionName:
											enableViewTransition && isExpanded
												? "playlist-description"
												: "none",
									}}
								>
									{description}
								</p>
								<span
									className="theme-text flex-shrink-0 text-xs tracking-widest uppercase opacity-50 transition-opacity group-hover/edit:opacity-100"
									style={{ fontFamily: fonts.body }}
								>
									Edit
								</span>
							</div>
						) : (
							<div className="theme-border-brighten theme-border-color border-2 border-dashed px-4 py-3 transition-colors">
								<p
									className="theme-text-muted text-sm"
									style={{ fontFamily: fonts.body }}
								>
									+ Add description
								</p>
							</div>
						)}
					</button>
				) : (
					<p
						className="theme-text-muted text-sm leading-relaxed"
						style={{ fontFamily: fonts.body }}
					>
						{description || `${trackCount} tracks`}
					</p>
				)
			) : (
				<p
					className="theme-text-muted line-clamp-1 max-w-sm text-sm"
					style={{ fontFamily: fonts.body }}
				>
					{description || `${trackCount} tracks`}
				</p>
			)}
		</div>
	);
}
