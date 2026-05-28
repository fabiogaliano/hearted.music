/**
 * Hook: useIsomorphicLayoutEffect
 *
 * `useLayoutEffect` on the client, `useEffect` on the server. Using
 * `useLayoutEffect` during SSR triggers a React warning because layout effects
 * cannot run without a DOM, so we fall back to `useEffect` when `window` is
 * absent. The runtime branch is resolved once at module load, not per render.
 */
import { useEffect, useLayoutEffect } from "react";

export const useIsomorphicLayoutEffect =
	typeof window !== "undefined" ? useLayoutEffect : useEffect;
