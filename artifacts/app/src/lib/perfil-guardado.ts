import { profileAccess } from "./access";
import { type ProfileRole } from "./modules";

/**
 * O último perfil lido de cada pessoa neste aparelho. Sem sinal, o app abre
 * com ele (a equipe de campo trabalha onde não pega, e a fila guardada só
 * volta com o app aberto); o perfil do servidor confirma ou tira o acesso
 * quando a rede volta. Guarda só o papel, o cliente e o nome, e sai no
 * logout.
 */
export type PerfilGuardado = {
  role: ProfileRole;
  customer_code?: string;
  nome?: string;
};

type Armazenamento = Pick<Storage, "getItem" | "setItem" | "removeItem" | "key" | "length">;

const PREFIXO = "dute.perfil.";

/** O localStorage, ou null quando o navegador bloqueia até chegar nele. */
function armazenamentoDoAparelho(): Armazenamento | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function guardarPerfil(
  uid: string,
  perfil: PerfilGuardado | null,
  armazenamento: Armazenamento | null = armazenamentoDoAparelho(),
): void {
  if (!armazenamento || !uid) return;
  try {
    if (perfil) armazenamento.setItem(PREFIXO + uid, JSON.stringify(perfil));
    else armazenamento.removeItem(PREFIXO + uid);
  } catch {
    // Sem espaço ou sem storage: o app só abre sem sinal depois de uma leitura com rede.
  }
}

export function perfilGuardado(
  uid: string,
  armazenamento: Armazenamento | null = armazenamentoDoAparelho(),
): PerfilGuardado | null {
  if (!armazenamento || !uid) return null;
  try {
    const dados: unknown = JSON.parse(armazenamento.getItem(PREFIXO + uid) ?? "null");
    if (!dados || typeof dados !== "object") return null;
    const registro = dados as Record<string, unknown>;
    const acesso = profileAccess(registro);
    if (acesso.state !== "active") return null;
    return {
      role: acesso.role,
      customer_code: typeof registro.customer_code === "string" ? registro.customer_code : undefined,
      nome: typeof registro.nome === "string" ? registro.nome : undefined,
    };
  } catch {
    return null;
  }
}

export function esquecerPerfis(armazenamento: Armazenamento | null = armazenamentoDoAparelho()): void {
  if (!armazenamento) return;
  try {
    const chaves: string[] = [];
    for (let indice = 0; indice < armazenamento.length; indice += 1) {
      const chave = armazenamento.key(indice);
      if (chave?.startsWith(PREFIXO)) chaves.push(chave);
    }
    for (const chave of chaves) armazenamento.removeItem(chave);
  } catch {
    // Sem storage: não há o que esquecer.
  }
}
