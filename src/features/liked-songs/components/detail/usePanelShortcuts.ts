import { useShortcut } from "@/lib/keyboard/useShortcut";

interface UsePanelShortcutsOptions {
	isExpanded: boolean;
	isAnalysisOpen: boolean;
	hasHeadline: boolean;
	toggleAnalysis: () => void;
}

export function usePanelShortcuts({
	isExpanded,
	isAnalysisOpen,
	hasHeadline,
	toggleAnalysis,
}: UsePanelShortcutsOptions) {
	useShortcut({
		key: "escape",
		handler: toggleAnalysis,
		description: "Close analysis",
		scope: "liked-detail-analysis",
		category: "actions",
		enabled: isExpanded && isAnalysisOpen,
	});

	useShortcut({
		key: "enter",
		handler: () => {
			if (hasHeadline) toggleAnalysis();
		},
		description: "Open analysis",
		scope: "liked-detail",
		category: "actions",
		enabled: isExpanded,
	});
}
