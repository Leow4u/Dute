/*
 * Entrada da demonstração: o app de verdade (src/App) com login próprio,
 * dados fictícios e rotas no hash, para abrir com dois cliques a partir do
 * arquivo, sem servidor e sem tocar no Firebase de produção.
 */
import "./demo.css";
import { createRoot } from "react-dom/client";
import { Router } from "wouter";
import App from "../src/App";
import { PwaInstallProvider } from "../src/lib/pwa-install";
import { installDemoApi } from "./api";
import { installDemoMenu } from "./menu";
import { useDemoHashLocation } from "./hash-location";
import DemoLogin from "./login";
import { readSession } from "./session";

installDemoApi();
installDemoMenu();

const session = readSession();
const root = createRoot(document.getElementById("root")!);

if (!session) {
  if (window.location.hash && window.location.hash !== "#/") window.location.hash = "/";
  root.render(<DemoLogin />);
} else {
  root.render(
    <Router hook={useDemoHashLocation}>
      <PwaInstallProvider>
        <App />
      </PwaInstallProvider>
    </Router>,
  );
}
