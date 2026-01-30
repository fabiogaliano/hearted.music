/**
 * Fan-spread album art display
 *
 * Shows 3 overlapping album covers with rotation and hover effects.
 */

import { useFanSpreadComposition } from "../hooks/useFanSpreadComposition";

interface AlbumImage {
	id: string;
	image: string;
}

interface FanSpreadAlbumArtProps {
	images: AlbumImage[];
}

export function FanSpreadAlbumArt({ images }: FanSpreadAlbumArtProps) {
	const composition = useFanSpreadComposition();

	if (images.length === 0) return null;

	return (
		<div className="relative -my-12 h-36 w-60">
			{images.slice(0, 3).map((item, idx) => {
				const comp = composition[idx];
				if (!comp) return null;

				return (
					<div
						key={item.id}
						className="absolute cursor-pointer shadow-2xl transition-all duration-300 hover:!z-10 hover:!-translate-y-3 hover:!scale-110 hover:!opacity-100"
						style={{
							width: `${comp.size}px`,
							height: `${comp.size}px`,
							left: `${comp.left}px`,
							top: `${comp.top}px`,
							zIndex: comp.z,
							opacity: comp.opacity,
							transform: `rotate(${comp.rotate}deg)`,
						}}
					>
						<img
							src={item.image}
							alt=""
							className="h-full w-full object-cover"
						/>
					</div>
				);
			})}
		</div>
	);
}
