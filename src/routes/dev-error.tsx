import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/dev-error")({
	component: DevError,
});

function DevError(): never {
	throw new Error("serverFn is not a function");
}
