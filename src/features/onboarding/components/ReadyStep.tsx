/**
 * Ready step - onboarding complete.
 * Shows stats and redirects to main app.
 */

import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { fonts } from "@/lib/theme/fonts";
import { type ThemeConfig } from "@/lib/theme/types";
import { markOnboardingComplete } from "@/lib/server/onboarding.server";

interface ReadyStepProps {
	theme: ThemeConfig;
	syncStats: { songs: number; playlists: number };
}

export function ReadyStep({ theme, syncStats }: ReadyStepProps) {
	const navigate = useNavigate();
	const [isCompleting, setIsCompleting] = useState(false);

	const handleStart = async () => {
		setIsCompleting(true);
		try {
			// Mark onboarding as complete
			await markOnboardingComplete();
			// Redirect to landing/app
			await navigate({ to: "/" });
		} catch (error) {
			console.error("Failed to complete onboarding:", error);
			toast.error("Failed to complete onboarding. Please try again.");
		} finally {
			setIsCompleting(false);
		}
	};

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
				You're all
				<br />
				<em className="font-normal">set</em>
			</h2>

			<p
				className="mt-6 text-lg font-light"
				style={{ fontFamily: fonts.body, color: theme.textMuted }}
			>
				Your library has been synced.
			</p>

			{/* Stats - editorial large numbers */}
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

			{/* Start button - still minimal but more prominent */}
			<button
				type="button"
				onClick={handleStart}
				disabled={isCompleting}
				className="group mt-20 inline-flex items-center gap-3"
				style={{
					fontFamily: fonts.body,
					color: theme.text,
					opacity: isCompleting ? 0.5 : 1,
				}}
			>
				<span className="text-xl font-medium tracking-wide">
					{isCompleting ? "Loading..." : "Start Sorting"}
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
