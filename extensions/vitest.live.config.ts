import { defineConfig } from "vite-plus";

export default defineConfig({
	test: {
		environment: "node",
		include: ["src/__tests__/live-contract*.test.ts"],
		testTimeout: 30_000,
	},
});
