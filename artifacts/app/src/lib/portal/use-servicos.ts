import { collection, query, where } from "firebase/firestore";

import { fichaDaLeitura, type FichaDaOs } from "../operacao/ficha-da-os";
import { useLeitura } from "../operacao/leitura";
import { nfDoPortal, type NfDoPortal } from "./servicos";

/**
 * As leituras do portal com a Operação e o Financeiro (parte 4.3b), ao vivo e
 * sempre pelo código do cliente da conta: as regras só deixam o cliente ler
 * as OS e as NFs dele, com o módulo no contrato, e a consulta precisa do
 * filtro para passar. Sem o módulo (`ligado` falso), nada é assinado.
 */

export function useOsDoCliente(customerCode: string | null | undefined, ligado: boolean): { os: FichaDaOs[] | null; erro: boolean } {
  const codigo = customerCode?.trim() || null;
  const leitura = useLeitura(
    ligado && codigo ? `portal:service_orders:${codigo}` : null,
    (db) => query(collection(db, "service_orders"), where("customer_code", "==", codigo)),
    fichaDaLeitura,
  );
  return { os: leitura.itens, erro: leitura.erro };
}

export function useNfsDoCliente(customerCode: string | null | undefined, ligado: boolean): { nfs: NfDoPortal[] | null; erro: boolean } {
  const codigo = customerCode?.trim() || null;
  const leitura = useLeitura(
    ligado && codigo ? `portal:client_faturas:${codigo}` : null,
    (db) => query(collection(db, "client_faturas"), where("customer_code", "==", codigo)),
    nfDoPortal,
  );
  return { nfs: leitura.itens, erro: leitura.erro };
}
