import { useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import { THEME_COLORS } from "@/lib/theme/types";
import type { ThemeColor } from "@/lib/theme/types";
import type { DesignConfig } from "./types";
import { PRESETS } from "./types";
import type { PlaygroundSong } from "./types";

interface DesignSwitcherProps {
	config: DesignConfig;
	onChange: (config: DesignConfig) => void;
	songs: PlaygroundSong[];
	selectedSongIndex: number;
	onSelectSong: (index: number) => void;
}

type VisibilityKey =
	| "sonicTexture"
	| "genres"
	| "audioStats"
	| "compoundMood"
	| "moodDescription"
	| "themes"
	| "headline"
	| "interpretation"
	| "keyLines"
	| "journey";

const VISIBILITY_LABELS: Record<VisibilityKey, string> = {
	sonicTexture: "Sonic Texture",
	genres: "Genres",
	audioStats: "Audio Stats",
	compoundMood: "Compound Mood",
	moodDescription: "Mood Description",
	themes: "Themes",
	headline: "Headline",
	interpretation: "Interpretation",
	keyLines: "Key Lines",
	journey: "Journey",
};

const THEME_LABELS: Record<ThemeColor, string> = {
	blue: "Calm",
	green: "Fresh",
	rose: "Warm",
	lavender: "Dreamy",
};

export function DesignSwitcher({
	config,
	onChange,
	songs,
	selectedSongIndex,
	onSelectSong,
}: DesignSwitcherProps) {
	const [isExpanded, setIsExpanded] = useState(true);

	const update = (partial: Partial<DesignConfig>) => {
		onChange({ ...config, ...partial });
	};

	const applyPreset = (presetKey: string) => {
		const preset = PRESETS[presetKey];
		if (preset) {
			onChange({ ...config, ...preset.config });
		}
	};

	if (!isExpanded) {
		return (
			<button
				type="button"
				onClick={() => setIsExpanded(true)}
				className="fixed bottom-4 right-4 z-50 w-10 h-10 rounded-full shadow-lg flex items-center justify-center cursor-pointer transition-transform hover:scale-110"
				style={{
					background: "hsl(0, 0%, 15%)",
					color: "hsl(0, 0%, 85%)",
				}}
			>
				<svg
					width="18"
					height="18"
					viewBox="0 0 24 24"
					fill="none"
					stroke="currentColor"
					strokeWidth="2"
				>
					<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
					<circle cx="12" cy="12" r="3" />
				</svg>
			</button>
		);
	}

	return (
		<div
			className="fixed bottom-4 right-4 z-50 w-72 max-h-[calc(100vh-2rem)] overflow-y-auto rounded-xl shadow-2xl"
			style={{
				background: "hsl(0, 0%, 12%)",
				border: "1px solid hsl(0, 0%, 20%)",
				fontFamily: fonts.body,
				color: "hsl(0, 0%, 85%)",
			}}
		>
			{/* Header */}
			<div
				className="sticky top-0 flex items-center justify-between px-3 py-2.5 border-b"
				style={{
					borderColor: "hsl(0, 0%, 20%)",
					background: "hsl(0, 0%, 12%)",
				}}
			>
				<span
					style={{
						fontSize: 11,
						fontWeight: 600,
						letterSpacing: "0.05em",
						textTransform: "uppercase",
					}}
				>
					Design Switcher
				</span>
				<button
					type="button"
					onClick={() => setIsExpanded(false)}
					className="w-6 h-6 flex items-center justify-center rounded cursor-pointer hover:bg-white/10"
					style={{ color: "hsl(0, 0%, 55%)" }}
				>
					✕
				</button>
			</div>

			<div className="p-3 space-y-4">
				{/* Song Switcher */}
				<Section title="Song">
					<div className="flex flex-col gap-1">
						{songs.map((s, i) => (
							<button
								key={s.id}
								type="button"
								className="px-2 py-1.5 rounded text-[11px] cursor-pointer transition-colors text-left"
								style={{
									background:
										selectedSongIndex === i ? "hsl(0, 0%, 22%)" : "transparent",
									border: `1px solid ${selectedSongIndex === i ? "hsl(0, 0%, 35%)" : "hsl(0, 0%, 20%)"}`,
									color:
										selectedSongIndex === i
											? "hsl(0, 0%, 95%)"
											: "hsl(0, 0%, 60%)",
								}}
								onClick={() => onSelectSong(i)}
							>
								{s.name} — {s.artist}
							</button>
						))}
					</div>
				</Section>

				{/* Presets */}
				<Section title="Presets">
					<div className="flex gap-1.5 flex-wrap">
						{Object.entries(PRESETS).map(([key, preset]) => (
							<button
								key={key}
								type="button"
								className="px-2.5 py-1 rounded-full text-[11px] cursor-pointer transition-colors hover:bg-white/10"
								style={{
									border: "1px solid hsl(0, 0%, 25%)",
									color: "hsl(0, 0%, 80%)",
								}}
								onClick={() => applyPreset(key)}
								title={preset.description}
							>
								{preset.label}
							</button>
						))}
					</div>
				</Section>

				{/* Visibility toggles */}
				<Section title="Visibility">
					<div className="space-y-1">
						{(Object.keys(VISIBILITY_LABELS) as VisibilityKey[]).map((key) => (
							<label
								key={key}
								className="flex items-center gap-2 py-0.5 cursor-pointer"
							>
								<input
									type="checkbox"
									checked={config[key]}
									onChange={(e) => update({ [key]: e.target.checked })}
									className="accent-white/80"
								/>
								<span style={{ fontSize: 11, color: "hsl(0, 0%, 70%)" }}>
									{VISIBILITY_LABELS[key]}
								</span>
							</label>
						))}
					</div>
				</Section>

				{/* Style options */}
				<Section title="Style">
					<div className="space-y-2.5">
						<OptionRow label="Sonic Texture">
							<SegmentedControl
								options={["dissolve", "whisper", "blur", "genre", "push"]}
								value={config.sonicTextureStyle}
								onChange={(v) =>
									update({
										sonicTextureStyle: v as DesignConfig["sonicTextureStyle"],
									})
								}
							/>
						</OptionRow>
						<OptionRow label="Genre Position">
							<SegmentedControl
								options={["hero", "content"]}
								value={config.genrePosition}
								onChange={(v) =>
									update({ genrePosition: v as DesignConfig["genrePosition"] })
								}
							/>
						</OptionRow>
						<OptionRow label="Audio Position">
							<SegmentedControl
								options={["hero", "content"]}
								value={config.audioPosition}
								onChange={(v) =>
									update({ audioPosition: v as DesignConfig["audioPosition"] })
								}
							/>
						</OptionRow>
						<OptionRow label="Mood Style">
							<SegmentedControl
								options={["label", "large"]}
								value={config.moodStyle}
								onChange={(v) =>
									update({ moodStyle: v as DesignConfig["moodStyle"] })
								}
							/>
						</OptionRow>
						<OptionRow label="Themes Position">
							<ThemesPositionControl
								value={config.themesPosition}
								onChange={(v) => update({ themesPosition: v })}
							/>
						</OptionRow>
						<OptionRow label="Themes Style">
							<SegmentedControl
								options={["list", "pills", "prose"]}
								value={config.themesStyle}
								onChange={(v) =>
									update({ themesStyle: v as DesignConfig["themesStyle"] })
								}
							/>
						</OptionRow>
						<OptionRow label="Headline Size">
							<SegmentedControl
								options={["sm", "md", "lg"]}
								value={config.headlineSize}
								onChange={(v) =>
									update({ headlineSize: v as DesignConfig["headlineSize"] })
								}
							/>
						</OptionRow>
						<OptionRow label="Headline Reveal">
							<SegmentedControl
								options={["swap", "push"]}
								value={config.headlineReveal}
								onChange={(v) =>
									update({
										headlineReveal: v as DesignConfig["headlineReveal"],
									})
								}
							/>
						</OptionRow>
						<OptionRow label="Interpretation">
							<SegmentedControl
								options={["paragraph", "pullquote"]}
								value={config.interpretationStyle}
								onChange={(v) =>
									update({
										interpretationStyle:
											v as DesignConfig["interpretationStyle"],
									})
								}
							/>
						</OptionRow>
						<OptionRow label="Key Lines">
							<SegmentedControl
								options={["blockquote", "stacked", "focused"]}
								value={config.keyLinesStyle}
								onChange={(v) =>
									update({ keyLinesStyle: v as DesignConfig["keyLinesStyle"] })
								}
							/>
						</OptionRow>
						<OptionRow label="Journey">
							<SegmentedControl
								options={["vertical", "stepper", "timeline"]}
								value={config.journeyStyle}
								onChange={(v) =>
									update({ journeyStyle: v as DesignConfig["journeyStyle"] })
								}
							/>
						</OptionRow>
					</div>
				</Section>

				{/* Theme */}
				<Section title="Theme">
					<div className="space-y-2.5">
						<label className="flex items-center gap-2 cursor-pointer">
							<input
								type="checkbox"
								checked={config.isDark}
								onChange={(e) => update({ isDark: e.target.checked })}
								className="accent-white/80"
							/>
							<span style={{ fontSize: 11, color: "hsl(0, 0%, 70%)" }}>
								Dark Mode
							</span>
						</label>
						<div className="flex gap-1.5">
							{THEME_COLORS.map((color) => (
								<button
									key={color}
									type="button"
									className="flex-1 px-2 py-1.5 rounded text-[10px] cursor-pointer transition-colors"
									style={{
										background:
											config.themeColor === color
												? "hsl(0, 0%, 22%)"
												: "transparent",
										border: `1px solid ${config.themeColor === color ? "hsl(0, 0%, 40%)" : "hsl(0, 0%, 20%)"}`,
										color:
											config.themeColor === color
												? "hsl(0, 0%, 95%)"
												: "hsl(0, 0%, 55%)",
									}}
									onClick={() => update({ themeColor: color })}
								>
									{THEME_LABELS[color]}
								</button>
							))}
						</div>
					</div>
				</Section>
			</div>
		</div>
	);
}

function Section({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	return (
		<div>
			<div
				className="mb-1.5"
				style={{
					fontSize: 9,
					fontWeight: 600,
					letterSpacing: "0.1em",
					textTransform: "uppercase",
					color: "hsl(0, 0%, 45%)",
				}}
			>
				{title}
			</div>
			{children}
		</div>
	);
}

function OptionRow({
	label,
	children,
}: {
	label: string;
	children: React.ReactNode;
}) {
	return (
		<div className="flex flex-col gap-1">
			<span
				style={{
					fontSize: 10,
					color: "hsl(0, 0%, 50%)",
					letterSpacing: "0.04em",
				}}
			>
				{label}
			</span>
			{children}
		</div>
	);
}

const THEMES_POSITION_LABELS: Record<DesignConfig["themesPosition"], string> = {
	"above-stats": "↑ stats",
	kicker: "kicker",
	hero: "hero",
	"above-headline": "↑ headline",
	"below-headline": "↓ headline",
	"after-mood": "after mood",
	bottom: "bottom",
};

function ThemesPositionControl({
	value,
	onChange,
}: {
	value: DesignConfig["themesPosition"];
	onChange: (v: DesignConfig["themesPosition"]) => void;
}) {
	const options: DesignConfig["themesPosition"][] = [
		"above-stats",
		"kicker",
		"hero",
		"above-headline",
		"below-headline",
		"after-mood",
		"bottom",
	];
	return (
		<div
			className="flex w-full rounded overflow-hidden"
			style={{ border: "1px solid hsl(0, 0%, 22%)" }}
		>
			{options.map((opt) => (
				<button
					key={opt}
					type="button"
					className="flex-1 py-1 text-[10px] cursor-pointer transition-colors text-center"
					style={{
						background: value === opt ? "hsl(0, 0%, 22%)" : "transparent",
						color: value === opt ? "hsl(0, 0%, 90%)" : "hsl(0, 0%, 50%)",
						borderRight:
							opt !== options[options.length - 1]
								? "1px solid hsl(0, 0%, 22%)"
								: "none",
					}}
					onClick={() => onChange(opt)}
				>
					{THEMES_POSITION_LABELS[opt]}
				</button>
			))}
		</div>
	);
}

function SegmentedControl({
	options,
	value,
	onChange,
}: {
	options: string[];
	value: string;
	onChange: (v: string) => void;
}) {
	return (
		<div
			className="flex w-full rounded overflow-hidden"
			style={{ border: "1px solid hsl(0, 0%, 22%)" }}
		>
			{options.map((opt) => (
				<button
					key={opt}
					type="button"
					className="flex-1 py-1 text-[10px] cursor-pointer transition-colors text-center"
					style={{
						background: value === opt ? "hsl(0, 0%, 22%)" : "transparent",
						color: value === opt ? "hsl(0, 0%, 90%)" : "hsl(0, 0%, 50%)",
						borderRight:
							opt !== options[options.length - 1]
								? "1px solid hsl(0, 0%, 22%)"
								: "none",
					}}
					onClick={() => onChange(opt)}
				>
					{opt}
				</button>
			))}
		</div>
	);
}
