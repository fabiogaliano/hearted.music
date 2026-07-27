import { useExtensionConnection } from "@/lib/extension/connection/useExtensionConnection";
import { fonts } from "@/lib/theme/fonts";

type Status = "checking" | "connected" | "not-found";

const PRIMARY_COPY: Record<Status, string> = {
	checking: "Looking for the extension…",
	connected: "Chrome extension is connected",
	"not-found": "Chrome extension not detected",
};

const SECONDARY_COPY: Record<Status, string> = {
	checking: "Just a moment.",
	connected: "Syncs your Spotify library to Hearted.",
	"not-found": "Install it to sync your Spotify library.",
};

const STATUS_LABEL: Record<Status, string> = {
	checking: "Checking",
	connected: "Connected",
	"not-found": "Not detected",
};

/**
 * Renders only the *contents* of the Connections row. The enclosing editorial
 * heading + microcopy live in SettingsPage's SettingsSection.
 *
 * Reads the shared connection query instead of checking once on mount — the
 * old version never re-checked, so installing the extension while this page
 * was open still showed "not detected" for the life of the page. Pre-link
 * (`useExtensionConnection(null)`, same reasoning as onboarding's
 * InstallExtensionStep): this row only reports install status, not identity,
 * so there is nothing gained by threading a linked Spotify id through it.
 */
export function ExtensionStatusRow() {
	const { verdict } = useExtensionConnection(null);
	// verdict.kind is checking | extension-missing | spotify-disconnected | ok
	// pre-link (mismatch/unpaired/unverifiable are unreachable with a null id
	// — see verdict.ts) — every non-missing, non-checking kind means the
	// extension answered PING, which is all this row reports (invariant 6: a
	// PING that answers but SPOTIFY_STATUS that doesn't is still installed).
	const status: Status =
		verdict.kind === "checking"
			? "checking"
			: verdict.kind === "extension-missing"
				? "not-found"
				: "connected";

	return (
		<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
			<div className="min-w-0">
				<p className="theme-text text-base" style={{ fontFamily: fonts.body }}>
					{PRIMARY_COPY[status]}
				</p>
				<p
					className="theme-text-muted mt-1.5 text-sm"
					style={{ fontFamily: fonts.body }}
				>
					{SECONDARY_COPY[status]}
				</p>
			</div>
			<span
				aria-live="polite"
				className="theme-text-muted flex shrink-0 items-center gap-2 pt-0.5 text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body }}
			>
				<span
					aria-hidden="true"
					className={`size-2 rounded-full transition-colors duration-200 ${
						status === "checking" ? "animate-pulse" : ""
					}`}
					style={{
						background: status === "connected" ? "#1DB954" : "var(--t-border)",
					}}
				/>
				{STATUS_LABEL[status]}
			</span>
		</div>
	);
}
