/**
 * Ready step - onboarding complete.
 * Shows stats and redirects to main app.
 */

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Kbd } from "@/components/ui/kbd";
import { useShortcut } from "@/lib/keyboard/useShortcut";
import {
	markOnboardingComplete,
	type OnboardingData,
	type ReadyCopyVariant,
} from "@/lib/server/onboarding.functions";
import { fonts } from "@/lib/theme/fonts";
import { useTheme } from "@/lib/theme/ThemeHueProvider";

interface ReadyStepProps {
	syncStats: { songs: number; playlists: number };
	copyVariant: ReadyCopyVariant;
}

const READY_COPY: Record<ReadyCopyVariant, string> = {
	free: "Exploring your 15 songs. An email's on its way when it's ready.",
	pack: "Exploring your selected songs. An email's on its way when it's ready.",
	unlimited: "Going through every song. An email's on its way when it's ready.",
};

const ONBOARDING_QUERY_KEY = ["auth", "onboarding"] as const;

export function ReadyStep({ syncStats, copyVariant }: ReadyStepProps) {
	const theme = useTheme();
	const navigate = useNavigate();
	const queryClient = useQueryClient();
	const [isCompleting, setIsCompleting] = useState(false);

	const handleStart = async () => {
		setIsCompleting(true);
		try {
			await markOnboardingComplete();
			queryClient.setQueryData<OnboardingData>(
				ONBOARDING_QUERY_KEY,
				(existing) =>
					existing
						? {
								...existing,
								isComplete: true,
							}
						: existing,
			);
			await queryClient.invalidateQueries({ queryKey: ONBOARDING_QUERY_KEY });
			await navigate({ to: "/dashboard" });
		} catch (error) {
			console.error("Failed to complete onboarding:", error);
			toast.error("Failed to complete onboarding. Please try again.");
		} finally {
			setIsCompleting(false);
		}
	};

	useShortcut({
		key: "enter",
		handler: handleStart,
		description: "Start Exploring",
		scope: "onboarding-ready",
		enabled: !isCompleting,
	});

	return (
		<div className="text-center">
			<p
				className="text-xs tracking-widest uppercase"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Complete
			</p>

			<h2
				className="mt-4 text-6xl leading-tight font-extralight"
				style={{ fontFamily: fonts.display, color: theme.text }}
			>
				You're
				<br />
				<em className="font-normal">in.</em>
			</h2>

			<p
				className="mt-6 text-lg font-light"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				{READY_COPY[copyVariant]}
			</p>

			<div className="mt-16 flex justify-center gap-16">
				<div className="text-center">
					<p
						className="text-5xl font-extralight"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{syncStats.songs}
					</p>
					<p
						className="mt-2 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Songs
					</p>
				</div>
				<div className="text-center">
					<p
						className="text-5xl font-extralight"
						style={{ fontFamily: fonts.display, color: theme.text }}
					>
						{syncStats.playlists}
					</p>
					<p
						className="mt-2 text-xs tracking-widest uppercase"
						style={{ fontFamily: fonts.body, color: theme.textMuted }}
					>
						Playlists
					</p>
				</div>
			</div>

			<button
				type="button"
				onClick={handleStart}
				disabled={isCompleting}
				className="group mt-20 inline-flex min-h-11 items-center gap-3"
				style={{
					fontFamily: fonts.body,
					color: theme.text,
					opacity: isCompleting ? 0.5 : 1,
				}}
			>
				<span className="text-xl font-medium tracking-wide">
					{isCompleting ? "Loading..." : "Start Exploring"}
				</span>
				<span
					className="inline-block transition-transform group-hover:translate-x-1"
					style={{ color: theme.textMuted }}
				>
					→
				</span>
			</button>

			<div className="mt-4 flex items-center justify-center gap-1.5">
				<span
					className="text-xs"
					style={{ color: theme.textMuted, opacity: 0.6 }}
				>
					or press
				</span>
				<Kbd
					style={{
						color: theme.textMuted,
						backgroundColor: `${theme.text}10`,
						border: `1px solid ${theme.textMuted}30`,
						boxShadow: `0 1px 0 ${theme.textMuted}20`,
					}}
				>
					⏎
				</Kbd>
			</div>
		</div>
	);
}
