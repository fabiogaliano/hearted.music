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
	// When the description is load-bearing for matching, lift it visually so
	// users feel the field's weight. Page mode (deep-link route) opts in; the
	// overlay panel keeps the standard size because the cover image already
	// competes for attention.
	prominent?: boolean;
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
	prominent = false,
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

	const containerWidth = prominent ? "max-w-xl" : "max-w-lg";
	const proseSize = prominent
		? "text-xl leading-snug"
		: "text-base leading-relaxed";
	const emptySize = prominent
		? "text-lg leading-snug"
		: "text-sm leading-relaxed";

	if (isEditing && isExpanded) {
		return (
			<div className={`mb-6 ${containerWidth}`}>
				<textarea
					ref={textareaRef}
					value={draftDescription}
					onChange={(e) => onDraftChange(e.target.value)}
					placeholder="What's this playlist about?"
					className={`theme-text theme-border-color w-full resize-none border-b bg-transparent pb-2 outline-none transition-colors duration-150 focus:border-(--t-primary) ${
						prominent ? "text-lg leading-snug" : "text-sm leading-relaxed"
					}`}
					style={{ fontFamily: fonts.body }}
					rows={3}
				/>
				<p
					className="theme-text-muted mt-3 text-xs leading-relaxed text-pretty"
					style={{ fontFamily: fonts.body }}
				>
					New songs find their way here by what you{" "}
					<em style={{ fontFamily: fonts.display, fontStyle: "italic" }}>
						write
					</em>
					. The clearer, the better.
				</p>
				<div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
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
					<span
						className="theme-text-muted text-[11px] tracking-widest uppercase opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						Saves to Spotify
					</span>
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
				className={`theme-text mb-6 text-pretty ${containerWidth} ${proseSize}`}
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
			<div className={`mb-6 ${containerWidth}`}>
				<button
					type="button"
					onClick={onEdit}
					className="theme-border-color theme-border-brighten -mx-3 block w-full cursor-pointer border-b px-3 py-4 text-left transition-colors duration-150"
				>
					<p
						className={`theme-text-muted text-pretty ${emptySize}`}
						style={{ fontFamily: fonts.body }}
					>
						Tell hearted what this playlist is{" "}
						<em style={{ fontFamily: fonts.display, fontStyle: "italic" }}>
							for
						</em>
						. New songs will find their way here by what you write.
					</p>
				</button>
			</div>
		);
	}

	return (
		<button
			type="button"
			onClick={onEdit}
			className={`group/edit theme-row-hover -mx-3 mb-6 block w-full cursor-pointer px-3 py-2 text-left ${containerWidth}`}
		>
			<div className="flex items-start gap-4">
				<p
					className={`theme-text flex-1 text-pretty ${proseSize}`}
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
