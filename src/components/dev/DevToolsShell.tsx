import { useEffect } from "react";
import { TanStackDevtools } from "@tanstack/react-devtools";
import { TanStackRouterDevtoolsPanel } from "@tanstack/react-router-devtools";
import TanStackQueryDevtools from "@/integrations/tanstack-query/devtools";

export default function DevToolsShell() {
	useEffect(() => {
		if (import.meta.env.VITE_DEVTOOLS !== "false") {
			void import("react-scan").then(({ scan }) => {
				scan({
					enabled: true,
					showToolbar: true,
					log: true,
					animationSpeed: "fast",
				});
			});
		}
	}, []);

	if (import.meta.env.VITE_DEVTOOLS === "false") return null;

	return (
		<TanStackDevtools
			config={{ position: "bottom-right" }}
			plugins={[
				{ name: "Tanstack Router", render: <TanStackRouterDevtoolsPanel /> },
				TanStackQueryDevtools,
			]}
		/>
	);
}
