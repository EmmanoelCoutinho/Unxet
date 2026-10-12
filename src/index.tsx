import "./lib/registerServiceWorker";
import "./index.css";
import { createRoot } from "react-dom/client";
import { App } from "./App";

// createRoot: o render antigo mantinha o app no modo de compatibilidade do React 17
createRoot(document.getElementById("root")!).render(<App />);
