/**
 * Pick Color step - theme selection.
 * Saves theme preference to DB.
 */

import { useReducedMotion } from "framer-motion";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { Kbd, KbdGroup } from "@/components/ui/kbd";
import { useListNavigation } from "@/lib/keyboard/useListNavigation";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import { saveThemePreference } from "@/lib/server/onboarding.functions";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { COLOR_LABELS, THEME_COLORS, type ThemeColor } from "@/lib/theme/types";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";
import { StaggeredContent } from "./StaggeredContent";
import { THEME_TRANSITION_MS } from "./StepContainer";

interface PickColorStepProps {
	currentTheme: ThemeColor;
	setTheme: (theme: ThemeColor) => void;
}

export function PickColorStep({ currentTheme, setTheme }: PickColorStepProps) {
	const { goToStep } = useOnboardingNavigation();
	const [isSaving, setIsSaving] = useState(false);
	const shouldReduceMotion = useReducedMotion();

	const handleColorSelect = useCallback(
		(colorId: ThemeColor) => {
			setTheme(colorId);
		},
		[setTheme],
	);

	const { getItemProps } = useListNavigation({
		items: THEME_COLORS,
		scope: "onboarding-colors",
		enabled: !isSaving,
		direction: "grid",
		columns: 2, // 2x2 grid - down/up moves by 2, left/right moves by 1
		getId: (colorId) => colorId,
		onSelect: handleColorSelect,
	});

	const handleContinue = async () => {
		setIsSaving(true);
		try {
			await saveThemePreference({ data: { theme: currentTheme } });
			await goToStep("install-extension");
		} catch (error) {
			console.error("Failed to save theme:", error);
			toast.error("Failed to save your theme preference. Please try again.");
			setIsSaving(false);
		}
	};

	useShortcut({
		key: "enter",
		handler: handleContinue,
		description: "Continue",
		scope: "onboarding-colors",
		enabled: !isSaving,
	});

	return (
		<>
			<StaggeredContent>
				<h2
					className="theme-text text-6xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display }}
				>
					Pick your
					<br />
					<em className="font-normal">palette</em>
				</h2>

				<StaggeredContent
					className="mt-16 grid grid-cols-2 gap-x-8 gap-y-4 sm:gap-x-12 sm:gap-y-8"
					role="listbox"
					aria-label="Theme color options"
					initialDelay={0}
				>
					{THEME_COLORS.map((colorId, index) => {
						const optionTheme = themes[colorId];
						const isSelected = currentTheme === colorId;
						const itemProps = getItemProps(colorId, index);
						const isFocused = itemProps["data-focused"];
						return (
							<button
								key={colorId}
								type="button"
								ref={itemProps.ref}
								tabIndex={itemProps.tabIndex}
								data-focused={itemProps["data-focused"]}
								data-nav-engaged={itemProps["data-nav-engaged"]}
								onPointerDown={itemProps.onPointerDown}
								onFocus={itemProps.onFocus}
								onBlur={itemProps.onBlur}
								onClick={() => setTheme(colorId)}
								aria-pressed={isSelected}
								aria-label={`Select ${COLOR_LABELS[colorId]} theme`}
								className="group flex min-h-11 cursor-pointer items-center gap-4 text-left"
							>
								<div className="relative h-11 w-11 shrink-0 sm:h-12 sm:w-12">
									<div
										className={`absolute -inset-1 rounded-full transition-opacity ease-out ${
											isSelected
												? "opacity-100"
												: "opacity-0 group-hover:opacity-40"
										}`}
										style={{
											border: `3px solid ${optionTheme.textMuted}`,
											transitionDuration: shouldReduceMotion
												? "0ms"
												: `${THEME_TRANSITION_MS}ms`,
										}}
									/>
									{isFocused && (
										<div
											className="absolute -inset-1 rounded-full"
											style={{
												border: "2px dashed var(--t-text-muted)",
												opacity: 0.7,
											}}
										/>
									)}
									<div
										className="h-full w-full rounded-full"
										style={{
											background: optionTheme.bg,
											border: `2px solid ${optionTheme.text}`,
										}}
									/>
								</div>
								<div>
									<p
										className={`text-xl font-extralight sm:text-2xl ${
											isSelected ? "theme-text" : "theme-text-muted"
										}`}
										style={{ fontFamily: fonts.display }}
									>
										{COLOR_LABELS[colorId]}
									</p>
									<p
										className="theme-text-muted mt-0.5 text-xs tracking-widest uppercase"
										style={{
											fontFamily: fonts.body,
											opacity: isSelected ? 1 : 0,
										}}
									>
										Selected
									</p>
								</div>
							</button>
						);
					})}
				</StaggeredContent>

				<button
					type="button"
					onClick={handleContinue}
					disabled={isSaving}
					className="theme-text group mt-16 inline-flex min-h-11 cursor-pointer items-center gap-3 sm:mt-20"
					style={{
						fontFamily: fonts.body,
						opacity: isSaving ? 0.5 : 1,
					}}
				>
					<span className="text-lg font-medium tracking-wide">
						{isSaving ? "Saving..." : "Continue"}
					</span>
					<span className="theme-text-muted inline-block transition-transform group-hover:translate-x-1">
						→
					</span>
				</button>
			</StaggeredContent>

			<div className="theme-kbd-scope fixed right-0 bottom-6 left-0 flex items-center justify-center gap-6 opacity-60">
				<div className="flex items-center gap-1.5">
					<KbdGroup>
						<Kbd>↑</Kbd>
						<Kbd>↓</Kbd>
						<Kbd>←</Kbd>
						<Kbd>→</Kbd>
					</KbdGroup>
					<span className="text-xs">navigate</span>
				</div>
				<div className="flex items-center gap-1.5">
					<Kbd>Space</Kbd>
					<span className="text-xs">select</span>
				</div>
				<div className="flex items-center gap-1.5">
					<Kbd>⏎</Kbd>
					<span className="text-xs">continue</span>
				</div>
			</div>
		</>
	);
}
