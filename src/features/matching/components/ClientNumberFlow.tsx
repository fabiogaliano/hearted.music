import { lazy, Suspense } from "react";
import type { CSSProperties } from "react";

// Guard: @number-flow/react extends HTMLElement at module scope, which doesn't exist during SSR.
// import.meta.env.SSR is replaced at transform time, so the false branch is dead code on the server.
const NumberFlowLazy = import.meta.env.SSR
	? null
	: lazy(() => import("@number-flow/react"));

interface Props {
	value: number;
	suffix?: string;
	className?: string;
	style?: CSSProperties;
}

export function ClientNumberFlow({ value, suffix, className, style }: Props) {
	const fallback = (
		<span className={className} style={style}>
			{value}
			{suffix}
		</span>
	);

	if (!NumberFlowLazy) return fallback;

	return (
		<Suspense fallback={fallback}>
			<NumberFlowLazy
				value={value}
				suffix={suffix}
				className={className}
				style={style}
			/>
		</Suspense>
	);
}
