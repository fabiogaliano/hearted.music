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
import { PaneRoot, PaneSlot, PaneStore, usePane } from "uipane";
import { resolveSession } from "@/features/onboarding/step-resolver";
import type { OnboardingStep } from "@/lib/domains/library/accounts/preferences-queries";
import type { OnboardingAuthPayload } from "@/lib/server/onboarding.functions";
import {
	getOnboardingSession,
	saveOnboardingStep,
} from "@/lib/server/onboarding.functions";

const ONBOARDING_STEPS: OnboardingStep[] = [
	"welcome",
	"pick-color",
	"install-extension",
	"syncing",
	"flag-playlists",
	"pick-demo-song",
	"song-walkthrough",
	"match-walkthrough",
	"plan-selection",
	"complete",
];

const ONBOARDING_SESSION_QUERY_KEY = ["auth", "onboarding-session"] as const;
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
			: (liveOnboarding?.session.status ?? "welcome");

	const stepOptions = useMemo(
		() =>
			ONBOARDING_STEPS.map((s, i) => {
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
					: (cached?.session.status ?? "welcome");
			const currentIdx = ONBOARDING_STEPS.indexOf(currentStep);

			let nextStep: OnboardingStep;
			if (target === "prev") {
				if (currentIdx <= 0) {
					setLastAction(`Already at first step (${currentStep})`);
					isRunningRef.current = false;
					return;
				}
				nextStep = ONBOARDING_STEPS[currentIdx - 1]!;
			} else if (target === "next") {
				if (currentIdx >= ONBOARDING_STEPS.length - 1) {
					setLastAction(`Already at last step (${currentStep})`);
					isRunningRef.current = false;
					return;
				}
				nextStep = ONBOARDING_STEPS[currentIdx + 1]!;
			} else {
				nextStep = target;
			}

			try {
				setLastAction(`Setting step → ${nextStep}…`);
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
			} catch (e) {
				setLastAction(
					`Step error: ${e instanceof Error ? e.message : String(e)}`,
				);
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
			const vals = PaneStore.getValues(id);
			return (vals["realAvailable"] as boolean) ?? false;
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
