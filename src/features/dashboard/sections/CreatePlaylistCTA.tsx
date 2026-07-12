/**
 * Standing invitation to /playlists/new — creation's most prominent surface.
 * Bordered (not filled) so the conditional MatchReviewCTA above it stays the
 * louder moment when both render.
 */
import { ArrowRightIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { fonts } from "@/lib/theme/fonts";

export function CreatePlaylistCTA() {
	return (
		<Link
			to="/playlists/new"
			className="theme-border-color hover-border-brighten group -mx-4 mb-10 block border px-4 py-6 transition-[transform,background-color,opacity] duration-200 ease-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:[outline-color:var(--t-primary)] motion-safe:active:scale-[0.99]"
		>
			<p
				className="theme-text-muted mb-2 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				From your liked songs
			</p>
			<div className="flex items-center justify-between gap-6">
				<h3
					className="theme-text text-3xl font-extralight text-balance"
					style={{ fontFamily: fonts.display }}
				>
					Create a playlist
				</h3>
				<span
					className="theme-text-muted inline-flex items-center gap-1.5 text-sm transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
					style={{ fontFamily: fonts.body }}
				>
					Start
					<ArrowRightIcon size={14} weight="regular" />
				</span>
			</div>
		</Link>
	);
}
