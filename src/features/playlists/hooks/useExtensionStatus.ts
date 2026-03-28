import { useCallback, useEffect, useState } from "react";
import { isExtensionInstalled } from "@/lib/extension/detect";

export type ExtensionAvailability = "checking" | "available" | "unavailable";

export function useExtensionStatus() {
	const [status, setStatus] = useState<ExtensionAvailability>("checking");

	const check = useCallback(async () => {
		setStatus("checking");
		const installed = await isExtensionInstalled();
		setStatus(installed ? "available" : "unavailable");
	}, []);

	useEffect(() => {
		void check();
	}, [check]);

	return { extensionStatus: status, recheckExtension: check };
}
