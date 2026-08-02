import { ArrowLeftIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";
import type { Destination } from "./types";

interface SpokePageProps {
	destination: Exclude<Destination, "home">;
	matchCount: number;
	/** Labeled back-link, shown only for spoke→spoke arrivals (the generalized
	 * "Back to match" pattern). Hub arrivals go home via the wordmark. */
	backTo?: { label: string; onClick: () => void };
}

const TITLES: Record<Exclude<Destination, "home" | "match">, string> = {
	"liked-songs": "Liked Songs",
	playlists: "Playlists",
	settings: "Settings",
};

/** Ghost spoke: real masthead context, placeholder body. The real pages keep
 * their existing UIs — this only proves the wayfinding loop (trunk test:
 * title says where you are, wordmark takes you home, backTo names the trail). */
export function SpokePage({ destination, matchCount, backTo }: SpokePageProps) {
	const title =
		destination === "match"
			? `${matchCount} ${matchCount === 1 ? "song" : "songs"} looking for ${matchCount === 1 ? "a home" : "homes"}`
			: TITLES[destination];

	return (
		<div className="mx-auto max-w-5xl px-8 py-10">
			{backTo && (
				<button
					type="button"
					onClick={backTo.onClick}
					className="focus-edge-offset theme-text-muted group mb-6 inline-flex items-center gap-1.5 text-xs tracking-widest uppercase transition-colors duration-150 ease-out hover:text-(--t-text) motion-reduce:transition-none"
					style={{ fontFamily: fonts.body }}
				>
					<ArrowLeftIcon
						size={12}
						weight="regular"
						className="transition-transform duration-200 ease-out motion-safe:group-hover:-translate-x-1"
					/>
					Back to {backTo.label}
				</button>
			)}
			<h1
				className="theme-text text-page-title font-extralight tracking-tight text-balance"
				style={{ fontFamily: fonts.display }}
			>
				{title}
			</h1>
			<p
				className="theme-text-muted mt-4 mb-10 text-sm"
				style={{ fontFamily: fonts.body }}
			>
				The real {destination === "match" ? "match" : title.toLowerCase()} page
				lives here — this spoke only proves the wayfinding.
			</p>
			<div className="space-y-3">
				{[1, 0.7, 0.45, 0.25].map((opacity) => (
					<div
						key={opacity}
						className="theme-surface-bg squircle h-16 rounded-[10px]"
						style={{ opacity }}
					/>
				))}
			</div>
		</div>
	);
}
