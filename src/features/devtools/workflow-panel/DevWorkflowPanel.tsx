import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { resolveSession } from "@/features/onboarding/step-resolver";
import { PaneRoot, PaneSlot, PaneStore, usePane } from "@/integrations/uipane";
import type { OnboardingAuthPayload } from "@/lib/domains/library/accounts/onboarding-session";
import {
	DEFAULT_ONBOARDING_STEP,
	getNextOnboardingStep,
	getPreviousOnboardingStep,
	ONBOARDING_STEP_VALUES,
	type OnboardingStep,
} from "@/lib/domains/library/accounts/onboarding-steps";
import { ONBOARDING_SESSION_QUERY_KEY } from "@/lib/platform/auth/query-keys";
import {
	getOnboardingSession,
	markOnboardingComplete,
	saveOnboardingStep,
} from "@/lib/server/onboarding.functions";
import { errorMessage } from "@/lib/shared/errors/error-message";

const ONBOARDING_PANE_NAME = "Onboarding";

export function DevWorkflowPanel() {
	const queryClient = useQueryClient();
	const router = useRouter();
	const [lastAction, setLastAction] = useState("");
	const isRunningRef = useRef(false);

	const { data: liveOnboarding } = useQuery<OnboardingAuthPayload>({
		queryKey: ONBOARDING_SESSION_QUERY_KEY,
		queryFn: () => getOnboardingSession(),
	});
	const currentOnboardingStep: OnboardingStep =
		liveOnboarding?.session.status === "complete"
			? "complete"
			: (liveOnboarding?.session.status ?? DEFAULT_ONBOARDING_STEP);

	const stepOptions = useMemo(
		() =>
			ONBOARDING_STEP_VALUES.map((s, i) => {
				const num = String(i + 1).padStart(2, "0");
				return {
					value: s,
					label:
						s === currentOnboardingStep
							? `${num}. ${s} (current)`
							: `${num}. ${s}`,
				};
			}),
		[currentOnboardingStep],
	);

	const handleOnboardingNav = useCallback(
		async (target: OnboardingStep | "prev" | "next") => {
			if (isRunningRef.current) return;
			isRunningRef.current = true;

			const cached = queryClient.getQueryData<OnboardingAuthPayload>(
				ONBOARDING_SESSION_QUERY_KEY,
			);
			const currentStep: OnboardingStep =
				cached?.session.status === "complete"
					? "complete"
					: (cached?.session.status ?? DEFAULT_ONBOARDING_STEP);

			let nextStep: OnboardingStep;
			if (target === "prev") {
				const prev = getPreviousOnboardingStep(currentStep);
				if (!prev) {
					setLastAction(`Already at first step (${currentStep})`);
					isRunningRef.current = false;
					return;
				}
				nextStep = prev;
			} else if (target === "next") {
				const next = getNextOnboardingStep(currentStep);
				if (!next) {
					setLastAction(`Already at last step (${currentStep})`);
					isRunningRef.current = false;
					return;
				}
				nextStep = next;
			} else {
				nextStep = target;
			}

			try {
				setLastAction(`Setting step → ${nextStep}…`);

				if (nextStep === "complete") {
					// Completion must go through the structured gate — not saveOnboardingStep.
					const result = await markOnboardingComplete();
					// Patch cache with authoritative payload, then navigate via resolver.
					queryClient.setQueryData(
						ONBOARDING_SESSION_QUERY_KEY,
						result.onboarding,
					);
					const resolved = resolveSession(result.onboarding.session);
					await router.navigate({ to: resolved.allowedPath });
					setLastAction(`${currentStep} → complete (${result.status})`);
				} else {
					await saveOnboardingStep({ data: { step: nextStep } });

					// Fetch the authoritative session so the resolver can make routing
					// decisions against it — jumping into a walkthrough step without a
					// demo song trips the dev invariant loudly, which is what we want.
					const nextSession = await queryClient.fetchQuery({
						queryKey: ONBOARDING_SESSION_QUERY_KEY,
						queryFn: () => getOnboardingSession(),
					});

					const resolved = resolveSession(nextSession.session);
					if (resolved.allowedPath === "/onboarding") {
						await router.navigate({
							to: "/onboarding",
							search: { step: nextStep },
						});
					} else {
						await router.navigate({ to: resolved.allowedPath });
					}

					setLastAction(`${currentStep} → ${nextStep}`);
				}
			} catch (e) {
				setLastAction(`Step error: ${errorMessage(e)}`);
			} finally {
				isRunningRef.current = false;
			}
		},
		[queryClient, router],
	);

	const onboardingParams = usePane(
		"Onboarding",
		{
			matching: {
				type: "folder",
				open: false,
				children: {
					enabled: { type: "toggle", value: false },
					status: { type: "slot" },
					matchSource: { type: "toggle", value: true },
					simulateRealReady: { type: "action", label: "Simulate Real Ready" },
				},
			},
			navigation: {
				type: "folder",
				open: true,
				children: {
					step: {
						type: "select",
						value: currentOnboardingStep,
						options: stepOptions,
					},
					prev: { type: "action", label: "← Prev" },
					next: { type: "action", label: "Next →" },
				},
			},
		},
		{
			onAction: (path) => {
				switch (path) {
					case "navigation.prev":
						void handleOnboardingNav("prev");
						break;
					case "navigation.next":
						void handleOnboardingNav("next");
						break;
					case "matching.simulateRealReady": {
						const id = PaneStore.getPanels().find(
							(p) => p.name === ONBOARDING_PANE_NAME,
						)?.id;
						if (!id) break;
						const vals = PaneStore.getValues(id);
						if (!(vals["matching.enabled"] as boolean)) break;
						PaneStore.updateValue(id, "realAvailable", true);
						break;
					}
				}
			},
		},
	);

	const selectedStep = onboardingParams.navigation.step as OnboardingStep;
	const prevSelectedStep = useRef(selectedStep);
	useEffect(() => {
		if (selectedStep !== prevSelectedStep.current) {
			prevSelectedStep.current = selectedStep;
			void handleOnboardingNav(selectedStep);
		}
	}, [selectedStep, handleOnboardingNav]);

	const realAvailable = usePaneRealAvailable();

	return (
		<PaneRoot>
			{lastAction && (
				<div
					style={{
						fontSize: 11,
						fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
						color: "#a3a3a3",
						padding: "5px 7px",
						background: "#141414",
						borderRadius: 6,
						wordBreak: "break-word",
					}}
				>
					{lastAction}
				</div>
			)}
			<PaneSlot panel="Onboarding" path="matching.status">
				<MatchStatusBadges
					matchSource={onboardingParams.matching.matchSource}
					realAvailable={realAvailable}
				/>
			</PaneSlot>
		</PaneRoot>
	);
}

function usePaneRealAvailable(): boolean {
	return useSyncExternalStore(
		(cb) => {
			const id = PaneStore.getPanels().find(
				(p) => p.name === ONBOARDING_PANE_NAME,
			)?.id;
			if (!id) return () => {};
			return PaneStore.subscribe(id, cb);
		},
		() => {
			const id = PaneStore.getPanels().find(
				(p) => p.name === ONBOARDING_PANE_NAME,
			)?.id;
			if (!id) return false;
			const vals = PaneStore.getValues(id) as { realAvailable?: boolean };
			return vals.realAvailable ?? false;
		},
		() => false,
	);
}

function MatchStatusBadges({
	matchSource,
	realAvailable,
}: {
	matchSource: boolean;
	realAvailable: boolean;
}) {
	return (
		<>
			<div className="up-labeled-row">
				<span className="up-labeled-row-label">Match view</span>
				<span
					style={{ fontSize: 11, color: matchSource ? "#86efac" : "#737373" }}
				>
					{matchSource ? "real" : "fallback"}
				</span>
			</div>
			<div className="up-labeled-row">
				<span className="up-labeled-row-label">Real matches</span>
				<span
					style={{ fontSize: 11, color: realAvailable ? "#86efac" : "#737373" }}
				>
					{realAvailable ? "ready" : "waiting"}
				</span>
			</div>
		</>
	);
}
