/**
 * Claim handle step — the one onboarding step that uses a semantic <form>
 * instead of the global `useShortcut("enter")` pattern, because the keyboard
 * provider suppresses shortcuts while focus is inside an <input>.
 *
 * Three distinct concepts drive the state machine:
 *   1. localFormatResult — output of validateHandleFormatInput on the current value
 *   2. availabilityVerdict — the latest authoritative server result for the debounced value
 *   3. isOwnedHandleState — whether claimHandleSeed.kind === "owned" and the
 *      current field value still exactly matches the seed handle
 *
 * Continue is actionable-only: enabled only when owned-equal OR
 * (format-valid + not-reserved + latest verdict === "available" + not submitting).
 */

import { ArrowRightIcon } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/Button";
import { Kbd } from "@/components/ui/kbd";
import { resolveSession } from "@/features/onboarding/step-resolver";
import { getPublicAppOrigin } from "@/lib/config/public-app-origin";
import type { ClaimHandleSeed } from "@/lib/domains/library/accounts/claim-handle-seed";
import type { HandleValidationReason } from "@/lib/domains/library/accounts/handle-rules";
import {
	isReservedHandle,
	validateHandleFormatInput,
} from "@/lib/domains/library/accounts/handle-rules";
import type { OnboardingAuthPayload } from "@/lib/domains/library/accounts/onboarding-session";
import {
	AUTH_SESSION_QUERY_KEY,
	ONBOARDING_SESSION_QUERY_KEY,
} from "@/lib/platform/auth/query-keys";
import {
	checkHandleAvailability,
	claimHandleAndAdvance,
} from "@/lib/server/account-handle.functions";
import { fonts } from "@/lib/theme/fonts";
import { StaggeredContent } from "./StaggeredContent";

// Loader-delay pattern (see github.com/smeijer/spin-delay): two thresholds keep
// the transient "Checking…" message from flashing.
//   • SHOW_DELAY — don't surface it until a lookup has been pending this long.
//     Quick checks resolve under it and go straight to the result.
//   • MIN_VISIBLE — once shown, hold it at least this long even if the result
//     lands immediately after, so a check that resolves just past SHOW_DELAY
//     can't flash the message on and instantly off.
const CHECKING_SHOW_DELAY_MS = 300;
const CHECKING_MIN_VISIBLE_MS = 500;

// ── Types ─────────────────────────────────────────────────────────────────────

type AvailabilityVerdict =
	| { status: "available" }
	| { status: "unavailable"; reason: HandleValidationReason }
	| { status: "error" }
	| null;

interface ClaimHandleStepProps {
	accountId: string;
	claimHandleSeed: ClaimHandleSeed;
}

// ── Copy helpers ───────────────────────────────────────────────────────────────

function reasonCopy(reason: HandleValidationReason): string {
	switch (reason) {
		case "empty":
			return "Enter a handle to continue.";
		case "contains_at_sign":
			return "Don’t include @ — it’s added to your public URL.";
		case "invalid_chars":
			return "Use only letters, numbers, periods, or underscores.";
		case "leading_period":
			return "Periods can’t start a username.";
		case "trailing_period":
			return "Periods can’t end a username.";
		case "consecutive_periods":
			return "Periods can’t appear twice in a row.";
		case "too_long":
			return "Handles can be up to 30 characters.";
		case "reserved":
			return "That handle is reserved.";
		case "profanity":
			return "That handle isn’t allowed.";
		case "taken":
			return "Someone got there first.";
	}
}

// ── Debounce hook ──────────────────────────────────────────────────────────────

function useDebounce<T>(value: T, delayMs: number): T {
	const [debounced, setDebounced] = useState<T>(value);
	useEffect(() => {
		const id = setTimeout(() => setDebounced(value), delayMs);
		return () => clearTimeout(id);
	}, [value, delayMs]);
	return debounced;
}

// ── Focus helper ───────────────────────────────────────────────────────────────

function focusInputAtEnd(input: HTMLInputElement | null) {
	if (!input) return;
	input.focus();
	const len = input.value.length;
	input.setSelectionRange(len, len);
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ClaimHandleStep({
	accountId,
	claimHandleSeed,
}: ClaimHandleStepProps) {
	const router = useRouter();
	const queryClient = useQueryClient();
	const inputRef = useRef<HTMLInputElement>(null);

	// Derived initial value from seed
	const initialValue =
		claimHandleSeed.kind === "blank" ? "" : claimHandleSeed.handle;

	const [value, setValue] = useState(initialValue);
	const [isSubmitting, setIsSubmitting] = useState(false);

	// When submit is in flight, we freeze the field readOnly and disable
	// new availability checks until the request settles.
	const [submitInFlight, setSubmitInFlight] = useState(false);

	// Submit-time unavailable verdict — overrides the query result as the
	// authoritative current-value verdict once returned by claimHandleAndAdvance.
	const [submitTimeUnavailable, setSubmitTimeUnavailable] =
		useState<HandleValidationReason | null>(null);

	// Delayed mirror of isChecking — gates only the *display* of the checking
	// message so fast lookups don't flash it. Submit gating still uses isChecking.
	// Refs let the driving effect depend solely on isChecking transitions without
	// re-running (and rescheduling its timers) when showChecking itself flips.
	const [showChecking, setShowChecking] = useState(false);
	const showCheckingRef = useRef(false);
	const checkingShownAtRef = useRef(0);

	// ── Owned-handle logic ────────────────────────────────────────────────────

	const ownedHandleSnapshot =
		claimHandleSeed.kind === "owned" ? claimHandleSeed.handle : null;

	// True only when the seed is "owned" and the field still holds the exact owned value.
	const isOwnedHandleState =
		claimHandleSeed.kind === "owned" && value === claimHandleSeed.handle;

	// True when seed is "owned" but the user has edited away from the seed value.
	const isEditedAwayFromOwned =
		claimHandleSeed.kind === "owned" && !isOwnedHandleState;

	// ── Local format validation ───────────────────────────────────────────────

	const formatResult = validateHandleFormatInput(value);
	const isFormatValid = formatResult.status === "valid";
	const formatReason =
		formatResult.status === "invalid" ? formatResult.reason : null;

	// Normalized handle only exists when format is valid.
	const normalizedHandle =
		formatResult.status === "valid" ? formatResult.normalizedHandle : null;

	// Locally reserved check (only when format is valid).
	const isLocallyReserved =
		isFormatValid &&
		normalizedHandle !== null &&
		isReservedHandle(normalizedHandle);

	// ── Debounced availability query ──────────────────────────────────────────

	// We debounce the value that drives the React Query key so:
	//   • Typing doesn't fire requests until the user pauses 250ms
	//   • The gcTime:0 + fresh key ensures edit-away-then-back forces a live check
	const debouncedValue = useDebounce(value, 250);

	// Only the debounced value that is ALSO format-valid, not locally reserved,
	// not owned-seed, and not submit-in-flight should trigger a query.
	// Once the debounce settles the two values are identical, so reuse the live
	// result instead of validating the same string twice per render.
	const debouncedFormatResult =
		debouncedValue === value
			? formatResult
			: validateHandleFormatInput(debouncedValue);
	const debouncedIsFormatValid = debouncedFormatResult.status === "valid";
	const debouncedNormalized =
		debouncedFormatResult.status === "valid"
			? debouncedFormatResult.normalizedHandle
			: null;
	const debouncedIsLocallyReserved =
		debouncedIsFormatValid &&
		debouncedNormalized !== null &&
		isReservedHandle(debouncedNormalized);

	// The query fires when:
	//   • not owned-seed (owned seed never checks availability)
	//   • debounced value is format-valid
	//   • debounced value is not locally reserved
	//   • submit is not in flight (to avoid late responses overwriting submit UI)
	//   • no active submit-time unavailable verdict — §8.4: don't re-fire the same
	//     unchanged value after a submit-time unavailable. Re-arming the stale query
	//     here would refetch and flicker "taken → Checking… → taken". handleChange
	//     clears it on edit, so edit-then-recheck still fires for the new value.
	const queryEnabled =
		claimHandleSeed.kind !== "owned" &&
		debouncedIsFormatValid &&
		!debouncedIsLocallyReserved &&
		debouncedValue.length > 0 &&
		!submitInFlight &&
		submitTimeUnavailable === null;

	// Query key includes ownedHandleSnapshot so that if the account later claims
	// a handle and the same-session session cache is updated, the key changes and
	// a fresh check occurs rather than serving a stale "available" result.
	const availabilityQueryKey = [
		"onboarding",
		"handle-availability",
		accountId,
		ownedHandleSnapshot,
		// Use the debounced value here so the query key only changes after the
		// 250ms debounce period, not on every keystroke.
		debouncedValue,
	] as const;

	const availabilityQuery = useQuery({
		queryKey: availabilityQueryKey,
		queryFn: () =>
			checkHandleAvailability({ data: { handle: debouncedValue } }),
		enabled: queryEnabled,
		retry: false,
		refetchOnWindowFocus: false,
		refetchOnReconnect: false,
		gcTime: 0,
		// staleTime: 0 ensures edit-away-then-back always re-fetches, not returning
		// a cached result for the same handle string.
		staleTime: 0,
	});

	// ── Verdict derivation ────────────────────────────────────────────────────

	// The current-value verdict for the LIVE input (not debounced).
	// Rules:
	//   • If the live value differs from the debounced value, we're in the
	//     debounce gap — no verdict yet, clear old one.
	//   • If submit returned unavailable for this exact value, that overrides.
	//   • Otherwise use the React Query result if it matches the live value.
	const isInDebouncedGap = value !== debouncedValue;

	let currentVerdict: AvailabilityVerdict = null;

	if (!isOwnedHandleState && !isEditedAwayFromOwned) {
		if (submitTimeUnavailable !== null && !isInDebouncedGap) {
			// Submit-time unavailable is authoritative until the user edits.
			currentVerdict = { status: "unavailable", reason: submitTimeUnavailable };
		} else if (!isInDebouncedGap && queryEnabled && availabilityQuery.data) {
			// Use React Query data only when the debounced value matches the live value.
			const data = availabilityQuery.data;
			if (data.status === "available") {
				currentVerdict = { status: "available" };
			} else if (data.status === "unavailable") {
				currentVerdict = { status: "unavailable", reason: data.reason };
			} else if (data.status === "error") {
				currentVerdict = { status: "error" };
			}
			// "already_owned" during availability is handled in the effect below.
		} else if (
			!isInDebouncedGap &&
			queryEnabled &&
			availabilityQuery.isLoading
		) {
			// Query is in-flight — "checking" state (null verdict, checking handled
			// by availabilityQuery.isFetching).
			currentVerdict = null;
		}
	}

	const isChecking =
		!isInDebouncedGap &&
		queryEnabled &&
		(availabilityQuery.isFetching || availabilityQuery.isLoading);

	// Drive showChecking through the two thresholds. While a lookup is pending,
	// arm a SHOW_DELAY timer to reveal the message; if the lookup resolves first,
	// the cleanup clears it and the message is never shown. Once it *is* shown,
	// defer hiding until MIN_VISIBLE has elapsed so it can't flash off instantly.
	useEffect(() => {
		if (isChecking) {
			if (showCheckingRef.current) return;
			const id = setTimeout(() => {
				showCheckingRef.current = true;
				checkingShownAtRef.current = performance.now();
				setShowChecking(true);
			}, CHECKING_SHOW_DELAY_MS);
			return () => clearTimeout(id);
		}

		if (!showCheckingRef.current) {
			setShowChecking(false);
			return;
		}

		const remaining =
			CHECKING_MIN_VISIBLE_MS -
			(performance.now() - checkingShownAtRef.current);
		if (remaining <= 0) {
			showCheckingRef.current = false;
			setShowChecking(false);
			return;
		}
		const id = setTimeout(() => {
			showCheckingRef.current = false;
			setShowChecking(false);
		}, remaining);
		return () => clearTimeout(id);
	}, [isChecking]);

	// ── Authoritative server-result application ──────────────────────────────

	// Every server result that resolves this step the same way: patch the
	// onboarding-session cache, patch the session cache's handle when the server
	// confirmed one, then navigate wherever the authoritative session says.
	// One helper so the four call sites (availability-time already_owned plus
	// the three submit branches) can never drift apart.
	const applyAuthoritativeOnboarding = useCallback(
		(onboarding: OnboardingAuthPayload, ownedHandle?: string) => {
			queryClient.setQueryData(ONBOARDING_SESSION_QUERY_KEY, onboarding);
			if (ownedHandle !== undefined) {
				queryClient.setQueryData(AUTH_SESSION_QUERY_KEY, (prev: unknown) => {
					if (!prev || typeof prev !== "object") return prev;
					const p = prev as { account?: Record<string, unknown> };
					return {
						...p,
						account: {
							...p.account,
							handle: ownedHandle,
						},
					};
				});
			}

			const { allowedPath } = resolveSession(onboarding.session);
			if (allowedPath === "/onboarding") {
				router.navigate({
					to: "/onboarding",
					search: { step: onboarding.session.status },
				});
			} else {
				router.navigate({ to: allowedPath });
			}
		},
		[queryClient, router],
	);

	// ── Handle availability-time already_owned as immediate recovery ──────────

	useEffect(() => {
		if (!availabilityQuery.data) return;
		const data = availabilityQuery.data;
		if (data.status !== "already_owned") return;

		// Availability returned already_owned — patch both caches and navigate.
		// This is authoritative stale-state correction, not a validation error.
		applyAuthoritativeOnboarding(data.onboarding, data.ownedHandle);
	}, [availabilityQuery.data, applyAuthoritativeOnboarding]);

	// ── CTA gating ────────────────────────────────────────────────────────────

	// Continue enables only when:
	//   (owned-handle state AND not submitting)
	//   OR (format-valid + not-reserved + latest verdict available + not submitting)
	const canContinue =
		!isSubmitting &&
		(isOwnedHandleState ||
			(isFormatValid &&
				!isLocallyReserved &&
				currentVerdict?.status === "available"));

	// ── Input change handler ──────────────────────────────────────────────────

	const handleChange = useCallback(
		(e: React.ChangeEvent<HTMLInputElement>) => {
			if (submitInFlight) return;
			// Live-lowercase; preserve all other chars exactly (no slugification).
			const lowered = e.target.value.toLowerCase();
			setValue(lowered);
			// Clear any submit-time unavailable verdict as soon as the user edits.
			setSubmitTimeUnavailable(null);
		},
		[submitInFlight],
	);

	// ── Reset (owned-edited-away → restore owned handle) ─────────────────────

	const handleReset = useCallback(() => {
		if (claimHandleSeed.kind !== "owned") return;
		setValue(claimHandleSeed.handle);
		setSubmitTimeUnavailable(null);
		// Return focus to the input with caret at end.
		requestAnimationFrame(() => focusInputAtEnd(inputRef.current));
	}, [claimHandleSeed]);

	// ── Retry availability ────────────────────────────────────────────────────

	const handleRetry = useCallback(async () => {
		// Bypass debounce: force refetch for the current visible value immediately.
		await availabilityQuery.refetch();
		// Once settled, return focus to the input with caret at end.
		focusInputAtEnd(inputRef.current);
	}, [availabilityQuery]);

	// ── Submit ────────────────────────────────────────────────────────────────

	const handleSubmit = useCallback(
		async (e: React.FormEvent<HTMLFormElement>) => {
			e.preventDefault();

			// Branch by submit-state — one explicit path.

			// Owned-handle edited away → no-op (keep value, keep reminder visible).
			if (isEditedAwayFromOwned) return;

			// Blank, format-invalid, or locally reserved → defensive no-op.
			if (!isFormatValid || isLocallyReserved) return;

			// No current-value verdict yet (debounce gap, checking) → no-op.
			if (!isOwnedHandleState && !currentVerdict) return;
			if (!isOwnedHandleState && isChecking) return;

			// Availability error → keep existing retry state; don't submit.
			if (currentVerdict?.status === "error") return;

			// Not available and not owned-equal → no-op.
			if (!isOwnedHandleState && currentVerdict?.status !== "available") return;

			// ── Real claim branch ────────────────────────────────────────────────

			const submittedHandle = value; // snapshot before any state change
			setSubmitInFlight(true);
			setIsSubmitting(true);

			let result: Awaited<ReturnType<typeof claimHandleAndAdvance>>;
			try {
				result = await claimHandleAndAdvance({
					data: { handle: submittedHandle },
				});
			} catch {
				// Operational failure — toast and restore editability.
				toast.error("Couldn’t save your handle. Please try again.");
				setSubmitInFlight(false);
				setIsSubmitting(false);
				requestAnimationFrame(() => focusInputAtEnd(inputRef.current));
				return;
			}

			// Handle each result branch.

			if (result.status === "not_ready") {
				// Out-of-order stale-client path. Patch onboarding-session only —
				// the server confirmed no handle, so the session cache stays as-is.
				applyAuthoritativeOnboarding(result.onboarding);
				return;
			}

			if (result.status === "already_owned") {
				// Stale-tab submit for a different already-owned handle.
				applyAuthoritativeOnboarding(result.onboarding, result.ownedHandle);
				return;
			}

			if (result.status === "claimed") {
				// Successful claim.
				applyAuthoritativeOnboarding(result.onboarding, result.ownedHandle);
				return;
			}

			if (result.status === "unavailable") {
				// Submit-time unavailable — becomes the authoritative verdict for this value.
				// Drive the dynamic region from reason; hide preview; keep user on step.
				setSubmitTimeUnavailable(result.reason);
				setSubmitInFlight(false);
				setIsSubmitting(false);
				requestAnimationFrame(() => focusInputAtEnd(inputRef.current));
				return;
			}

			// Fallback: unexpected result — restore editability.
			setSubmitInFlight(false);
			setIsSubmitting(false);
			requestAnimationFrame(() => focusInputAtEnd(inputRef.current));
		},
		[
			value,
			isOwnedHandleState,
			isEditedAwayFromOwned,
			isFormatValid,
			isLocallyReserved,
			currentVerdict,
			isChecking,
			applyAuthoritativeOnboarding,
		],
	);

	// ── Dynamic status region content ─────────────────────────────────────────

	// Returns { text, showRetry, showReset } for the dynamic region.
	// This is the single source of truth for the status region.
	const dynamicStatus = (() => {
		// Owned-handle states take priority.
		if (isOwnedHandleState) {
			return {
				text: "Using your current handle.",
				showRetry: false,
				showReset: false,
			};
		}
		if (isEditedAwayFromOwned && claimHandleSeed.kind === "owned") {
			return {
				text: `Your handle is already @${claimHandleSeed.handle}.`,
				showRetry: false,
				showReset: true,
			};
		}

		// Empty — neutral (no error copy for ordinary empty editing).
		if (value === "") {
			return { text: "", showRetry: false, showReset: false };
		}

		// Format errors.
		if (!isFormatValid && formatReason) {
			return {
				text: reasonCopy(formatReason),
				showRetry: false,
				showReset: false,
			};
		}

		// Locally reserved.
		if (isLocallyReserved) {
			return {
				text: reasonCopy("reserved"),
				showRetry: false,
				showReset: false,
			};
		}

		// Debounce gap — neutral while waiting for check.
		if (isInDebouncedGap) {
			return { text: "", showRetry: false, showReset: false };
		}

		// Checking — only surfaced once the lookup outlasts the display threshold.
		// The trailing dots are animated in via .hearted-ellipsis, so the text
		// itself omits them (a static "…" returns under reduced motion).
		if (showChecking) {
			return {
				text: "Checking availability",
				showRetry: false,
				showReset: false,
			};
		}

		// Submit-time unavailable (already captured into currentVerdict).
		if (currentVerdict?.status === "unavailable") {
			return {
				text: reasonCopy(currentVerdict.reason),
				showRetry: false,
				showReset: false,
			};
		}

		// Available.
		if (currentVerdict?.status === "available") {
			return { text: "Available.", showRetry: false, showReset: false };
		}

		// Error.
		if (currentVerdict?.status === "error") {
			return {
				text: "Couldn’t check that one. Give it another go.",
				showRetry: true,
				showReset: false,
			};
		}

		return { text: "", showRetry: false, showReset: false };
	})();

	// One feedback line below the field: the live status takes over from the
	// static helper whenever the field has something to report, so guidance and
	// validation never stack as two near-identical lines.
	const hasStatus = dynamicStatus.text !== "";

	// Success leans on the accent; problems use full-strength text so they register
	// against the pastel background (the palette has no red); transient and neutral
	// states stay muted.
	const statusToneClass =
		currentVerdict?.status === "available"
			? "theme-primary"
			: showChecking || isOwnedHandleState || dynamicStatus.showReset
				? "theme-text-muted"
				: "theme-text";

	// ── Address prefix ──────────────────────────────────────────────────────────

	const publicAppOrigin = getPublicAppOrigin();
	// Bare domain (no scheme) so the field reads like an address rather than a
	// raw URL — "hearted.music/@you", not "http://127.0.0.1:5173/@you".
	const previewDomain = publicAppOrigin.replace(/^https?:\/\//, "");

	// ── Render ────────────────────────────────────────────────────────────────

	return (
		<>
			<StaggeredContent>
				<h2
					className="theme-text text-6xl leading-tight font-extralight"
					style={{ fontFamily: fonts.display }}
				>
					Your
					<br />
					<em className="font-normal">hearted.</em> handle
				</h2>

				<form
					onSubmit={handleSubmit}
					noValidate
					className="mt-16 max-w-md text-left"
				>
					{/* The field renders the live address: a muted, non-editable
					    {domain}/@ prefix sits flush against the input so the value the
					    user types reads as their real URL — the prefix is never part of
					    the typed value. */}
					<div
						className={[
							"theme-border-color flex items-baseline border-b",
							"transition-[border-color] duration-150 ease-out",
							"focus-within:border-[color:var(--t-primary)]",
							submitInFlight ? "opacity-70" : "",
						]
							.filter(Boolean)
							.join(" ")}
					>
						<span
							aria-hidden="true"
							className="theme-text-muted shrink-0 select-none py-2 text-lg whitespace-nowrap"
							style={{ fontFamily: fonts.body }}
						>
							{previewDomain}/@
						</span>
						<input
							id="claim-handle-input"
							ref={inputRef}
							type="text"
							value={value}
							onChange={handleChange}
							readOnly={submitInFlight}
							// biome-ignore lint/a11y/noAutofocus: §8.3 mandates autoFocus on mount — dedicated single-field onboarding step; intentional expected.
							autoFocus
							autoCapitalize="none"
							autoCorrect="off"
							spellCheck={false}
							autoComplete="off"
							placeholder="fabio"
							aria-label="Handle"
							aria-describedby="claim-handle-helper claim-handle-status"
							className="theme-text min-w-0 flex-1 bg-transparent py-2 text-lg outline-none"
							style={{ fontFamily: fonts.body }}
						/>
					</div>

					{/* Feedback — guidance by default; the live status takes over the
					    line whenever the field has something to report. Both stay in the
					    DOM for aria-describedby, but only one is ever visible. */}
					<div className="mt-3 min-h-5 text-sm">
						<p
							id="claim-handle-helper"
							hidden={hasStatus}
							className="theme-text-muted"
							style={{ fontFamily: fonts.body }}
						>
							Letters, numbers, periods, and underscores.
						</p>

						<div
							id="claim-handle-status"
							aria-live="polite"
							style={{ fontFamily: fonts.body }}
						>
							{dynamicStatus.text && (
								<span className={statusToneClass}>
									{dynamicStatus.text}
									{showChecking && (
										<span className="hearted-ellipsis" aria-hidden="true" />
									)}
								</span>
							)}

							{/* Reset action for owned-edited-away */}
							{dynamicStatus.showReset && claimHandleSeed.kind === "owned" && (
								<>
									{" "}
									<button
										type="button"
										onClick={handleReset}
										className="theme-primary underline cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
										style={{ fontFamily: fonts.body }}
									>
										Use @{claimHandleSeed.handle}
									</button>
								</>
							)}

							{/* Retry action for availability error */}
							{dynamicStatus.showRetry && (
								<>
									{" "}
									<button
										type="button"
										onClick={handleRetry}
										className="theme-primary underline cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-2 [outline-color:var(--t-primary)]"
										style={{ fontFamily: fonts.body }}
									>
										Check again
									</button>
								</>
							)}
						</div>
					</div>

					{/* Submit button */}
					<Button
						type="submit"
						variant="link"
						disabled={!canContinue}
						className="mt-12"
						style={{ fontFamily: fonts.body }}
					>
						<span className="text-lg font-medium tracking-wide">
							{isSubmitting ? "Saving…" : "Continue"}
						</span>
						<ArrowRightIcon
							size={16}
							className="theme-text-muted inline-block transition-transform group-hover:translate-x-1"
						/>
					</Button>
				</form>
			</StaggeredContent>

			<div className="theme-kbd-scope fixed right-0 bottom-6 left-0 flex items-center justify-center gap-6 opacity-60">
				<div className="flex items-center gap-1.5">
					<Kbd>⏎</Kbd>
					<span className="text-xs">to continue</span>
				</div>
			</div>
		</>
	);
}
