import { useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { collection, doc, getDoc, limit, orderBy, query, where } from "firebase/firestore";

import { useToast } from "@/hooks/use-toast";
import { chamarComercial, novaChave } from "@/lib/comercial/api";
import {
  ETAPAS_COM_PRAZO_DE_PERDA,
  alternarMarcacao,
  SITUACOES_A_LER,
  autorizacaoDoRegistro,
  autorizadasAFaturar,
  chaveDaRv,
  demandaDoRegistro,
  formNovaAutorizacao,
  linhasDaFila,
  linhasMarcadas,
  payloadCancelar,
  payloadPerderPorPrazo,
  payloadRegistrar,
  prazosVencidos,
  somaDasLinhas,
  textoDoRegistro,
  type FiltroDeIdade,
  type FormAutorizacao,
  type LinhaAutorizada,
  type LinhaDoPrazoVencido,
} from "@/lib/comercial/autorizacoes";
import { cadastroDoDocumento, hojeLocal, type Carga } from "@/lib/comercial/clientes";
import { contratoDoRegistro, nomesDosClientes } from "@/lib/comercial/contratos";
import { useLeitura } from "@/lib/comercial/leitura";
import { firestore } from "@/lib/firebase";

import { CancelarAutorizacaoDialog, PerderPorPrazoDialog } from "./autorizacoes-dialogos";
import { AutorizacoesView } from "./autorizacoes-view";

/**
 * Comercial › Autorizações (docs/mockups/ComAutorizacoes.dc.html; parte 15b
 * de docs/plataforma/fase-6-comercial.md). Lê pelo Firestore, como as regras
 * permitem a owner, admin e comercial: as demandas aguardando autorização ou
 * a faturar (`demands`), o total da RV validada de cada uma
 * (`quotes/{numero}/revisoes/{rv}`, congelada no envio), as autorizações
 * registradas (`client_authorizations`), os contratos e o cadastro. Grava só
 * pela callable recordAuthorization (registrar e cancelar), com chave de
 * idempotência; o servidor confere a etapa de cada demanda e recalcula todo
 * valor.
 */

/** As mais recentes a faturar; o resto fica para a busca da Fase 7. */
const LIMITE_DE_AUTORIZADAS = 200;

type ResultadoDoRegistro = { valor_cents?: unknown; demandas?: unknown };

/** O total de cada RV validada, lido uma vez (a RV enviada não muda). */
function useTotaisDasRvs(chaves: ReadonlyArray<{ numero: string; rv: number }>): ReadonlyMap<string, number> {
  const resultados = useQueries({
    queries: chaves.map(({ numero, rv }) => ({
      queryKey: ["comercial", "rv-total", numero, rv],
      queryFn: async (): Promise<number | null> => {
        if (!firestore) throw new Error("Firebase não configurado.");
        const total: unknown = (await getDoc(doc(firestore, "quotes", numero, "revisoes", String(rv)))).get("total_cents");
        return typeof total === "number" && Number.isSafeInteger(total) && total >= 0 ? total : null;
      },
      staleTime: Infinity,
      retry: 1,
      refetchOnWindowFocus: false,
    })),
  });
  const valores = new Map<string, number>();
  chaves.forEach(({ numero, rv }, indice) => {
    const total = resultados[indice]?.data;
    if (typeof total === "number") valores.set(chaveDaRv(numero, rv), total);
  });
  return valores;
}

/** `somenteLeitura`: a mesma tela no shell do Financeiro (Fase 7, parte 7.5c), sem gravar nada. */
export default function ComercialAutorizacoesPage({ somenteLeitura = false }: { somenteLeitura?: boolean } = {}) {
  const { toast } = useToast();
  const hoje = hojeLocal();
  const [filtro, setFiltro] = useState<FiltroDeIdade>("todas");
  const [busca, setBusca] = useState("");
  const [aberto, setAberto] = useState(true);
  const [marcadas, setMarcadas] = useState<string[]>([]);
  const [form, setForm] = useState<FormAutorizacao>(() => formNovaAutorizacao(hoje));
  // Uma chave por intenção de registrar: a mesma no clique repetido, nova depois do registro.
  const [chave, setChave] = useState(novaChave);
  const [resultado, setResultado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [cancelando, setCancelando] = useState<{ autorizacao: LinhaAutorizada; chave: string } | null>(null);
  const [erroDoCancelamento, setErroDoCancelamento] = useState<string | null>(null);
  // A perda por prazo de faturamento (parte 7.5b): a linha e a chave da intenção.
  const [perdendo, setPerdendo] = useState<{ linha: LinhaDoPrazoVencido; chave: string } | null>(null);
  const [erroDaPerda, setErroDaPerda] = useState<string | null>(null);

  const demandas = useLeitura(
    "demands:autorizacao",
    (db) => query(collection(db, "demands"), where("etapa", "in", [...ETAPAS_COM_PRAZO_DE_PERDA])),
    demandaDoRegistro,
  );
  const autorizacoes = useLeitura(
    "client_authorizations:registradas",
    (db) =>
      query(
        collection(db, "client_authorizations"),
        where("status", "in", [...SITUACOES_A_LER]),
        orderBy("registrada_em", "desc"),
        limit(LIMITE_DE_AUTORIZADAS),
      ),
    autorizacaoDoRegistro,
  );
  const contratos = useLeitura("contracts", (db) => collection(db, "contracts"), contratoDoRegistro);
  const cadastros = useLeitura("customers", (db) => collection(db, "customers"), cadastroDoDocumento);

  const nomes = useMemo(() => nomesDosClientes(cadastros.itens ?? []), [cadastros.itens]);
  const chavesDasRvs = useMemo(
    () =>
      (demandas.itens ?? [])
        .filter((demanda) => demanda.etapa === "aguardando_autorizacao" && demanda.validacao)
        .map((demanda) => ({ numero: demanda.numero, rv: demanda.validacao!.rv })),
    [demandas.itens],
  );
  const valores = useTotaisDasRvs(chavesDasRvs);
  const linhas = linhasDaFila(demandas.itens ?? [], { nomes, valores, hoje });
  const autorizadas: Carga<LinhaAutorizada> = autorizacoes.erro
    ? "erro"
    : autorizacoes.itens === null
      ? "carregando"
      : autorizadasAFaturar(autorizacoes.itens, {
          nomes,
          demandas: demandas.itens ?? [],
          contratos: contratos.itens ?? [],
          hoje,
          busca,
        });
  const estado = demandas.erro ? "erro" : demandas.itens === null ? "carregando" : "pronto";
  const vencidos = contratos.itens ? prazosVencidos(demandas.itens ?? [], contratos.itens, nomes, hoje) : [];

  /** Recomeça o painel: nada marcado, formulário vazio e chave nova. */
  function limparPainel() {
    setMarcadas([]);
    setForm(formNovaAutorizacao(hoje));
    setChave(novaChave());
    setErro(null);
  }

  async function registrar() {
    const selecionadas = linhasMarcadas(linhas, marcadas);
    const entrada = payloadRegistrar(form, selecionadas, chave, hoje);
    if (!entrada.ok) {
      setErro(entrada.problema);
      return;
    }
    setOcupado(true);
    setErro(null);
    setResultado(null);
    try {
      const resposta = await chamarComercial<ResultadoDoRegistro>("recordAuthorization", entrada.valor);
      const valorCents =
        typeof resposta.valor_cents === "number" && Number.isSafeInteger(resposta.valor_cents)
          ? resposta.valor_cents
          : (somaDasLinhas(selecionadas) ?? 0);
      const texto = textoDoRegistro({
        pedido: typeof entrada.valor.pedido === "string" ? entrada.valor.pedido : null,
        demandas: Array.isArray(resposta.demandas) ? resposta.demandas.length : selecionadas.length,
        valorCents,
      });
      limparPainel();
      setResultado(texto);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível registrar a autorização.");
    } finally {
      setOcupado(false);
    }
  }

  async function cancelar(motivo: string) {
    if (!cancelando) return;
    const entrada = payloadCancelar(cancelando.autorizacao.id, motivo, cancelando.chave);
    if (!entrada.ok) {
      setErroDoCancelamento(entrada.problema);
      return;
    }
    setOcupado(true);
    setErroDoCancelamento(null);
    try {
      await chamarComercial("recordAuthorization", entrada.valor);
      setCancelando(null);
      toast({ title: "Autorização cancelada" });
    } catch (error) {
      setErroDoCancelamento(error instanceof Error ? error.message : "Não foi possível cancelar a autorização.");
    } finally {
      setOcupado(false);
    }
  }

  async function perderPorPrazo(nota: string) {
    if (!perdendo) return;
    setOcupado(true);
    setErroDaPerda(null);
    try {
      await chamarComercial("advanceDemand", payloadPerderPorPrazo(perdendo.linha, nota, perdendo.chave));
      toast({ title: `${perdendo.linha.rotulo} perdida por prazo de faturamento` });
      setPerdendo(null);
    } catch (error) {
      setErroDaPerda(error instanceof Error ? error.message : "Não foi possível registrar a perda.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <>
      <AutorizacoesView
        somenteLeitura={somenteLeitura}
        estado={estado}
        linhas={linhas}
        filtro={filtro}
        busca={busca}
        painel={{ aberto, marcadas, form, resultado, erro }}
        contratos={contratos.itens ?? []}
        autorizadas={autorizadas}
        vencidos={vencidos}
        hoje={hoje}
        ocupado={ocupado}
        acoes={{
          filtrar: setFiltro,
          buscar: setBusca,
          abrirPainel: () => {
            limparPainel();
            setResultado(null);
            setAberto(true);
          },
          fecharPainel: () => {
            limparPainel();
            setResultado(null);
            setAberto(false);
          },
          marcar: (numero) => {
            const linha = linhas.find((item) => item.numero === numero);
            if (!linha) return;
            setMarcadas((atuais) => alternarMarcacao(atuais, linha, linhas));
            setResultado(null);
            setErro(null);
          },
          editar: (campo, valor) => {
            setForm((atual) => ({ ...atual, [campo]: valor }));
            setResultado(null);
            setErro(null);
          },
          registrar: () => void registrar(),
          cancelarAutorizacao: (id) => {
            const autorizacao = Array.isArray(autorizadas) ? autorizadas.find((item) => item.id === id) : undefined;
            if (!autorizacao) return;
            setErroDoCancelamento(null);
            setCancelando({ autorizacao, chave: novaChave() });
          },
          perderPorPrazo: (numero) => {
            const linha = vencidos.find((item) => item.numero === numero);
            if (!linha) return;
            setErroDaPerda(null);
            setPerdendo({ linha, chave: novaChave() });
          },
        }}
      />
      <PerderPorPrazoDialog
        linha={perdendo?.linha ?? null}
        ocupado={ocupado}
        erro={erroDaPerda}
        onVoltar={() => {
          if (!ocupado) setPerdendo(null);
        }}
        onConfirmar={(nota) => void perderPorPrazo(nota)}
      />
      <CancelarAutorizacaoDialog
        autorizacao={cancelando?.autorizacao ?? null}
        ocupado={ocupado}
        erro={erroDoCancelamento}
        onVoltar={() => {
          if (!ocupado) setCancelando(null);
        }}
        onConfirmar={(motivo) => void cancelar(motivo)}
      />
    </>
  );
}
