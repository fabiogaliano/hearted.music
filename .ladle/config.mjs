// Sidebar groups follow the product's user journey rather than A–Z, so the tree
// reads top-to-bottom like the app itself. Each "group*" prefix is expanded by
// Ladle against the story keys (leaves stay alphabetical within a group). The
// trailing "*" is a catch-all so any future group still shows up — without it,
// keys matched by no prefix are dropped from the sidebar entirely.
const storyOrder = [
	"auth*",
	"onboarding*",
	"dashboard*",
	"liked-songs*",
	"match*",
	"settings*",
	"billing*",
	"app-shell*",
	"foundations*",
	"*",
];

/** @type {import('@ladle/react').UserConfig} */
export default {
	stories: "src/**/*.stories.tsx",
	storyOrder,
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
