import type { FaltaAoVivo } from "../operacao/leitura";
import { useDocumentoDoPortal, useLeituraDoPortal, type LeituraDoPortal } from "../portal/leitura-do-portal";
import {
  consultaDasEdicoesDoCliente,
  consultaDosEventosDoCliente,
  consultaDosPrecosDoCliente,
  edicaoDaLeitura,
  eventoDaLeitura,
  precoDaLeitura,
  referenciaDaEdicao,
  type EventoView,
  type PrecoDaEdicao,
} from "./leitura";
import type { EdicaoView } from "./tipos";

/**
 * As leituras do portal dos Eventos, ao vivo e pelo código do cliente da
 * conta, no molde de Minhas OS (lib/portal/use-servicos.ts): as regras só
 * abrem as do cliente, com a armazenagem no contrato, e sem o módulo
 * (`ligado` falso) nada é assinado. A falha tem a nova tentativa (`tentar`).
 */

function chaveDo(colecao: string, customerCode: string | null | undefined, ligado: boolean): { chave: string | null; codigo: string } {
  const codigo = customerCode?.trim() || "";
  return { chave: ligado && codigo ? `portal:${colecao}:${codigo}` : null, codigo };
}

export function useEventosDoCliente(customerCode: string | null | undefined, ligado: boolean): LeituraDoPortal<EventoView> {
  const { chave, codigo } = chaveDo("client_events", customerCode, ligado);
  return useLeituraDoPortal(chave, (db) => consultaDosEventosDoCliente(db, codigo), eventoDaLeitura);
}

export function useEdicoesDoCliente(customerCode: string | null | undefined, ligado: boolean): LeituraDoPortal<EdicaoView> {
  const { chave, codigo } = chaveDo("client_event_editions", customerCode, ligado);
  return useLeituraDoPortal(chave, (db) => consultaDasEdicoesDoCliente(db, codigo), edicaoDaLeitura);
}

export function usePrecosDoCliente(customerCode: string | null | undefined, ligado: boolean): LeituraDoPortal<PrecoDaEdicao> {
  const { chave, codigo } = chaveDo("client_event_prices", customerCode, ligado);
  return useLeituraDoPortal(chave, (db) => consultaDosPrecosDoCliente(db, codigo), precoDaLeitura);
}

export type EdicaoAoVivo = {
  /** `undefined` lendo; `null` sem o documento. */
  edicao: EdicaoView | null | undefined;
  erro: boolean;
  tentando: boolean;
  tentar: () => void;
} & FaltaAoVivo;

/**
 * Uma edição ao vivo, sem chave do react-query: a escuta entrega também a
 * própria escrita. A regra lê o documento para conferir o cliente, então a
 * edição apagada (o rascunho excluído) ou de outro cliente chega como falha.
 */
export function useEdicaoDoEvento(id: string | null): EdicaoAoVivo {
  const leitura = useDocumentoDoPortal(id ? `portal:client_event_editions:doc:${id}` : null, (db) => referenciaDaEdicao(db, id ?? ""), edicaoDaLeitura);
  return { edicao: leitura.item, erro: leitura.erro, tentando: leitura.tentando, tentar: leitura.tentar, falta: leitura.falta, lidaEm: leitura.lidaEm };
}
