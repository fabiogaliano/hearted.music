import { ArrowRightIcon } from "@phosphor-icons/react";
import { fonts } from "@/lib/theme/fonts";
import { FanSpreadAlbumArt } from "../FanSpreadAlbumArt";
import type { MatchPreviewVM } from "./types";

/** Material tier per composition (design-evolution): plane = baseline raised
 * card, lit = the paywall-tier lit plane, ceramic = lit + matte grain, sitting
 * flush (no bleed) so it aligns with sibling grain panels. */
type MatchShelfAppearance = "plane" | "lit" | "ceramic";

interface MatchShelfProps {
	count: number;
	previews: MatchPreviewVM[];
	appearance?: MatchShelfAppearance;
	onOpen: () => void;
}

const APPEARANCE_CLASSES: Record<MatchShelfAppearance, string> = {
	plane: "surface-raised surface-raised-hover -mx-4 w-[calc(100%+2rem)]",
	lit: "surface-raised surface-raised-lit -mx-4 w-[calc(100%+2rem)]",
	ceramic: "surface-raised surface-raised-lit ceramic-grain w-full",
};

/** The MatchReviewCTA recast as the hub's lead shelf. The headline carries the
 * sidebar badge's job: state + promise ("7 songs looking for homes"), not a
 * section name. */
export function MatchShelf({
	count,
	previews,
	appearance = "plane",
	onOpen,
}: MatchShelfProps) {
	if (count === 0) {
		return (
			<p
				className="theme-text-muted text-sm"
				style={{ fontFamily: fonts.body }}
			>
				Your songs have found their{" "}
				<em style={{ fontFamily: fonts.display }}>home</em>.
			</p>
		);
	}

	return (
		<button
			type="button"
			onClick={onOpen}
			className={`${APPEARANCE_CLASSES[appearance]} squircle focus-edge group block rounded-[14px] px-4 py-6 text-left motion-safe:active:scale-[0.99]`}
		>
			<p
				className="theme-text-muted mb-2 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Ready to match
			</p>
			<div className="flex items-center justify-between gap-6">
				<h3
					className="theme-text text-3xl font-extralight text-balance"
					style={{ fontFamily: fonts.display }}
				>
					{count} {count === 1 ? "song" : "songs"} looking for{" "}
					{count === 1 ? "a home" : "homes"}
				</h3>
				<div className="flex items-center gap-8">
					<FanSpreadAlbumArt images={previews} />
					<span
						className="theme-text-muted inline-flex items-center gap-1.5 text-sm transition-transform duration-200 ease-out motion-safe:group-hover:translate-x-1"
						style={{ fontFamily: fonts.body }}
					>
						Start
						<ArrowRightIcon size={14} weight="regular" />
					</span>
				</div>
			</div>
		</button>
	);
}
