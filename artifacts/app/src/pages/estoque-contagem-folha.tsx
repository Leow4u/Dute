import { useMemo, useState } from "react";
import { flushSync } from "react-dom";
import { useLocation, useSearch } from "wouter";

import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import { folhaDeContagem, hrefDaFolha, ruaDaBusca, ruasDaContagem } from "@/lib/warehouse-ops/contagem-por-caixa";
import { useContagemPorCaixa } from "@/lib/warehouse-ops/use-contagem-por-caixa";

import { EstoqueContagemFolhaView, type EstadoDaFolha } from "./estoque-contagem-folha-view";

/**
 * Estoque › Contagem › Folha de contagem (diagnóstico da Contagem cíclica,
 * seção 6, item 1): a folha A4 da rua da busca (?rua=A; sem ela, a primeira
 * rua do cliente ativo), lida das mesmas leituras do Mapa e das Etiquetas. Só
 * leitura: nada aqui grava. Imprimir é o do navegador (Imprimir → Salvar
 * como PDF), como a lista de separação.
 */
export default function PaginaFolhaDeContagem() {
  const busca = useSearch();
  const [, navigate] = useLocation();
  const { user } = useAppUser();
  const { code, active, isLoading: clienteCarregando, falhou: clienteFalhou } = useActiveCustomer();
  // Sem o cliente ativo confirmado, nada é lido com o cliente padrão: o customer_code é a fronteira.
  const cliente = clienteCarregando || clienteFalhou ? null : code;
  const leitura = useContagemPorCaixa(cliente);
  const ruas = useMemo(() => ruasDaContagem(leitura.prateleiras), [leitura.prateleiras]);
  const pedida = ruaDaBusca(busca);
  const rua = pedida ?? ruas[0] ?? null;
  // A hora da folha: a da abertura e, ao imprimir, a do clique.
  const [agora, setAgora] = useState(() => new Date());
  const [tentativas, setTentativas] = useState(0);

  const estado: EstadoDaFolha = clienteCarregando || leitura.carregando ? "carregando" : leitura.falha ? "erro" : "pronto";
  const folha =
    estado === "pronto" && rua && ruas.includes(rua)
      ? folhaDeContagem({ rua, prateleiras: leitura.prateleiras, cliente: active.name || code, por: user?.fullName, agora })
      : null;

  const tentar = () => {
    setTentativas((quantas) => quantas + 1);
    return leitura.tentar().finally(() => setTentativas((quantas) => quantas - 1));
  };
  const imprimir = () => {
    // A hora entra na folha antes de o navegador abrir a impressão.
    flushSync(() => setAgora(new Date()));
    window.print();
  };
  return (
    <EstoqueContagemFolhaView
      estado={estado}
      folha={folha}
      ruas={ruas}
      rua={rua}
      onRua={(escolhida) => navigate(hrefDaFolha(escolhida))}
      falha={leitura.falha}
      clienteFalhou={clienteFalhou}
      catalogoFalhou={leitura.catalogoFalhou}
      tentando={tentativas > 0}
      onImprimir={imprimir}
      onTentar={tentar}
    />
  );
}
