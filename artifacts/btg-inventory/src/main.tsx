import { createRoot } from "react-dom/client";

import App from "./App";
import { installCloudApi } from "./lib/cloud-api";
import { installDemoApi } from "./lib/demo-api";

import "./index.css";

installDemoApi();
installCloudApi();

createRoot(document.getElementById("root")!).render(<App />);
