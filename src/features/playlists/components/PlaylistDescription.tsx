import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/Button";
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
					placeholder="Add a description for this playlist…"
					className="theme-text theme-border-color w-full resize-none border-b bg-transparent pb-2 text-sm leading-relaxed outline-none transition-colors duration-150 focus:border-(--t-primary)"
					style={{ fontFamily: fonts.body }}
					rows={3}
				/>
				<div className="mt-3 flex items-center gap-3">
					<Button size="sm" onClick={onSave} style={{ fontFamily: fonts.body }}>
						Save
					</Button>
					<Button
						variant="ghost"
						size="sm"
						onClick={onCancel}
						style={{ fontFamily: fonts.body }}
					>
						Cancel
					</Button>
				</div>
			</div>
		);
	}

	if (!isExpanded) {
		return (
			<p
				className="theme-text-muted mb-0 line-clamp-1 max-w-sm text-sm"
				style={{ fontFamily: fonts.body }}
			>
				{description || `${trackCount} tracks`}
			</p>
		);
	}

	const canEdit = extensionStatus === "available";
	const hasDescription = Boolean(description);

	if (!canEdit) {
		return (
			<p
				className="theme-text mb-6 max-w-lg text-base leading-relaxed text-pretty"
				style={{
					fontFamily: fonts.body,
					viewTransitionName: enableViewTransition
						? "playlist-description"
						: "none",
				}}
			>
				{description || `${trackCount} tracks`}
			</p>
		);
	}

	if (!hasDescription) {
		return (
			<div className="mb-6 max-w-lg">
				<button
					type="button"
					onClick={onEdit}
					className="theme-border-color theme-border-brighten -mx-3 block w-full cursor-pointer border-b px-3 py-3 text-left transition-colors duration-150"
				>
					<p
						className="theme-text-muted text-sm italic"
						style={{ fontFamily: fonts.body }}
					>
						Add a description…
					</p>
				</button>
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={onEdit}
			className="group/edit theme-row-hover -mx-3 mb-6 block w-full max-w-lg cursor-pointer px-3 py-2 text-left"
		>
			<div className="flex items-start gap-4">
				<p
					className="theme-text flex-1 text-base leading-relaxed text-pretty"
					style={{
						fontFamily: fonts.body,
						viewTransitionName: enableViewTransition
							? "playlist-description"
							: "none",
					}}
				>
					{description}
				</p>
				<span
					className="theme-text flex-shrink-0 self-center text-xs tracking-widest uppercase opacity-40 transition-opacity duration-150 group-hover/edit:opacity-100"
					style={{ fontFamily: fonts.body }}
				>
					Edit
				</span>
			</div>
		</button>
	);
}
