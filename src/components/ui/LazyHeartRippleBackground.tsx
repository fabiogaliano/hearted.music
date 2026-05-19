import type { CSSProperties, Ref } from "react";
import { useEffect, useState } from "react";
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

function loadHeartRippleBackground(): Promise<HeartRippleBackgroundComponent> {
	if (!heartRippleBackgroundPromise) {
		heartRippleBackgroundPromise = import("./HeartRippleBackground").then(
			(module) => module.HeartRippleBackground,
		);
	}

	return heartRippleBackgroundPromise;
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
			if (!isCancelled) {
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
