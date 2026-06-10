import { createRoot } from "react-dom/client";
import { App } from "./App";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("[hearted.] #root element not found");
createRoot(rootEl).render(<App />);
