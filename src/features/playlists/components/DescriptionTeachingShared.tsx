import { CaretLeftIcon, CaretRightIcon } from "@phosphor-icons/react";
import { useCallback, useState } from "react";
import { fonts } from "@/lib/theme/fonts";

// Lowercase, conversational examples that span the shapes a real user might
// write: genre + mood, pure activity, activity + genre + occasion, emotional
// purpose, mood + occasion, scene-painting, weather, era, time-of-day.
// Adding more here just deepens the rotation.
export const DESCRIPTION_EXAMPLES = [
	"my indie rock broken heart playlist",
	"songs i run to",
	"sun is shining, you are making a coffee, dancing in your kitchen",
	"for rainy sundays",
	"slow jazz for sunday cooking",
	"90s r&b for slow afternoons",
	"songs that make me cry on purpose",
	"songs to feel brave",
	"the gym at 6am",
	"long drives where i don't talk",
	"first warm day of spring, driving with the windows down",
] as const;

// Shared between the /playlists (!) dialog and the onboarding first-pick dialog.
// Same words on both surfaces so the user recognises the concept on return.

export function DescriptionTeachingHeadline({ id }: { id: string }) {
	return (
		<h3
			id={id}
			className="theme-text mb-6 text-2xl leading-snug font-light tracking-tight"
			style={{ fontFamily: fonts.display }}
		>
			How songs find their way <em style={{ fontStyle: "italic" }}>home</em>
		</h3>
	);
}

export function DescriptionExamplesCarousel() {
	const [index, setIndex] = useState(0);

	const goPrev = useCallback(() => {
		setIndex(
			(i) =>
				(i - 1 + DESCRIPTION_EXAMPLES.length) % DESCRIPTION_EXAMPLES.length,
		);
	}, []);

	const goNext = useCallback(() => {
		setIndex((i) => (i + 1) % DESCRIPTION_EXAMPLES.length);
	}, []);

	return (
		<div className="theme-border-color mt-8 mb-8 border-t pt-4">
			<p
				className="theme-text-muted mb-2 text-[10px] tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Description examples
			</p>

			<div className="flex items-stretch gap-2">
				<button
					type="button"
					onClick={goPrev}
					aria-label="Previous example"
					className="theme-text-muted theme-border-color flex w-8 cursor-pointer items-center justify-center border transition-colors duration-150 hover:text-(--t-text)"
				>
					<CaretLeftIcon size={14} weight="regular" />
				</button>

				<div
					className="theme-surface-dim-bg theme-border-color flex min-h-12 flex-1 items-center justify-center border px-4 py-3"
					aria-live="polite"
				>
					<p
						key={index}
						className="theme-text text-center text-sm leading-snug"
						style={{ fontFamily: fonts.body }}
					>
						{DESCRIPTION_EXAMPLES[index]}
					</p>
				</div>

				<button
					type="button"
					onClick={goNext}
					aria-label="Next example"
					className="theme-text-muted theme-border-color flex w-8 cursor-pointer items-center justify-center border transition-colors duration-150 hover:text-(--t-text)"
				>
					<CaretRightIcon size={14} weight="regular" />
				</button>
			</div>

			<div
				className="mt-3 flex items-center justify-center gap-1.5"
				aria-hidden="true"
			>
				{DESCRIPTION_EXAMPLES.map((example, i) => (
					<span
						key={example}
						className="theme-text-muted size-1 rounded-full transition-opacity duration-150"
						style={{
							backgroundColor: "currentColor",
							opacity: i === index ? 0.9 : 0.25,
						}}
					/>
				))}
			</div>
		</div>
	);
}

export function DescriptionTeachingBullets() {
	return (
		<ul
			className="theme-border-color theme-text-muted mt-8 mb-8 space-y-1.5 border-t pt-4 text-xs leading-relaxed"
			style={{ fontFamily: fonts.body }}
		>
			<li className="flex gap-3">
				<span className="theme-text-muted flex-shrink-0" aria-hidden="true">
					·
				</span>
				<span>The songs in this playlist</span>
			</li>
			<li className="flex gap-3">
				<span className="theme-text-muted flex-shrink-0" aria-hidden="true">
					·
				</span>
				<span>The description you wrote</span>
			</li>
			<li className="flex gap-3">
				<span className="theme-text-muted flex-shrink-0" aria-hidden="true">
					·
				</span>
				<span>Synced to your Spotify playlist</span>
			</li>
		</ul>
	);
}
