import { firebaseAuth } from "../firebase";
import { EMULADORES, EMULADORES_LIGADOS } from "../emuladores";
import type { CreatedIntegration, IntegrationInput, IntegrationRow } from "./model";

export function apiBase(project: string, emulator = false): string {
  if (!/^[a-z][a-z0-9-]+$/.test(project)) throw new Error("Projeto Firebase não configurado.");
  return emulator
    ? `http://${EMULADORES.host}:${EMULADORES.functions}/${project}/southamerica-east1/duteApi/api/v1`
    : `https://southamerica-east1-${project}.cloudfunctions.net/duteApi/api/v1`;
}

export const INTEGRACOES_API_BASE = apiBase(import.meta.env.VITE_FIREBASE_PROJECT_ID || "nao-configurado", EMULADORES_LIGADOS);

async function request<T>(path: string, method = "GET", body?: IntegrationInput, signal?: AbortSignal): Promise<T> {
  const user = firebaseAuth?.currentUser;
  if (!user) throw new Error("Entre novamente para gerenciar integrações.");
  const token = await user.getIdToken();
  let response: Response;
  try {
    response = await fetch(`${INTEGRACOES_API_BASE}${path}`, {
      method, signal, cache: "no-store", credentials: "omit", redirect: "error",
      headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new Error(method === "POST"
      ? "Não foi possível confirmar a criação. Confira a lista antes de tentar novamente; se a chave foi criada, revogue-a e crie outra."
      : "Não foi possível conectar à API. Tente novamente.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok) throw new Error(result?.error?.message || "Não foi possível concluir a operação.");
  if (!result || !("data" in result)) throw new Error("Resposta inválida da API. Confira a lista antes de tentar novamente.");
  return result as T;
}

export function listarIntegracoes(cursor?: string, signal?: AbortSignal) {
  const query = new URLSearchParams({ limit: "50", ...(cursor ? { cursor } : {}) });
  return request<{ data: IntegrationRow[]; next_cursor: string | null }>(`/integrations?${query}`, "GET", undefined, signal);
}

/** Chamada direta, sem retry ou cache de mutations: token só vai ao estado efêmero da tela. */
export async function criarIntegracao(input: IntegrationInput): Promise<CreatedIntegration> {
  return (await request<{ data: CreatedIntegration }>("/integrations", "POST", input)).data;
}

export async function revogarIntegracao(id: string): Promise<void> {
  if (!/^[a-f0-9]{32}$/.test(id)) throw new Error("Integração inválida.");
  await request(`/integrations/${id}`, "DELETE");
}
