/**
 * A regra única das respostas do Firestore (carregamento v2, partes 7a e
 * 13j): a resposta só do cache é a falta (o SDK se deu por offline), e a do
 * servidor é a volta. A leitura do `lib/cloud-api.ts` (o `getDocs` e o
 * `getDoc`) e a escuta ao vivo (`lib/operacao/leitura.ts`, que o Comercial, o
 * campo, o portal e o Financeiro usam) passam por aqui:
 *
 * - `firestoreRespondeu` guarda se o SDK está só no cache. O `lib/cloud-api.ts`
 *   acorda o SDK por esse sinal (`acordarFirestore`) e, enquanto ele está
 *   offline, escuta o próprio perfil para saber da volta;
 * - a escuta de fora do react-query diz ao estado único da conexão quando
 *   ficou sem o servidor e quando ele voltou (`leituraDeFora`, em
 *   `estado-da-conexao.ts`), como o react-query faz pelas leituras do
 *   `lib/cloud-api.ts`.
 *
 * Sem dependência do Firebase: quem fala com o SDK é quem lê.
 */

/** O SDK do Firestore está só no cache: a última resposta dele, de uma leitura ou de uma escuta, não veio do servidor. */
let soNoCache = false;
/** Desde quando (no relógio do `Date.now()`, o da hora que a tela mostra) ele está só no cache. */
let soNoCacheDesde: number | null = null;
const ouvintes = new Set<() => void>();

/** O SDK do Firestore se deu por offline: a última resposta dele só achou o cache. */
export function firestoreSoNoCache(): boolean {
  return soNoCache;
}

/**
 * Desde quando o SDK está só no cache, para a hora da lista que ficou na tela
 * ("lista de 10:42"): até ali, o que as escutas mostravam estava em dia com o
 * servidor. Nulo com o SDK em dia.
 */
export function firestoreSoNoCacheDesde(): number | null {
  return soNoCacheDesde;
}

/**
 * Uma resposta do Firestore: do servidor (a volta) ou só do cache (a falta).
 * Quem ouve fica sabendo a cada resposta só do cache (o perfil que espera a
 * volta só começa com alguém logado) e quando o SDK volta ao servidor.
 */
export function firestoreRespondeu(doServidor: boolean, agora: () => number = Date.now): void {
  const antes = soNoCache;
  soNoCache = !doServidor;
  if (soNoCache && !antes) soNoCacheDesde = agora();
  if (!soNoCache) soNoCacheDesde = null;
  if (soNoCache || antes) for (const ouvinte of [...ouvintes]) ouvinte();
}

/** Ouve as respostas que mudam o sinal (ou que confirmam o cache). Devolve quem desliga. */
export function ouvirRespostasDoFirestore(ouvinte: () => void): () => void {
  ouvintes.add(ouvinte);
  return () => {
    ouvintes.delete(ouvinte);
  };
}
