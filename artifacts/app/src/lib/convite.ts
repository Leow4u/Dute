import { roleLabel } from "./access";
import { normalizeProfileRole, type ProfileRole } from "./modules";

/**
 * O convite pelo link (pergunta 68, docs/plataforma/fase-2-nucleo.md). A tela
 * lê o convite pelo `lookupInvite`, e o aceite é do servidor (`acceptInvite`,
 * functions/wms/src/domain/invite-acceptance.ts): ele pede o login com o
 * e-mail do convite confirmado e grava o perfil, o convite usado e o evento
 * numa transação. O navegador não grava nada do aceite.
 */

export type ConviteLido = {
  token: string;
  email: string;
  /** O nome que o convite sugere; a pessoa pode trocar. */
  nome: string;
  role: ProfileRole;
  /** O nome do cliente, no convite de cliente. */
  cliente: string | null;
};

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

/** A resposta do `lookupInvite`, conferida; null quando ela não serve de convite. */
export function conviteLido(token: string, dados: unknown): ConviteLido | null {
  const registro = dados && typeof dados === "object" ? (dados as Record<string, unknown>) : {};
  const email = texto(registro.email).toLowerCase();
  const role = normalizeProfileRole(registro.role);
  if (!token || !email || !role || texto(registro.status) !== "pending") return null;
  return { token, email, nome: texto(registro.nome), role, cliente: texto(registro.customer_name) || null };
}

/** "Cliente · Itaú Unibanco", ou o perfil da equipe ("Coordenação"). */
export function perfilDoConvite(convite: Pick<ConviteLido, "role" | "cliente">): string {
  const perfil = roleLabel(convite.role);
  return convite.role === "cliente" && convite.cliente ? `${perfil} · ${convite.cliente}` : perfil;
}

/** O nome que vai no aceite: o digitado; sem ele, o da conta, o do convite ou o começo do e-mail. */
export function nomeDoAceite(digitado: string, daConta: string | null | undefined, convite: Pick<ConviteLido, "nome" | "email">): string {
  return texto(digitado) || texto(daConta) || convite.nome || convite.email.split("@")[0];
}

export const MENSAGENS_DO_CONVITE = {
  semConfirmacao: "Seu e-mail ainda não foi confirmado. Abra o link que enviamos.",
  reenviado: "Link reenviado.",
} as const;

/** As recusas do aceite que o servidor escreve para a pessoa (invite-acceptance.ts). */
const RECUSAS_DO_SERVIDOR = new Set([
  "functions/unauthenticated",
  "functions/invalid-argument",
  "functions/failed-precondition",
  "functions/permission-denied",
  "functions/not-found",
  "functions/resource-exhausted",
]);

/** O erro do Firebase como a tela do convite mostra. */
export function mensagemDoConvite(erro: unknown): string {
  const codigo = (erro as { code?: unknown } | null)?.code;
  switch (codigo) {
    case "auth/wrong-password":
    case "auth/invalid-credential":
    case "auth/invalid-login-credentials":
      return "Este e-mail já tem conta, e a senha não confere. Use a senha dela, ou Esqueci minha senha no login.";
    case "auth/weak-password":
      return "Use uma senha com pelo menos 6 caracteres.";
    case "auth/too-many-requests":
      return "Muitas tentativas. Espere alguns minutos e tente de novo.";
    case "auth/network-request-failed":
    case "functions/unavailable":
    case "functions/deadline-exceeded":
      return "Sem conexão. Confira a internet e tente de novo.";
  }
  if (typeof codigo === "string" && RECUSAS_DO_SERVIDOR.has(codigo) && erro instanceof Error && erro.message) return erro.message;
  return "Não foi possível aceitar o convite. Tente de novo.";
}

/** Falha no envio da confirmação: não confundir indisponibilidade do provedor com conexão do navegador. */
export function mensagemDoEnvioDeConfirmacao(erro: unknown): string {
  const codigo = (erro as { code?: unknown } | null)?.code;
  if (typeof codigo === "string" && RECUSAS_DO_SERVIDOR.has(codigo) && erro instanceof Error && erro.message) return erro.message;
  return "Não foi possível enviar o e-mail de confirmação. Use Reenviar e-mail para tentar novamente.";
}
