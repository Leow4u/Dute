import { useRef, useState } from "react";
import { collection, doc, query, where } from "firebase/firestore";
import { useSearch } from "wouter";

import { chamarOperacao, mensagemDoErro, novaChave } from "@/lib/operacao/api";
import { escopoComSaldo, etapaNaOperacao, demandaDaOperacao, osDaDemanda } from "@/lib/operacao/demandas";
import { clienteDaLeitura, nomesPorCodigo, osDaLeitura } from "@/lib/operacao/fila";
import { linhasComSaldo, prazoDaDemanda } from "@/lib/operacao/hoje";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import { demandaDaBusca } from "@/lib/operacao/navegacao";

import { DemandaView, type EstadoDaDemanda, type LocalDaFicha } from "./demanda-view";

/** Operação › Demanda (parte 3.5b): a ficha da demanda pedida em ?numero=. */

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

function enderecoEmLinha(endereco: unknown): string | null {
  if (!endereco || typeof endereco !== "object") return null;
  const e = endereco as Record<string, unknown>;
  const rua = [texto(e.logradouro), texto(e.numero)].filter(Boolean).join(", ");
  const cidade = [texto(e.cidade), texto(e.uf)].filter(Boolean).join("/");
  const partes = [rua, texto(e.bairro), cidade].filter(Boolean);
  return partes.length ? partes.join(" · ") : null;
}

export default function PaginaDemanda() {
  const numero = demandaDaBusca(useSearch());
  const demanda = useDocumento(numero ? `demands/${numero}` : null, (db) => doc(db, "demands", numero ?? "-"), demandaDaOperacao);
  const ordens = useLeitura(
    numero ? `service_orders:${numero}` : null,
    (db) => query(collection(db, "service_orders"), where("demanda", "==", numero ?? "-")),
    osDaLeitura,
  );
  const codigo = demanda.item?.customerCode ?? null;
  const clientes = useLeitura("customers", (db) => collection(db, "customers"), clienteDaLeitura);
  const locais = useLeitura(
    codigo ? `customer_locations:${codigo}` : null,
    (db) => query(collection(db, "customer_locations"), where("customer_code", "==", codigo ?? "-")),
    (id, data) => ({ id, nome: texto(data.nome) || null, endereco: enderecoEmLinha(data.endereco) }),
  );
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const chave = useRef<string | null>(null);

  const estado: EstadoDaDemanda = !numero
    ? "nao_encontrada"
    : demanda.erro || ordens.erro
      ? "erro"
      : demanda.item === undefined || ordens.itens === null
        ? "carregando"
        : demanda.item === null
          ? "nao_encontrada"
          : "pronto";
  const ficha = demanda.item ?? null;
  const lista = ficha ? osDaDemanda(ficha.numero, ordens.itens ?? [], true) : [];
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

  async function abrirOs() {
    if (!ficha) return;
    setOcupado(true);
    setErro(null);
    chave.current ??= novaChave();
    try {
      await chamarOperacao("saveServiceOrder", { action: "create", demanda: ficha.numero, idempotency_key: chave.current });
      chave.current = null;
    } catch (error) {
      setErro(mensagemDoErro(error));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <DemandaView
      estado={estado}
      numero={numero}
      demanda={ficha}
      cliente={ficha ? nomesPorCodigo(clientes.itens ?? [])[ficha.customerCode] || ficha.customerCode : ""}
      etapa={ficha ? etapaNaOperacao(ficha, lista) : null}
      escopo={ficha ? escopoComSaldo(ficha, lista) : []}
      ordens={lista}
      linhasComSaldo={ficha ? linhasComSaldo(ficha, lista) : 0}
      locais={locaisDaFicha}
      prazo={ficha?.entrada === "direta" ? prazoDaDemanda(ficha.executarAte, new Date()) : null}
      ocupado={ocupado}
      erro={erro}
      onAbrirOs={() => void abrirOs()}
    />
  );
}
