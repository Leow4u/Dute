import { useMemo, useRef, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { useLocation } from "wouter";

import { chamarOperacao, mensagemDoErro, novaChave } from "@/lib/operacao/api";
import {
  buscarNoCatalogo,
  formularioVazio,
  itemDoCatalogo,
  pedidoDaDemanda,
  problemasDoFormulario,
  type FormularioDaDemanda,
} from "@/lib/operacao/demanda-direta";
import { clienteDaLeitura } from "@/lib/operacao/fila";
import { useLeitura } from "@/lib/operacao/leitura";
import { hrefDaDemanda } from "@/lib/operacao/navegacao";

import { DemandaNovaView } from "./demanda-nova-view";

/** Operação › Nova demanda direta (parte 3.5c): o formulário e openDirectDemand. */

function texto(valor: unknown): string {
  return typeof valor === "string" ? valor.trim() : "";
}

export default function PaginaDemandaNova() {
  const [, navegar] = useLocation();
  const agora = new Date();
  const [form, setForm] = useState<FormularioDaDemanda>(() => formularioVazio(new Date()));
  const [busca, setBusca] = useState("");
  const [corrigindo, setCorrigindo] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const chave = useRef<string | null>(null);
  const contador = useRef(0);

  const clientes = useLeitura("customers", (db) => collection(db, "customers"), clienteDaLeitura);
  const catalogo = useLeitura("lpu_items", (db) => collection(db, "lpu_items"), itemDoCatalogo);
  const locais = useLeitura(
    form.customerCode ? `customer_locations:${form.customerCode}` : null,
    (db) => query(collection(db, "customer_locations"), where("customer_code", "==", form.customerCode)),
    (id, data) => (data.ativo === false ? null : { valor: id, rotulo: texto(data.nome) || id }),
  );

  const opcoesDeClientes = useMemo(
    () =>
      (clientes.itens ?? [])
        .map((cliente) => ({ valor: cliente.code, rotulo: cliente.nome }))
        .sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR")),
    [clientes.itens],
  );
  const problemas = problemasDoFormulario(form, agora);

  function mudar(novo: FormularioDaDemanda) {
    setForm(novo);
    // Mudou o pedido: a próxima tentativa é outra chamada.
    chave.current = null;
  }

  async function abrir() {
    setTentou(true);
    setErro(null);
    if (problemas.length) return;
    setOcupado(true);
    chave.current ??= novaChave();
    try {
      const resultado = await chamarOperacao<{ numero: string }>("openDirectDemand", pedidoDaDemanda(form, chave.current));
      chave.current = null;
      navegar(hrefDaDemanda(resultado.numero));
    } catch (error) {
      setErro(mensagemDoErro(error));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <DemandaNovaView
      agora={agora}
      form={form}
      onForm={mudar}
      clientes={opcoesDeClientes}
      locais={(locais.itens ?? []).sort((a, b) => a.rotulo.localeCompare(b.rotulo, "pt-BR"))}
      busca={busca}
      onBusca={setBusca}
      resultados={buscarNoCatalogo(catalogo.itens ?? [], busca).filter((item) => !form.linhas.some((linha) => linha.lpuItemId === item.id))}
      onAdicionar={(item) => {
        contador.current += 1;
        mudar({ ...form, linhas: [...form.linhas, { chave: `c${contador.current}`, lpuItemId: item.id, item: item.item, unidade: item.unidade ?? "", quantidade: "" }] });
        setBusca("");
      }}
      onAvulso={() => {
        contador.current += 1;
        mudar({ ...form, linhas: [...form.linhas, { chave: `c${contador.current}`, lpuItemId: null, item: "", unidade: "", quantidade: "" }] });
      }}
      corrigindo={corrigindo}
      onCorrigir={setCorrigindo}
      problemas={tentou ? problemas : []}
      ocupado={ocupado}
      erro={erro}
      onAbrir={() => void abrir()}
    />
  );
}
