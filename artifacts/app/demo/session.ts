/* Perfis da demo e a sessão guardada no navegador. Nenhuma senha real. */
import type { ProfileRole } from "../src/lib/modules";
import { CLIENT_ONLY } from "./audience";
import { CLIENT_USER, CUSTOMER } from "./data";

export type DemoProfileKey = "cliente" | "dutelog";

export type DemoProfile = {
  key: DemoProfileKey;
  label: string;
  hint: string;
  login: string;
  password: string;
  fullName: string;
  email: string;
  role: ProfileRole;
  home: string;
};

export const DEMO_PROFILES: Record<DemoProfileKey, DemoProfile> = {
  cliente: {
    key: "cliente",
    label: `Portal do cliente · ${CUSTOMER}`,
    hint: CLIENT_ONLY
      ? "Estoque com fotos, pedidos, kits, destinatários, envios, faturas e o Agent Dute."
      : "O que a equipe da TikTok vê: estoque com fotos, pedidos, envios, faturas e o Agent Dute.",
    login: "tiktok@demo.dutelog.com.br",
    password: "demo",
    fullName: CLIENT_USER.name,
    email: CLIENT_USER.email,
    role: "cliente",
    home: "/portal",
  },
  dutelog: {
    key: "dutelog",
    label: "Operação Dutelog",
    hint: "O que a nossa equipe usa: aprovação de pedidos, recebimento, separação, estoque e faturamento.",
    login: "equipe@demo.dutelog.com.br",
    password: "demo",
    fullName: "Leonardo",
    email: "equipe@demo.dutelog.com.br",
    role: "owner",
    home: "/dashboard",
  },
};

/** Perfis que este arquivo aceita: no build do cliente, só o portal. */
export const AVAILABLE_PROFILES: DemoProfile[] = CLIENT_ONLY ? [DEMO_PROFILES.cliente] : [DEMO_PROFILES.cliente, DEMO_PROFILES.dutelog];
const available = (key: string | null) => AVAILABLE_PROFILES.find((profile) => profile.key === key) ?? null;

const SESSION_KEY = "dute.demo.session";

export function readSession(): DemoProfile | null {
  try {
    // Sessão de um perfil que este arquivo não tem (ex.: operação no build do cliente) volta ao login.
    return available(window.localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}

export function writeSession(key: DemoProfileKey | null) {
  try {
    if (key) window.localStorage.setItem(SESSION_KEY, key);
    else window.localStorage.removeItem(SESSION_KEY);
  } catch {
    // Sem storage: a sessão vale só até recarregar.
  }
}

export function profileForLogin(login: string, password: string): DemoProfile | null {
  const email = login.trim().toLowerCase();
  const match = AVAILABLE_PROFILES.find((profile) => profile.login === email);
  return match && match.password === password ? match : null;
}
