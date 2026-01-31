import type { Song } from "@/lib/data/mock-data";
import { fonts } from "@/lib/theme/fonts";
import type { ThemeConfig } from "@/lib/theme/types";

const COLLAPSED_ALBUM_SIZE_PX = "400px";
const EXPANDED_ALBUM_SIZE_PX = "240px";

interface SongSectionProps {
	song: Song;
	theme: ThemeConfig;
	isExpanded: boolean;
	metaVisible: boolean;
	albumArtUrl: string;
	isLoading: boolean;
}

export function SongSection({
	song,
	theme,
	isExpanded,
	metaVisible,
	albumArtUrl,
	isLoading,
}: SongSectionProps) {
	return (
		<div className={isExpanded ? "flex items-start gap-6" : ""}>
			<div
				className="relative shrink-0 origin-top transition-[width,max-width] duration-500 ease-in-out"
				style={{
					maxWidth: isExpanded
						? EXPANDED_ALBUM_SIZE_PX
						: COLLAPSED_ALBUM_SIZE_PX,
					width: isExpanded ? EXPANDED_ALBUM_SIZE_PX : COLLAPSED_ALBUM_SIZE_PX,
				}}
			>
				{isLoading ? (
					<div
						className="aspect-square w-full animate-pulse"
						style={{ background: theme.surface }}
					/>
				) : (
					<img
						src={albumArtUrl}
						alt={song.album}
						className="aspect-square w-full object-cover transition-all duration-500 ease-in-out"
					/>
				)}
			</div>

			<div
				className={`transition-[opacity,transform,margin-top] ease-in-out ${isExpanded ? "mt-0 min-w-0 flex-1" : "mt-6"}`}
				style={{
					opacity: metaVisible ? 1 : 0,
					transform: metaVisible ? "translateY(0px)" : "translateY(12px)",
					filter: metaVisible ? "blur(0px)" : "blur(10px)",
					willChange: "opacity, transform, filter",
					transitionProperty: "opacity, transform, filter, margin-top",
					transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
					transitionDuration: metaVisible ? "900ms" : "450ms",
				}}
			>
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{song.album}
				</p>
				<h2
					className={
						isExpanded
							? "mt-2 text-2xl leading-tight font-extralight"
							: "mt-2 text-4xl leading-tight font-extralight"
					}
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					{song.name}
				</h2>
				<p
					className={isExpanded ? "mt-1 text-base" : "mt-2 text-lg"}
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					{song.artist}
				</p>
			</div>
		</div>
	);
}
