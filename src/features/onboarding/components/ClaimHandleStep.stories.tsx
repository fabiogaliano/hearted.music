import type { Story } from "@ladle/react";
import { useEffect } from "react";
import {
	type HandleAvailabilityBehavior,
	setHandleAvailabilityBehavior,
} from "@/__mocks__/account-handle.functions.stub";
import type { ClaimHandleSeed } from "@/lib/domains/library/accounts/claim-handle-seed";
import { ClaimHandleStep } from "./ClaimHandleStep";

/**
 * ClaimHandleStep is an uncontrolled state machine driven by the seed prop, live
 * format validation, and a debounced availability query. In Ladle the query's
 * server function is swapped for a controllable stub (ladle-vite.config.ts), so
 * `availability` here drives the check/available/taken/blocked/error states.
 *
 * Format-error and reserved states need no stub: invalid or reserved input keeps
 * the query disabled, so they render synchronously from a `suggested` seed value.
 */

export default {
	title: "Onboarding/ClaimHandleStep",
};

const ACCOUNT_ID = "acc_ladle";

// Mirrors StepContainer's non-fullBleed centering so the step reads like the page.
function Centered({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex min-h-screen items-center justify-center px-6">
			<div className="w-full max-w-2xl">{children}</div>
		</div>
	);
}

function Harness({
	seed,
	availability,
}: {
	seed: ClaimHandleSeed;
	availability?: HandleAvailabilityBehavior;
}) {
	// Set during render so the behavior is in place before the availability query
	// dispatches from the child's effect phase (see the stub header).
	if (availability) setHandleAvailabilityBehavior(availability);

	return (
		<Centered>
			<ClaimHandleStep accountId={ACCOUNT_ID} claimHandleSeed={seed} />
		</Centered>
	);
}

// ── Seed states ─────────────────────────────────────────────────────────────

export const Blank: Story = () => <Harness seed={{ kind: "blank" }} />;
Blank.meta = {
	description:
		"Empty field with the default helper line. Continue is disabled until a handle is available.",
};

export const Owned: Story = () => (
	<Harness seed={{ kind: "owned", handle: "fabio" }} />
);
Owned.meta = {
	description:
		"Account already owns this handle: no availability check, preview shown, Continue enabled.",
};

// ── Availability states (controllable stub) ─────────────────────────────────

// Uses a handle unique to this story on purpose. The "checking" stub never
// settles, so its query stays in flight forever — and React Query neither
// garbage-collects an in-flight query nor re-runs the queryFn for a key that's
// already fetching; it dedupes new observers onto the existing promise. A handle
// shared with another story (they all defaulted to "fabio") would therefore
// attach that story to this dead promise, so e.g. the error state would read as
// a permanent "Checking availability" instead of its own result.
export const CheckingAvailability: Story = () => (
	<Harness
		seed={{ kind: "suggested", handle: "checking" }}
		availability="checking"
	/>
);
CheckingAvailability.meta = {
	description: "Debounced query in flight — the stub never settles.",
};

export const Available: Story = () => (
	<Harness
		seed={{ kind: "suggested", handle: "fabio" }}
		availability="available"
	/>
);
Available.meta = {
	description:
		"Suggested seed confirmed available: accent status, live preview, Continue enabled.",
};

export const UnavailableTaken: Story = () => (
	<Harness
		seed={{ kind: "suggested", handle: "taylorswift" }}
		availability="taken"
	/>
);
UnavailableTaken.meta = {
	description: "Handle already claimed by someone else.",
};

export const UnavailableBlocked: Story = () => (
	<Harness
		seed={{ kind: "suggested", handle: "somehandle" }}
		availability="profanity"
	/>
);
UnavailableBlocked.meta = {
	description: "Handle rejected by the profanity filter.",
};

export const AvailabilityError: Story = () => (
	<Harness seed={{ kind: "suggested", handle: "fabio" }} availability="error" />
);
AvailabilityError.meta = {
	description:
		"Availability check failed — shows the inline 'Check again' retry.",
};

// ── Format-error states (no stub needed) ────────────────────────────────────

export const FormatContainsAtSign: Story = () => (
	<Harness seed={{ kind: "suggested", handle: "@fabio" }} />
);

export const FormatInvalidChars: Story = () => (
	<Harness seed={{ kind: "suggested", handle: "fabio!" }} />
);

export const FormatLeadingPeriod: Story = () => (
	<Harness seed={{ kind: "suggested", handle: ".fabio" }} />
);

export const FormatTrailingPeriod: Story = () => (
	<Harness seed={{ kind: "suggested", handle: "fabio." }} />
);

export const FormatConsecutivePeriods: Story = () => (
	<Harness seed={{ kind: "suggested", handle: "fa..bio" }} />
);

export const FormatTooLong: Story = () => (
	<Harness seed={{ kind: "suggested", handle: "a".repeat(31) }} />
);

export const ReservedHandle: Story = () => (
	<Harness seed={{ kind: "suggested", handle: "admin" }} />
);
ReservedHandle.meta = {
	description: "Locally reserved word — flagged without hitting the server.",
};

// ── Interaction-driven states ───────────────────────────────────────────────

// Sets a controlled input's value the way React's change tracking expects, so
// onChange fires and the component's state machine advances.
function setReactInputValue(input: HTMLInputElement, value: string) {
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	)?.set;
	setter?.call(input, value);
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

export const OwnedEditedAway: Story = () => {
	// Typing away from an owned seed surfaces the "already @fabio" reminder + reset.
	useEffect(() => {
		const raf = requestAnimationFrame(() => {
			const input = document.getElementById(
				"claim-handle-input",
			) as HTMLInputElement | null;
			if (input) setReactInputValue(input, "fabio.new");
		});
		return () => cancelAnimationFrame(raf);
	}, []);

	return (
		<Centered>
			<ClaimHandleStep
				accountId={ACCOUNT_ID}
				claimHandleSeed={{ kind: "owned", handle: "fabio" }}
			/>
		</Centered>
	);
};
OwnedEditedAway.meta = {
	description:
		"Owned handle edited away: reminder copy plus the 'Use @fabio' reset action.",
};

export const Submitting: Story = () => {
	setHandleAvailabilityBehavior("available");

	// Once the suggested handle resolves available, submit so the step freezes in
	// its in-flight "Saving…" state (the claim stub never settles).
	useEffect(() => {
		let raf = 0;
		const tick = () => {
			const form = document.querySelector("form");
			const button = form?.querySelector(
				'button[type="submit"]',
			) as HTMLButtonElement | null;
			if (form && button && !button.disabled) {
				form.requestSubmit();
				return;
			}
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, []);

	return (
		<Centered>
			<ClaimHandleStep
				accountId={ACCOUNT_ID}
				claimHandleSeed={{ kind: "suggested", handle: "fabio" }}
			/>
		</Centered>
	);
};
Submitting.meta = {
	description:
		"Claim in flight: read-only field, dimmed input, 'Saving…' on the button.",
};
