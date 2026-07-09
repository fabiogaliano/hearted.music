/**
 * ExtensionUnavailablePrompt — shown at the create touchpoint when the
 * browser extension isn't installed. Matches the install-extension
 * affordance pattern already in the CreatePlaylistScreen header so the
 * two occurrences feel consistent.
 */

import {
	getBrowserTarget,
	getExtensionStoreUrl,
} from "@/lib/extension/browser-target";
import { fonts } from "@/lib/theme/fonts";

export function ExtensionUnavailablePrompt() {
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
				Install the browser extension to create playlists from hearted.
			</p>
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
	);
}
