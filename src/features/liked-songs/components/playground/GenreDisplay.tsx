import { fonts } from "@/lib/theme/fonts";
import type { ColorProps } from "./types";

interface GenreDisplayProps {
	genres: string[];
	colors: ColorProps;
}

export function GenreDisplay({ genres, colors }: GenreDisplayProps) {
	if (!genres.length) return null;

	const [primary, ...rest] = genres;

	return (
		<div className="group flex flex-wrap items-center gap-1.5">
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
					className="opacity-30 transition-opacity duration-200 group-hover:opacity-70"
					style={{
						fontFamily: fonts.body,
						fontSize: 11,
						color: colors.textMuted,
						letterSpacing: "0.02em",
					}}
				>
					· {genre}
				</span>
			))}
		</div>
	);
}
