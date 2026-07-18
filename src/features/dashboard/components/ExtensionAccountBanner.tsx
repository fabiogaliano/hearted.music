/**
 * Proactive account-conflict banner for the dashboard.
 *
 * Surfaces the two states useExtensionAccountConflict detects before the user
 * hits a failing sync: the browser's Spotify session not matching the linked
 * library account, and a popup-side hearted disconnect. Renders nothing when
 * accounts agree, so it costs the layout nothing in the healthy path.
 *
 * Split view/container so Ladle can drive every state without the extension:
 * ExtensionAccountBannerView is pure props, ExtensionAccountBanner owns the
 * polling hook + re-pairing action.
 */
import { useState } from "react";
import { pairExtension } from "@/lib/extension/connect";
import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import {
	type ExtensionAccountConflict,
	useExtensionAccountConflict,
} from "@/lib/extension/useExtensionAccountConflict";
import { fonts } from "@/lib/theme/fonts";

interface ExtensionAccountBannerViewProps {
	conflict: ExtensionAccountConflict;
	/** Display name of the hearted account's linked Spotify identity, for the
	 * "this library belongs to…" half of the mismatch copy. */
	accountDisplayName: string | null;
	repairing: boolean;
	onReconnect: () => void;
}

export function ExtensionAccountBannerView({
	conflict,
	accountDisplayName,
	repairing,
	onReconnect,
}: ExtensionAccountBannerViewProps) {
	return (
		<div
			role="status"
			aria-live="polite"
			className="theme-surface-bg theme-border-color -mx-4 mb-10 border border-l-2 px-4 py-4"
			style={{ borderLeftColor: "var(--t-primary)" }}
		>
			<p
				className="theme-text-muted mb-1 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				Account check
			</p>
			{conflict.kind === "spotify-mismatch" ? (
				<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
					<p
						className="theme-text text-sm text-balance"
						style={{ fontFamily: fonts.body }}
					>
						Your browser is signed in to Spotify as{" "}
						<strong className="font-medium">
							{conflict.extensionProfile.displayName}
						</strong>
						{accountDisplayName ? (
							<>
								, but this library belongs to{" "}
								<strong className="font-medium">{accountDisplayName}</strong>
							</>
						) : (
							", which isn't the account this library was built from"
						)}
						. Syncing is paused until they match.
					</p>
					<SpotifyReconnectLink label="Switch Spotify account" />
				</div>
			) : (
				<div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
					<p
						className="theme-text text-sm text-balance"
						style={{ fontFamily: fonts.body }}
					>
						The extension is no longer connected to your hearted account, so
						syncing is paused.
					</p>
					<button
						type="button"
						onClick={onReconnect}
						disabled={repairing}
						className="hover-border-brighten inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs tracking-widest whitespace-nowrap uppercase active:scale-[0.98] disabled:opacity-50"
						style={{ fontFamily: fonts.body }}
					>
						{repairing ? "Reconnecting…" : "Reconnect"}
					</button>
				</div>
			)}
		</div>
	);
}

interface ExtensionAccountBannerProps {
	linkedSpotifyId: string | null;
	accountDisplayName: string | null;
}

export function ExtensionAccountBanner({
	linkedSpotifyId,
	accountDisplayName,
}: ExtensionAccountBannerProps) {
	const { conflict, recheck } = useExtensionAccountConflict(linkedSpotifyId);
	const [repairing, setRepairing] = useState(false);

	if (conflict === null) return null;

	const onReconnect = async () => {
		setRepairing(true);
		try {
			await pairExtension();
		} finally {
			setRepairing(false);
			recheck();
		}
	};

	return (
		<ExtensionAccountBannerView
			conflict={conflict}
			accountDisplayName={accountDisplayName}
			repairing={repairing}
			onReconnect={() => void onReconnect()}
		/>
	);
}
