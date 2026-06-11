/**
 * Soft, non-blocking pre-warning shown near the auth CTA on /login and / when
 * the current browser can't run our extension. Primes the cost before the user
 * pays it, so the later capability wall reads as expected, not bait-and-switch.
 *
 * Deliberately not a hard block: we never gate signup on it — the user can sign
 * up here and finish on a computer (progress is saved server-side). Detection is
 * client-side (see SetupOnComputerNoticeGate), reusing the same getEngineSupport
 * signal as the real wall — more accurate than a server UA, which can't see the
 * touch-points hint that distinguishes an iPad from a Mac.
 */

import { MonitorIcon } from "@phosphor-icons/react";
import { useOnboardingCapability } from "../hooks/useOnboardingCapability";

const MESSAGE =
	"heads up — first-time setup needs a computer with a supported browser. you can sign up here and finish on your laptop.";

/**
 * Renders the notice only on a browser that can't run our extension at all
 * (Safari / iOS / Android Chrome). Screen size is deliberately NOT a trigger:
 * a capable desktop in a narrow window shouldn't be told it "needs a computer."
 * Capable-but-small devices (Firefox Android, a ChromeOS tablet) get the real
 * handoff at the install step, so this hint stays free of that false positive.
 */
export function SetupOnComputerNoticeGate({
	className,
}: {
	className?: string;
}) {
	const { engineSupported } = useOnboardingCapability();
	if (engineSupported) return null;
	// Wrapper applied only when shown, so a capable visitor renders nothing at all
	// (no stray spacing where the notice would have been).
	return className ? (
		<div className={className}>
			<SetupOnComputerNotice />
		</div>
	) : (
		<SetupOnComputerNotice />
	);
}

export function SetupOnComputerNotice() {
	return (
		<div
			className="theme-border-color theme-text-muted flex items-start gap-2 rounded-lg border px-4 py-3 text-sm leading-relaxed"
			role="note"
		>
			<span className="flex h-[1lh] shrink-0 items-center">
				<MonitorIcon size={16} weight="regular" aria-hidden />
			</span>
			<p className="theme-text text-pretty">{MESSAGE}</p>
		</div>
	);
}
