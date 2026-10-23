import { useEffect, useMemo, useRef, useState } from "react";
import { collection, doc, query, where } from "firebase/firestore";
import { useLocation, useSearch } from "wouter";

import { chamarOperacao, mensagemDoErro, novaChave } from "@/lib/operacao/api";
import { escopoComSaldo } from "@/lib/operacao/demandas";
import { fichaDaLeitura, servicosEmTexto } from "@/lib/operacao/ficha-da-os";
import { clienteDaLeitura, hojeIso, nomesPorCodigo, osDaLeitura } from "@/lib/operacao/fila";
import { demandaDoHoje } from "@/lib/operacao/hoje";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { ROTA_REVISAO, osDaBusca } from "@/lib/operacao/navegacao";
import { linhasParaRevisar, paraRevisar, pedidoDaRevisao, problemasDaRevisao, revisaoInicial, type FormularioDaRevisao } from "@/lib/operacao/revisao";
import { useUrlsDasFotos } from "@/lib/operacao/use-urls-das-fotos";

import { RevisaoView, type EstadoDaRevisao } from "./revisao-view";

/**
 * Operação › Revisão (parte 3.10b): as OS em revisão, a da vez (?os=, ou a
 * que espera há mais tempo), a demanda dela e as outras OS da demanda (para
 * o orçado e o saldo, com a conta da callable). Concluir chama
 * reviewServiceOrder com a chave da tentativa e passa à próxima.
 */
export default function PaginaRevisao() {
  const [, navegar] = useLocation();
  const pedida = osDaBusca(useSearch());
  const emRevisao = useLeitura("service_orders:em_revisao", (db) => query(collection(db, "service_orders"), where("status", "==", "em_revisao")), fichaDaLeitura);
  const clientes = useLeitura("customers", (db) => collection(db, "customers"), clienteDaLeitura);
  const nomes = useMemo(() => nomesPorCodigo(clientes.itens ?? []), [clientes.itens]);
  const cartoes = useMemo(() => paraRevisar(emRevisao.itens ?? [], nomes, servicosEmTexto), [emRevisao.itens, nomes]);
  const numero = pedida && cartoes.some((cartao) => cartao.numero === pedida) ? pedida : (cartoes[0]?.numero ?? null);
  const ficha = (emRevisao.itens ?? []).find((item) => item.numero === numero) ?? null;

  const demanda = useDocumento(ficha ? `demands/${ficha.demanda}` : null, (db) => doc(db, "demands", ficha?.demanda ?? "-"), demandaDoHoje);
  const ordens = useLeitura(
    ficha ? `service_orders:demanda:${ficha.demanda}` : null,
    (db) => query(collection(db, "service_orders"), where("demanda", "==", ficha?.demanda ?? "-")),
    osDaLeitura,
  );
  const direta = demanda.item?.entrada === "direta";
  const linhas = useMemo(
    () => (ficha ? linhasParaRevisar(ficha, demanda.item && ordens.itens ? escopoComSaldo(demanda.item, ordens.itens) : null, direta) : []),
    [ficha, demanda.item, ordens.itens, direta],
  );
  const urls = useUrlsDasFotos([...(ficha?.fotos ?? []).map((foto) => foto.caminho), ...(ficha?.conclusao?.assinatura ? [ficha.conclusao.assinatura] : [])]);

  // Um formulário e uma chave por OS da vez.
  const [form, setForm] = useState<{ numero: string; valor: FormularioDaRevisao } | null>(null);
  const [tentou, setTentou] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const chave = useRef<{ numero: string | null; valor: string }>({ numero: null, valor: "" });
  useEffect(() => {
    if (!ficha || form?.numero === ficha.numero) return;
    setForm({ numero: ficha.numero, valor: revisaoInicial(linhas) });
    setTentou(false);
    setErro(null);
    chave.current = { numero: ficha.numero, valor: novaChave() };
  }, [ficha, form?.numero, linhas]);
  const formulario = form && ficha && form.numero === ficha.numero ? form.valor : null;

  async function concluir() {
    if (!ficha || !formulario) return;
    setTentou(true);
    if (problemasDaRevisao(formulario, linhas, direta).length) return;
    setOcupado(true);
    setErro(null);
    try {
      const pedido = pedidoDaRevisao(formulario, linhas, ficha.numero, chave.current.valor);
      await chamarOperacao(pedido.callable, pedido.dados);
      navegar(ROTA_REVISAO);
    } catch (error) {
      setErro(mensagemDoErro(error));
    } finally {
      setOcupado(false);
    }
  }

  const estado: EstadoDaRevisao = emRevisao.erro ? "erro" : emRevisao.itens ? "pronto" : "carregando";
  return (
    <RevisaoView
      estado={estado}
      cartoes={cartoes}
      selecionada={numero}
      os={ficha ? { ficha, cliente: nomes[ficha.customerCode] || ficha.clienteNome || ficha.customerCode, linhas, direta, urls, hoje: hojeIso() } : null}
      form={formulario}
      onForm={(valor) => ficha && setForm({ numero: ficha.numero, valor })}
      problemas={tentou && formulario ? problemasDaRevisao(formulario, linhas, direta) : []}
      erro={erro}
      ocupado={ocupado}
      onConcluir={() => void concluir()}
    />
  );
}
