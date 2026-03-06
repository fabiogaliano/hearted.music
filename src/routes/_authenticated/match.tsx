import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Matching } from "@/features/matching/Matching";

export const Route = createFileRoute("/_authenticated/match")({
	component: MatchPage,
});

function MatchPage() {
	const navigate = useNavigate();

	return <Matching onExit={() => navigate({ to: "/" })} />;
}
