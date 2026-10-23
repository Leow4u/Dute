import { useEffect, useRef, useState } from "react";
import { collection, doc, query, where } from "firebase/firestore";
import { useLocation, useSearch } from "wouter";

import { chamarOperacao, mensagemDoErro, novaChave } from "@/lib/operacao/api";
import { colaboradorDaLeitura, veiculoDaLeitura } from "@/lib/operacao/cadastro";
import { demandaDaOperacao, escopoComSaldo, osDaDemanda } from "@/lib/operacao/demandas";
import { clienteDaLeitura, hojeIso, nomesPorCodigo, osDaLeitura } from "@/lib/operacao/fila";
import { milesimos } from "@/lib/operacao/hoje";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { demandaDoPlanoDaBusca, hrefDaDemanda } from "@/lib/operacao/navegacao";
import {
  alertasDoPlano,
  dividir,
  igualarAoSaldo,
  pedidoDoPlano,
  planoInicial,
  problemasDoPlano,
  removerOs,
  restantes,
  type FormularioDoPlano,
} from "@/lib/operacao/planejar";

import type { LocalDaFicha } from "./demanda-view";
import { PlanejarView, type EstadoDoPlano } from "./planejar-view";

/** Operação › Planejar OS (parte 3.6a): a demanda pedida em ?demanda=, o plano e saveServiceOrder (plan). */

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
  const numero = demandaDoPlanoDaBusca(useSearch());
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

  const hoje = hojeIso();
  const ficha = demanda.item ?? null;
  const daDemanda = ficha ? osDaDemanda(ficha.numero, ordens.itens ?? []) : [];
  const saldo = ficha ? escopoComSaldo(ficha, daDemanda).filter((linha) => milesimos(linha.saldo) > 0) : [];
  const carregou = Boolean(ficha && ordens.itens);

  // O plano nasce uma vez, quando a demanda e as OS chegam: todo o saldo numa OS, hoje.
  useEffect(() => {
    if (!form && carregou && saldo.length) setForm(planoInicial(saldo, hoje));
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
          : !saldo.length
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

  function mudar(novo: FormularioDoPlano) {
    setForm(novo);
    chave.current = null;
  }

  const problemasAgendando = form ? problemasDoPlano(form, saldo, hoje, true) : [];
  const [agendando, setAgendando] = useState(true);
  const problemas = form && tentou ? problemasDoPlano(form, saldo, hoje, agendando) : [];

  async function gravar(agendar: boolean) {
    if (!form || !ficha) return;
    setTentou(true);
    setAgendando(agendar);
    setErro(null);
    if (problemasDoPlano(form, saldo, hoje, agendar).length) return;
    setOcupado(true);
    chave.current ??= novaChave();
    try {
      await chamarOperacao("saveServiceOrder", pedidoDoPlano(form, ficha.numero, saldo, chave.current, agendar));
      chave.current = null;
      navegar(hrefDaDemanda(ficha.numero));
    } catch (error) {
      setErro(mensagemDoErro(error));
    } finally {
      setOcupado(false);
    }
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
      alertas={form ? alertasDoPlano(form, pessoas.itens ?? [], veiculos.itens ?? [], (ordens.itens ?? []).filter((os) => os.demanda !== ficha?.numero)) : []}
      problemas={tentou ? problemas : problemasAgendando.filter((problema) => problema.includes("as OS somam"))}
      ocupado={ocupado}
      erro={erro}
      onGravar={(agendar) => void gravar(agendar)}
    />
  );
}
