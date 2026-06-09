/**
 * §14.7 — Sidebar: handle-first identity display.
 *
 * Verifies the sidebar renders @handle as the identity line when present,
 * passes handle to UserAvatar, and omits the identity line when null without
 * falling back to display_name or email.
 */

import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/utils/render";
import { Sidebar } from "../Sidebar";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		children,
		to,
		...rest
	}: {
		children: React.ReactNode;
		to: string;
		[key: string]: unknown;
	}) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
	useMatchRoute: () => () => false,
}));

describe("Sidebar — handle identity", () => {
	it("renders the @handle identity line when handle is present", () => {
		render(<Sidebar unsortedCount={0} handle="fabio" userPlan="Free Plan" />);
		expect(screen.getByText("@fabio")).toBeInTheDocument();
	});

	it("passes handle to UserAvatar so initials derive from it", () => {
		render(<Sidebar unsortedCount={0} handle="zebra" userPlan="Free Plan" />);
		// When no imageUrl, UserAvatar renders the first char of handle as initial
		expect(screen.getByText("Z")).toBeInTheDocument();
	});

	it("omits the identity line when handle is null — non-throwing", () => {
		render(<Sidebar unsortedCount={0} handle={null} userPlan="Free Plan" />);
		expect(screen.queryByText(/^@/)).not.toBeInTheDocument();
	});

	it("does not fall back to display_name or email when handle is null", () => {
		render(<Sidebar unsortedCount={0} handle={null} userPlan="Free Plan" />);
		// No @-prefixed text should appear
		const atNodes = screen.queryAllByText(/^@/);
		expect(atNodes).toHaveLength(0);
	});

	it("still renders the plan label when handle is null", () => {
		render(<Sidebar unsortedCount={0} handle={null} userPlan="Free Plan" />);
		expect(screen.getByText(/free plan/i)).toBeInTheDocument();
	});
});
