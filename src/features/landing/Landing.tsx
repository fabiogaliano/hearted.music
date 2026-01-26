/**
 * HEARTED - Unified Landing Page
 *
 * Structure:
 * 1. Hero (100vh): True 50/50 split - copy left, full-height panel right with artist image
 * 2. Matching: Shows the playlist matching proposition
 * 3. CTA: Simple close with login/waitlist
 *
 * Voice: Curious friend — warm, observant, confident, playful
 *
 * Modes:
 * - Released (default): Shows "Login with Spotify" for live product
 * - Pre-release: Shows waitlist email input for launch prep
 */
import { useState } from 'react'

import { playlists, songs } from '@/lib/data/mock-data'
import { useAlbumArt } from '@/lib/hooks/useAlbumArt'
import { useArtistImage } from '@/lib/hooks/useArtistImage'
import { type ThemeConfig } from '@/lib/theme/types'
import { fonts } from '@/lib/theme/fonts'
import { MatchesSection } from '@/features/matching/components/MatchesSection'
import { SongSection } from '@/features/matching/components/SongSection'
import { LandingHero } from './components/LandingHero'
import { SpotifyLoginButton } from './components/SpotifyLoginButton'
import { WaitlistInput } from './components/WaitlistInput'

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface LandingProps {
	theme: ThemeConfig
	/** Index of song to feature (default 0, can be randomized server-side) */
	featuredSongIndex?: number
	/** Release mode - true for login, false for waitlist (controlled from PrototypeWrapper) */
	isReleased?: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────

export function Landing({
	theme,
	featuredSongIndex = 0,
	isReleased = true,
}: LandingProps) {
	// Hero song selection state
	const [selectedSongIndex, setSelectedSongIndex] = useState(featuredSongIndex)
	const featuredSong = songs[selectedSongIndex] || songs[0]
	const { getAlbumArt, isLoading } = useAlbumArt()
	const albumArtUrl = getAlbumArt(featuredSong.spotifyTrackId, 300)
	const { artistImageUrl } = useArtistImage(featuredSong.spotifyTrackId)

	// Preview song for Section 2 - separate state so it can cycle independently
	const [previewSongIndex, setPreviewSongIndex] = useState(2) // Start with Frank Ocean
	const previewSong = songs[previewSongIndex] || songs[0]

	// Navigation handlers for hero
	const handlePrev = () => {
		setSelectedSongIndex(selectedSongIndex > 0 ? selectedSongIndex - 1 : songs.length - 1)
	}
	const handleNext = () => {
		setSelectedSongIndex(selectedSongIndex < songs.length - 1 ? selectedSongIndex + 1 : 0)
	}

	// Navigation handlers for Section 2 preview
	const handlePreviewNext = () => {
		setPreviewSongIndex(previewSongIndex < songs.length - 1 ? previewSongIndex + 1 : 0)
	}
	const handlePreviewDiscard = () => {
		// Discard behaves the same as next for the preview
		handlePreviewNext()
	}

	return (
		<div
			data-landing-scroll-root
			className="h-screen snap-y snap-proximity overflow-y-auto overscroll-none"
			style={{ fontFamily: fonts.body, background: theme.bg }}
		>
			{/* ───────────────────────────────────────────────────────────────────
			    SECTION 1: HERO (100vh) - Cinematic Morph Reveal
			    ─────────────────────────────────────────────────────────────────── */}
			<LandingHero
				theme={theme}
				featuredSong={featuredSong}
				albumArtUrl={albumArtUrl}
				artistImageUrl={artistImageUrl}
				isLoading={isLoading}
				onPrev={handlePrev}
				onNext={handleNext}
				isReleased={isReleased}
			/>

			{/* ───────────────────────────────────────────────────────────────────
			    SECTION 2: MATCHING PROPOSITION (Full viewport height)
			    Uses real matching UI components for 1:1 preview
			    ─────────────────────────────────────────────────────────────────── */}
			<section
				className="flex min-h-screen snap-start snap-always items-center px-8 lg:px-16"
				style={{ background: theme.surface }}
			>
				<div className="mx-auto w-full max-w-7xl py-16 lg:py-24">
					{/* Section intro copy */}
					<div className="mb-12 max-w-2xl">
						<p className="mb-4 text-lg" style={{ color: theme.textMuted }}>
							It found you. You kept it.
						</p>
						<h3
							className="text-3xl leading-tight font-extralight md:text-4xl lg:text-5xl"
							style={{ fontFamily: fonts.display, color: theme.text }}
						>
							See where it <span className="italic">could land.</span>
						</h3>
					</div>

					{/* UI Preview Container — clean frame for the matching interface */}
					<div
						className="rounded-sm p-6 lg:p-8"
						style={{
							background: theme.bg,
							border: `1px solid ${theme.border}`,
							boxShadow: `0 1px 3px ${theme.text}08, 0 4px 12px ${theme.text}04`,
						}}
					>
						<div className="grid gap-10 lg:grid-cols-[1.1fr_1fr]">
							<SongSection
								song={previewSong}
								theme={theme}
								isExpanded={false}
								metaVisible={true}
								albumArtUrl={getAlbumArt(previewSong.spotifyTrackId, 640)}
								isLoading={isLoading}
							/>
							<MatchesSection
								playlists={playlists.slice(0, 3)} // Top 3 matches — fits without scroll
								theme={theme}
								addedTo={[]} // Fresh state for each song
								onAdd={() => {}} // No-op for preview (would need more state to track)
								onDiscard={handlePreviewDiscard}
								onNext={handlePreviewNext}
								isExpanded={false}
							/>
						</div>
					</div>
				</div>
			</section>

			{/* ───────────────────────────────────────────────────────────────────
			    SECTION 3: SIMPLE CTA
			    ─────────────────────────────────────────────────────────────────── */}
			<section className="flex flex-col items-center justify-center px-8 py-24 lg:px-16 lg:py-32">
				<p className="mb-4 text-lg" style={{ color: theme.textMuted }}>
					Your songs have been trying to tell you something.
				</p>
				<h3
					className="text-3xl font-extralight md:text-4xl lg:text-5xl"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					What do they <span className="italic">say about you?</span>
				</h3>
				<div className="mt-10 flex justify-center">
					{isReleased ?
						<SpotifyLoginButton theme={theme} />
					:	<WaitlistInput theme={theme} />}
				</div>
			</section>

			{/* ───────────────────────────────────────────────────────────────────
			    FOOTER
			    ─────────────────────────────────────────────────────────────────── */}
			<footer
				className="px-8 py-8 text-center text-sm lg:px-16"
				style={{ borderTop: `1px solid ${theme.border}`, color: theme.textMuted }}
			>
				<p>
					<a
						href="/prototypes/warm-pastel/faq"
						className="underline-offset-2 hover:underline"
					>
						FAQ
					</a>
					{' · '}
					<a
						href="/prototypes/warm-pastel/privacy"
						className="underline-offset-2 hover:underline"
					>
						Privacy
					</a>
					{' · '}
					<a
						href="/prototypes/warm-pastel/terms"
						className="underline-offset-2 hover:underline"
					>
						Terms
					</a>
				</p>
				<p
					className="mt-2 opacity-60"
					style={{ fontFamily: fonts.display, fontWeight: 300 }}
				>
					hearted. by{' '}
					<a
						href="https://fabiogaliano.com"
						target="_blank"
						rel="noopener noreferrer"
						className="underline-offset-2 hover:underline"
					>
						fábio galiano
					</a>
				</p>
			</footer>
		</div>
	)
}

export default Landing
