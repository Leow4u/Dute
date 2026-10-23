import type { Firestore } from "firebase-admin/firestore";

/**
 * Apoio dos testes do Agent Dute (partes 5.5c e 5.5d), sem teste próprio: um
 * banco em memória que responde às consultas como o Firestore (os filtros, a
 * ordem e o limite) e recusa qualquer gravação. Toda ferramenta roda nele:
 * se uma gravar, o teste quebra.
 */

export type DocumentoFalso = Record<string, unknown>;
export type ColecoesFalsas = Record<string, Record<string, DocumentoFalso>>;

export const GRAVACOES = ["set", "update", "delete", "create", "add", "batch", "runTransaction", "bulkWriter", "recursiveDelete"] as const;

function recusa(nome: string) {
  return () => {
    throw new Error(`gravação no banco: ${nome}`);
  };
}

function campo(documento: DocumentoFalso, caminho: string): unknown {
  return caminho.split(".").reduce<unknown>((valor, chave) => (valor && typeof valor === "object" ? (valor as Record<string, unknown>)[chave] : undefined), documento);
}

function comparar(a: unknown, b: unknown): number {
  if (a === b) return 0;
  if (a === undefined || a === null) return -1;
  if (b === undefined || b === null) return 1;
  return (a as number | string) < (b as number | string) ? -1 : 1;
}

function passa(valor: unknown, operador: string, alvo: unknown): boolean {
  switch (operador) {
    case "==":
      return valor === alvo;
    case "in":
      return Array.isArray(alvo) && alvo.includes(valor);
    case "array-contains":
      return Array.isArray(valor) && valor.includes(alvo);
    case ">=":
      return valor !== undefined && valor !== null && comparar(valor, alvo) >= 0;
    case ">":
      return valor !== undefined && valor !== null && comparar(valor, alvo) > 0;
    case "<=":
      return valor !== undefined && valor !== null && comparar(valor, alvo) <= 0;
    case "<":
      return valor !== undefined && valor !== null && comparar(valor, alvo) < 0;
    default:
      throw new Error(`operador sem suporte no banco falso: ${operador}`);
  }
}

type Estado = { filtros: Array<[string, string, unknown]>; ordem: Array<[string, string]>; limite: number | null };

export function bancoFalso(colecoes: ColecoesFalsas) {
  const consultas: Array<{ colecao: string } & Estado> = [];

  function snapshotDe(colecao: string, id: string, dados: DocumentoFalso | undefined) {
    return { id, exists: dados !== undefined, data: () => (dados ? structuredClone(dados) : undefined), get: (caminho: string) => (dados ? campo(dados, caminho) : undefined) };
  }

  function consulta(colecao: string, estado: Estado): Record<string, unknown> {
    const query: Record<string, unknown> = {
      where: (caminho: string, operador: string, valor: unknown) => consulta(colecao, { ...estado, filtros: [...estado.filtros, [caminho, operador, valor]] }),
      orderBy: (caminho: string, direcao = "asc") => consulta(colecao, { ...estado, ordem: [...estado.ordem, [caminho, direcao]] }),
      limit: (limite: number) => consulta(colecao, { ...estado, limite }),
      async get() {
        consultas.push({ colecao, ...estado });
        let docs = Object.entries(colecoes[colecao] ?? {}).filter(([, dados]) => estado.filtros.every(([caminho, operador, valor]) => passa(campo(dados, caminho), operador, valor)));
        docs = docs.sort(([idA, a], [idB, b]) => {
          for (const [caminho, direcao] of estado.ordem) {
            const diferenca = comparar(campo(a, caminho), campo(b, caminho));
            if (diferenca) return direcao === "desc" ? -diferenca : diferenca;
          }
          return idA.localeCompare(idB);
        });
        if (estado.limite !== null) docs = docs.slice(0, estado.limite);
        return { docs: docs.map(([id, dados]) => snapshotDe(colecao, id, dados)), size: docs.length, empty: docs.length === 0 };
      },
    };
    for (const nome of GRAVACOES) query[nome] = recusa(nome);
    return query;
  }

  const db: Record<string, unknown> = {
    collection(colecao: string) {
      const ref = consulta(colecao, { filtros: [], ordem: [], limite: null });
      ref.doc = (id: string) => {
        const docRef: Record<string, unknown> = { get: async () => snapshotDe(colecao, id, colecoes[colecao]?.[id]) };
        for (const nome of GRAVACOES) docRef[nome] = recusa(nome);
        return docRef;
      };
      return ref;
    },
  };
  for (const nome of GRAVACOES) db[nome] = recusa(nome);
  return { db: db as unknown as Firestore, consultas };
}
