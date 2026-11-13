import { createRoot } from "react-dom/client";

import App from "./App";
import { ligarConexaoDoApp } from "./lib/carregando/estado-da-conexao";
import { installCloudApi } from "./lib/cloud-api";
import { PwaInstallProvider } from "./lib/pwa-install";
import { queryClient } from "./lib/queryClient";

import "./index.css";

installCloudApi();
// O estado único da conexão: "Reconectando…" com histerese e a releitura sozinha (carregamento v2, parte 7a).
ligarConexaoDoApp(queryClient);

createRoot(document.getElementById("root")!).render(
  <PwaInstallProvider>
    <App />
  </PwaInstallProvider>,
);
