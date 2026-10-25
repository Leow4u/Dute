import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocation, useSearch } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { useAppUser } from "@/lib/auth";
import { chamarFinanceiro, novaChave } from "@/lib/financeiro/api";
import {
  CABECALHO_DA_PLANILHA,
  TITULO_DO_FILTRO,
  faturasDoFiltro,
  formDoEnvio,
  formDoPagamento,
  linhasDaPlanilha,
  nomeDaPlanilha,
  nomesDosClientes,
  pagamentosDaNf,
  pedidoDoCancelamento,
  pedidoDoEnvio,
  pedidoDoEstorno,
  pedidoDoPagamento,
  problemasDoEnvio,
  problemasDoMotivo,
  problemasDoPagamento,
  receitaPorCliente,
  rotuloDaNf,
  type FaturaDoFinanceiro,
  type FiltroDeFaturas,
} from "@/lib/financeiro/faturas";
import { baixasPorPagamento } from "@/lib/financeiro/baixas";
import { ROTA_A_RECEBER, ROTA_FATURAS, ROTA_PAGOS, ROTA_VENCIDOS, hrefDaNf, nfDaBusca } from "@/lib/financeiro/navegacao";
import { CHAVE_DAS_BAIXAS, useBaixasDaNf } from "@/lib/financeiro/use-baixas";
import { useFaturas, usePagamentosDaNf, usePagamentosDoMes } from "@/lib/financeiro/use-faturas";
import { hojeIso } from "@/lib/operacao/fila";
import { baixarPlanilha, planilhaXlsx } from "@/lib/planilha-xlsx";

import { FaturasView, type PainelDaNfAberta } from "./faturas-view";

/**
 * Financeiro › A receber, Vencidos, Pagos e Faturas (parte 4.2b de
 * docs/plataforma/fase-4-financeiro.md). Lê `faturas` e os pagamentos da NF
 * aberta pelo Firestore, como as regras permitem a quem lê preço. A NF aberta
 * fica na URL (`?nf=`), para o Início levar direto a ela. Grava só pela
 * callable advanceFatura, com uma chave de idempotência por intenção; o
 * servidor confere de novo o saldo, as datas e o status.
 */

const ROTA_DO_FILTRO: Record<FiltroDeFaturas, string> = {
  a_receber: ROTA_A_RECEBER,
  vencidos: ROTA_VENCIDOS,
  pagos: ROTA_PAGOS,
  todas: ROTA_FATURAS,
};

type ResultadoDaCobranca = { status?: unknown; saldo_cents?: unknown };

/** O que a gravação desta tela recomeça no painel, com a resposta do servidor. */
type Recomeco = (resultado: ResultadoDaCobranca) => (atual: PainelDaNfAberta) => PainelDaNfAberta;

/** A NF com o saldo que o servidor devolveu, que o onSnapshot ainda pode não ter trazido. */
function comSaldoDaResposta(fatura: FaturaDoFinanceiro, resultado: ResultadoDaCobranca): FaturaDoFinanceiro {
  const saldo = resultado.saldo_cents;
  return typeof saldo === "number" && Number.isSafeInteger(saldo) && saldo >= 0 ? { ...fatura, saldoCents: saldo } : fatura;
}

function painelNovo(fatura: FaturaDoFinanceiro | null, hoje: string): PainelDaNfAberta {
  return {
    pagamento: fatura ? formDoPagamento(fatura, hoje) : { valor: "", recebidoEm: hoje, forma: "boleto", observacao: "" },
    envio: formDoEnvio(hoje),
    confirmando: null,
    erro: null,
  };
}

function FaturasPage({ filtro }: { filtro: FiltroDeFaturas }) {
  const { toast } = useToast();
  const { user } = useAppUser();
  const [, navegar] = useLocation();
  const hoje = hojeIso(new Date());
  const rota = ROTA_DO_FILTRO[filtro];
  const leitura = useFaturas(user?.publicMetadata.role);
  const faturas = leitura.faturas ?? [];
  const pedida = nfDaBusca(useSearch());
  const aberta = (pedida && faturas.find((fatura) => fatura.id === pedida)) || null;
  const pagamentos = usePagamentosDaNf(aberta?.id ?? null);
  // Na NF que saiu pela Omie, a baixa de cada pagamento (parte 7.4i).
  const baixasDaNf = useBaixasDaNf(user?.publicMetadata.role, aberta?.id ?? null, aberta?.pelaOmie ?? false);
  const queryClient = useQueryClient();
  const [busca, setBusca] = useState("");
  const [painel, setPainel] = useState<PainelDaNfAberta>(() => painelNovo(null, hoje));
  const [chave, setChave] = useState(novaChave);
  const [resultado, setResultado] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  // A receita por cliente (parte 4.2c), só em Pagos: o mês de hoje até a pessoa trocar.
  const [mes, setMes] = useState(() => hoje.slice(0, 7));
  const doMes = usePagamentosDoMes(user?.publicMetadata.role, mes, filtro === "pagos");

  // Outra NF aberta: o painel recomeça. A mudança da mesma NF (o envio, o
  // pagamento de outra pessoa) não apaga o que a pessoa digitou: o servidor
  // confere o saldo e o status de novo. Depois de cada gravação desta tela,
  // recomeça só a parte da ação (Recomeco), com o saldo da resposta.
  useEffect(() => {
    setPainel(painelNovo(aberta, hoje));
    setChave(novaChave());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aberta?.id]);

  const estado = leitura.falhas.length ? "erro" : leitura.faturas ? "pronto" : "carregando";

  async function gravar(pedido: Record<string, unknown>, confirmacao: string, recomeco: Recomeco) {
    setOcupado(true);
    setPainel((atual) => ({ ...atual, erro: null }));
    try {
      const resultado = await chamarFinanceiro<ResultadoDaCobranca>("advanceFatura", pedido);
      setResultado(confirmacao);
      toast({ title: confirmacao });
      setChave(novaChave());
      setPainel(recomeco(resultado));
    } catch (falha) {
      setPainel((atual) => ({ ...atual, erro: falha instanceof Error ? falha.message : "Não foi possível gravar." }));
    } finally {
      // O pagamento e o estorno mexem na baixa da NF que saiu pela Omie: ela é lida de novo.
      await queryClient.invalidateQueries({ queryKey: CHAVE_DAS_BAIXAS });
      setOcupado(false);
    }
  }

  function comProblemas(problemas: string[]): boolean {
    if (!problemas.length) return false;
    setPainel((atual) => ({ ...atual, erro: problemas.join(" ") }));
    return true;
  }

  return (
    <FaturasView
      filtro={filtro}
      estado={estado}
      faturas={faturas}
      busca={busca}
      hoje={hoje}
      aberta={aberta}
      pagamentos={pagamentos.pagamentos && aberta ? pagamentosDaNf(pagamentos.pagamentos, aberta.id) : null}
      baixas={baixasDaNf.baixas ? baixasPorPagamento(baixasDaNf.baixas) : null}
      painel={painel}
      resultado={resultado}
      ocupado={ocupado}
      receita={
        filtro === "pagos"
          ? { mes, dados: doMes.pagamentos && leitura.faturas ? receitaPorCliente(doMes.pagamentos, nomesDosClientes(faturas)) : null, erro: doMes.erro }
          : null
      }
      acoes={{
        buscar: setBusca,
        abrir: (id) => {
          setResultado(null);
          navegar(hrefDaNf(rota, id));
        },
        fechar: () => navegar(rota),
        editarPagamento: (campo, valor) => setPainel((atual) => ({ ...atual, erro: null, pagamento: { ...atual.pagamento, [campo]: valor } })),
        registrarPagamento: () => {
          if (!aberta || comProblemas(problemasDoPagamento(painel.pagamento, aberta, hoje))) return;
          // O próximo pagamento já vem com o saldo que sobrou.
          void gravar(pedidoDoPagamento(painel.pagamento, aberta, chave), `Pagamento registrado na ${rotuloDaNf(aberta)}`, (resultado) => (atual) => ({
            ...atual,
            pagamento: formDoPagamento(comSaldoDaResposta(aberta, resultado), hoje),
            confirmando: null,
          }));
        },
        editarEnvio: (campo, valor) => setPainel((atual) => ({ ...atual, erro: null, envio: { ...atual.envio, [campo]: valor } })),
        marcarEnviada: () => {
          if (!aberta || comProblemas(problemasDoEnvio(painel.envio, aberta, hoje))) return;
          // O envio não mexe no pagamento que a pessoa está digitando.
          void gravar(pedidoDoEnvio(painel.envio, aberta, chave), `${rotuloDaNf(aberta)} enviada ao cliente`, () => (atual) => ({ ...atual, envio: formDoEnvio(hoje), confirmando: null }));
        },
        pedirEstorno: (pagamentoId) => {
          setChave(novaChave());
          setPainel((atual) => ({ ...atual, erro: null, confirmando: { tipo: "estorno", pagamentoId, motivo: "" } }));
        },
        editarMotivo: (motivo) => setPainel((atual) => (atual.confirmando ? { ...atual, erro: null, confirmando: { ...atual.confirmando, motivo } } : atual)),
        confirmarEstorno: () => {
          const pedido = painel.confirmando;
          if (!aberta || pedido?.tipo !== "estorno" || comProblemas(problemasDoMotivo(pedido.motivo))) return;
          void gravar(pedidoDoEstorno(aberta, pedido.pagamentoId, pedido.motivo, chave), `Pagamento estornado na ${rotuloDaNf(aberta)}`, (resultado) => (atual) => ({
            ...atual,
            pagamento: formDoPagamento(comSaldoDaResposta(aberta, resultado), hoje),
            confirmando: null,
          }));
        },
        pedirCancelamento: () => {
          setChave(novaChave());
          setPainel((atual) => ({ ...atual, erro: null, confirmando: { tipo: "cancelamento", motivo: "" } }));
        },
        confirmarCancelamento: () => {
          const pedido = painel.confirmando;
          if (!aberta || pedido?.tipo !== "cancelamento" || comProblemas(problemasDoMotivo(pedido.motivo))) return;
          void gravar(pedidoDoCancelamento(aberta, pedido.motivo, chave), `Registro da ${rotuloDaNf(aberta)} cancelado: as demandas voltaram a A faturar`, (resultado) => () =>
            painelNovo(comSaldoDaResposta(aberta, resultado), hoje),
          );
        },
        desistir: () => setPainel((atual) => ({ ...atual, erro: null, confirmando: null })),
        exportar: () => {
          const lista = faturasDoFiltro(faturas, filtro, hoje, busca);
          baixarPlanilha(nomeDaPlanilha(filtro, hoje), planilhaXlsx(TITULO_DO_FILTRO[filtro], [...CABECALHO_DA_PLANILHA], linhasDaPlanilha(lista, hoje)));
        },
        mudarMes: (novo) => {
          if (/^\d{4}-\d{2}$/.test(novo)) setMes(novo);
        },
      }}
    />
  );
}

export function FinanceiroAReceber() {
  return <FaturasPage filtro="a_receber" />;
}

export function FinanceiroVencidos() {
  return <FaturasPage filtro="vencidos" />;
}

export function FinanceiroPagos() {
  return <FaturasPage filtro="pagos" />;
}

export function FinanceiroFaturas() {
  return <FaturasPage filtro="todas" />;
}
