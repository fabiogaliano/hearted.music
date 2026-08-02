import type { Story } from "@ladle/react";
import { AppFrame as AppFrameComponent } from "./AppFrame";
import { FrontPage } from "./FrontPage";
import { FrontPageCeramic } from "./FrontPageCeramic";
import { FrontPageEditorial } from "./FrontPageEditorial";
import { FrontPageGallery } from "./FrontPageGallery";
import { makeHubData } from "./fixtures";
import type { FrontPageComposition, MastheadVariant } from "./types";

export default {
	title: "Dashboard/Explorations/Composable",
};

const noop = () => {};

interface AppFrameArgs {
	masthead: MastheadVariant;
	composition: FrontPageComposition;
	ambientBadge: boolean;
	matchCount: number;
}

/** The full sidebar-less shell as a working navigation simulator: click a
 * shelf to reach its spoke, the wordmark to come home, the profile strip for
 * settings. `masthead` toggles Sketch A (pure) vs Sketch B (nav line);
 * `composition` swaps the hub layout direction. */
export const AppFrame: Story<AppFrameArgs> = ({
	masthead,
	composition,
	ambientBadge,
	matchCount,
}) => (
	<AppFrameComponent
		mastheadVariant={masthead}
		composition={composition}
		ambientBadge={ambientBadge}
		data={makeHubData(matchCount)}
	/>
);
AppFrame.args = {
	masthead: "pure",
	composition: "stack",
	ambientBadge: true,
	matchCount: 7,
};
AppFrame.argTypes = {
	masthead: { options: ["pure", "line"], control: { type: "select" } },
	composition: {
		options: ["stack", "editorial", "gallery", "ceramic"],
		control: { type: "select" },
	},
	ambientBadge: { control: { type: "boolean" } },
	matchCount: { control: { type: "range", min: 0, max: 40, step: 1 } },
};
AppFrame.meta = {
	description:
		"Sketch A (pure) vs Sketch B (line) from docs/tmp/sidebar-less-navigation-vision.md. Try: shelf → spoke → wordmark home; profile → settings from a spoke shows the labeled back-trail.",
};

const compositionArgs = {
	matchCount: { control: { type: "range", min: 0, max: 40, step: 1 } },
} as const;

/** Baseline stack — shelves in a single column, match lead on the plane tier. */
export const Stack: Story<{ matchCount: number }> = ({ matchCount }) => (
	<FrontPage data={makeHubData(matchCount)} onNavigate={noop} />
);
Stack.args = { matchCount: 7 };
Stack.argTypes = compositionArgs;

/** Two-column magazine — match as typographic lead story, library as rail. */
export const Editorial: Story<{ matchCount: number }> = ({ matchCount }) => (
	<FrontPageEditorial data={makeHubData(matchCount)} onNavigate={noop} />
);
Editorial.args = { matchCount: 7 };
Editorial.argTypes = compositionArgs;

/** Art-dominant — lit match banner, playlists hung as a full cover wall. */
export const Gallery: Story<{ matchCount: number }> = ({ matchCount }) => (
	<FrontPageGallery data={makeHubData(matchCount)} onNavigate={noop} />
);
Gallery.args = { matchCount: 7 };
Gallery.argTypes = compositionArgs;

/** Warm tactile materiality — every shelf on a grain plane, match on lit. */
export const Ceramic: Story<{ matchCount: number }> = ({ matchCount }) => (
	<FrontPageCeramic data={makeHubData(matchCount)} onNavigate={noop} />
);
Ceramic.args = { matchCount: 7 };
Ceramic.argTypes = compositionArgs;
