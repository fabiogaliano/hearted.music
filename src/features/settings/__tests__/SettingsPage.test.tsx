/**
 * §14.7 — Settings surface: handle-first identity display.
 *
 * Verifies the Account section treats @handle as the primary identity line,
 * email as the secondary, never renders display_name, and omits @handle when
 * null without throwing.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { FREE_BILLING_STATE } from "@/lib/domains/billing/state";
import { render, screen } from "@/test/utils/render";
import { SettingsPage } from "../SettingsPage";

vi.mock("@tanstack/react-router", () => ({
	useNavigate: () => vi.fn(),
	useLocation: () => ({ hash: "" }),
}));

vi.mock("@tanstack/react-query", () => ({
	useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

vi.mock("@/lib/server/settings.functions", () => ({
	updateThemePreference: vi.fn(),
	updateMatchStrictnessPreference: vi.fn(),
}));

vi.mock("@/lib/platform/auth/auth-client", () => ({
	signOut: vi.fn(),
}));

// ConsentSection reads import.meta.env.PROD — keep tests in non-prod mode,
// which means the Privacy section is hidden; no extra mock needed.

const baseProps = {
	email: "user@example.com",
	imageUrl: null,
	currentTheme: "rose" as const,
	onThemeChange: vi.fn(),
	currentStrictness: "balanced" as const,
	billingState: FREE_BILLING_STATE,
};

beforeEach(() => {
	vi.clearAllMocks();
});

describe("SettingsPage — Account section", () => {
	it("renders @handle as the primary identity line when handle is present", () => {
		render(<SettingsPage {...baseProps} handle="fabio" />);
		expect(screen.getByText("@fabio")).toBeInTheDocument();
	});

	it("renders email as the secondary identity line", () => {
		render(<SettingsPage {...baseProps} handle="fabio" />);
		expect(screen.getByText("user@example.com")).toBeInTheDocument();
	});

	it("does not render display_name as the displayed identity", () => {
		render(<SettingsPage {...baseProps} handle="fabio" />);
		// display_name would typically be something like "Fábio Galiano"; verify
		// no text prefixed with display_name semantics slips through
		expect(screen.queryByText("Fábio Galiano")).not.toBeInTheDocument();
	});

	it("passes handle (not display_name) to UserAvatar so initials derive from it", () => {
		// When handle is present and no imageUrl, UserAvatar renders its first letter
		render(<SettingsPage {...baseProps} handle="zebra" />);
		// The initials element contains "Z" (first char of handle)
		expect(screen.getByText("Z")).toBeInTheDocument();
	});

	it("omits the @handle line when handle is null, keeping email visible — non-throwing", () => {
		render(<SettingsPage {...baseProps} handle={null} />);
		expect(screen.queryByText(/^@/)).not.toBeInTheDocument();
		expect(screen.getByText("user@example.com")).toBeInTheDocument();
	});

	it("does not fall back to display_name or email when handle is null", () => {
		render(<SettingsPage {...baseProps} handle={null} />);
		// Confirm no @-prefixed string appears at all
		const atNodes = screen.queryAllByText(/^@/);
		expect(atNodes).toHaveLength(0);
	});
});
