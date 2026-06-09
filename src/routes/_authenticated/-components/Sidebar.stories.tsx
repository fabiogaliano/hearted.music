import type { Story } from "@ladle/react";
import { useEffect, useState } from "react";
import { sidebarData } from "@/stories/fixtures";
import { Sidebar } from "./Sidebar";

export const Default: Story = () => (
	<Sidebar
		unsortedCount={sidebarData.unsortedCount}
		handle={sidebarData.handle}
		userPlan="Free Plan"
	/>
);

export const WithBadge: Story = () => (
	<Sidebar unsortedCount={12} handle="ghr" userPlan="Free Plan" />
);

export const NoBadge: Story = () => (
	<Sidebar unsortedCount={0} handle="ghr" userPlan="Free Plan" />
);

export const MatchCountUpdating: Story = () => {
	const [count, setCount] = useState(0);

	useEffect(() => {
		const id = setInterval(() => setCount((c) => c + 1), 2000);
		return () => clearInterval(id);
	}, []);

	return <Sidebar unsortedCount={count} handle="ghr" userPlan="Free Plan" />;
};
MatchCountUpdating.meta = {
	description: "Watch the match badge count increment as new matches arrive",
};
