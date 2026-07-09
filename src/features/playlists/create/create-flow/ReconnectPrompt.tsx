/**
 * ReconnectPrompt — inline affordance for the create touchpoint when
 * Spotify is disconnected. Uses the shared SpotifyReconnectLink so
 * the reconnect token-refresh flow works identically to other surfaces.
 *
 * entityKey scopes the reconnect-state hook to this draft session so
 * the polling auto-clears once the token is detected again.
 */

import { SpotifyReconnectLink } from "@/lib/extension/SpotifyReconnectLink";
import { fonts } from "@/lib/theme/fonts";

interface ReconnectPromptProps {
	entityKey: string;
}

export function ReconnectPrompt({
	entityKey: _entityKey,
}: ReconnectPromptProps) {
	return (
		<div
			className="flex items-center gap-4 px-6 py-5"
			role="status"
			aria-live="polite"
		>
			<p
				className="theme-text-muted text-xs"
				style={{ fontFamily: fonts.body }}
			>
				Spotify is disconnected — reconnect to create your playlist.
			</p>
			<SpotifyReconnectLink />
		</div>
	);
}
