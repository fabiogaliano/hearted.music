import type { Story } from "@ladle/react";
import { useState, useEffect } from "react";
import { Sidebar } from "./Sidebar";
import { sidebarData } from "@/stories/fixtures";

export const Default: Story = () => (
	<Sidebar
		unsortedCount={sidebarData.unsortedCount}
		userName={sidebarData.userName}
		userPlan="Free Plan"
	/>
);

export const WithBadge: Story = () => (
	<Sidebar unsortedCount={12} userName="ghr" userPlan="Free Plan" />
);

export const NoBadge: Story = () => (
	<Sidebar unsortedCount={0} userName="ghr" userPlan="Free Plan" />
);

export const MatchCountUpdating: Story = () => {
	const [count, setCount] = useState(0);

	useEffect(() => {
		const id = setInterval(() => setCount((c) => c + 1), 2000);
		return () => clearInterval(id);
	}, []);

	return <Sidebar unsortedCount={count} userName="ghr" userPlan="Free Plan" />;
};
MatchCountUpdating.meta = {
	description: "Watch the match badge count increment as new matches arrive",
};
