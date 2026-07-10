import { createRoot } from "react-dom/client";

import App from "./App";
import { installCloudApi } from "./lib/cloud-api";

import "./index.css";

installCloudApi();

createRoot(document.getElementById("root")!).render(<App />);
