import { useState } from "react";
import { useLocation, useSearch } from "wouter";

import { useAppUser } from "@/lib/auth";
import { osDaBusca } from "@/lib/operacao/navegacao";
import { hojeIso } from "@/lib/operacao/fila";
import { useOperationProfile } from "@/lib/operation-profile";
import { leiturasDoPortal } from "@/lib/operations";
import { aPagar, cobrancaPorDemanda, numerosDasOs, ordenarOs, osDoPortal } from "@/lib/portal/servicos";
import { useNfsDoCliente, useOsDoCliente } from "@/lib/portal/use-servicos";

import { ServicosView } from "./servicos-view";

/**
 * Portal › Minhas OS (parte 4.3b): as OS do cliente da conta, com a NF da
 * demanda de cada uma quando o contrato tem as faturas. Só lê o que o
 * contrato deixa (leiturasDoPortal, a mesma régua das regras); a OS aberta
 * fica na URL (`?os=`).
 */
export function ClienteServicos() {
  const { user } = useAppUser();
  const { profile } = useOperationProfile();
  const [, navegar] = useLocation();
  const [busca, setBusca] = useState("");
  const hoje = hojeIso(new Date());
  const leituras = profile ? leiturasDoPortal(profile.modules) : null;
  const codigo = user?.publicMetadata.customer_code;
  const leituraDasOs = useOsDoCliente(codigo, Boolean(leituras?.servicos));
  const leituraDasNfs = useNfsDoCliente(codigo, Boolean(leituras?.faturas));
  const pedida = osDaBusca(useSearch());

  const os = ordenarOs((leituraDasOs.os ?? []).map((ficha) => osDoPortal(ficha, hoje)));
  const nfs = leituraDasNfs.nfs ?? [];
  const estado = leituraDasOs.erro ? "erro" : leituras && leituraDasOs.os ? "pronto" : "carregando";
  // A rolagem é da tela, como nas outras do portal.
  return (
    <main className="h-full min-h-0 w-full overflow-y-auto">
      <ServicosView
        estado={estado}
        os={os}
        numeros={numerosDasOs(os)}
        aPagarCents={leituras?.faturas && leituraDasNfs.nfs ? aPagar(nfs, hoje) : null}
        cobrancas={cobrancaPorDemanda(nfs, hoje)}
        busca={busca}
        aberta={(pedida && os.find((item) => item.numero === pedida)) || null}
        acoes={{
          buscar: setBusca,
          abrir: (numero) => navegar(`/portal/servicos?os=${encodeURIComponent(numero)}`),
          fechar: () => navegar("/portal/servicos"),
        }}
      />
    </main>
  );
}
