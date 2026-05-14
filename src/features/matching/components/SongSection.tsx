import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { memo } from "react";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { fonts } from "@/lib/theme/fonts";

const ALBUM_SIZE = "min(100%, clamp(280px, 30vw, 560px))";

interface SongSectionProps {
	song: {
		name: string;
		album: string;
		artist: string;
	};
	albumArtUrl?: string;
	songKey?: string;
}

export const SongSection = memo(function SongSection({
	song,
	albumArtUrl,
	songKey,
}: SongSectionProps) {
	const prefersReducedMotion = useReducedMotion();

	return (
		<div>
			<AnimatePresence mode="wait">
				<motion.div
					key={songKey}
					initial={prefersReducedMotion ? false : { opacity: 0, x: 20 }}
					animate={{
						opacity: 1,
						x: 0,
						transition: { duration: 0.25, ease: [0.165, 0.84, 0.44, 1] },
					}}
					exit={
						prefersReducedMotion
							? {}
							: {
									opacity: 0,
									x: -20,
									transition: {
										duration: 0.18,
										ease: [0.645, 0.045, 0.355, 1],
									},
								}
					}
				>
					<div
						className="relative shrink-0 origin-top"
						style={{
							maxWidth: ALBUM_SIZE,
							width: ALBUM_SIZE,
						}}
					>
						{albumArtUrl ? (
							<img
								src={albumArtUrl}
								alt={song.album}
								className="aspect-square w-full object-cover"
							/>
						) : (
							<div className="aspect-square w-full">
								<AlbumPlaceholder />
							</div>
						)}
					</div>

					<div className="mt-6">
						<p
							className="theme-text-muted text-xs tracking-widest uppercase"
							style={{ fontFamily: fonts.body }}
						>
							{song.album}
						</p>
						<h2
							className="theme-text mt-2 text-4xl leading-tight font-extralight"
							style={{ fontFamily: fonts.display }}
						>
							{song.name}
						</h2>
						<p
							className="theme-text-muted mt-2 text-lg"
							style={{ fontFamily: fonts.body }}
						>
							{song.artist}
						</p>
					</div>
				</motion.div>
			</AnimatePresence>
		</div>
	);
});
