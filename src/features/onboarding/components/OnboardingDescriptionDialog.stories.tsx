import type { Story } from "@ladle/react";
import { useEffect, useState } from "react";
import {
	type SaveMatchIntentBehavior,
	setSaveMatchIntentBehavior,
} from "@/__mocks__/playlists.functions.stub";
import type { OnboardingPlaylist } from "@/lib/server/onboarding.functions";
import { OnboardingDescriptionDialog } from "./OnboardingDescriptionDialog";

/**
 * The teaching dialog that fires when a playlist is picked on the flag-playlists
 * step. It mirrors the in-app playlist detail view — cover, title, and the same
 * PlaylistWritingSurface — opened display-first. "Continue and save" persists the
 * match intent + genres to our own DB (the playlists.functions stub in Ladle,
 * aliased via ladle-vite.config.ts) and advances; "Skip for now" advances with no
 * playlist; dismissing commits nothing. `behavior` drives the match-intent save
 * outcome the UI renders differently — success/advance, the inline failure line,
 * and the frozen "Saving…" state. Genres persist through the same stub.
 */

export default {
	title: "Onboarding/DescriptionDialog",
};

const BASE_PLAYLIST: OnboardingPlaylist = {
	id: "pl_ladle",
	spotifyId: "37i9dQZF1DXcBWIGoYBM5M",
	name: "songs i run to",
	matchIntent: null,
	imageUrl: null,
	songCount: 42,
	isTarget: false,
	genrePills: [],
};

function Harness({
	playlist,
	behavior = "success",
}: {
	playlist: OnboardingPlaylist;
	behavior?: SaveMatchIntentBehavior;
}) {
	// Set during render so the outcome is in place before any auto-save fires.
	setSaveMatchIntentBehavior(behavior);

	const [open, setOpen] = useState(true);

	return (
		<div className="min-h-screen">
			{!open && (
				<div className="flex min-h-screen items-center justify-center">
					<button
						type="button"
						onClick={() => setOpen(true)}
						className="theme-text-muted text-sm underline"
					>
						Dialog closed — reopen
					</button>
				</div>
			)}
			{open && (
				<OnboardingDescriptionDialog
					playlist={playlist}
					accountId="acct_ladle"
					onClose={() => setOpen(false)}
					onCommitAndContinue={() => setOpen(false)}
					onSkipStep={() => setOpen(false)}
				/>
			)}
		</div>
	);
}

// ── Static states (the main UI-editing surface) ──────────────────────────────

export const Default: Story = () => <Harness playlist={BASE_PLAYLIST} />;
Default.meta = {
	description:
		"First-pick teaching dialog, display-first like the in-app detail view: cover + title above the collapsed writing surface (intent placeholder + a dormant '+ Add genres' pill). Click the text or '+ Add genres' to edit; 'Skip for now' advances with no playlist.",
};

export const WithExistingIntent: Story = () => (
	<Harness
		playlist={{
			...BASE_PLAYLIST,
			matchIntent: "songs that make me cry on purpose",
		}}
	/>
);
WithExistingIntent.meta = {
	description:
		"Collapsed display with a saved match intent and the '+ Add genres' affordance.",
};

export const WithGenres: Story = () => (
	<Harness
		playlist={{
			...BASE_PLAYLIST,
			matchIntent: "songs i run to at 6am",
			genrePills: ["indie", "electronic", "rock"],
		}}
	/>
);
WithGenres.meta = {
	description:
		"Collapsed display with intent text and read-only genre chips — click either to open the editor.",
};

export const WithCoverArt: Story = () => (
	<Harness
		playlist={{
			...BASE_PLAYLIST,
			imageUrl: "https://picsum.photos/seed/hearted/240",
		}}
	/>
);
WithCoverArt.meta = {
	description: "Cover image instead of the AlbumPlaceholder fallback.",
};

export const LongName: Story = () => (
	<Harness
		playlist={{
			...BASE_PLAYLIST,
			name: "the long drives where i don't talk and just let the road carry it",
		}}
	/>
);
LongName.meta = {
	description: "Stress-tests the playlist title wrapping next to the cover.",
};

// ── Save-outcome states (driven via the controllable stub) ───────────────────

// Sets a controlled textarea's value the way React's change tracking expects,
// so onChange fires and `draft` advances before we click Continue and save.
function setReactTextareaValue(textarea: HTMLTextAreaElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	setter?.call(textarea, value);
	textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

// Enters the editor (the surface is display-first now), types a changed intent,
// then clicks "Continue and save" once. The value is set a frame before the
// click so React has committed `draft` — otherwise the handler reads the stale
// empty draft and early-returns instead of saving.
function useAutoSave(value: string) {
	useEffect(() => {
		let raf = 0;
		const tick = () => {
			const dialog = document.querySelector('[role="dialog"]');
			const textarea = dialog?.querySelector(
				"textarea",
			) as HTMLTextAreaElement | null;
			if (!textarea) {
				// Collapsed display — click the text to open the editor.
				const editButton = Array.from(
					dialog?.querySelectorAll("button") ?? [],
				).find((b) => /\bedit\b/i.test(b.textContent ?? "")) as
					| HTMLButtonElement
					| undefined;
				editButton?.click();
				raf = requestAnimationFrame(tick);
				return;
			}
			if (textarea.value !== value) {
				setReactTextareaValue(textarea, value);
				raf = requestAnimationFrame(tick);
				return;
			}
			const saveButton = Array.from(
				dialog?.querySelectorAll("button") ?? [],
			).find((b) => b.textContent?.trim() === "Continue and save") as
				| HTMLButtonElement
				| undefined;
			if (saveButton && !saveButton.disabled) {
				saveButton.click();
				return;
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [value]);
}

function DrivenHarness({
	behavior,
	value = "songs i run to",
}: {
	behavior: SaveMatchIntentBehavior;
	value?: string;
}) {
	useAutoSave(value);
	return <Harness playlist={BASE_PLAYLIST} behavior={behavior} />;
}

export const Saving: Story = () => <DrivenHarness behavior="hang" />;
Saving.meta = {
	description:
		"Save in flight (stub never settles): textarea disabled, button reads 'Saving…'.",
};

export const SaveFailed: Story = () => <DrivenHarness behavior="fail" />;
SaveFailed.meta = {
	description: "Inline 'Something went sideways saving that. Try again?' line.",
};
