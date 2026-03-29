import type { Story } from "@ladle/react";
import { useState, useEffect, useRef, useCallback } from "react";
import { SongCard } from "./components/SongCard";
import { allLikedSongs, simulateEnrichment } from "@/stories/fixtures";
import type { LikedSong } from "./types";

function SongList({ songs }: { songs: LikedSong[] }) {
	return (
		<div style={{ maxWidth: 600, margin: "0 auto" }}>
			{songs.map((song) => (
				<SongCard
					key={song.track.id}
					song={song}
					albumArtUrl={song.track.image_url ?? undefined}
					isSelected={false}
					itemRef={() => {}}
					tabIndex={0}
					dataFocused={false}
					navEngaged={false}
					onClick={() => {}}
				/>
			))}
		</div>
	);
}

export const AllEnriched: Story = () => <SongList songs={allLikedSongs} />;

export const NoneEnriched: Story = () => (
	<SongList songs={simulateEnrichment(allLikedSongs, 0)} />
);

export const PartiallyEnriched: Story = () => (
	<SongList songs={simulateEnrichment(allLikedSongs, 8)} />
);

export const ProgressiveEnrichment: Story = () => {
	const total = allLikedSongs.length;
	const [count, setCount] = useState(0);
	const [autoPlay, setAutoPlay] = useState(false);
	const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

	const stop = useCallback(() => {
		if (intervalRef.current) {
			clearInterval(intervalRef.current);
			intervalRef.current = null;
		}
		setAutoPlay(false);
	}, []);

	const start = useCallback(() => {
		stop();
		setAutoPlay(true);
		intervalRef.current = setInterval(() => {
			setCount((c) => {
				if (c >= total) {
					stop();
					return total;
				}
				return c + 1;
			});
		}, 600);
	}, [total, stop]);

	useEffect(() => () => stop(), [stop]);

	const songs = simulateEnrichment(allLikedSongs, count);

	return (
		<div>
			<div
				style={{
					position: "sticky",
					top: 0,
					zIndex: 10,
					padding: "12px 16px",
					background: "#f5f5f5",
					borderBottom: "1px solid #e5e5e5",
					fontSize: 13,
					display: "flex",
					gap: 12,
					alignItems: "center",
				}}
			>
				<span style={{ fontWeight: 600, minWidth: 100 }}>
					{count}/{total} enriched
				</span>
				<input
					type="range"
					min={0}
					max={total}
					value={count}
					onChange={(e) => {
						stop();
						setCount(Number(e.target.value));
					}}
					style={{ flex: 1 }}
				/>
				{autoPlay ? (
					<button onClick={stop} style={{ fontSize: 12, padding: "4px 10px" }}>
						Pause
					</button>
				) : (
					<button onClick={start} style={{ fontSize: 12, padding: "4px 10px" }}>
						Play
					</button>
				)}
				<button
					onClick={() => {
						stop();
						setCount(0);
					}}
					style={{ fontSize: 12, padding: "4px 10px" }}
				>
					Reset
				</button>
			</div>
			<SongList songs={songs} />
		</div>
	);
};
ProgressiveEnrichment.meta = {
	description:
		"Simulate songs being enriched one by one. Use slider or hit Play.",
};
