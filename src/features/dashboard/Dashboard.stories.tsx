import type { Story } from "@ladle/react";
import { useState, useEffect } from "react";
import { Dashboard } from "./Dashboard";
import { allLikedSongs, simulateDashboard } from "@/stories/fixtures";

export const FullyEnriched: Story = () => (
	<Dashboard
		{...simulateDashboard(allLikedSongs, allLikedSongs.length, false)}
	/>
);

export const Empty: Story = () => (
	<Dashboard {...simulateDashboard(allLikedSongs, 0, false)} />
);

export const MidEnrichment: Story = () => (
	<Dashboard {...simulateDashboard(allLikedSongs, 12, true)} />
);

export const ProgressiveEnrichment: Story = () => {
	const [count, setCount] = useState(0);
	const total = allLikedSongs.length;

	useEffect(() => {
		if (count >= total) return;
		const id = setTimeout(() => setCount((c) => Math.min(c + 1, total)), 800);
		return () => clearTimeout(id);
	}, [count, total]);

	return (
		<div>
			<div
				style={{
					padding: "12px 16px",
					background: "#f5f5f5",
					borderBottom: "1px solid #e5e5e5",
					fontSize: 13,
					display: "flex",
					gap: 12,
					alignItems: "center",
				}}
			>
				<span>
					Enriched: {count}/{total}
				</span>
				<input
					type="range"
					min={0}
					max={total}
					value={count}
					onChange={(e) => setCount(Number(e.target.value))}
					style={{ flex: 1 }}
				/>
				<button
					onClick={() => setCount(0)}
					style={{ fontSize: 12, padding: "4px 8px" }}
				>
					Reset
				</button>
			</div>
			<Dashboard {...simulateDashboard(allLikedSongs, count, count < total)} />
		</div>
	);
};
ProgressiveEnrichment.meta = {
	description: "Drag the slider to simulate songs being enriched over time",
};
