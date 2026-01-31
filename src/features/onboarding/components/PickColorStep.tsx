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
import { saveThemePreference } from "@/lib/server/onboarding.server";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import {
	COLOR_LABELS,
	THEME_COLORS,
	type ThemeColor,
	type ThemeConfig,
} from "@/lib/theme/types";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";
import { StaggeredContent } from "./StaggeredContent";
import { THEME_TRANSITION_MS } from "./StepContainer";

interface PickColorStepProps {
	theme: ThemeConfig;
	currentTheme: ThemeColor;
	setTheme: (theme: ThemeColor) => void;
}

export function PickColorStep({
	theme,
	currentTheme,
	setTheme,
}: PickColorStepProps) {
	const { goToStep } = useOnboardingNavigation();
	const [isSaving, setIsSaving] = useState(false);
	const shouldReduceMotion = useReducedMotion();

	const handleColorSelect = useCallback(
		(colorId: ThemeColor) => {
			setTheme(colorId);
		},
		[setTheme],
	);

	const { focusedIndex, getItemProps } = useListNavigation({
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
			await goToStep("connecting");
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

	const kbdVars = {
		"--kbd-text-color": theme.textMuted,
		"--kbd-bg-color": `${theme.text}10`,
		"--kbd-border-color": `${theme.textMuted}30`,
		"--kbd-shadow-color": `${theme.textMuted}20`,
	} as React.CSSProperties;

	return (
		<>
			<StaggeredContent>
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Step 01
				</p>

				<h2
					className="mt-4 text-6xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					Pick your
					<br />
					<em className="font-normal">palette</em>
				</h2>

				{/* Color options - no initialDelay since outer stagger handles sequencing */}
				<StaggeredContent
					className="mt-16 grid grid-cols-2 gap-x-8 gap-y-4 sm:gap-x-12 sm:gap-y-8"
					role="listbox"
					aria-label="Theme color options"
					initialDelay={0}
				>
					{THEME_COLORS.map((colorId, index) => {
						const optionTheme = themes[colorId];
						const isSelected = currentTheme === colorId;
						const isFocused = focusedIndex === index;
						const itemProps = getItemProps(colorId, index);
						return (
							<button
								key={colorId}
								type="button"
								ref={itemProps.ref}
								tabIndex={itemProps.tabIndex}
								data-focused={itemProps["data-focused"]}
								onClick={() => setTheme(colorId)}
								aria-pressed={isSelected}
								aria-label={`Select ${COLOR_LABELS[colorId]} theme`}
								className="group flex min-h-11 cursor-pointer items-center gap-4 rounded-lg text-left outline-none ring-offset-2 focus-visible:ring-2"
								style={{
									["--tw-ring-color" as string]: theme.text,
									["--tw-ring-offset-color" as string]: theme.bg,
								}}
							>
								{/* Color swatch - min 44px for touch targets */}
								<div className="relative h-11 w-11 shrink-0 sm:h-12 sm:w-12">
									{/* Selection/hover ring - uses shared theme transition timing */}
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
									{/* Keyboard focus indicator - shows on any focused item */}
									{isFocused && (
										<div
											className="absolute -inset-1 rounded-full"
											style={{
												border: `2px dashed ${theme.textMuted}`,
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
										className="text-xl font-extralight sm:text-2xl"
										style={{
											fontFamily: fonts.display,
											color: isSelected ? theme.text : theme.textMuted,
										}}
									>
										{COLOR_LABELS[colorId]}
									</p>
									<p
										className="mt-0.5 text-xs tracking-widest uppercase"
										style={{
											fontFamily: fonts.body,
											color: theme.textMuted,
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
					className="group mt-16 inline-flex min-h-11 items-center gap-3 rounded outline-2 outline-offset-2 outline-transparent focus-visible:outline-(--focus-color) sm:mt-20"
					style={{
						["--focus-color" as string]: theme.text,
						fontFamily: fonts.body,
						color: theme.text,
						opacity: isSaving ? 0.5 : 1,
					}}
				>
					<span className="text-lg font-medium tracking-wide">
						{isSaving ? "Saving..." : "Continue"}
					</span>
					<span
						className="inline-block transition-transform group-hover:translate-x-1"
						style={{ color: theme.textMuted }}
					>
						→
					</span>
				</button>
			</StaggeredContent>

			<div
				className="fixed bottom-6 left-0 right-0 flex items-center justify-center gap-6"
				style={{ color: theme.textMuted, opacity: 0.6, ...kbdVars }}
			>
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
