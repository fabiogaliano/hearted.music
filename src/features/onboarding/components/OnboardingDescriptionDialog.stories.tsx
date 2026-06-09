import type { Story } from "@ladle/react";
import { useEffect, useState } from "react";
import {
	type DescriptionSaveBehavior,
	setDescriptionSaveBehavior,
} from "@/__mocks__/playlist-description-save.stub";
import type { OnboardingPlaylist } from "@/lib/server/onboarding.functions";
import { OnboardingDescriptionDialog } from "./OnboardingDescriptionDialog";

/**
 * The teaching dialog that fires the first time a playlist is selected on the
 * flag-playlists step. In Ladle its save path is swapped for a controllable stub
 * (ladle-vite.config.ts), so `behavior` drives the outcomes the UI renders
 * differently — success/close, the inline failure line, the reconnect swap, and
 * the frozen "Saving…" state.
 */

export default {
	title: "Onboarding/DescriptionDialog",
};

const BASE_PLAYLIST: OnboardingPlaylist = {
	id: "pl_ladle",
	spotifyId: "37i9dQZF1DXcBWIGoYBM5M",
	name: "songs i run to",
	description: null,
	imageUrl: null,
	songCount: 42,
	isTarget: false,
};

function Harness({
	playlist,
	behavior = "ready",
}: {
	playlist: OnboardingPlaylist;
	behavior?: DescriptionSaveBehavior;
}) {
	// Set during render so the outcome is in place before any auto-save fires.
	setDescriptionSaveBehavior(behavior);

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
					onClose={() => setOpen(false)}
				/>
			)}
		</div>
	);
}

// ── Static states (the main UI-editing surface) ──────────────────────────────

export const Default: Story = () => <Harness playlist={BASE_PLAYLIST} />;
Default.meta = {
	description:
		"First-selection teaching dialog, empty description so the placeholder shows. Save closes; Skip closes.",
};

export const WithExistingDescription: Story = () => (
	<Harness
		playlist={{
			...BASE_PLAYLIST,
			description: "songs that make me cry on purpose",
		}}
	/>
);
WithExistingDescription.meta = {
	description: "Pre-filled draft — the textarea autosizes to the content.",
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
// so onChange fires and `draft` advances before we click Save.
function setReactTextareaValue(textarea: HTMLTextAreaElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	)?.set;
	setter?.call(textarea, value);
	textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

// Types a changed description into the dialog, then clicks Save once. The value
// is set a frame before the click so React has committed `draft` — otherwise
// handleSave reads the stale empty draft and early-returns instead of saving.
function useAutoSave(value: string) {
	useEffect(() => {
		let raf = 0;
		const tick = () => {
			const dialog = document.querySelector('[role="dialog"]');
			const textarea = dialog?.querySelector(
				"textarea",
			) as HTMLTextAreaElement | null;
			if (!textarea) {
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
			).find((b) => b.textContent?.trim() === "Save") as
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
	behavior: DescriptionSaveBehavior;
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

export const SaveFailed: Story = () => (
	<DrivenHarness behavior="fetch-failed" />
);
SaveFailed.meta = {
	description: "Inline 'Something went sideways saving that. Try again?' line.",
};

export const ReconnectRequired: Story = () => (
	<DrivenHarness behavior="reconnect-required" />
);
ReconnectRequired.meta = {
	description: "Save swaps to the 'Reconnect Spotify to Save' link.",
};
