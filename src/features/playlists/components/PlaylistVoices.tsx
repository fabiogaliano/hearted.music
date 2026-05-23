import { InfoIcon } from "@phosphor-icons/react";
import { useState } from "react";
import type { Playlist } from "@/lib/domains/library/playlists/queries";
import { fonts } from "@/lib/theme/fonts";
import {
	type PlaylistVoiceWeights,
	usePlaylistVoices,
} from "../hooks/usePlaylistVoices";
import { DescriptionRoleDialog } from "./DescriptionRoleDialog";

interface PlaylistVoicesProps {
	playlist?: Playlist;
	weights?: PlaylistVoiceWeights;
	className?: string;
}

// Two-state framing: with songs vs without songs. Users don't experience their
// playlist as four matcher buckets — they experience "empty" or "growing".
function copyFor(weights: PlaylistVoiceWeights) {
	if (weights.state === "cold-start") {
		return {
			before: "No songs yet, so new ones will find their way here by what you ",
			italic: "wrote",
			after: ".",
		};
	}
	return {
		before: "New songs find their way here by what you ",
		italic: "wrote",
		after: ".",
	};
}

export function PlaylistVoices({
	playlist,
	weights: weightsProp,
	className,
}: PlaylistVoicesProps) {
	const derived = usePlaylistVoices(
		playlist ?? { songCount: 0, hasDescription: false },
	);
	const weights = weightsProp ?? derived;
	const [isHelpOpen, setIsHelpOpen] = useState(false);

	// PlaylistDescription's empty-state CTA already invites the user; layering a
	// second indicator on top of an absent description doubles the noise.
	if (!weights.hasDescription) return null;

	const copy = copyFor(weights);

	return (
		<>
			<span
				className={`theme-text-muted inline-flex items-center gap-2 text-xs leading-relaxed text-pretty ${className ?? ""}`}
				style={{ fontFamily: fonts.body }}
			>
				<PulseDot />
				<span>
					{copy.before}
					<em style={{ fontFamily: fonts.display, fontStyle: "italic" }}>
						{copy.italic}
					</em>
					{copy.after}
				</span>
				<HelpButton onClick={() => setIsHelpOpen(true)} />
			</span>
			{isHelpOpen && (
				<DescriptionRoleDialog onClose={() => setIsHelpOpen(false)} />
			)}
		</>
	);
}

function PulseDot() {
	return (
		<span aria-hidden="true" className="relative inline-flex size-2">
			<span className="theme-primary-bg absolute inset-0 rounded-full opacity-70" />
			<span className="theme-primary-bg absolute inset-0 rounded-full opacity-40 motion-safe:animate-ping motion-reduce:hidden" />
		</span>
	);
}

// 44px hit area for the info trigger, achieved via negative-margin padding
// around a small icon. Keyboard-focusable; opens the role dialog on click
// or Enter/Space.
function HelpButton({ onClick }: { onClick: () => void }) {
	return (
		<button
			type="button"
			onClick={onClick}
			aria-label="Learn how songs find their way here"
			className="theme-text-muted -m-2 inline-flex size-9 cursor-pointer items-center justify-center align-middle transition-colors duration-150 hover:text-(--t-text) focus-visible:text-(--t-text)"
			style={{ fontFamily: fonts.body }}
		>
			<InfoIcon
				aria-hidden="true"
				size={14}
				weight="regular"
				className="shrink-0"
			/>
		</button>
	);
}
