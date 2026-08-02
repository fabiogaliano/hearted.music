import type { Story } from "@ladle/react";
import { MATCH_PREVIEWS, PLAYLISTS, RECENT_SONGS } from "./fixtures";
import { LikedSongsShelf as LikedSongsShelfComponent } from "./LikedSongsShelf";
import { Masthead as MastheadComponent } from "./Masthead";
import { MatchShelf as MatchShelfComponent } from "./MatchShelf";
import { PlaylistsShelf as PlaylistsShelfComponent } from "./PlaylistsShelf";
import { ProfileLink as ProfileLinkComponent } from "./ProfileLink";
import type { Destination, MastheadVariant } from "./types";

export default {
	title: "Dashboard/Explorations/Components",
};

const noop = () => {};

interface MastheadArgs {
	variant: MastheadVariant;
	active: Destination;
	matchCount: number;
	ambientBadge: boolean;
}

export const Masthead: Story<MastheadArgs> = ({
	variant,
	active,
	matchCount,
	ambientBadge,
}) => (
	<MastheadComponent
		variant={variant}
		active={active}
		matchCount={matchCount}
		ambientBadge={ambientBadge}
		handle="june"
		planLabel="Free plan"
		onNavigate={noop}
	/>
);
Masthead.args = {
	variant: "line",
	active: "liked-songs",
	matchCount: 7,
	ambientBadge: true,
};
Masthead.argTypes = {
	variant: { options: ["pure", "line"], control: { type: "select" } },
	active: {
		options: ["home", "match", "liked-songs", "playlists", "settings"],
		control: { type: "select" },
	},
	matchCount: { control: { type: "range", min: 0, max: 40, step: 1 } },
	ambientBadge: { control: { type: "boolean" } },
};

export const ProfileLink: Story<{ isActive: boolean }> = ({ isActive }) => (
	<div className="flex justify-end p-8">
		<ProfileLinkComponent
			handle="june"
			planLabel="Free plan"
			isActive={isActive}
			onOpen={noop}
		/>
	</div>
);
ProfileLink.args = { isActive: false };
ProfileLink.argTypes = {
	isActive: { control: { type: "boolean" } },
};

interface MatchShelfArgs {
	count: number;
	appearance: "plane" | "lit" | "ceramic";
}

export const MatchShelf: Story<MatchShelfArgs> = ({ count, appearance }) => (
	<div className="mx-auto max-w-5xl px-8 py-10">
		<MatchShelfComponent
			count={count}
			previews={MATCH_PREVIEWS.slice(0, Math.min(count, 3))}
			appearance={appearance}
			onOpen={noop}
		/>
	</div>
);
MatchShelf.args = { count: 7, appearance: "plane" };
MatchShelf.argTypes = {
	count: { control: { type: "range", min: 0, max: 40, step: 1 } },
	appearance: {
		options: ["plane", "lit", "ceramic"],
		control: { type: "select" },
	},
};

export const LikedSongsShelf: Story<{ count: number }> = ({ count }) => (
	<div className="mx-auto max-w-5xl px-8 py-10">
		<LikedSongsShelfComponent
			count={count}
			recent={RECENT_SONGS}
			onBrowse={noop}
			onOpenSong={noop}
		/>
	</div>
);
LikedSongsShelf.args = { count: 1204 };
LikedSongsShelf.argTypes = {
	count: { control: { type: "number" } },
};

export const PlaylistsShelf: Story<{ shown: number }> = ({ shown }) => (
	<div className="mx-auto max-w-5xl px-8 py-10">
		<PlaylistsShelfComponent
			count={18}
			playlists={PLAYLISTS.slice(0, shown)}
			onBrowse={noop}
			onOpenPlaylist={noop}
			onCreate={noop}
		/>
	</div>
);
PlaylistsShelf.args = { shown: 5 };
PlaylistsShelf.argTypes = {
	shown: { control: { type: "range", min: 0, max: 5, step: 1 } },
};
