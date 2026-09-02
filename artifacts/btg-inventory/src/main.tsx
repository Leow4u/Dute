import { createRoot } from "react-dom/client";

import App from "./App";
import { installCloudApi } from "./lib/cloud-api";
import { PwaInstallProvider } from "./lib/pwa-install";

import "./index.css";

installCloudApi();

createRoot(document.getElementById("root")!).render(
  <PwaInstallProvider>
    <App />
  </PwaInstallProvider>,
);
