import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlbumPlaceholder } from "@/components/ui/AlbumPlaceholder";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

const ALBUM_SIZE = "min(100%, clamp(280px, 30vw, 560px))";

interface SongSectionProps {
	song: {
		name: string;
		album: string;
		artist: string;
	};
	metaVisible: boolean;
	albumArtUrl?: string;
	isLoading: boolean;
	songKey?: string;
}

export function SongSection({
	song,
	metaVisible,
	albumArtUrl,
	isLoading,
	songKey,
}: SongSectionProps) {
	const theme = useTheme();
	const prefersReducedMotion = useReducedMotion();

	return (
		<div>
			<AnimatePresence mode="wait">
				<motion.div
					key={songKey}
					className="relative shrink-0 origin-top"
					style={{
						maxWidth: ALBUM_SIZE,
						width: ALBUM_SIZE,
					}}
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
					{isLoading ? (
						<div
							className="aspect-square w-full animate-pulse"
							style={{ background: theme.surface }}
						/>
					) : albumArtUrl ? (
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
				</motion.div>
			</AnimatePresence>

			<AnimatePresence mode="wait">
				<motion.div
					key={songKey}
					className="mt-6"
					style={{
						opacity: metaVisible ? 1 : 0,
						willChange: "opacity, transform",
					}}
					initial={prefersReducedMotion ? false : { opacity: 0, x: 20 }}
					animate={{
						opacity: metaVisible ? 1 : 0,
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
					<p
						className="text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{song.album}
					</p>
					<h2
						className="mt-2 text-4xl leading-tight font-extralight"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{song.name}
					</h2>
					<p
						className="mt-2 text-lg"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						{song.artist}
					</p>
				</motion.div>
			</AnimatePresence>
		</div>
	);
}
