import type { Story } from "@ladle/react";
import { RouteErrorFallback } from "@/components/RouteErrorFallback";

export default {
	title: "Infrastructure/RouteErrorFallback",
};

/**
 * The themed "a wrong note" error screen rendered by both the root and
 * authenticated route boundaries. Always uses the rose palette so the error
 * state is visually distinct from the rest of the app regardless of the active
 * theme — the theme selector in Ladle has no effect on this story by design.
 */
export const Default: Story = () => <RouteErrorFallback />;
Default.meta = {
	description:
		"Shared route-level error fallback. Appears when an error bubbles to the _authenticated or __root boundary. Theme selector has no effect — error state is always rose.",
};
