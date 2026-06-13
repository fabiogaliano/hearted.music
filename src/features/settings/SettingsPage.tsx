/**
 * Settings page — editorial row layout.
 *
 * Each section is a 2-column editorial row: identity (eyebrow + serif title +
 * microcopy) on the left, controls on the right. Hairline dividers separate
 * sections. The pattern mirrors PlaylistsHeader / LikedSongsHeader so the
 * /settings surface reads as part of the same magazine.
 */

import { ArrowLeftIcon } from "@phosphor-icons/react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useNavigate } from "@tanstack/react-router";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { dashboardKeys } from "@/features/dashboard/queries";
import { matchingKeys } from "@/features/matching/queries";
import type { BillingState } from "@/lib/domains/billing/state";
import {
	type MatchStrictness,
	STRICTNESS_MIN_SCORE,
} from "@/lib/domains/taste/song-matching/strictness";
import { signOut } from "@/lib/platform/auth/auth-client";
import {
	updateMatchStrictnessPreference,
	updateThemePreference,
} from "@/lib/server/settings.functions";
import { themes } from "@/lib/theme/colors";
import { fonts } from "@/lib/theme/fonts";
import { COLOR_LABELS, THEME_COLORS, type ThemeColor } from "@/lib/theme/types";
import { BillingSection } from "./components/BillingSection";
import { ConsentSection } from "./components/ConsentSection";
import { ExtensionStatusRow } from "./components/ExtensionStatusRow";

interface StrictnessOption {
	value: MatchStrictness;
	label: string;
	description: string;
}

// The label stays evocative and the description stays plain; the score
// threshold rides along as a muted caption in the picker so the number grounds
// the choice (users already see it on every match in /match) without turning
// the copy into a spec. The caption is derived from STRICTNESS_MIN_SCORE rather
// than retyped here, so retuning a preset can't make the copy lie. Order is
// loosest → strictest.
const STRICTNESS_OPTIONS: StrictnessOption[] = [
	{
		value: "open",
		label: "Room for surprises",
		description: "Shows every match, even the weak ones.",
	},
	{
		value: "balanced",
		label: "Might be worth the spot",
		description: "Hides the weaker matches.",
	},
	{
		value: "strict",
		label: "The ones pulling ahead",
		description: "Shows only the strongest.",
	},
];

interface SettingsPageProps {
	handle: string | null;
	email: string | null;
	imageUrl: string | null;
	currentTheme: ThemeColor;
	onThemeChange: (theme: ThemeColor) => void;
	currentStrictness: MatchStrictness;
	billingState: BillingState;
	// True only when the user arrived via "Adjust strictness" from /match;
	// drives the round-trip "Back to match" button in the Matching section.
	cameFromMatch?: boolean;
}

export function SettingsPage({
	handle,
	email,
	imageUrl,
	currentTheme,
	onThemeChange,
	currentStrictness,
	billingState,
	cameFromMatch = false,
}: SettingsPageProps) {
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const { hash } = useLocation();
	const [isSavingTheme, setIsSavingTheme] = useState(false);
	const [strictness, setStrictness] =
		useState<MatchStrictness>(currentStrictness);
	const [isSavingStrictness, setIsSavingStrictness] = useState(false);
	const [isSigningOut, setIsSigningOut] = useState(false);

	// Hash-driven anchor: when the sidebar Upgrade CTA links here with
	// hash="settings-section-subscription", scroll the matching heading into
	// view and move focus to it so AT users land at the right place.
	useEffect(() => {
		if (!hash) return;
		const target = document.getElementById(hash);
		if (!target) return;
		target.scrollIntoView({ block: "start", behavior: "smooth" });
		target.focus({ preventScroll: true });
	}, [hash]);

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

	const handleStrictnessSelect = useCallback(
		async (next: MatchStrictness) => {
			if (next === strictness || isSavingStrictness) return;

			const previousStrictness = strictness;
			setStrictness(next);
			setIsSavingStrictness(true);

			try {
				await updateMatchStrictnessPreference({ data: { strictness: next } });
				// Invalidate both families so the new bar applies without a reload:
				// the /match queue + dashboard previews/review count read these keys.
				queryClient.invalidateQueries({ queryKey: matchingKeys.all });
				queryClient.invalidateQueries({ queryKey: dashboardKeys.all });
			} catch {
				setStrictness(previousStrictness);
				toast.error("Something went sideways. Let's try that again.");
			} finally {
				setIsSavingStrictness(false);
			}
		},
		[strictness, isSavingStrictness, queryClient],
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
		<div className="max-w-4xl">
			<header className="mb-10 md:mb-14">
				<p
					className="theme-text-muted text-xs tracking-widest uppercase"
					style={{ fontFamily: fonts.body }}
				>
					Settings
				</p>
				<h1
					className="theme-text mt-3 text-page-title font-extralight tracking-tight leading-[0.95]"
					style={{ fontFamily: fonts.display }}
				>
					<em>Preferences</em>
				</h1>
			</header>

			<SettingsSection
				index={1}
				title="Account"
				description="Your identity on Hearted."
			>
				<div className="flex items-center gap-4">
					<UserAvatar name={handle} imageUrl={imageUrl} size="md" />
					<div className="min-w-0">
						{handle && (
							<p
								className="theme-text truncate text-xl font-light"
								style={{ fontFamily: fonts.display }}
							>
								@{handle}
							</p>
						)}
						<p
							className={`theme-text-muted truncate text-sm ${handle ? "mt-1" : ""}`}
							style={{ fontFamily: fonts.body }}
						>
							{email ?? "—"}
						</p>
					</div>
				</div>
			</SettingsSection>

			<SettingsSection
				index={2}
				title="Subscription"
				description="Your plan and remaining credits."
			>
				<BillingSection billingState={billingState} />
			</SettingsSection>

			<SettingsSection
				index={3}
				title="Appearance"
				description="Pick a palette to live in."
				accessory={
					<span
						aria-live="polite"
						className={`theme-text-muted text-xs tracking-widest uppercase transition-opacity duration-200 ${
							isSavingTheme ? "opacity-100" : "opacity-0"
						}`}
						style={{ fontFamily: fonts.body }}
					>
						{isSavingTheme ? "Saving…" : " "}
					</span>
				}
			>
				<ThemeColorPicker
					currentTheme={currentTheme}
					onSelect={handleThemeSelect}
					isSaving={isSavingTheme}
				/>
			</SettingsSection>

			<SettingsSection
				index={4}
				title="Matching"
				description="How sure a song has to be before it shows up at your door."
				accessory={
					<span
						aria-live="polite"
						className={`theme-text-muted text-xs tracking-widest uppercase transition-opacity duration-200 ${
							isSavingStrictness ? "opacity-100" : "opacity-0"
						}`}
						style={{ fontFamily: fonts.body }}
					>
						{isSavingStrictness ? "Saving…" : " "}
					</span>
				}
			>
				<MatchStrictnessPicker
					currentStrictness={strictness}
					onSelect={handleStrictnessSelect}
					isSaving={isSavingStrictness}
				/>
				{cameFromMatch && (
					<div className="mt-5 flex justify-end">
						<Link
							to="/match"
							className="theme-text group inline-flex items-center gap-2.5 text-sm font-medium tracking-wide transition-transform duration-150 ease-out motion-safe:active:scale-[0.98]"
							style={{ fontFamily: fonts.body }}
						>
							<ArrowLeftIcon
								size={16}
								weight="regular"
								className="theme-text-muted transition-transform duration-200 ease-out motion-safe:group-hover:-translate-x-1"
							/>
							Back to match
						</Link>
					</div>
				)}
			</SettingsSection>

			<SettingsSection
				index={5}
				title="Connections"
				description="How your songs travel from Spotify to here."
			>
				<ExtensionStatusRow />
			</SettingsSection>

			{import.meta.env.PROD && (
				<SettingsSection
					index={6}
					title="Privacy"
					description="Review the analytics and replay choice for this account."
				>
					<ConsentSection />
				</SettingsSection>
			)}

			<SettingsSection
				title="Session"
				description="End your session on this device."
			>
				<Button
					variant="ghost"
					size="sm"
					onClick={handleSignOut}
					disabled={isSigningOut}
					style={{ fontFamily: fonts.body }}
				>
					{isSigningOut ? "Signing out…" : "Sign out"}
				</Button>
			</SettingsSection>
		</div>
	);
}

interface SettingsSectionProps {
	index?: number;
	title: string;
	description: string;
	accessory?: ReactNode;
	children: ReactNode;
}

function SettingsSection({
	index,
	title,
	description,
	accessory,
	children,
}: SettingsSectionProps) {
	const headingId = `settings-section-${title.toLowerCase()}`;
	return (
		<section
			aria-labelledby={headingId}
			className="theme-border-color grid grid-cols-1 gap-x-10 gap-y-6 border-t py-9 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] md:py-12"
		>
			<div className="flex flex-col">
				{index !== undefined && (
					<span
						aria-hidden="true"
						className="theme-text-muted text-xs tabular-nums tracking-widest uppercase opacity-60"
						style={{ fontFamily: fonts.body }}
					>
						{String(index).padStart(2, "0")}
					</span>
				)}
				<h2
					id={headingId}
					tabIndex={-1}
					className={`theme-text text-2xl font-light leading-tight ${
						index !== undefined ? "mt-2" : ""
					}`}
					style={{ fontFamily: fonts.display }}
				>
					{title}
				</h2>
				<p
					className="theme-text-muted mt-2 max-w-xs text-sm leading-relaxed text-pretty"
					style={{ fontFamily: fonts.body }}
				>
					{description}
				</p>
				{accessory !== undefined && <div className="mt-3">{accessory}</div>}
			</div>
			<div className="min-w-0">{children}</div>
		</section>
	);
}

interface ThemeColorPickerProps {
	currentTheme: ThemeColor;
	onSelect: (theme: ThemeColor) => void;
	isSaving: boolean;
}

function ThemeColorPicker({
	currentTheme,
	onSelect,
	isSaving,
}: ThemeColorPickerProps) {
	// Native radios share a name so the browser handles arrow-key roving and
	// announces "radio group" to assistive tech for free. We hide the input
	// and project focus onto the swatch via Tailwind's `peer-focus-visible:`.
	const groupName = useId();

	return (
		<fieldset className="flex flex-wrap gap-x-7 gap-y-5 border-0 p-0">
			<legend className="sr-only">Theme color</legend>
			{THEME_COLORS.map((colorId) => {
				const optionTheme = themes[colorId];
				const isSelected = currentTheme === colorId;
				return (
					<label
						key={colorId}
						className="group flex cursor-pointer flex-col items-center gap-2.5"
					>
						<input
							type="radio"
							name={groupName}
							value={colorId}
							checked={isSelected}
							onChange={() => onSelect(colorId)}
							disabled={isSaving && !isSelected}
							className="peer sr-only focus-visible:outline-none"
						/>
						<span
							aria-hidden="true"
							className="relative inline-block size-10 rounded-full transition-[transform,box-shadow] duration-200 ease-out group-hover:scale-[1.06] group-active:scale-[0.96] peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-(--focus-ring-color)"
							style={{
								background: optionTheme.surfaceDim,
								// Offset ring: inner gap is the page background, outer line is
								// the theme's own text color — lets the swatch read undisturbed
								// when selected, and stays inside the layout box (no clipping).
								boxShadow: isSelected
									? `0 0 0 2px var(--t-bg), 0 0 0 4px ${optionTheme.text}`
									: `inset 0 0 0 1px ${optionTheme.border}`,
							}}
						/>
						<span
							className={`text-xs tracking-widest uppercase transition-colors duration-150 ${
								isSelected ? "theme-text font-medium" : "theme-text-muted"
							}`}
							style={{ fontFamily: fonts.body }}
						>
							{COLOR_LABELS[colorId]}
						</span>
					</label>
				);
			})}
		</fieldset>
	);
}

interface MatchStrictnessPickerProps {
	currentStrictness: MatchStrictness;
	onSelect: (strictness: MatchStrictness) => void;
	isSaving: boolean;
}

function MatchStrictnessPicker({
	currentStrictness,
	onSelect,
	isSaving,
}: MatchStrictnessPickerProps) {
	// Same accessibility pattern as ThemeColorPicker: native radios sharing a
	// name (free roving focus + "radio group" announcement), input hidden and
	// focus projected onto the card via `peer-focus-visible:`. Each option is a
	// label + one-line description card instead of a color swatch.
	const groupName = useId();

	return (
		<fieldset className="flex flex-col gap-3 border-0 p-0">
			<legend className="sr-only">Match strictness</legend>
			{STRICTNESS_OPTIONS.map((option) => {
				const isSelected = currentStrictness === option.value;
				return (
					<label
						key={option.value}
						className="group flex cursor-pointer items-start gap-3.5 border p-4 transition-[border-color] duration-200 ease-out peer-focus-visible:outline-2"
						style={{
							borderColor: isSelected ? "var(--t-text)" : "var(--t-border)",
						}}
					>
						<input
							type="radio"
							name={groupName}
							value={option.value}
							checked={isSelected}
							onChange={() => onSelect(option.value)}
							disabled={isSaving && !isSelected}
							className="peer sr-only focus-visible:outline-none"
						/>
						<span
							aria-hidden="true"
							className="relative mt-0.5 inline-block size-4 shrink-0 rounded-full transition-[box-shadow] duration-200 ease-out peer-focus-visible:outline-2 peer-focus-visible:outline-offset-4 peer-focus-visible:outline-(--focus-ring-color)"
							style={{
								boxShadow: isSelected
									? "inset 0 0 0 5px var(--t-text)"
									: "inset 0 0 0 1px var(--t-border)",
							}}
						/>
						<span className="flex min-w-0 flex-col gap-1">
							<span
								className="theme-text-muted text-xs leading-none tabular-nums italic opacity-70"
								style={{ fontFamily: fonts.body }}
							>
								above {Math.round(STRICTNESS_MIN_SCORE[option.value] * 100)}%
							</span>
							<span
								className={`text-base leading-none ${
									isSelected ? "theme-text font-medium" : "theme-text"
								}`}
								style={{ fontFamily: fonts.body }}
							>
								{option.label}
							</span>
							<span
								className="theme-text-muted text-sm leading-snug text-pretty"
								style={{ fontFamily: fonts.body }}
							>
								{option.description}
							</span>
						</span>
					</label>
				);
			})}
		</fieldset>
	);
}
