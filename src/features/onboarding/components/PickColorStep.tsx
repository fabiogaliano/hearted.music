/**
 * Pick Color step - theme selection.
 * Saves theme preference to DB.
 */

import { useState } from "react";
import { toast } from "sonner";
import { themes } from "@/lib/theme/colors";
import { type ThemeColor, type ThemeConfig, COLOR_LABELS, THEME_COLORS } from "@/lib/theme/types";
import { fonts } from "@/lib/theme/fonts";
import { saveThemePreference } from "@/lib/server/onboarding.server";
import { useOnboardingNavigation } from "../hooks/useOnboardingNavigation";

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

	const handleContinue = async () => {
		setIsSaving(true);
		try {
			// Save theme to server
			await saveThemePreference({ data: { theme: currentTheme } });
			// Navigate to next step
			await goToStep("connecting");
		} catch (error) {
			console.error("Failed to save theme:", error);
			toast.error("Failed to save your theme preference. Please try again.");
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div>
			{/* Section label */}
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

			{/* Color options - minimal, text-focused */}
			<div className="mt-16 grid grid-cols-2 gap-x-12 gap-y-8">
				{THEME_COLORS.map((colorId) => {
					const optionTheme = themes[colorId];
					const isSelected = currentTheme === colorId;
					return (
						<button
							key={colorId}
							type="button"
							onClick={() => setTheme(colorId)}
							aria-pressed={isSelected}
							aria-label={`Select ${COLOR_LABELS[colorId]} theme`}
							className="group flex items-center gap-4 text-left"
						>
							{/* Color swatch */}
							<div
								className="h-12 w-12 rounded-full transition-transform group-hover:scale-110"
								style={{
									background: optionTheme.bg,
									border: `2px solid ${optionTheme.text}`,
									boxShadow: isSelected
										? `0 0 0 3px ${optionTheme.textMuted}`
										: "none",
								}}
							/>
							<div>
								<p
									className="text-2xl font-extralight"
									style={{
										fontFamily: fonts.display,
										color: isSelected ? theme.text : theme.textMuted,
									}}
								>
									{COLOR_LABELS[colorId]}
								</p>
								{isSelected && (
									<p
										className="mt-0.5 text-xs tracking-widest uppercase"
										style={{ fontFamily: fonts.body, color: theme.textMuted }}
									>
										Selected
									</p>
								)}
							</div>
						</button>
					);
				})}
			</div>

			{/* Continue link */}
			<button
				type="button"
				onClick={handleContinue}
				disabled={isSaving}
				className="group mt-20 inline-flex items-center gap-3"
				style={{
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
		</div>
	);
}
