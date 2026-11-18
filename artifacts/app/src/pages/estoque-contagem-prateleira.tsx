import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useSearch } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { useAppUser } from "@/lib/auth";
import { avisoDoErroDaEscrita, useTentativaDaEscrita } from "@/lib/carregando/tentativa-da-escrita";
import { relerDoZero } from "@/lib/carregando/reler-do-zero";
import { canOperateWarehouse } from "@/lib/permissions";
import { horaEmTexto, hrefDaFolha } from "@/lib/warehouse-ops/contagem-por-caixa";
import {
  CONTAGEM_EM_BRANCO,
  RODADA_DA_RECONTAGEM_GERAL,
  comRecontagensLocais,
  contagemDaCaixaVazia,
  entradaDaRecontagem,
  posicaoDaBusca,
  proximaPorContar,
  recontagemDaResposta,
  soAlgarismos,
  unidadesComSinal,
  type CaixaDaBancada,
  type ContagemDigitada,
  type Recontagem,
} from "@/lib/warehouse-ops/recontagem-por-caixa";
import { useBancadaDaPrateleira } from "@/lib/warehouse-ops/use-recontagem";
import { recontarCaixa } from "@/lib/wms/recontagem";

import { EstoqueContagemPrateleiraView, idsDaCaixa, type EstadoDaPrateleira } from "./estoque-contagem-prateleira-view";

/**
 * Estoque › Contagem por caixa › a prateleira da URL (?posicao=A-03): a
 * bancada da recontagem caixa a caixa (diagnóstico da Contagem cíclica,
 * seção 6, item 4). Cada "Confirmar caixa" grava a caixa e o saldo da
 * prateleira juntos, pela callable `recountWarehouseBox`, com o `round_id`
 * da recontagem geral; a resposta mostra na hora a caixa confirmada e a origem
 * da peça a mais, e a leitura ao vivo traz o que outra pessoa grava.
 */

type Pedido = { caixa: CaixaDaBancada; digitado: ContagemDigitada };

/** Foca o elemento do id depois do próximo quadro: o campo novo, o botão que entrou no lugar. */
function focarDepois(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

export default function PaginaPrateleiraDaContagem() {
  const posicao = posicaoDaBusca(useSearch());
  const { code, isLoading: clienteCarregando, falhou: clienteFalhou } = useActiveCustomer();
  // Sem o cliente ativo confirmado, nada é lido com o cliente padrão: o customer_code é a fronteira.
  const cliente = clienteCarregando || clienteFalhou ? null : code;
  const { user } = useAppUser();
  const operador = canOperateWarehouse(user?.publicMetadata.role);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  // A rodada é a da recontagem geral, fixa até a coleção da rodada: a recontagem leva o `round_id` dela em qualquer dia.
  const rodada = RODADA_DA_RECONTAGEM_GERAL.id;
  // O dia da tela, para a hora das recontagens: a de outro dia sai com o dia.
  const [agora] = useState(() => new Date());
  const leitura = useBancadaDaPrateleira(cliente, posicao, rodada);

  const [emContagem, setEmContagem] = useState<string | null>(null);
  const [digitado, setDigitado] = useState<ContagemDigitada>(CONTAGEM_EM_BRANCO);
  // A última recontagem gravada na caixa quando ela abriu: outra, na resposta, é de outra pessoa no meio.
  const [antes, setAntes] = useState<string | null>(null);
  const [locais, setLocais] = useState<readonly Recontagem[]>([]);
  const tentativa = useTentativaDaEscrita();

  const bancada = useMemo(() => comRecontagensLocais(leitura.bancada, locais, leitura.gravadas), [leitura.bancada, locais, leitura.gravadas]);
  const caixa = bancada?.caixas.find((candidata) => candidata.code === emContagem) ?? null;
  const pedido = caixa ? { caixa: caixa.code, itens: caixa.itens.map((item) => item.sku), digitado } : null;

  const abrir = (code: string) => {
    const alvo = bancada?.caixas.find((candidata) => candidata.code === code);
    tentativa.esquecer();
    setEmContagem(alvo ? code : null);
    setDigitado(CONTAGEM_EM_BRANCO);
    setAntes(alvo?.ultimaRecontagem ?? null);
  };

  const gravar = useMutation({
    mutationFn: ({ caixa: alvo, digitado: contado }: Pedido) => {
      const entrada = cliente && posicao ? entradaDaRecontagem({ cliente, posicao, rodada }, alvo, contado) : null;
      if (!entrada) return Promise.reject(new Error("Conte todos os itens da caixa."));
      return tentativa.enviar({ caixa: alvo.code, itens: alvo.itens.map((item) => item.sku), digitado: contado }, () => entrada, (corpo) => recontarCaixa(corpo));
    },
    onSuccess: (resposta, { caixa: alvo }) => {
      const recontagem = recontagemDaResposta(resposta, { quem: user?.fullName || user?.primaryEmailAddress?.emailAddress || "—", quando: new Date().toISOString(), catalogo: leitura.catalogo });
      setLocais((atuais) => [...atuais.filter((local) => local.caixa !== recontagem.caixa), recontagem]);
      const anterior = resposta.previous_recount;
      const outraPessoa = anterior?.recount_id && anterior.recount_id !== antes ? `Contada antes por ${anterior.by_name || "outra pessoa"}${anterior.at ? ` às ${horaEmTexto(anterior.at)}` : ""}.` : "";
      toast({
        title: recontagem.vazia ? `${recontagem.caixa} vazia` : `${recontagem.caixa} confirmada`,
        description: [recontagem.diferenca === 0 ? "Sem diferença." : `Diferença ${unidadesComSinal(recontagem.diferenca)}`, outraPessoa].filter(Boolean).join(" "),
      });
      // A próxima caixa por contar abre, com o foco no primeiro campo; sem ela, o foco vai ao "Contar de novo".
      const proxima = bancada ? proximaPorContar(bancada, alvo.code) : null;
      setEmContagem(proxima);
      setDigitado(CONTAGEM_EM_BRANCO);
      setAntes(proxima ? (bancada?.caixas.find((candidata) => candidata.code === proxima)?.ultimaRecontagem ?? null) : null);
      if (!proxima) focarDepois(idsDaCaixa(alvo.code).contar);
      // O Caixas × saldo, a folha e o Estoque leem de novo quando abrirem.
      void queryClient.invalidateQueries({ queryKey: ["warehouse-boxes"] });
      void queryClient.invalidateQueries({ queryKey: ["stock-balances"] });
      void queryClient.invalidateQueries({ queryKey: ["cycle-counts"] });
    },
    onError: (erro: Error) => {
      // A recusa diz o motivo do servidor; a lista que mudou se refaz sozinha pela leitura ao vivo.
      toast({ ...avisoDoErroDaEscrita(erro, `${emContagem ?? "Caixa"} não confirmada`), description: erro.message });
    },
  });

  const acoes = {
    onDigitar: (sku: string, valor: string) => setDigitado((atual) => ({ ...atual, contados: { ...atual.contados, [sku]: soAlgarismos(valor) } })),
    onAcrescentar: (produto: { sku: string; codigo: string; nome: string }) => {
      if (!caixa) return;
      const indice = caixa.itens.length + digitado.foraDaLista.length;
      setDigitado((atual) => ({ ...atual, foraDaLista: [...atual.foraDaLista, { sku: produto.sku, codigo: produto.codigo, nome: produto.nome, contado: "" }] }));
      focarDepois(`contado-${caixa.code}-${indice}`);
    },
    onDigitarForaDaLista: (sku: string, valor: string) =>
      setDigitado((atual) => ({ ...atual, foraDaLista: atual.foraDaLista.map((item) => (item.sku === sku ? { ...item, contado: soAlgarismos(valor) } : item)) })),
    onRemoverForaDaLista: (sku: string) => setDigitado((atual) => ({ ...atual, foraDaLista: atual.foraDaLista.filter((item) => item.sku !== sku) })),
    onCaixaVazia: () => {
      if (!caixa) return;
      setDigitado(contagemDaCaixaVazia(caixa));
      focarDepois(`confirmar-${caixa.code}`);
    },
    onConfirmar: () => {
      if (caixa && !gravar.isPending) gravar.mutate({ caixa, digitado });
    },
  };

  // A prateleira sem caixa do cliente diz isso, e só depois de ler tudo: nunca a lista vazia antes da leitura.
  const estado: EstadoDaPrateleira = !posicao
    ? "nao_encontrada"
    : clienteCarregando || leitura.carregando
      ? "carregando"
      : leitura.falhou
        ? "erro"
        : !bancada?.caixas.length
          ? "nao_encontrada"
          : "pronto";

  return (
    <EstoqueContagemPrateleiraView
      estado={estado}
      posicao={posicao ?? "Prateleira"}
      agora={agora}
      bancada={bancada}
      operador={operador}
      emContagem={emContagem}
      digitado={digitado}
      confirmar={{ estado: gravar.isPending ? "andamento" : "repouso", rotulo: pedido && tentativa.repete(pedido) ? "Tentar de novo" : undefined }}
      produtos={leitura.produtos}
      clienteFalhou={clienteFalhou}
      catalogoFalhou={leitura.catalogoFalhou}
      onTentarCatalogo={() => relerDoZero(queryClient, [["estoque", "skus"]])}
      hrefDaFolha={hrefDaFolha(bancada?.rua)}
      leitura={leitura.leitura}
      onTentar={() => leitura.leitura.tentar()}
      onContar={abrir}
      acoes={acoes}
    />
  );
}
