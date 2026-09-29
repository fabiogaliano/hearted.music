/**
 * §14.7 — DashboardHeader: handle-first identity display.
 *
 * Verifies the heading renders @handle when present and is omitted when null.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@/test/utils/render";
import { DashboardHeader } from "../DashboardHeader";

describe("DashboardHeader — handle identity", () => {
	it("renders @handle as the heading when handle is present", () => {
		render(<DashboardHeader handle="fabio" />);
		expect(screen.getByRole("heading", { name: "@fabio" })).toBeInTheDocument();
	});

	it("omits the heading entirely when handle is null — non-throwing", () => {
		render(<DashboardHeader handle={null} />);
		expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
	});

	// The header's other half must survive a null handle: an account mid-setup is
	// exactly when the reconnect banner in `trailing` matters most.
	it("still renders trailing content when handle is null", () => {
		render(
			<DashboardHeader
				handle={null}
				trailing={<button type="button">Reconnect Spotify</button>}
			/>,
		);
		expect(
			screen.getByRole("button", { name: /reconnect spotify/i }),
		).toBeInTheDocument();
	});
});
