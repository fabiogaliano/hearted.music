/**
 * Stub for @tanstack/react-start/server used in the Ladle story environment.
 *
 * Ladle runs browser-only — it doesn't execute the TanStack Start Vite plugin
 * that normally strips server-only code from client bundles. Any component
 * that transitively imports this module (via auth.server.ts → auth.middleware.ts
 * → server functions) would fail with a "module not found" error in the Vite
 * dev server because the underlying @tanstack/start-server-core contains
 * Node.js streams that can't be optimized for the browser.
 *
 * All exports are no-ops or throw — server functions are never actually called
 * in Ladle; components gracefully fall to their loading/error/unavailable states.
 */

const serverOnly = (name: string) => () => {
	throw new Error(
		`[Ladle stub] ${name} is server-only and cannot be called in stories.`,
	);
};

export const getRequest = serverOnly("getRequest");
export const getResponse = serverOnly("getResponse");
export const getRequestHeader = () => undefined;
export const getRequestHeaders = () => ({});
export const getRequestHost = () => "localhost";
export const getRequestIP = () => "127.0.0.1";
export const getRequestProtocol = () => "http";
export const getRequestUrl = () => "http://localhost/";
export const getResponseHeader = () => undefined;
export const getResponseHeaders = () => ({});
export const getResponseStatus = () => 200;
export const getSession = async () => null;
export const getValidatedQuery = () => ({});
export const setCookie = () => {};
export const getCookie = () => undefined;
export const getCookies = () => ({});
export const deleteCookie = () => {};
export const setResponseHeader = () => {};
export const setResponseHeaders = () => {};
export const removeResponseHeader = () => {};
export const setResponseStatus = () => {};
export const clearResponseHeaders = () => {};
export const clearSession = async () => {};
export const sealSession = async () => "";
export const unsealSession = async () => ({});
export const updateSession = async () => {};
export const useSession = async () => ({
	data: {},
	update: async () => {},
	clear: async () => {},
});
export const requestHandler = () => async () => new Response();
export const createRequestHandler = () => async () => new Response();
export const createStartHandler = () => async () => new Response();
export const defineHandlerCallback = (fn: unknown) => fn;
export const attachRouterServerSsrUtils = () => {};
export const transformPipeableStreamWithRouter = () => {};
export const transformReadableStreamWithRouter = () => {};
export const HEADERS = {};
export const VIRTUAL_MODULES = {};
