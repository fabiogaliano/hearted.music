import { type CSSProperties, useState } from "react";
import { fonts } from "@/lib/theme/fonts";
import "./playlist-explorations.css";

const GENRE_BANK = [
	"indie pop",
	"indie rock",
	"alternative",
	"bedroom pop",
	"dream pop",
	"art pop",
	"house",
	"deep house",
	"disco",
	"funk",
	"soul",
	"hip hop",
	"jazz",
	"ambient",
	"folk",
	"rock",
	"pop rock",
	"shoegaze",
	"lo-fi",
	"r&b",
	"electronic",
	"garage",
	"techno",
	"synth pop",
];

const selectedChipStyle: CSSProperties = {
	color: "var(--t-primary)",
	borderColor: "color-mix(in srgb, var(--t-primary) 32%, transparent)",
	backgroundColor: "color-mix(in srgb, var(--t-primary) 9%, transparent)",
	fontFamily: fonts.body,
};

interface GenrePickerProps {
	value: string[];
	onChange: (next: string[]) => void;
	/** Account's top genres, surfaced first among suggestions. */
	topGenres?: readonly string[];
	maxPills?: number;
	autoFocus?: boolean;
	disabled?: boolean;
}

/**
 * The lab-faithful genre picker: "Your genres" with a capacity meter and an
 * inline input, then a hairline-separated "Suggestions" group — the round-2 fix
 * for selected chips and suggestions colliding. Type to filter, Enter to add,
 * Backspace on an empty input to drop the last; a 6th attempt shakes.
 */
export function GenrePicker({
	value,
	onChange,
	topGenres = [],
	maxPills = 5,
	autoFocus,
	disabled,
}: GenrePickerProps) {
	const [input, setInput] = useState("");
	const [shake, setShake] = useState(false);
	const atCap = value.length >= maxPills;

	const add = (raw: string) => {
		const genre = raw.trim().toLowerCase();
		if (!genre) return;
		if (value.includes(genre)) {
			setInput("");
			return;
		}
		if (atCap) {
			setShake(true);
			window.setTimeout(() => setShake(false), 240);
			return;
		}
		onChange([...value, genre]);
		setInput("");
	};
	const remove = (genre: string) => onChange(value.filter((g) => g !== genre));

	const query = input.trim().toLowerCase();
	const pool = [...new Set([...topGenres, ...GENRE_BANK])];
	const suggestions = pool
		.filter((g) => !value.includes(g) && (query ? g.includes(query) : true))
		.slice(0, 6);

	return (
		<div className="flex flex-col gap-2.5">
			<div className={`flex flex-col gap-2.5 ${shake ? "xpl-shake" : ""}`}>
				<div className="flex items-baseline justify-between">
					<span
						className="theme-text-muted text-[10px] tracking-[0.16em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Your genres
					</span>
					<span
						className={`text-xs tabular-nums ${atCap ? "theme-primary" : "theme-text-muted"}`}
						style={{ fontFamily: fonts.body }}
					>
						{value.length}
						<span className="opacity-60">/{maxPills}</span>
					</span>
				</div>

				<div className="flex flex-wrap items-center gap-2">
					{value.map((genre) => (
						<span
							key={genre}
							className="inline-flex items-center gap-1.5 rounded-full border px-3 py-[5px] text-xs"
							style={selectedChipStyle}
						>
							{genre}
							<button
								type="button"
								onClick={() => remove(genre)}
								aria-label={`Remove ${genre}`}
								className="-mr-[3px] cursor-pointer border-0 bg-transparent p-0 text-[15px] leading-none opacity-60 transition-[opacity,transform] duration-150 hover:opacity-100 active:scale-90"
								style={{ color: "inherit" }}
							>
								×
							</button>
						</span>
					))}
					<input
						value={input}
						disabled={disabled}
						// biome-ignore lint/a11y/noAutofocus: the editor opens focused on genres when the caller asks
						autoFocus={autoFocus}
						onChange={(event) => setInput(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter") {
								event.preventDefault();
								add(input);
							} else if (
								event.key === "Backspace" &&
								!input &&
								value.length > 0
							) {
								remove(value[value.length - 1]);
							}
						}}
						placeholder={value.length ? "add another…" : "type a genre…"}
						className="theme-primary min-w-[9ch] border-0 bg-transparent px-0.5 py-[5px] text-[13px] outline-none placeholder:text-(--t-text-muted)"
						style={{ fontFamily: fonts.body }}
					/>
				</div>
			</div>

			{suggestions.length > 0 && (
				<div
					className="flex flex-col gap-2 border-t pt-3.5"
					style={{
						borderColor: "color-mix(in srgb, var(--t-border) 80%, transparent)",
					}}
				>
					<span
						className="theme-text-muted text-[10px] tracking-[0.16em] uppercase opacity-85"
						style={{ fontFamily: fonts.body }}
					>
						Suggestions
					</span>
					<div className="flex flex-wrap gap-2">
						{suggestions.map((genre) => (
							<button
								key={genre}
								type="button"
								disabled={disabled}
								onClick={() => add(genre)}
								className="theme-text-muted theme-border-color cursor-pointer rounded-full border px-3 py-1.5 text-xs transition-[color,border-color,background-color,transform] duration-150 hover:border-(--t-primary)/40 hover:text-(--t-primary) active:scale-[0.96]"
								style={{ fontFamily: fonts.body }}
							>
								{genre}
							</button>
						))}
					</div>
				</div>
			)}
		</div>
	);
}
