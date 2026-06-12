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

	// The writing surface's empty-state CTA already invites the user; layering a
	// second indicator on top of absent intent text doubles the noise.
	if (!weights.hasDescription) return null;

	return (
		<>
			<span
				className={`theme-text-muted inline-flex items-center gap-2 text-xs leading-relaxed text-pretty ${className ?? ""}`}
				style={{ fontFamily: fonts.body }}
			>
				<span>
					Set the vibe. New songs find their way here from what you write.
				</span>
				<HelpButton onClick={() => setIsHelpOpen(true)} />
			</span>
			{isHelpOpen && (
				<DescriptionRoleDialog onClose={() => setIsHelpOpen(false)} />
			)}
		</>
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
