import { useCallback, useSyncExternalStore } from "react";
import {
	getDefaultWorkflowDevSettings,
	readWorkflowDevSettings,
	resetWorkflowDevSettings,
	subscribeWorkflowDevSettings,
	updateWorkflowDevClientSettings,
	updateWorkflowDevServerSettings,
} from "@/lib/workflows/library-processing/devtools/settings";

export function useWorkflowDevSettings() {
	const settings = useSyncExternalStore(
		subscribeWorkflowDevSettings,
		readWorkflowDevSettings,
		getDefaultWorkflowDevSettings,
	);

	const updateClient = useCallback(
		(partial: Parameters<typeof updateWorkflowDevClientSettings>[0]) => {
			updateWorkflowDevClientSettings(partial);
		},
		[],
	);

	const updateServer = useCallback(
		(partial: Parameters<typeof updateWorkflowDevServerSettings>[0]) => {
			updateWorkflowDevServerSettings(partial);
		},
		[],
	);

	const resetAll = useCallback(() => {
		resetWorkflowDevSettings();
	}, []);

	return {
		client: settings.client,
		server: settings.server,
		updateClient,
		updateServer,
		resetAll,
	};
}
