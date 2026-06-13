import type { Story } from "@ladle/react";
import { useState } from "react";
import { WaitlistWelcomeDialog } from "./WaitlistWelcomeDialog";

export default {
	title: "Billing/WaitlistWelcomeDialog",
};

export const Default: Story = () => {
	const [open, setOpen] = useState(true);

	return (
		<div style={{ minHeight: "100vh", position: "relative" }}>
			{!open && (
				<div style={{ padding: 24, textAlign: "center", opacity: 0.6 }}>
					<p>Dismissed.</p>
					<button
						type="button"
						onClick={() => setOpen(true)}
						style={{ marginTop: 12, cursor: "pointer" }}
					>
						Reopen
					</button>
				</div>
			)}
			{open && <WaitlistWelcomeDialog onClose={() => setOpen(false)} />}
		</div>
	);
};
