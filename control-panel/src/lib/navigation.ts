import { createContext, useContext } from "react";

// Lets a card deep in a section jump to another section (e.g. an Overview alert
// → the Jobs detail table). App wires this to its section switcher.
export const NavContext = createContext<(sectionKey: string) => void>(() => {});

export const useNavigate = () => useContext(NavContext);
