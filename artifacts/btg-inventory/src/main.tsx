import { createRoot } from "react-dom/client";

import App from "./App";
import { installDemoApi } from "./lib/demo-api";

import "./index.css";

installDemoApi();

createRoot(document.getElementById("root")!).render(<App />);
