/**
 * CreatePlaylistScreen — the page shell for /playlists/new.
 *
 * Lays out the four regions of the creation flow with intentional
 * hearted-style spacing and typography. T5 (config surface), T6 (preview
 * list + suggestions tray), and T7 (create flow) are rendered as labelled
 * thin placeholders so subsequent tasks can address each piece by name.
 *
 * The screen is deliberately calm — no loaders in the shell itself; the
 * useCreatePlaylistDraft hook drives per-region loading state.
 */

import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
	getBrowserTarget,
	getExtensionStoreUrl,
} from "@/lib/extension/browser-target";
import {
	getSpotifyConnectionStatus,
	isExtensionInstalled,
} from "@/lib/extension/detect";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { fonts } from "@/lib/theme/fonts";
import { MaxSongsSlider } from "./MaxSongsSlider";
import { ConfigRegionPlaceholder } from "./placeholders/ConfigRegionPlaceholder";
import { CreateBarPlaceholder } from "./placeholders/CreateBarPlaceholder";
import { PreviewRegionPlaceholder } from "./placeholders/PreviewRegionPlaceholder";
import { SuggestionsRegionPlaceholder } from "./placeholders/SuggestionsRegionPlaceholder";
import { useCreatePlaylistDraft } from "./useCreatePlaylistDraft";

type SpotifyGateState =
	| "checking"
	| "ok"
	| "extension-unavailable"
	| "reconnect-required";

export function CreatePlaylistScreen() {
	const navigate = useNavigate();
	const draft = useCreatePlaylistDraft();

	// Proactively surface the reconnect/install affordance at page load so the
	// user knows about a disconnected Spotify session before attempting to create.
	// T7 will also check gate state at the create touchpoint — this is just the
	// early-awareness check scoped to the shell header.
	const [gateState, setGateState] = useState<SpotifyGateState>("checking");

	useEffect(() => {
		let cancelled = false;
		async function checkGate() {
			const installed = await isExtensionInstalled();
			if (cancelled) return;
			if (!installed) {
				setGateState("extension-unavailable");
				return;
			}
			const connected = await getSpotifyConnectionStatus();
			if (cancelled) return;
			setGateState(connected ? "ok" : "reconnect-required");
		}
		void checkGate();
		return () => {
			cancelled = true;
		};
	}, []);

	return (
		<div className="mx-auto max-w-[1180px] pb-24">
			<header className="mb-10 flex items-start justify-between gap-6">
				<div className="flex flex-col gap-1">
					<button
						type="button"
						onClick={() => void navigate({ to: "/playlists" })}
						className="theme-text-muted -ml-0.5 mb-3 inline-flex cursor-pointer items-center gap-1.5 text-[11px] tracking-widest uppercase transition-opacity duration-150 hover:opacity-70"
						style={{ fontFamily: fonts.body }}
					>
						<ArrowLeftIcon size={11} weight="regular" aria-hidden />
						Playlists
					</button>
					<h1
						className="theme-text text-page-title leading-[0.95] font-extralight tracking-tight text-balance"
						style={{ fontFamily: fonts.display }}
					>
						New playlist
					</h1>
				</div>

				{gateState === "extension-unavailable" && (
					<div className="flex items-center gap-3 pt-1">
						<span
							className="theme-text-muted text-xs"
							style={{ fontFamily: fonts.body }}
						>
							Extension not detected
						</span>
						<a
							href={getExtensionStoreUrl(getBrowserTarget())}
							target="_blank"
							rel="noopener noreferrer"
							className="hover-border-brighten inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-3 py-1.5 text-xs tracking-widest uppercase active:scale-[0.98]"
							style={{ fontFamily: fonts.body }}
						>
							Install extension
							<span className="text-xs" style={{ opacity: 0.45 }}>
								↗
							</span>
						</a>
					</div>
				)}

				{gateState === "reconnect-required" && (
					<div className="flex items-center gap-3 pt-1">
						<span
							className="theme-text-muted text-xs"
							style={{ fontFamily: fonts.body }}
						>
							Spotify disconnected
						</span>
						<SpotifyReconnectLink />
					</div>
				)}
			</header>

			{/* CONFIG REGION — MaxSongsSlider is live; genre pills, filters, and
			    intent are seams for T5. */}
			<section className="mb-10">
				<div className="mb-6 flex items-center gap-4 px-1">
					<span
						className="theme-text-muted text-xs tracking-[0.2em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Configure
					</span>
					<div className="theme-border-color h-px flex-1 border-t" />
				</div>

				<div className="grid grid-cols-[1fr_280px] gap-10">
					{/* Left: T5 will fill genre pills + intent editor + filters here. */}
					<ConfigRegionPlaceholder />

					{/* Right: MaxSongsSlider — live and fully functional. */}
					<div className="flex flex-col gap-2">
						<MaxSongsSlider
							value={draft.config.maxSongs}
							onChange={draft.setMaxSongs}
						/>
					</div>
				</div>
			</section>

			{/* PREVIEW REGION — seam for T6 */}
			<section className="mb-10">
				<div className="mb-6 flex items-center justify-between gap-4 px-1">
					<div className="flex items-center gap-4">
						<span
							className="theme-text-muted text-xs tracking-[0.2em] uppercase"
							style={{ fontFamily: fonts.body }}
						>
							Preview
						</span>
						<div className="theme-border-color h-px w-20 border-t" />
						{draft.totalEligible > 0 && (
							<span
								className="theme-text-muted text-xs tabular-nums"
								style={{ fontFamily: fonts.body }}
							>
								{draft.preview.length} of {draft.totalEligible} eligible
							</span>
						)}
					</div>
					{draft.isLoading && (
						<span
							className="theme-text-muted text-[11px] tracking-widest uppercase"
							style={{ fontFamily: fonts.body }}
						>
							Updating…
						</span>
					)}
				</div>
				<PreviewRegionPlaceholder
					preview={draft.preview}
					isLoading={draft.isLoading}
					onRemoveSong={draft.removeSong}
				/>
			</section>

			{/* SUGGESTIONS REGION — seam for T6 */}
			<section className="mb-10">
				<div className="mb-6 flex items-center gap-4 px-1">
					<span
						className="theme-text-muted text-xs tracking-[0.2em] uppercase"
						style={{ fontFamily: fonts.body }}
					>
						Suggested to add
					</span>
					<div className="theme-border-color h-px flex-1 border-t" />
				</div>
				<SuggestionsRegionPlaceholder
					suggestions={draft.suggestions}
					onAddSong={draft.addSong}
				/>
			</section>

			{/* CREATE BAR — seam for T7 */}
			<CreateBarPlaceholder
				previewCount={draft.preview.length}
				intentApplied={draft.intentApplied}
			/>
		</div>
	);
}
