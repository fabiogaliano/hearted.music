/**
 * Dashboard shell component
 *
 * Provides the main layout with sidebar navigation and main content area.
 * Wraps child routes (Home, Match Songs, Liked Songs, etc.)
 */

import type { ReactNode } from "react";
import { themes } from "@/lib/theme/colors";
import { DEFAULT_THEME } from "@/lib/theme/types";
import { Sidebar } from "./components/Sidebar";
import { KeyboardShortcutProvider } from "./components/KeyboardShortcutProvider";
import { ShortcutsHelpModal } from "./components/ShortcutsHelpModal";
import type { DashboardLoaderData } from "./types";

interface DashboardProps {
	data: DashboardLoaderData;
	children: ReactNode;
}

export function Dashboard({ data, children }: DashboardProps) {
	const theme = themes[data.theme ?? DEFAULT_THEME];

	return (
		<KeyboardShortcutProvider>
			<div className="flex min-h-screen" style={{ background: theme.bg }}>
				<Sidebar
					theme={theme}
					userName={data.userName}
					pendingCount={data.stats.newSongsCount}
				/>

				<main className="flex-1 overflow-auto px-12 py-8">{children}</main>

				<ShortcutsHelpModal theme={theme} />
			</div>
		</KeyboardShortcutProvider>
	);
}
