import type { RegistroNaFila } from "./fila";

/**
 * A fila do campo guardada no aparelho (docs/plataforma/fase-3-operacao.md,
 * parte 3.8c): cada registro que ainda não chegou fica no IndexedDB do
 * navegador, com a foto dentro e o instante do toque, e volta à fila quando
 * o app abre de novo, mesmo sem sinal. A chave do registro é a de
 * idempotência: reenviar o que já tinha chegado grava uma vez só.
 *
 * Cada pessoa vê só os registros dela (o celular pode ser de mais de um). Sem
 * IndexedDB (aba privada, navegador antigo), a fila fica só na memória.
 */

const BANCO = "dute-campo";
const VERSAO = 1;
const LOJA = "registros";
const POR_PESSOA = "uid";

type RegistroGuardado = RegistroNaFila & { uid: string; ordem: number };

export type ArmazemDaFila = {
  /** Os registros da pessoa, na ordem em que entraram na fila. */
  carregar: (uid: string) => Promise<RegistroNaFila[]>;
  /** Troca os registros guardados da pessoa pela fila atual. */
  guardar: (uid: string, fila: readonly RegistroNaFila[]) => Promise<void>;
};

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
export function armazemNaMemoria(): ArmazemDaFila {
  const guardados = new Map<string, RegistroNaFila[]>();
  return {
    carregar: async (uid) => [...(guardados.get(uid) ?? [])],
    guardar: async (uid, fila) => {
      guardados.set(uid, [...fila]);
    },
  };
}

/** No IndexedDB do aparelho; sem ele, na memória. */
export function armazemNoAparelho(fabrica: IDBFactory | null = typeof indexedDB === "undefined" ? null : indexedDB): ArmazemDaFila {
  if (!fabrica) return armazemNaMemoria();
  let banco: Promise<IDBDatabase> | null = null;
  const conexao = () => (banco ??= abrir(fabrica));
  return {
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
