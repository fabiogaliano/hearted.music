/**
 * Settings page — Account, Appearance, Connected Services, Sign Out.
 *
 * Editorial-minimal aesthetic: typography-driven,
 * generous whitespace. Instrument Serif for display, Geist for UI.
 */

import { useNavigate } from "@tanstack/react-router";
import { useCallback, useState } from "react";
import { toast } from "sonner";
import { UserAvatar } from "@/components/ui/UserAvatar";
import type { BillingState } from "@/lib/domains/billing/state";
import { signOut } from "@/lib/platform/auth/auth-client";
import { updateThemePreference } from "@/lib/server/settings.functions";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";
import { COLOR_LABELS, THEME_COLORS, type ThemeColor } from "@/lib/theme/types";
import { BillingSection } from "./components/BillingSection";
import { ExtensionStatusRow } from "./components/ExtensionStatusRow";

interface SettingsPageProps {
	displayName: string | null;
	email: string | null;
	imageUrl: string | null;
	currentTheme: ThemeColor;
	onThemeChange: (theme: ThemeColor) => void;
	billingState: BillingState;
}

export function SettingsPage({
	displayName,
	email,
	imageUrl,
	currentTheme,
	onThemeChange,
	billingState,
}: SettingsPageProps) {
	const theme = useTheme();
	const navigate = useNavigate();
	const [isSavingTheme, setIsSavingTheme] = useState(false);
	const [isSigningOut, setIsSigningOut] = useState(false);

	const handleThemeSelect = useCallback(
		async (colorId: ThemeColor) => {
			if (colorId === currentTheme || isSavingTheme) return;

			const previousTheme = currentTheme;
			onThemeChange(colorId);
			setIsSavingTheme(true);

			try {
				await updateThemePreference({ data: { theme: colorId } });
			} catch {
				onThemeChange(previousTheme);
				toast.error("Something went sideways. Let's try that again.");
			} finally {
				setIsSavingTheme(false);
			}
		},
		[currentTheme, isSavingTheme, onThemeChange],
	);

	const handleSignOut = useCallback(async () => {
		setIsSigningOut(true);
		try {
			await signOut({
				fetchOptions: { onSuccess: () => navigate({ to: "/" }) },
			});
		} catch {
			toast.error("Something went sideways. Let's try that again.");
			setIsSigningOut(false);
		}
	}, [navigate]);

	return (
		<div className="max-w-3xl">
			<div className="mb-16">
				<p
					className="text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body, color: theme.textMuted }}
				>
					Settings
				</p>
				<h2
					className="mt-3 text-page-title font-extralight tracking-tight"
					style={{ fontFamily: fonts.display, color: theme.text }}
				>
					<em>Preferences</em>
				</h2>
			</div>

			<div className="space-y-10">
				<section>
					<div className="flex items-center gap-4">
						<UserAvatar name={displayName} imageUrl={imageUrl} size="md" />
						<div className="min-w-0">
							<p
								className="truncate text-xl font-light"
								style={{ fontFamily: fonts.display, color: theme.text }}
							>
								{displayName ?? "—"}
							</p>
							<p
								className="mt-1 truncate text-sm"
								style={{ fontFamily: fonts.body, color: theme.textMuted }}
							>
								{email ?? "—"}
							</p>
						</div>
					</div>
				</section>

				<section>
					<div>
						<p
							className="mb-6 text-xl font-light"
							style={{ fontFamily: fonts.display, color: theme.text }}
						>
							Theme color
						</p>
						<div className="flex gap-6">
							{THEME_COLORS.map((colorId) => {
								const optionTheme = themes[colorId];
								const isSelected = currentTheme === colorId;
								return (
									<button
										key={colorId}
										type="button"
										onClick={() => handleThemeSelect(colorId)}
										disabled={isSavingTheme}
										className="group flex cursor-pointer flex-col items-center gap-2 disabled:cursor-wait"
										aria-label={`Select ${COLOR_LABELS[colorId]} theme`}
										aria-pressed={isSelected}
									>
										<div
											className="h-12 w-12 rounded-full transition-transform duration-150 group-hover:scale-[1.05] group-active:scale-[0.98]"
											style={{
												background: optionTheme.surfaceDim,
												border: isSelected
													? `2px solid ${optionTheme.text}`
													: "2px solid transparent",
											}}
										/>
										<span
											className="text-xs tracking-widest uppercase transition-colors duration-150"
											style={{
												fontFamily: fonts.body,
												color: isSelected ? theme.text : theme.textMuted,
												fontWeight: isSelected ? 500 : 400,
											}}
										>
											{COLOR_LABELS[colorId]}
										</span>
									</button>
								);
							})}
						</div>
					</div>
				</section>

				<BillingSection billingState={billingState} />

				<section>
					<ExtensionStatusRow />
				</section>

				<section>
					<div className="border-t pt-8" style={{ borderColor: theme.border }}>
						<button
							type="button"
							onClick={handleSignOut}
							disabled={isSigningOut}
							className="cursor-pointer text-xs font-normal tracking-widest uppercase transition-opacity duration-150 hover:opacity-70 disabled:cursor-wait disabled:opacity-50"
							style={{ fontFamily: fonts.body, color: theme.textMuted }}
						>
							{isSigningOut ? "Signing out…" : "Sign out"}
						</button>
					</div>
				</section>
			</div>
		</div>
	);
}
