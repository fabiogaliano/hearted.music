import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@/test/utils/render";
import { MatchingHeader } from "../sections/MatchingHeader";

describe("MatchingHeader", () => {
	it("renders progress counter with 1-based index", () => {
		render(
			<MatchingHeader
				currentIndex={0}
				totalSongs={10}
				mode="song"
				onModeChange={vi.fn()}
			/>,
		);
		expect(
			screen.getByRole("heading", { level: 2, name: /^1\s*\/\s*10$/ }),
		).toBeDefined();
	});
});
