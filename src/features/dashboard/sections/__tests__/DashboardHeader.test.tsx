/**
 * §14.7 — DashboardHeader: handle-first identity display.
 *
 * Verifies the heading renders @handle when present, is omitted when null, and
 * never falls back to display_name or email.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/utils/render";
import { DashboardHeader } from "../DashboardHeader";

vi.mock("@/lib/hooks/useActiveJobs", () => ({
	useActiveJobs: () => ({
		isEnrichmentRunning: false,
		enrichmentProgress: null,
	}),
}));

vi.mock("@/features/dashboard/hooks/useDashboardSync", () => ({
	useDashboardSync: () => ({
		state: { kind: "ready", lastSyncAt: null },
		onAction: vi.fn(),
	}),
}));

// ClientNumberFlow is a client-only component; stub it to avoid SSR issues
vi.mock("@/features/matching/components/ClientNumberFlow", () => ({
	ClientNumberFlow: ({ value, suffix }: { value: number; suffix?: string }) => (
		<span>{`${value}${suffix ?? ""}`}</span>
	),
}));

const baseStats = {
	totalSongs: 100,
	analyzedPercent: 80,
	playlistCount: 5,
	reviewCount: 3,
};

describe("DashboardHeader — handle identity", () => {
	it("renders @handle as the heading when handle is present", () => {
		render(
			<DashboardHeader
				accountId="acc-1"
				stats={baseStats}
				handle="fabio"
				lastSyncText="2 hours ago"
			/>,
		);
		expect(screen.getByRole("heading", { name: "@fabio" })).toBeInTheDocument();
	});

	it("omits the heading entirely when handle is null — non-throwing", () => {
		render(
			<DashboardHeader
				accountId="acc-1"
				stats={baseStats}
				handle={null}
				lastSyncText="2 hours ago"
			/>,
		);
		expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
	});

	it("does not fall back to display_name or email when handle is null", () => {
		render(
			<DashboardHeader
				accountId="acc-1"
				stats={baseStats}
				handle={null}
				lastSyncText="2 hours ago"
			/>,
		);
		expect(screen.queryByText(/^@/)).not.toBeInTheDocument();
	});

	it("still renders stats and sync control when handle is null", () => {
		render(
			<DashboardHeader
				accountId="acc-1"
				stats={baseStats}
				handle={null}
				lastSyncText="Never"
			/>,
		);
		expect(screen.getByText("Never")).toBeInTheDocument();
	});
});
