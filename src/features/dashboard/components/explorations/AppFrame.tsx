import type { ComponentType } from "react";
import { useState } from "react";
import { FrontPage } from "./FrontPage";
import { FrontPageCeramic } from "./FrontPageCeramic";
import { FrontPageEditorial } from "./FrontPageEditorial";
import { FrontPageGallery } from "./FrontPageGallery";
import { Masthead } from "./Masthead";
import { SpokePage } from "./SpokePage";
import type {
	Destination,
	FrontPageComposition,
	FrontPageProps,
	HubData,
	MastheadVariant,
} from "./types";

interface AppFrameProps {
	mastheadVariant: MastheadVariant;
	composition: FrontPageComposition;
	ambientBadge?: boolean;
	data: HubData;
}

const FRONT_PAGES: Record<
	FrontPageComposition,
	ComponentType<FrontPageProps>
> = {
	stack: FrontPage,
	editorial: FrontPageEditorial,
	gallery: FrontPageGallery,
	ceramic: FrontPageCeramic,
};

const BACK_LABELS: Record<Exclude<Destination, "home">, string> = {
	match: "Match",
	"liked-songs": "Liked Songs",
	playlists: "Playlists",
	settings: "Settings",
};

/** Working navigation simulator for the sidebar-less shell — the thing being
 * evaluated is the wayfinding loop, so clicks really navigate. Owns location
 * the way the router would. */
export function AppFrame({
	mastheadVariant,
	composition,
	ambientBadge = false,
	data,
}: AppFrameProps) {
	const [location, setLocation] = useState<Destination>("home");
	const [cameFrom, setCameFrom] = useState<Destination | null>(null);

	const navigate = (destination: Destination) => {
		if (destination === location) return;
		setCameFrom(location);
		setLocation(destination);
	};

	// Spoke→spoke arrivals get a labeled trail back; hub arrivals rely on the
	// wordmark, matching the vision doc's generalized "Back to {parent}" rule.
	const backTo =
		location !== "home" &&
		cameFrom &&
		cameFrom !== "home" &&
		cameFrom !== location
			? { label: BACK_LABELS[cameFrom], onClick: () => navigate(cameFrom) }
			: undefined;

	const FrontPageComponent = FRONT_PAGES[composition];

	// Home is chrome-free: each composition carries its own brand header. The
	// masthead band only exists on spokes, as the way back.
	return (
		<div className="theme-bg min-h-screen">
			{location === "home" ? (
				<FrontPageComponent data={data} onNavigate={navigate} />
			) : (
				<>
					<Masthead
						variant={mastheadVariant}
						active={location}
						matchCount={data.matchCount}
						ambientBadge={ambientBadge}
						handle={data.handle}
						planLabel={data.planLabel}
						onNavigate={navigate}
					/>
					<SpokePage
						destination={location}
						matchCount={data.matchCount}
						backTo={backTo}
					/>
				</>
			)}
		</div>
	);
}
