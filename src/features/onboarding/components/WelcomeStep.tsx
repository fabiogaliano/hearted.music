import { ArrowRightIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/kbd";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { fonts } from "@/lib/theme/fonts";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";

export function WelcomeStep() {
	const { goToStep } = useOnboardingNavigation();
	const [isNavigating, setIsNavigating] = useState(false);

	const handleContinue = async () => {
		if (isNavigating) return;
		setIsNavigating(true);
		const result = await goToStep("flag-playlists");
		if (result.status === "transition_failed") {
			setIsNavigating(false);
			toast.error("Couldn't continue. Please try again.");
		}
	};

	useShortcut({
		key: "enter",
		handler: handleContinue,
		description: "Continue",
		scope: "onboarding-welcome",
		enabled: !isNavigating,
	});

	return (
		<>
			<div className="text-center">
				<h1
					className="theme-text text-8xl leading-none font-extralight tracking-tight"
					style={{ fontFamily: fonts.display }}
				>
					hearted.
				</h1>
				<p
					className="theme-text-muted mt-6 text-xl font-light tracking-wide"
					style={{ fontFamily: fonts.body }}
				>
					You have liked songs. You have playlists.
					<br />
					Tell us what each is for, and your songs find their way in.
				</p>
				<Button
					variant="link"
					onClick={handleContinue}
					disabled={isNavigating}
					className="mt-16"
					style={{ fontFamily: fonts.body }}
				>
					<span className="text-lg font-medium tracking-wide">
						Show me how it works
					</span>
					<ArrowRightIcon
						size={16}
						className="theme-text-muted inline-block transition-transform group-hover:translate-x-1"
					/>
				</Button>
			</div>

			<div className="theme-kbd-scope fixed right-0 bottom-6 left-0 flex items-center justify-center gap-6 opacity-60">
				<div className="flex items-center gap-1.5">
					<Kbd>⏎</Kbd>
					<span className="text-xs">to continue</span>
				</div>
			</div>
		</>
	);
}
