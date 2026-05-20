import type { CSSProperties } from "react";
import { lazy, Suspense } from "react";

interface Props {
	value: number;
	suffix?: string;
	className?: string;
	style?: CSSProperties;
	continuous?: boolean;
}

// Guard: @number-flow/react extends HTMLElement at module scope, which doesn't exist during SSR.
// import.meta.env.SSR is replaced at transform time, so the false branch is dead code on the server.
const NumberFlowLazy = import.meta.env.SSR
	? null
	: lazy(async () => {
			const mod = await import("@number-flow/react");
			const NumberFlow = mod.default;
			// Stable plugins array — NumberFlow diffs by identity.
			const continuousPlugins = [mod.continuous];
			function NumberFlowAdapter({
				continuous: enableContinuous,
				...rest
			}: Props) {
				return (
					<NumberFlow
						{...rest}
						plugins={enableContinuous ? continuousPlugins : undefined}
					/>
				);
			}
			return { default: NumberFlowAdapter };
		});

export function ClientNumberFlow({
	value,
	suffix,
	className,
	style,
	continuous,
}: Props) {
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
				continuous={continuous}
			/>
		</Suspense>
	);
}
