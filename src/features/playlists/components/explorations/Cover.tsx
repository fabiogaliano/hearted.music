import type { CSSProperties } from "react";

interface CoverProps {
	src: string | null;
	/**
	 * Square edge length in px, or `"fill"` to stretch to the parent's box — size
	 * it via a sized wrapper (and the placeholder glyph via `className`, e.g.
	 * `text-5xl`) when filling.
	 */
	size: number | "fill";
	className?: string;
	style?: CSSProperties;
}

/**
 * A square playlist/album cover: the image when there is one, else a flat
 * placeholder with the house ♫ glyph. `image-outline` carries the 1px inset
 * outline (and auto-flips in dark mode), matching every other cover in the app.
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
			className={`image-outline theme-surface-dim-bg theme-text-muted grid place-items-center ${box} ${className}`}
			style={{
				...dims,
				fontSize: fill ? undefined : Math.round(size * 0.4),
				...style,
			}}
		>
			♫
		</div>
	);
}
