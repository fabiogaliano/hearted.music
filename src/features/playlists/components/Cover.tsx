import type { CSSProperties } from "react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";

interface CoverProps {
	src: string | null;
	/** Square edge length in px, or `"fill"` to stretch to the parent's box. */
	size: number | "fill";
	className?: string;
	style?: CSSProperties;
}

/**
 * A square playlist/album cover: the image when there is one, else the shared
 * AlbumPlaceholder. The placeholder is a viewBox SVG, so its ♫ scales with the
 * box at every size — a big note in the spotlight, a small one in a rail row —
 * instead of a fixed text glyph that looked tiny at fill sizes. `image-outline`
 * carries the 1px inset outline (auto-flips in dark mode) like every other cover.
 */
export function Cover({ src, size, className = "", style }: CoverProps) {
	const fill = size === "fill";
	const dims: CSSProperties = fill ? {} : { width: size, height: size };
	const box = fill ? "h-full w-full" : "";
	if (src) {
		return (
			<img
				src={src}
				alt=""
				loading="lazy"
				className={`image-outline object-cover ${box} ${className}`}
				style={{ ...dims, ...style }}
			/>
		);
	}
	return (
		<div
			aria-hidden="true"
			className={`image-outline ${box} ${className}`}
			style={{ ...dims, ...style }}
		>
			<AlbumPlaceholder />
		</div>
	);
}
