import { collection, query, where } from "firebase/firestore";

import { fichaDaLeitura, type FichaDaOs } from "../operacao/ficha-da-os";
import { useLeituraDoPortal } from "./leitura-do-portal";
import { nfDoPortal, type NfDoPortal } from "./servicos";
import { solicitacaoDoPortal, type SolicitacaoDoPortal } from "./solicitacao";

/**
 * As leituras do portal com a Operação e o Financeiro (parte 4.3b), ao vivo e
 * sempre pelo código do cliente da conta: as regras só deixam o cliente ler
 * as OS e as NFs dele, com o módulo no contrato, e a consulta precisa do
 * filtro para passar. Sem o módulo (`ligado` falso), nada é assinado. A
 * falha tem a nova tentativa (`tentar`), e enquanto ela não responde a falha
 * fica na tela (`tentando`; carregamento v2, parte 13f).
 */

/** A nova tentativa da leitura que falhou. */
type NovaTentativa = { tentando: boolean; tentar: () => void };

export function useOsDoCliente(customerCode: string | null | undefined, ligado: boolean): { os: FichaDaOs[] | null; erro: boolean } & NovaTentativa {
  const codigo = customerCode?.trim() || null;
  const leitura = useLeituraDoPortal(
    ligado && codigo ? `portal:service_orders:${codigo}` : null,
    (db) => query(collection(db, "service_orders"), where("customer_code", "==", codigo)),
    fichaDaLeitura,
  );
  return { os: leitura.itens, erro: leitura.erro, tentando: leitura.tentando, tentar: leitura.tentar };
}

export function useNfsDoCliente(customerCode: string | null | undefined, ligado: boolean): { nfs: NfDoPortal[] | null; erro: boolean } & NovaTentativa {
  const codigo = customerCode?.trim() || null;
  const leitura = useLeituraDoPortal(
    ligado && codigo ? `portal:client_faturas:${codigo}` : null,
    (db) => query(collection(db, "client_faturas"), where("customer_code", "==", codigo)),
    nfDoPortal,
  );
  return { nfs: leitura.itens, erro: leitura.erro, tentando: leitura.tentando, tentar: leitura.tentar };
}

/** As solicitações de OS do cliente pelo portal (parte 4.4b), ao vivo, pelo código do cliente da conta. */
export function useSolicitacoesDoCliente(customerCode: string | null | undefined, ligado: boolean): { solicitacoes: SolicitacaoDoPortal[] | null; erro: boolean } & NovaTentativa {
  const codigo = customerCode?.trim() || null;
  const leitura = useLeituraDoPortal(
    ligado && codigo ? `portal:service_requests:${codigo}` : null,
    (db) => query(collection(db, "service_requests"), where("customer_code", "==", codigo)),
    solicitacaoDoPortal,
  );
  return { solicitacoes: leitura.itens, erro: leitura.erro, tentando: leitura.tentando, tentar: leitura.tentar };
}
