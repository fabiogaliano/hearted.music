import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";

interface PlaylistCardProps {
	playlist: Playlist;
	theme: ThemeConfig;
	status: "active" | "available";
	onSelect?: (id: string, element: HTMLElement) => void;
	onRemove?: (id: string) => void;
	onAction?: (id: string) => void;
	isAnimatingTo?: boolean;
	itemRef?: (el: HTMLElement | null) => void;
	tabIndex?: number;
	dataFocused?: boolean;
	navEngaged?: boolean;
	onPointerDown?: React.PointerEventHandler<HTMLElement>;
	onFocus?: React.FocusEventHandler<HTMLElement>;
	onBlur?: React.FocusEventHandler<HTMLElement>;
}

export function PlaylistCard({
	playlist,
	theme,
	status,
	onSelect,
	onRemove,
	onAction,
	isAnimatingTo,
	itemRef,
	tabIndex,
	dataFocused,
	navEngaged,
	onPointerDown,
	onFocus,
	onBlur,
}: PlaylistCardProps) {
	if (status === "active") {
		return (
			<div
				className="group -mx-3 flex items-center gap-3 px-3 py-3 transition-colors duration-150 ease-out"
				style={{ background: theme.surface }}
				onMouseEnter={(e) =>
					(e.currentTarget.style.background = theme.surfaceDim)
				}
				onMouseLeave={(e) => (e.currentTarget.style.background = theme.surface)}
			>
				<div
					className="h-10 w-10 flex-shrink-0"
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
						className="truncate text-sm"
						style={{
							fontFamily: fonts.body,
							color: theme.text,
							viewTransitionName: isAnimatingTo ? "playlist-title" : "none",
						}}
					>
						{playlist.name}
					</p>
					{playlist.description && (
						<p
							className="truncate text-xs"
							style={{
								fontFamily: fonts.body,
								color: theme.textMuted,
							}}
						>
							{playlist.description}
						</p>
					)}
				</div>
				<button
					type="button"
					onClick={() => onRemove?.(playlist.id)}
					className="p-1.5 opacity-0 transition-opacity duration-150 ease-out group-hover:opacity-100"
					aria-label={`Remove ${playlist.name} from matching`}
				>
					<span
						className="text-lg leading-none"
						style={{ color: theme.textMuted }}
					>
						×
					</span>
				</button>
			</div>
		);
	}

	const isFocused = dataFocused === true;

	return (
		<div
			ref={itemRef}
			tabIndex={tabIndex}
			data-focused={dataFocused}
			data-nav-engaged={navEngaged}
			onPointerDown={onPointerDown}
			onFocus={onFocus}
			onBlur={onBlur}
			className="group flex cursor-pointer items-center gap-5 py-5 transition-transform duration-100 ease-out active:scale-[0.995]"
			style={{
				borderBottom: `1px solid ${theme.border}`,
				borderLeft: isFocused
					? `3px solid ${theme.primary}`
					: "3px solid transparent",
			}}
			onClick={(event) => onSelect?.(playlist.id, event.currentTarget)}
		>
			<div
				className="h-16 w-16 flex-shrink-0 overflow-hidden"
				style={{
					viewTransitionName: isAnimatingTo ? "playlist-cover" : "none",
				}}
			>
				{playlist.image_url ? (
					<img
						src={playlist.image_url}
						alt={playlist.name}
						className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-105"
					/>
				) : (
					<AlbumPlaceholder />
				)}
			</div>

			<div className="min-w-0 flex-1">
				<h3
					className="truncate text-xl font-extralight"
					style={{
						fontFamily: fonts.display,
						color: theme.text,
						viewTransitionName: isAnimatingTo ? "playlist-title" : "none",
					}}
				>
					{playlist.name}
				</h3>
				{playlist.description && (
					<p
						className="mt-1 truncate text-sm"
						style={{
							fontFamily: fonts.body,
							color: theme.textMuted,
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
					onAction?.(playlist.id);
				}}
				className="px-4 py-2 text-xs tracking-widest uppercase opacity-0 transition-all duration-150 ease-out group-hover:opacity-100"
				style={{
					fontFamily: fonts.body,
					background: theme.surface,
					color: theme.text,
				}}
				onMouseEnter={(e) => {
					e.currentTarget.style.background = theme.primary;
					e.currentTarget.style.color = theme.textOnPrimary;
				}}
				onMouseLeave={(e) => {
					e.currentTarget.style.background = theme.surface;
					e.currentTarget.style.color = theme.text;
				}}
				aria-label={`Add ${playlist.name} to matching`}
			>
				Add
			</button>
		</div>
	);
}
