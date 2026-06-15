import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const API_PORT = Number(process.env.CP_API_PORT ?? 4319);
const WEB_PORT = Number(process.env.CP_WEB_PORT ?? 4318);

// Standalone, local-only dashboard. Its own Vite root so it never enters the
// product build; /api is proxied to the Bun server that holds the prod creds.
export default defineConfig({
	root: __dirname,
	plugins: [react()],
	server: {
		port: WEB_PORT,
		strictPort: true,
		proxy: {
			"/api": {
				target: `http://localhost:${API_PORT}`,
				changeOrigin: true,
			},
		},
	},
});
