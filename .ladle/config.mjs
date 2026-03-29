/** @type {import('@ladle/react').UserConfig} */
export default {
	stories: "src/**/*.stories.tsx",
	viteConfig: process.cwd() + "/ladle-vite.config.ts",
	appendToHead: `<style>
		:root {
			--ladle-main-padding: 0;
			--ladle-main-padding-mobile: 0;
		}
		body { margin: 0; }
	</style>`,
	addons: {
		theme: { enabled: true, defaultState: "light" },
		width: {
			enabled: true,
			options: { mobile: 414, tablet: 768, desktop: 1280 },
			defaultState: 0,
		},
	},
};
