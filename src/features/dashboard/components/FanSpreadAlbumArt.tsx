/** Fan-spread album art: 1-3 overlapping images with rotation and hover effects. */

interface AlbumImage {
	id: number;
	image: string;
}

interface FanSpreadAlbumArtProps {
	images: AlbumImage[];
}

interface FanSpreadConfig {
	size: number;
	left: number;
	top: number;
	z: number;
	opacity: number;
	rotate: number;
}

function getComposition(count: number): FanSpreadConfig[] {
	switch (count) {
		case 1:
			return [{ size: 130, left: 55, top: 2, z: 1, opacity: 1, rotate: 0 }];

		case 2:
			return [
				{ size: 105, left: 90, top: 10, z: 2, opacity: 1, rotate: 5 },
				{ size: 105, left: 25, top: 10, z: 1, opacity: 0.92, rotate: -5 },
			];

		default:
			return [
				{ size: 110, left: 60, top: 8, z: 3, opacity: 1, rotate: 0 },
				{ size: 100, left: 0, top: 16, z: 2, opacity: 0.85, rotate: -8 },
				{ size: 100, left: 130, top: 16, z: 1, opacity: 0.85, rotate: 8 },
			];
	}
}

export function FanSpreadAlbumArt({ images }: FanSpreadAlbumArtProps) {
	const limitedImages = images.slice(0, 3);
	const composition = getComposition(limitedImages.length);

	return (
		<div aria-hidden="true" className="relative -my-12 h-36 w-60">
			{limitedImages.map((item, idx) => {
				const comp = composition[idx];
				if (!comp) return null;

				// The hover state writes a full `transform` value with !important so it
				// beats the inline `transform: rotate(...)` base — pulling the card out
				// of the fan (rotation snaps to 0, card lifts and scales forward).
				return (
					<div
						key={item.id}
						className="absolute transition-[transform,opacity] duration-200 ease-out motion-safe:hover:[transform:translateY(-12px)_scale(1.08)]! motion-safe:hover:z-10! motion-safe:hover:opacity-100!"
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
							loading="lazy"
							className="h-full w-full object-cover shadow-md"
							style={{ outline: "1px solid rgba(255, 255, 255, 0.1)" }}
						/>
					</div>
				);
			})}
		</div>
	);
}
