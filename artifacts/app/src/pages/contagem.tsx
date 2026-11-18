import { useEffect, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useLocation } from "wouter";

import { useOpeningInventorySession } from "@/features/warehouse-ops/opening-inventory-status";
import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { falhaDasLeituras } from "@/lib/carregando/falha-das-leituras";
import { avisoDoErroDaEscrita, useTentativaDaEscrita } from "@/lib/carregando/tentativa-da-escrita";
import { useLeituraComFalha } from "@/lib/carregando/use-leitura-com-falha";
import { registroDaAberturaConcluida } from "@/lib/opening-inventory";
import { juntarTentativas } from "@/lib/operacao/leitura";
import { hrefDaFolha, ruasDaContagem } from "@/lib/warehouse-ops/contagem-por-caixa";
import { produtosDoCliente, rodadaDaContagem } from "@/lib/warehouse-ops/recontagem-por-caixa";
import { entradaDoInicio, numerosDaRodadaConcluida, rodadaRegistrada, type EscolhaDoAlcance } from "@/lib/warehouse-ops/rodadas-da-contagem";
import { useContagemPorCaixa } from "@/lib/warehouse-ops/use-contagem-por-caixa";
import { useCaixasDoCliente } from "@/lib/warehouse-ops/use-lista-de-separacao";
import { useCatalogoDoCliente, useLeiturasDaRodada } from "@/lib/warehouse-ops/use-recontagem";
import { useRodadasDaContagem } from "@/lib/warehouse-ops/use-rodadas";
import { concluirContagem, iniciarContagem } from "@/lib/wms/rodadas";

import { ContagemView, ROTA_DA_ABERTURA, type ConcluirNaEntrada, type EstadoDaEntrada, type IniciarNaEntrada } from "./contagem-view";

/**
 * Estoque › Contagem, a entrada (desenho de 18/11/2026; o registro da
 * rodada): para o cliente com a abertura concluída, as contagens: a rodada
 * aberta em andamento (as mesmas leituras da Contagem por caixa, ao vivo),
 * "Iniciar contagem" sem rodada aberta, "Concluir contagem" na que está, e
 * as anteriores (as rodadas concluídas e a abertura, lida da sessão). Com a
 * abertura pendente ou em curso, a tela de hoje, em /wms/contagem/abertura,
 * que volta para cá quando a sessão conclui. Grava pelas callables
 * `startCountRound` e `completeCountRound`, com a chave da tentativa.
 */

const SEM_CATALOGO = new Map();

export default function PaginaDaContagem() {
  const { code, active, isLoading: clienteCarregando, falhou: clienteFalhou } = useActiveCustomer();
  // Sem o cliente ativo confirmado, nada é lido com o cliente padrão: o customer_code é a fronteira.
  const cliente = clienteCarregando || clienteFalhou ? null : code;
  const [agora] = useState(() => new Date());
  const [, navegar] = useLocation();
  const { toast } = useToast();

  const sessao = useOpeningInventorySession();
  // A sessão que falhou fica na tela enquanto tenta de novo (a cópia): a falha nunca vira o vazio.
  const sessaoNaTela = useLeituraComFalha(sessao);
  // A abertura pendente ou em curso é a tela de hoje; a sessão só manda para lá depois de lida, nunca na falha.
  const precisaDaAbertura = sessao.data !== undefined && sessao.data.status !== "completed";
  useEffect(() => {
    if (precisaDaAbertura) navegar(ROTA_DA_ABERTURA, { replace: true });
  }, [precisaDaAbertura, navegar]);

  // A rodada aberta do cliente (a recontagem geral de 17/11 sem documento vale como aberta enquanto tem recontagem).
  const rodadas = useRodadasDaContagem(cliente);
  const rodada = rodadas.aberta;
  const leitura = useContagemPorCaixa(cliente);
  const caixas = useCaixasDoCliente(cliente);
  const daRodada = useLeiturasDaRodada(cliente, rodada?.id ?? null, SEM_CATALOGO);
  const resumo = useMemo(
    () =>
      rodada
        ? rodadaDaContagem({
            cliente,
            prateleiras: leitura.prateleiras,
            caixas: caixas.data ?? [],
            recontagens: daRodada.recontagens,
            guardas: daRodada.guardas,
            reservas: daRodada.separadas,
            rodada,
            agora,
          })
        : null,
    [cliente, leitura.prateleiras, caixas.data, daRodada.recontagens, daRodada.guardas, daRodada.separadas, rodada, agora],
  );
  const ruas = useMemo(() => ruasDaContagem(leitura.prateleiras), [leitura.prateleiras]);
  const primeiraRua = ruas[0] ?? null;
  // O catálogo do cliente, para o alcance por item (a mesma chave do Estoque e da bancada).
  const catalogo = useCatalogoDoCliente(Boolean(cliente));
  const produtos = useMemo(() => produtosDoCliente(catalogo.data?.items ?? [], cliente), [catalogo.data?.items, cliente]);

  // Iniciar e concluir: a chave da tentativa repete a mesma chave depois de um resultado incerto (nunca grava duas vezes).
  const [iniciarAberto, setIniciarAberto] = useState(false);
  const [concluirAberto, setConcluirAberto] = useState(false);
  const tentativaDoInicio = useTentativaDaEscrita();
  const tentativaDaConclusao = useTentativaDaEscrita();
  const inicio = useMutation({
    mutationFn: (escolha: EscolhaDoAlcance) => {
      if (!cliente) return Promise.reject(new Error("Confirme o cliente ativo antes de iniciar a contagem."));
      return tentativaDoInicio.enviar(escolha, () => entradaDoInicio(cliente, escolha), (corpo) => iniciarContagem(corpo));
    },
    onSuccess: (resposta) => {
      toast({ title: "Contagem iniciada", description: resposta.title });
      setIniciarAberto(false);
    },
    onError: (erro: Error) => {
      // A recusa diz o motivo do servidor; o diálogo fica aberto, com a escolha.
      toast({ ...avisoDoErroDaEscrita(erro, "Contagem não iniciada"), description: erro.message });
    },
  });
  const conclusao = useMutation({
    mutationFn: (id: string) => {
      if (!cliente) return Promise.reject(new Error("Confirme o cliente ativo antes de concluir a contagem."));
      return tentativaDaConclusao.enviar({ rodada: id }, () => ({ customer_code: cliente, round_id: id }), (corpo) => concluirContagem(corpo));
    },
    onSuccess: (resposta) => {
      const registrada = cliente ? rodadaRegistrada(resposta.round_id, { ...resposta, customer_code: cliente }) : null;
      toast({ title: "Contagem concluída", description: registrada?.numeros ? numerosDaRodadaConcluida(registrada.numeros) : resposta.title });
      setConcluirAberto(false);
    },
    onError: (erro: Error) => {
      toast({ ...avisoDoErroDaEscrita(erro, "Contagem não concluída"), description: erro.message });
    },
  });

  const falhaDaSessao = falhaDasLeituras([[sessao, sessaoNaTela]]);
  const estado: EstadoDaEntrada =
    clienteCarregando || sessaoNaTela.isLoading || rodadas.carregando || leitura.carregando || daRodada.carregando
      ? "carregando"
      : falhaDaSessao || leitura.falha || rodadas.falhou || daRodada.falhou
        ? "erro"
        : "pronto";

  const iniciar: IniciarNaEntrada | null =
    estado === "pronto" && !rodada
      ? {
          aberto: iniciarAberto,
          estado: inicio.isPending ? "andamento" : "repouso",
          ruas,
          produtos,
          catalogoFalhou: catalogo.isError && catalogo.data === undefined,
          onAbrir: () => setIniciarAberto(true),
          onFechar: () => {
            if (!inicio.isPending) setIniciarAberto(false);
          },
          onIniciar: (escolha) => {
            if (!inicio.isPending) inicio.mutate(escolha);
          },
        }
      : null;
  const concluir: ConcluirNaEntrada | null =
    estado === "pronto" && rodada
      ? {
          aberto: concluirAberto,
          estado: conclusao.isPending ? "andamento" : "repouso",
          onAbrir: () => setConcluirAberto(true),
          onFechar: () => {
            if (!conclusao.isPending) setConcluirAberto(false);
          },
          onConcluir: () => {
            if (!conclusao.isPending) conclusao.mutate(rodada.id);
          },
        }
      : null;

  return (
    <ContagemView
      estado={estado}
      cliente={active.name}
      abertura={estado === "pronto" ? registroDaAberturaConcluida(sessaoNaTela.data) : null}
      rodada={estado === "pronto" ? resumo : null}
      anteriores={estado === "pronto" ? rodadas.anteriores : undefined}
      iniciar={iniciar}
      concluir={concluir}
      agora={agora}
      leitura={[...leitura.leituras, sessaoNaTela]}
      aoVivo={juntarTentativas(rodadas.leitura, daRodada.leitura)}
      falha={falhaDaSessao ?? leitura.falha}
      clienteFalhou={clienteFalhou}
      hrefDaFolha={hrefDaFolha(primeiraRua)}
    />
  );
}
