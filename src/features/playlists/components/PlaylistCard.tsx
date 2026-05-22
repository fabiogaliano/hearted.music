import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { fonts } from "@/lib/theme/fonts";

interface PlaylistCardProps {
	playlist: Playlist;
	status: "active" | "available";
	isSelected?: boolean;
	onSelect?: (id: string, element: HTMLElement) => void;
	onRemove?: (id: string) => void;
	onAction?: (id: string) => void;
	isAnimatingTo?: boolean;
	itemRef?: (el: HTMLElement | null) => void;
	tabIndex?: number;
	dataFocused?: boolean;
	dataTabFocused?: boolean;
	navEngaged?: boolean;
	onPointerDown?: React.PointerEventHandler<HTMLElement>;
	onFocus?: React.FocusEventHandler<HTMLElement>;
	onBlur?: React.FocusEventHandler<HTMLElement>;
}

// Persistent right-edge action button styling. Always visible at low opacity
// so the affordance is discoverable without hover; lifts to full contrast on
// row hover or button focus. Tracking-widest uppercase keeps the visual
// language consistent with the rest of the editorial type system.
const rowActionClass =
	"theme-text-muted inline-flex h-9 min-w-[3.5rem] flex-shrink-0 cursor-pointer items-center justify-center px-3 text-[11px] tracking-widest uppercase opacity-60 transition-[opacity,color,transform] duration-150 ease-out hover:text-(--t-text) hover:opacity-100 focus-visible:opacity-100 active:scale-[0.97] group-hover:opacity-90";

export function PlaylistCard({
	playlist,
	status,
	isSelected,
	onSelect,
	onRemove,
	onAction,
	isAnimatingTo,
	itemRef,
	tabIndex,
	dataFocused,
	dataTabFocused,
	navEngaged,
	onPointerDown,
	onFocus,
	onBlur,
}: PlaylistCardProps) {
	const handleSelectKeyDown: React.KeyboardEventHandler<HTMLElement> = (
		event,
	) => {
		if (event.key !== "Enter" && event.key !== " ") return;
		event.preventDefault();
		onSelect?.(playlist.id, event.currentTarget);
	};

	if (status === "active") {
		return (
			// biome-ignore lint/a11y/useSemanticElements: The row contains a nested remove button, so a button wrapper would create invalid nested interactive controls.
			<div
				role="button"
				tabIndex={0}
				className="theme-active-row group flex cursor-pointer items-center gap-5 py-5 transition-transform duration-150 ease-out active:scale-[0.995]"
				data-selected={isSelected === true}
				onClick={(event) => onSelect?.(playlist.id, event.currentTarget)}
				onKeyDown={handleSelectKeyDown}
			>
				<div
					className="image-outline relative size-16 flex-shrink-0 overflow-hidden"
					style={{
						viewTransitionName: isAnimatingTo ? "playlist-cover" : "none",
					}}
				>
					{playlist.image_url ? (
						<img
							src={playlist.image_url}
							alt=""
							className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-105"
						/>
					) : (
						<AlbumPlaceholder />
					)}
				</div>

				<div className="min-w-0 flex-1">
					<h3
						className="theme-text truncate text-2xl font-extralight text-balance"
						style={{
							fontFamily: fonts.display,
							fontWeight: isSelected ? 400 : undefined,
							viewTransitionName: isAnimatingTo ? "playlist-title" : "none",
						}}
					>
						{playlist.name}
					</h3>
					{playlist.description && (
						<p
							className="theme-text-muted mt-1 truncate text-sm text-pretty"
							style={{
								fontFamily: fonts.body,
								viewTransitionName: isAnimatingTo
									? "playlist-description"
									: "none",
							}}
						>
							{playlist.description}
						</p>
					)}
				</div>

				<button
					type="button"
					onClick={(e) => {
						e.stopPropagation();
						onRemove?.(playlist.id);
					}}
					className={rowActionClass}
					style={{ fontFamily: fonts.body }}
					aria-label={`Remove ${playlist.name} from matching`}
				>
					Remove
				</button>
			</div>
		);
	}

	const isFocused = dataFocused === true;
	const hasHighlight = isFocused || isSelected;

	return (
		// biome-ignore lint/a11y/useSemanticElements: The row contains a nested add button, so a button wrapper would create invalid nested interactive controls.
		<div
			ref={itemRef}
			tabIndex={tabIndex}
			data-focused={dataFocused}
			data-tab-focused={dataTabFocused}
			data-nav-engaged={navEngaged}
			onPointerDown={onPointerDown}
			onFocus={onFocus}
			onBlur={onBlur}
			role="button"
			className="theme-selectable-row group -mx-3 flex cursor-pointer items-center gap-3 px-3 py-2.5 transition-[background-color,transform,border-color] duration-150 ease-out active:scale-[0.995]"
			data-highlighted={hasHighlight}
			onClick={(event) => onSelect?.(playlist.id, event.currentTarget)}
			onKeyDown={handleSelectKeyDown}
		>
			<div
				className="image-outline relative size-11 flex-shrink-0 overflow-hidden"
				style={{
					viewTransitionName: isAnimatingTo ? "playlist-cover" : "none",
				}}
			>
				{playlist.image_url ? (
					<img
						src={playlist.image_url}
						alt=""
						className="h-full w-full object-cover"
					/>
				) : (
					<AlbumPlaceholder />
				)}
			</div>

			<div className="min-w-0 flex-1">
				<p
					className="theme-text truncate text-sm text-pretty"
					style={{
						fontFamily: fonts.body,
						fontWeight: isSelected ? 400 : 300,
						viewTransitionName: isAnimatingTo ? "playlist-title" : "none",
					}}
				>
					{playlist.name}
				</p>
				{playlist.description && (
					<p
						className="theme-text-muted truncate text-xs"
						style={{ fontFamily: fonts.body }}
					>
						{playlist.description}
					</p>
				)}
			</div>

			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation();
					onAction?.(playlist.id);
				}}
				className={rowActionClass}
				style={{ fontFamily: fonts.body }}
				aria-label={`Add ${playlist.name} to matching`}
			>
				<span aria-hidden="true" className="mr-1 text-sm leading-none">
					+
				</span>
				Add
			</button>
		</div>
	);
}
