import type { CSSProperties, Ref } from "react";
import { useEffect, useState } from "react";
import { captureRouteError } from "@/lib/observability/sentry";
import { recoverFromStaleChunk } from "@/lib/platform/routing/stale-chunk";
import type { HeartRippleHandle } from "./HeartRippleBackground";

type HeartRippleBackgroundComponent =
	typeof import("./HeartRippleBackground").HeartRippleBackground;

interface LazyHeartRippleBackgroundProps {
	rippleRef?: Ref<HeartRippleHandle>;
	className?: string;
	style?: CSSProperties;
	onReady?: () => void;
}

let heartRippleBackgroundPromise: Promise<HeartRippleBackgroundComponent> | null =
	null;

function loadHeartRippleBackground(): Promise<HeartRippleBackgroundComponent | null> {
	if (!heartRippleBackgroundPromise) {
		heartRippleBackgroundPromise = import("./HeartRippleBackground").then(
			(module) => module.HeartRippleBackground,
		);
	}

	// This import sits outside the router, so a rejection here never reaches
	// the root error boundary: it surfaced as an unhandled rejection (Sentry
	// 1E) instead of the stale-chunk reload every route import gets. Handle it
	// the same way, and forget the failed promise so a later mount can retry.
	return heartRippleBackgroundPromise.catch((error: unknown) => {
		heartRippleBackgroundPromise = null;
		if (!recoverFromStaleChunk(error)) {
			captureRouteError(error, {
				route: "landing",
				chunk: "HeartRippleBackground",
			});
		}
		return null;
	});
}

export function LazyHeartRippleBackground({
	rippleRef,
	className,
	style,
	onReady,
}: LazyHeartRippleBackgroundProps) {
	const [Component, setComponent] =
		useState<HeartRippleBackgroundComponent | null>(null);

	useEffect(() => {
		let isCancelled = false;

		void loadHeartRippleBackground().then((LoadedComponent) => {
			if (!isCancelled && LoadedComponent) {
				setComponent(() => LoadedComponent);
			}
		});

		return () => {
			isCancelled = true;
		};
	}, []);

	if (!Component) {
		return null;
	}

	return (
		<Component
			ref={rippleRef}
			className={className}
			style={style}
			onReady={onReady}
		/>
	);
}
