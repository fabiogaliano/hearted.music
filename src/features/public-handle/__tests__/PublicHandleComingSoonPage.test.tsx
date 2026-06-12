/**
 * Tests for PublicHandleComingSoonPage.
 *
 * §14.8 coverage:
 * - renders the handle-first identity (@handle), coming-soon copy, and the
 *   "Back to hearted." CTA pointing at "/"
 * - the avatar is driven by the handle (initials) / image_url (img src)
 * - does NOT render a secondary provider display_name line — the component has
 *   no display_name prop, so this asserts the only name-like text is the handle
 */

import { describe, expect, it, vi } from "vitest";
import { PublicHandleComingSoonPage } from "@/features/public-handle/PublicHandleComingSoonPage";
import { render, screen } from "@/test/utils/render";

vi.mock("@tanstack/react-router", () => ({
	Link: ({
		to,
		children,
		...rest
	}: {
		to: string;
		children: React.ReactNode;
	}) => (
		<a href={to} {...rest}>
			{children}
		</a>
	),
}));

describe("PublicHandleComingSoonPage", () => {
	it("renders the handle, coming-soon copy, and the Back-to-hearted CTA", () => {
		render(
			<PublicHandleComingSoonPage
				identity={{ handle: "fabio", imageUrl: null }}
			/>,
		);

		expect(screen.getByText("@fabio")).toBeInTheDocument();
		expect(screen.getByText("Public profile coming soon.")).toBeInTheDocument();
		expect(
			screen.getByText("More public hearted. features are on the way."),
		).toBeInTheDocument();

		const cta = screen.getByRole("link", { name: "Back to hearted." });
		expect(cta).toHaveAttribute("href", "/");
	});

	it("renders the Spotify image as the avatar when image_url is present", () => {
		render(
			<PublicHandleComingSoonPage
				identity={{
					handle: "fabio",
					imageUrl: "https://img.example.com/a.jpg",
				}}
			/>,
		);

		expect(
			document.querySelector('img[src="https://img.example.com/a.jpg"]'),
		).not.toBeNull();
	});

	it("does not render a secondary provider display_name line", () => {
		render(
			<PublicHandleComingSoonPage
				identity={{ handle: "fabio", imageUrl: null }}
			/>,
		);

		// The page exposes only the handle. A provider display name is never
		// passed nor rendered; the sole name-like text is the @handle.
		expect(screen.queryByText("Fábio Galiano")).not.toBeInTheDocument();
		expect(screen.getAllByText(/^@/)).toHaveLength(1);
	});
});
