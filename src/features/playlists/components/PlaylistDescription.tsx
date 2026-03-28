import type { ThemeConfig } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";
import type { ExtensionAvailability } from "../hooks/useExtensionStatus";

interface PlaylistDescriptionProps {
	theme: ThemeConfig;
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
	theme,
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
	if (isEditing && isExpanded) {
		return (
			<div className="mb-6 max-w-lg">
				<textarea
					value={draftDescription}
					onChange={(e) => onDraftChange(e.target.value)}
					placeholder="Add a description for this playlist..."
					className="w-full resize-none border-b-2 bg-transparent pb-2 text-sm leading-relaxed outline-none"
					style={{
						fontFamily: fonts.body,
						color: theme.text,
						borderColor: theme.primary,
					}}
					rows={3}
					autoFocus
				/>
				<div className="mt-3 flex items-center gap-3">
					<button
						onClick={onSave}
						className="px-3 py-1.5 text-xs tracking-widest uppercase"
						style={{
							fontFamily: fonts.body,
							background: theme.primary,
							color: theme.textOnPrimary,
						}}
					>
						Save
					</button>
					<button
						onClick={onCancel}
						className="text-xs tracking-widest uppercase"
						style={{
							fontFamily: fonts.body,
							color: theme.textMuted,
						}}
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
						onClick={onEdit}
						className="group/edit relative w-full max-w-lg text-left"
					>
						{description ? (
							<div
								className="-mx-3 flex items-start gap-4 rounded px-3 py-2 transition-colors"
								style={{ background: "transparent" }}
								onMouseEnter={(e) =>
									(e.currentTarget.style.background = theme.surface)
								}
								onMouseLeave={(e) =>
									(e.currentTarget.style.background = "transparent")
								}
							>
								<p
									className="flex-1 text-sm leading-relaxed"
									style={{
										fontFamily: fonts.body,
										color: theme.textMuted,
										viewTransitionName:
											enableViewTransition && isExpanded
												? "playlist-description"
												: "none",
									}}
								>
									{description}
								</p>
								<span
									className="flex-shrink-0 text-xs tracking-widest uppercase opacity-50 transition-opacity group-hover/edit:opacity-100"
									style={{
										fontFamily: fonts.body,
										color: theme.text,
									}}
								>
									Edit
								</span>
							</div>
						) : (
							<div
								className="border-2 border-dashed px-4 py-3 transition-colors"
								style={{ borderColor: theme.border }}
								onMouseEnter={(e) =>
									(e.currentTarget.style.borderColor = theme.textMuted)
								}
								onMouseLeave={(e) =>
									(e.currentTarget.style.borderColor = theme.border)
								}
							>
								<p
									className="text-sm"
									style={{
										fontFamily: fonts.body,
										color: theme.textMuted,
									}}
								>
									+ Add description
								</p>
							</div>
						)}
					</button>
				) : (
					<p
						className="text-sm leading-relaxed"
						style={{
							fontFamily: fonts.body,
							color: theme.textMuted,
						}}
					>
						{description || `${trackCount} tracks`}
					</p>
				)
			) : (
				<p
					className="line-clamp-1 max-w-sm text-sm"
					style={{
						fontFamily: fonts.body,
						color: theme.textMuted,
					}}
				>
					{description || `${trackCount} tracks`}
				</p>
			)}
		</div>
	);
}
