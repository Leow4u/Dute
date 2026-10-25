import { useEffect, useRef, useState } from "react";
import { collection, doc, query, where } from "firebase/firestore";
import { useLocation, useSearch } from "wouter";

import { MEMORIA_LIBERADA } from "@/lib/liberacao";
import { chamarNucleo } from "@/lib/memoria/api";
import { janelaComSugestao, pedidoDaSugestao, respostaDaSugestao, type DecisaoNaTela } from "@/lib/memoria/sugestao";
import { useSugestoes } from "@/lib/memoria/use-sugestoes";
import { chamarOperacao, mensagemDoErro, novaChave } from "@/lib/operacao/api";
import { colaboradorDaLeitura, veiculoDaLeitura } from "@/lib/operacao/cadastro";
import { demandaDaOperacao, escopoComSaldo, osDaDemanda } from "@/lib/operacao/demandas";
import { clienteDaLeitura, hojeIso, nomesPorCodigo, osDaLeitura } from "@/lib/operacao/fila";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { demandaDoPlanoDaBusca, hrefDaDemanda, vistoriaNoPlanoDaBusca } from "@/lib/operacao/navegacao";
import {
  alertasDoPlano,
  dividir,
  igualarAoSaldo,
  linhasDoPlano,
  pedidoDaVistoria,
  pedidoDoPlano,
  planoInicial,
  problemasDaVistoriaNoPlano,
  problemasDoPlano,
  revisoesNoPlano,
  removerOs,
  restantes,
  vistoriaInicial,
  type FormularioDoPlano,
} from "@/lib/operacao/planejar";
import { problemaParaAbrirVistoria } from "@/lib/operacao/vistoria";

import type { LocalDaFicha } from "./demanda-view";
import { PlanejarView, type EstadoDoPlano } from "./planejar-view";

/**
 * Operação › Planejar OS (parte 3.6a): a demanda pedida em ?demanda=, o plano
 * e saveServiceOrder (plan). Com &vistoria=1 (parte 3.11c), a vistoria da
 * demanda: uma OS sem itens, no dia da visita técnica, e saveServiceOrder
 * (survey). Com a memória liberada (parte 5.2b), cada OS recebe a duração
 * sugerida (suggestDuration); salvo o plano, o que a pessoa fez com cada uma
 * vai ao answerSuggestion, sem segurar a volta à demanda se falhar.
 */

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function enderecoEmLinha(endereco: unknown): string | null {
  if (!endereco || typeof endereco !== "object") return null;
  const e = endereco as Record<string, unknown>;
  const partes = [[texto(e.logradouro), texto(e.numero)].filter(Boolean).join(", "), texto(e.bairro), [texto(e.cidade), texto(e.uf)].filter(Boolean).join("/")].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

export default function PaginaPlanejar() {
  const [, navegar] = useLocation();
  const busca = useSearch();
  const numero = demandaDoPlanoDaBusca(busca);
  const vistoria = vistoriaNoPlanoDaBusca(busca);
  const demanda = useDocumento(numero ? `demands/${numero}` : null, (db) => doc(db, "demands", numero ?? "-"), demandaDaOperacao);
  const ordens = useLeitura("service_orders", (db) => collection(db, "service_orders"), osDaLeitura);
  const pessoas = useLeitura("collaborators", (db) => collection(db, "collaborators"), colaboradorDaLeitura);
  const veiculos = useLeitura("vehicles", (db) => collection(db, "vehicles"), veiculoDaLeitura);
  const clientes = useLeitura("customers", (db) => collection(db, "customers"), clienteDaLeitura);
  const codigo = demanda.item?.customerCode ?? null;
  const locais = useLeitura(
    codigo ? `customer_locations:${codigo}` : null,
    (db) => query(collection(db, "customer_locations"), where("customer_code", "==", codigo ?? "-")),
    (id, data) => ({ id, nome: texto(data.nome) || null, endereco: enderecoEmLinha(data.endereco) }),
  );
  const [form, setForm] = useState<FormularioDoPlano | null>(null);
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const chave = useRef<string | null>(null);
  const [decisoes, setDecisoes] = useState<Record<number, DecisaoNaTela>>({});

  const hoje = hojeIso();
  const ficha = demanda.item ?? null;
  const daDemanda = ficha ? osDaDemanda(ficha.numero, ordens.itens ?? []) : [];
  const saldo = ficha && !vistoria ? linhasDoPlano(escopoComSaldo(ficha, daDemanda), form) : [];
  const carregou = Boolean(ficha && ordens.itens);
  const motivo = ficha && vistoria ? problemaParaAbrirVistoria(ficha, osDaDemanda(ficha.numero, ordens.itens ?? [], true)) : null;

  // O plano nasce uma vez, quando a demanda e as OS chegam: todo o saldo numa OS, hoje; a vistoria, no dia da visita técnica.
  useEffect(() => {
    if (form || !carregou || !ficha) return;
    if (vistoria) setForm(vistoriaInicial(ficha.visitaTecnica && ficha.visitaTecnica >= hoje ? ficha.visitaTecnica : hoje));
    else if (saldo.length) setForm(planoInicial(saldo, hoje));
    // Só a chegada das leituras dispara.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [carregou]);

  const estado: EstadoDoPlano = !numero
    ? "nao_encontrada"
    : demanda.erro || ordens.erro || pessoas.erro || veiculos.erro
      ? "erro"
      : demanda.item === undefined || !ordens.itens || !pessoas.itens || !veiculos.itens
        ? "carregando"
        : demanda.item === null
          ? "nao_encontrada"
          : vistoria && motivo
            ? "indisponivel"
            : !vistoria && !saldo.length
              ? "sem_saldo"
              : form
                ? "pronto"
                : "carregando";

  const porLocal = new Map((locais.itens ?? []).map((local) => [local.id, local]));
  const locaisDaFicha: LocalDaFicha[] = ficha
    ? (
        [
          ["Origem", ficha.origem],
          ["Destino", ficha.destino],
        ] as const
      ).flatMap(([rotulo, local]) => {
        if (!local) return [];
        const cadastro = local.localId ? porLocal.get(local.localId) : undefined;
        return [{ rotulo, nome: cadastro?.nome ?? null, endereco: cadastro?.endereco ?? null, complemento: local.complemento }];
      })
    : [];

  const pedidosDeSugestao = form && ficha && !vistoria ? form.ordens.map((_, indice) => pedidoDaSugestao(form, indice, saldo, ficha.numero)) : [];
  const sugestoes = useSugestoes(pedidosDeSugestao, MEMORIA_LIBERADA && !vistoria);

  function mudar(novo: FormularioDoPlano) {
    setForm(novo);
    chave.current = null;
  }

  // Agendando, o veículo no dia da revisão preventiva também impede (parte 3.13b); no rascunho não há data.
  const problemasDe = (agendar: boolean) => {
    if (!form) return [];
    const doPlano = vistoria ? problemasDaVistoriaNoPlano(form, hoje, agendar) : problemasDoPlano(form, saldo, hoje, agendar);
    return agendar ? [...doPlano, ...revisoesNoPlano(form, veiculos.itens ?? [], vistoria ? "A vistoria" : undefined)] : doPlano;
  };
  const problemasAgendando = problemasDe(true);
  const [agendando, setAgendando] = useState(true);
  const problemas = tentou ? problemasDe(agendando) : [];

  async function gravar(agendar: boolean) {
    if (!form || !ficha) return;
    setTentou(true);
    setAgendando(agendar);
    setErro(null);
    if (problemasDe(agendar).length) return;
    setOcupado(true);
    chave.current ??= novaChave();
    try {
      const gravado = await chamarOperacao<{ numeros?: string[] }>(
        "saveServiceOrder",
        vistoria ? pedidoDaVistoria(form, ficha.numero, chave.current, agendar) : pedidoDoPlano(form, ficha.numero, saldo, chave.current, agendar),
      );
      chave.current = null;
      await responderSugestoes(gravado.numeros ?? []);
      navegar(hrefDaDemanda(ficha.numero));
    } catch (error) {
      setErro(mensagemDoErro(error));
    } finally {
      setOcupado(false);
    }
  }

  /** O que a pessoa fez com a sugestão de cada OS salva. É a memória que aprende: falhar não segura a volta à demanda. */
  async function responderSugestoes(numeros: readonly string[]) {
    if (!MEMORIA_LIBERADA || !form) return;
    const respostas = pedidosDeSugestao.flatMap((pedido, indice) => {
      const sugestao = sugestoes[indice];
      const numeroDaOs = numeros[indice];
      if (!pedido || !numeroDaOs || sugestao?.estado !== "pronto" || sugestao.sugestao?.minutos_total == null) return [];
      return [chamarNucleo("answerSuggestion", respostaDaSugestao(pedido, numeroDaOs, form.ordens[indice], decisoes[indice], novaChave()))];
    });
    await Promise.allSettled(respostas);
  }

  function usarSugestao(indice: number) {
    const sugestao = sugestoes[indice];
    const os = form?.ordens[indice];
    const minutos = sugestao?.sugestao?.minutos_total;
    if (!form || !os || !sugestao || minutos == null) return;
    const janela = janelaComSugestao(os, minutos);
    if (!janela) return;
    mudar({ ...form, ordens: form.ordens.map((atual, posicao) => (posicao === indice ? janela : atual)) });
    setDecisoes((atuais) => ({ ...atuais, [indice]: { chave: sugestao.chave, usou: janela.fim, ignorou: false } }));
  }

  function ignorarSugestao(indice: number) {
    const sugestao = sugestoes[indice];
    if (!sugestao) return;
    setDecisoes((atuais) => ({ ...atuais, [indice]: { chave: sugestao.chave, usou: null, ignorou: true } }));
  }

  return (
    <PlanejarView
      estado={estado}
      numero={numero}
      demanda={ficha}
      cliente={ficha ? nomesPorCodigo(clientes.itens ?? [])[ficha.customerCode] || ficha.customerCode : ""}
      saldo={saldo}
      restante={form ? restantes(saldo, form) : new Map()}
      locais={locaisDaFicha}
      form={form}
      onForm={mudar}
      onQuantidade={(indice, linha, valor) => {
        if (!form) return;
        mudar({ ...form, ordens: form.ordens.map((os, posicao) => (posicao === indice ? { ...os, itens: { ...os.itens, [linha]: valor } } : os)) });
      }}
      onIgualar={(indice) => form && mudar(igualarAoSaldo(form, indice, saldo))}
      onDividir={() => form && mudar(dividir(form))}
      onRemoverOs={(indice) => form && mudar(removerOs(form, indice))}
      pessoas={pessoas.itens ?? []}
      veiculos={veiculos.itens ?? []}
      alertas={form ? alertasDoPlano(form, pessoas.itens ?? [], veiculos.itens ?? [], (ordens.itens ?? []).filter((os) => os.demanda !== ficha?.numero), vistoria ? "A vistoria" : undefined) : []}
      problemas={tentou ? problemas : problemasAgendando.filter((problema) => problema.includes("as OS somam"))}
      ocupado={ocupado}
      erro={erro}
      onGravar={(agendar) => void gravar(agendar)}
      vistoria={vistoria}
      motivo={motivo}
      sugestoes={sugestoes}
      ignoradas={sugestoes.map((sugestao, indice) => Boolean(sugestao && decisoes[indice]?.chave === sugestao.chave && decisoes[indice]?.ignorou))}
      onUsarSugestao={usarSugestao}
      onIgnorarSugestao={ignorarSugestao}
    />
  );
}
