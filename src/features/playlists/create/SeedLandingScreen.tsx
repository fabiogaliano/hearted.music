/**
 * SeedLandingScreen — beat 1 of creation, the route body for /playlists/new.
 *
 * The entrance owns no draft state: SeedStage hands back a chosen preset (or
 * null for "own words" / "from scratch") plus the typed intent, and this screen
 * turns that into a navigation into the studio, carrying the seed in router
 * history state (studioSeed.ts) so the studio URL stays clean. The two beats are
 * now distinct routes, so "up a level" is a real route hop — SeedStage's back
 * link and the studio's point at the same /playlists.
 *
 * Intent is only carried when the account is eligible, reproducing the original
 * single-screen handleSeed invariant at the point the seed is committed.
 */

import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { UpgradeDialog } from "@/features/billing/components/UpgradeDialog";
import type { BillingState } from "@/lib/domains/billing/state";
import { intentEligibilityQueryOptions } from "./intentEligibility";
import { SeedStage } from "./seed/SeedStage";
import type { PresetVM } from "./seedTypes";
import { buildStudioSeed } from "./studioSeed";

interface SeedLandingScreenProps {
	billingState: BillingState;
}

export function SeedLandingScreen({ billingState }: SeedLandingScreenProps) {
	const navigate = useNavigate();
	const [showPaywall, setShowPaywall] = useState(false);

	// Cache-synchronous on first paint (loader-ensured). The gate only decides
	// whether a typed intent survives into the studio — templates are structured
	// and never carry intent, so they're unaffected.
	const { data: intentGate } = useQuery(intentEligibilityQueryOptions());
	const isIntentEligible = intentGate?.allowed ?? false;

	const handleSeed = useCallback(
		(preset: PresetVM | null, intentText: string) => {
			const carriedIntent = isIntentEligible ? intentText : "";
			const studioSeed = buildStudioSeed(preset, carriedIntent);
			// Updater form preserves the router's own internal history-state keys.
			void navigate({
				to: "/playlists/new/studio",
				state: (prev) => ({ ...prev, studioSeed }),
			});
		},
		[navigate, isIntentEligible],
	);

	return (
		<>
			<SeedStage
				onSeed={handleSeed}
				onUnlock={() => setShowPaywall(true)}
				onBack={() => void navigate({ to: "/playlists" })}
			/>
			{showPaywall && (
				<UpgradeDialog
					billingState={billingState}
					onClose={() => setShowPaywall(false)}
				/>
			)}
		</>
	);
}
