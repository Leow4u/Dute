import type { FalhaDaFila, RegistroNaFila } from "./fila";

/**
 * A fila do campo guardada no aparelho (docs/plataforma/fase-3-operacao.md,
 * parte 3.8c): cada registro que ainda não chegou fica no IndexedDB do
 * navegador, com a foto dentro e o instante do toque, e volta à fila quando
 * o app abre de novo, mesmo sem sinal. A chave do registro é a de
 * idempotência: reenviar o que já tinha chegado grava uma vez só.
 *
 * Cada pessoa vê só os registros dela (o celular pode ser de mais de um). Sem
 * IndexedDB (aba privada, navegador antigo), a fila fica só na memória.
 *
 * As falhas (o que a callable recusou) ficam no localStorage, por pessoa, até
 * ela dispensar: cada tela do /campo monta a fila de novo, e a recusa da
 * conclusão sumia na primeira troca de tela, com a assinatura do cliente.
 */

const BANCO = "dute-campo";
const VERSAO = 1;
const LOJA = "registros";
const POR_PESSOA = "uid";
const FALHAS = "dute.campo.falhas.";

type RegistroGuardado = RegistroNaFila & { uid: string; ordem: number };

export type ArmazemDaFila = {
  /** Os registros da pessoa, na ordem em que entraram na fila. */
  carregar: (uid: string) => Promise<RegistroNaFila[]>;
  /** Troca os registros guardados da pessoa pela fila atual. */
  guardar: (uid: string, fila: readonly RegistroNaFila[]) => Promise<void>;
  /** As falhas da pessoa que ela ainda não dispensou. */
  carregarFalhas: (uid: string) => Promise<FalhaDaFila[]>;
  /** Troca as falhas guardadas da pessoa pelas atuais. */
  guardarFalhas: (uid: string, falhas: readonly FalhaDaFila[]) => Promise<void>;
};

type Armazenamento = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function armazenamentoLocal(): Armazenamento | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function ehFalha(valor: unknown): valor is FalhaDaFila {
  const falha = valor as Partial<FalhaDaFila> | null;
  return (
    typeof falha?.chave === "string" &&
    typeof falha.rotulo === "string" &&
    typeof falha.mensagem === "string" &&
    (falha.foto === undefined || typeof falha.foto === "string")
  );
}

/** As falhas no localStorage do aparelho; sem ele, na memória. */
function falhasGuardadas(armazenamento: Armazenamento | null): Pick<ArmazemDaFila, "carregarFalhas" | "guardarFalhas"> {
  if (!armazenamento) {
    const naMemoria = new Map<string, FalhaDaFila[]>();
    return {
      carregarFalhas: async (uid) => [...(naMemoria.get(uid) ?? [])],
      guardarFalhas: async (uid, falhas) => {
        naMemoria.set(uid, [...falhas]);
      },
    };
  }
  return {
    carregarFalhas: async (uid) => {
      const lidas: unknown = JSON.parse(armazenamento.getItem(FALHAS + uid) ?? "[]");
      return Array.isArray(lidas) ? lidas.filter(ehFalha) : [];
    },
    guardarFalhas: async (uid, falhas) => {
      if (falhas.length) armazenamento.setItem(FALHAS + uid, JSON.stringify(falhas));
      else armazenamento.removeItem(FALHAS + uid);
    },
  };
}

function pedido<T>(requisicao: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    requisicao.onsuccess = () => resolve(requisicao.result);
    requisicao.onerror = () => reject(requisicao.error);
  });
}

function concluida(transacao: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transacao.oncomplete = () => resolve();
    transacao.onerror = () => reject(transacao.error);
    transacao.onabort = () => reject(transacao.error);
  });
}

function abrir(fabrica: IDBFactory): Promise<IDBDatabase> {
  const requisicao = fabrica.open(BANCO, VERSAO);
  requisicao.onupgradeneeded = () => {
    const banco = requisicao.result;
    if (!banco.objectStoreNames.contains(LOJA)) {
      banco.createObjectStore(LOJA, { keyPath: "chave" }).createIndex(POR_PESSOA, POR_PESSOA);
    }
  };
  return pedido(requisicao);
}

function semOGuardado({ uid: _uid, ordem: _ordem, ...registro }: RegistroGuardado): RegistroNaFila {
  return registro;
}

/** Na memória: o recuo sem IndexedDB e o que os testes usam para a fila. */
export function armazemNaMemoria(armazenamento: Armazenamento | null = null): ArmazemDaFila {
  const guardados = new Map<string, RegistroNaFila[]>();
  return {
    carregar: async (uid) => [...(guardados.get(uid) ?? [])],
    guardar: async (uid, fila) => {
      guardados.set(uid, [...fila]);
    },
    ...falhasGuardadas(armazenamento),
  };
}

/** No IndexedDB do aparelho (as falhas, no localStorage); sem ele, na memória. */
export function armazemNoAparelho(
  fabrica: IDBFactory | null = typeof indexedDB === "undefined" ? null : indexedDB,
  armazenamento: Armazenamento | null = armazenamentoLocal(),
): ArmazemDaFila {
  if (!fabrica) return armazemNaMemoria(armazenamento);
  let banco: Promise<IDBDatabase> | null = null;
  const conexao = () => (banco ??= abrir(fabrica));
  return {
    ...falhasGuardadas(armazenamento),
    carregar: async (uid) => {
      const db = await conexao();
      const transacao = db.transaction(LOJA, "readonly");
      const guardados = (await pedido(transacao.objectStore(LOJA).index(POR_PESSOA).getAll(uid))) as RegistroGuardado[];
      return guardados.sort((a, b) => a.ordem - b.ordem).map(semOGuardado);
    },
    guardar: async (uid, fila) => {
      const db = await conexao();
      const transacao = db.transaction(LOJA, "readwrite");
      const loja = transacao.objectStore(LOJA);
      const chaves = (await pedido(loja.index(POR_PESSOA).getAllKeys(uid))) as IDBValidKey[];
      for (const chave of chaves) loja.delete(chave);
      fila.forEach((registro, ordem) => loja.put({ ...registro, uid, ordem } satisfies RegistroGuardado));
      await concluida(transacao);
    },
  };
}
