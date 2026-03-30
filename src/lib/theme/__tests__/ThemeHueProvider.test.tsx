import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { themes } from "@/lib/theme/colors";
import { ThemeHueProvider, useTheme } from "@/lib/theme/ThemeHueProvider";

function ThemeConsumer() {
	const theme = useTheme();
	return <span>{theme.name}</span>;
}

describe("ThemeHueProvider", () => {
	it("renders the active theme and emits the hue CSS variable during render", () => {
		const { container } = render(
			<ThemeHueProvider theme={themes.green}>
				<ThemeConsumer />
			</ThemeHueProvider>,
		);

		expect(screen.getByText("Fresh")).toBeTruthy();
		expect(container.querySelector("style")?.textContent).toContain(
			"--theme-hue: 135",
		);
	});

	it("updates the rendered hue when the theme prop changes", () => {
		const { container, rerender } = render(
			<ThemeHueProvider theme={themes.rose}>
				<ThemeConsumer />
			</ThemeHueProvider>,
		);

		expect(container.querySelector("style")?.textContent).toContain(
			"--theme-hue: 340",
		);

		rerender(
			<ThemeHueProvider theme={themes.lavender}>
				<ThemeConsumer />
			</ThemeHueProvider>,
		);

		expect(screen.getByText("Dreamy")).toBeTruthy();
		expect(container.querySelector("style")?.textContent).toContain(
			"--theme-hue: 300",
		);
	});
});
