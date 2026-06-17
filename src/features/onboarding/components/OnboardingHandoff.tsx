/**
 * Handoff view for the install-extension step when the current device can't run
 * our extension here — whether the browser can't run it at all (Safari / iOS /
 * Android Chrome) or the viewport is too small for the wizard (Firefox Android,
 * a ChromeOS tablet). The message is the same in every case, because the real
 * constraint is always the extension, never screen size: finish on a computer
 * with a supported browser.
 *
 * Presentational only — the parent gate decides when to render it. No "email me
 * the link" in v1: the user is already signed in, so any login on a capable
 * device resumes them at their saved step via the route guard.
 */

import { CheckIcon } from "@phosphor-icons/react";
import { StaggeredContent } from "@/components/ui/StaggeredContent";
import { fonts } from "@/lib/theme/fonts";

const SUPPORTED_BROWSERS = "Chrome, Firefox, or other Chromium browsers";

export function OnboardingHandoff() {
	return (
		<StaggeredContent>
			<p className="theme-text-muted text-xs uppercase tracking-widest">
				almost there
			</p>

			<h2
				className="theme-text mt-3 text-[clamp(2rem,7vw,3.75rem)] font-extralight tracking-tight leading-[0.95]"
				style={{ fontFamily: fonts.display }}
			>
				finish setting up
				<br />
				on a computer.
			</h2>

			<p className="theme-text mt-10 max-w-md text-base leading-relaxed font-light text-pretty">
				hearted builds your library through a browser extension that runs on a
				computer with {SUPPORTED_BROWSERS}. open hearted.music there to keep
				going.
			</p>

			<div className="mt-10 flex items-center gap-2">
				<CheckIcon size={14} className="theme-text-muted" weight="bold" />
				<span className="theme-text-muted text-sm">
					your progress is saved.
				</span>
			</div>
		</StaggeredContent>
	);
}
