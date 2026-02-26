import { useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import type { ColorProps } from "./types";

interface GenreDisplayProps {
	genres: string[];
	colors: ColorProps;
}

export function GenreDisplay({ genres, colors }: GenreDisplayProps) {
	const [isHovered, setIsHovered] = useState(false);

	if (!genres.length) return null;

	const [primary, ...rest] = genres;

	return (
		<div
			className="flex items-center gap-1.5 flex-wrap"
			onMouseEnter={() => setIsHovered(true)}
			onMouseLeave={() => setIsHovered(false)}
		>
			<span
				style={{
					fontFamily: fonts.body,
					fontSize: 11,
					color: colors.textMuted,
					letterSpacing: "0.02em",
				}}
			>
				{primary}
			</span>
			{rest.map((genre) => (
				<span
					key={genre}
					style={{
						fontFamily: fonts.body,
						fontSize: 11,
						color: colors.textMuted,
						letterSpacing: "0.02em",
						opacity: isHovered ? 0.7 : 0.3,
						transition: "opacity 200ms ease",
					}}
				>
					· {genre}
				</span>
			))}
		</div>
	);
}
