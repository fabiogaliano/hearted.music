import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { fonts } from "@/lib/theme/fonts";
import { PanelPrototype } from "@/features/liked-songs/components/playground/PanelPrototype";
import { DesignSwitcher } from "@/features/liked-songs/components/playground/DesignSwitcher";
import { MOCK_SONGS } from "@/features/liked-songs/components/playground/mock-data";
import { DEFAULT_CONFIG } from "@/features/liked-songs/components/playground/types";
import type { DesignConfig } from "@/features/liked-songs/components/playground/types";

export const Route = createFileRoute("/dev-playground")({
	component: DevPlayground,
});

function DevPlayground() {
	const [config, setConfig] = useState<DesignConfig>(DEFAULT_CONFIG);
	const [selectedSongIndex, setSelectedSongIndex] = useState(0);

	const song = MOCK_SONGS[selectedSongIndex];

	return (
		<div
			className="min-h-screen flex items-start justify-center pt-8 pb-20 px-4"
			style={{
				background: config.isDark ? "hsl(0, 0%, 5%)" : "hsl(0, 0%, 92%)",
				fontFamily: fonts.body,
				transition: "background 300ms ease",
			}}
		>
			<div className="flex flex-col items-center gap-4">
				<h1
					style={{
						fontFamily: fonts.display,
						fontSize: 16,
						fontWeight: 400,
						color: config.isDark ? "hsl(0, 0%, 50%)" : "hsl(0, 0%, 40%)",
					}}
				>
					Song Detail Panel — Design Playground
				</h1>

				<PanelPrototype song={song} config={config} />
			</div>

			<DesignSwitcher
				config={config}
				onChange={setConfig}
				songs={MOCK_SONGS}
				selectedSongIndex={selectedSongIndex}
				onSelectSong={setSelectedSongIndex}
			/>
		</div>
	);
}
