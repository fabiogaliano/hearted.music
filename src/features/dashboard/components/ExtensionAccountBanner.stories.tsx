import type { Story } from "@ladle/react";
import type { ReactNode } from "react";
import type { ExtensionAccountConflict } from "@/lib/extension/useExtensionAccountConflict";
import { ExtensionAccountBannerView } from "./ExtensionAccountBanner";

export default {
	title: "Dashboard/ExtensionAccountBanner",
};

const noop = () => {};

// Sit the banner in the dashboard's max-w-5xl column so the -mx-4 full-bleed
// edges and text wrapping are judged at the width it actually ships in, across
// all four theme hues.
function DashboardContext({ children }: { children: ReactNode }) {
	return (
		<div style={{ padding: 48 }}>
			<div className="mx-auto max-w-5xl px-4">{children}</div>
		</div>
	);
}

const MISMATCH: ExtensionAccountConflict = {
	kind: "spotify-mismatch",
	extensionProfile: {
		spotifyId: "spotify-user-other",
		displayName: "alex@work",
		avatarUrl: null,
	},
};

const UNPAIRED: ExtensionAccountConflict = { kind: "unpaired" };

// The Spotify session in the browser belongs to a different account than the
// one this library was built from — the headline conflict.
export const SpotifyMismatch: Story = () => (
	<DashboardContext>
		<ExtensionAccountBannerView
			conflict={MISMATCH}
			accountDisplayName="fabio"
			repairing={false}
			onReconnect={noop}
		/>
	</DashboardContext>
);

// Same mismatch, but the account's linked Spotify display name is unknown
// (pre-backfill), so the copy falls back to the generic phrasing.
export const SpotifyMismatchUnknownAccount: Story = () => (
	<DashboardContext>
		<ExtensionAccountBannerView
			conflict={MISMATCH}
			accountDisplayName={null}
			repairing={false}
			onReconnect={noop}
		/>
	</DashboardContext>
);

// The extension lost its hearted pairing (e.g. disconnected from the popup).
export const Unpaired: Story = () => (
	<DashboardContext>
		<ExtensionAccountBannerView
			conflict={UNPAIRED}
			accountDisplayName="fabio"
			repairing={false}
			onReconnect={noop}
		/>
	</DashboardContext>
);

// Unpaired banner mid-reconnect: the Reconnect button shows its pending label.
export const UnpairedReconnecting: Story = () => (
	<DashboardContext>
		<ExtensionAccountBannerView
			conflict={UNPAIRED}
			accountDisplayName="fabio"
			repairing={true}
			onReconnect={noop}
		/>
	</DashboardContext>
);

// Single interactive story: toggle conflict kind + repairing from the Controls
// panel to compare states without switching stories.
type PlaygroundProps = {
	kind: "spotify-mismatch" | "unpaired";
	extensionDisplayName: string;
	accountDisplayName: string;
	repairing: boolean;
};

export const Playground: Story<PlaygroundProps> = ({
	kind,
	extensionDisplayName,
	accountDisplayName,
	repairing,
}) => {
	const conflict: ExtensionAccountConflict =
		kind === "spotify-mismatch"
			? {
					kind: "spotify-mismatch",
					extensionProfile: {
						spotifyId: "spotify-user-other",
						displayName: extensionDisplayName,
						avatarUrl: null,
					},
				}
			: { kind: "unpaired" };
	return (
		<DashboardContext>
			<ExtensionAccountBannerView
				conflict={conflict}
				accountDisplayName={accountDisplayName || null}
				repairing={repairing}
				onReconnect={noop}
			/>
		</DashboardContext>
	);
};

Playground.args = {
	kind: "spotify-mismatch",
	extensionDisplayName: "alex@work",
	accountDisplayName: "fabio",
	repairing: false,
};

Playground.argTypes = {
	kind: {
		options: ["spotify-mismatch", "unpaired"],
		control: { type: "radio" },
	},
	extensionDisplayName: { control: { type: "text" } },
	accountDisplayName: { control: { type: "text" } },
	repairing: { control: { type: "boolean" } },
};
