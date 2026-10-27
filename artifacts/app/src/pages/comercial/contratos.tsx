import { useEffect, useMemo, useRef, useState } from "react";
import { collection, query, where } from "firebase/firestore";
import { useLocation, useSearch } from "wouter";

import { useToast } from "@/hooks/use-toast";
import { chamarComercial, novaChave, type CallableDoContrato } from "@/lib/comercial/api";
import { cadastroDoDocumento, hojeLocal } from "@/lib/comercial/clientes";
import {
  aditivoDoRegistro,
  contratoDoRegistro,
  contratoEscolhido,
  listaDeContratos,
  nomesDosClientes,
  payloadAditivo,
  payloadEdicaoContrato,
  payloadNovoContrato,
  tabelaDoRegistro,
  type Aditivo,
  type Contrato,
  type FiltroDaLista,
  type TabelaDoContrato,
} from "@/lib/comercial/contratos";
import { carga, useLeitura } from "@/lib/comercial/leitura";
import { ROTA_CONTRATOS, contratoDaBusca, hrefDoContrato } from "@/lib/comercial/navegacao";
import { payloadDaTabela } from "@/lib/comercial/tabela-do-contrato";

import { ContratoDialog, RegistrarAditivoDialog } from "./contratos-dialogos";
import { ContratosView } from "./contratos-view";
import { TabelaDoContratoDialog } from "./tabela-do-contrato-dialog";

/**
 * Comercial › Contratos (docs/mockups/ComContrato.dc.html; parte 14 de
 * docs/plataforma/fase-6-comercial.md). Lê pelo Firestore, como as regras
 * permitem a owner, admin e comercial (`contracts` e os aditivos,
 * `price_tables` por canReadPrices(); `customers` para o nome do cliente), e
 * grava só pelas callables de functions/comercial: saveContract (com a
 * edição lida) e recordAditivo (o servidor recusa número que já está no
 * histórico), cada uma com chave de idempotência.
 */

type Dialogo =
  | { tipo: "novo"; chave: string }
  // O contrato e o histórico de quando o diálogo abriu: o formulário não se refaz a cada snapshot.
  | { tipo: "editar"; chave: string; contrato: Contrato }
  | { tipo: "tabela"; chave: string; contrato: Contrato }
  | { tipo: "aditivo"; chave: string; contrato: Contrato; aditivos: Aditivo[] };

/** Abaixo do xl a ficha fica embaixo da lista (contratos-view.tsx). */
const TELA_ESTREITA = "(max-width: 1279px)";

/** No celular a ficha fica embaixo da lista: leva a pessoa até ela. */
function rolarAteAFicha() {
  if (typeof window === "undefined" || !window.matchMedia?.(TELA_ESTREITA).matches) return;
  window.requestAnimationFrame(() =>
    document.querySelector('[aria-label="Ficha do contrato"]')?.scrollIntoView({ behavior: "smooth", block: "start" }),
  );
}

/** `somenteLeitura`: a mesma tela no shell do Financeiro (Fase 7, parte 7.5c), sem gravar nada. */
export default function ComercialContratosPage({ somenteLeitura = false }: { somenteLeitura?: boolean } = {}) {
  const { toast } = useToast();
  const busca = useSearch();
  const [, navigate] = useLocation();
  const [filtro, setFiltro] = useState<FiltroDaLista>("vigentes");
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const hoje = hojeLocal();

  const contratos = useLeitura("contracts", (db) => collection(db, "contracts"), contratoDoRegistro);
  const cadastros = useLeitura("customers", (db) => collection(db, "customers"), cadastroDoDocumento);

  const lista = contratos.itens ?? [];
  const clientes = cadastros.itens ?? [];
  const itens = useMemo(
    () => listaDeContratos(lista, nomesDosClientes(clientes), filtro, hoje),
    [lista, clientes, filtro, hoje],
  );
  const idDaUrl = contratoDaBusca(busca);
  const selecionado = contratoEscolhido(itens, lista, idDaUrl);
  const id = selecionado?.id ?? null;

  // Link para um contrato encerrado (Clientes, Início): a lista mostra o filtro dele.
  const filtroDaUrl = lista.find((contrato) => contrato.id === idDaUrl)?.dados.status;
  useEffect(() => {
    if (filtroDaUrl) setFiltro(filtroDaUrl === "encerrado" ? "encerrados" : "vigentes");
  }, [idDaUrl, filtroDaUrl]);

  // Aberto por link (Início, ficha do cliente) ou recém-criado: quando o contrato da URL aparece, vai até a ficha, uma vez.
  const rolouAte = useRef<string | null>(null);
  const daUrlNaFicha = idDaUrl !== null && selecionado?.id === idDaUrl;
  useEffect(() => {
    if (!daUrlNaFicha || rolouAte.current === idDaUrl) return;
    rolouAte.current = idDaUrl;
    rolarAteAFicha();
  }, [daUrlNaFicha, idDaUrl]);

  const tabelas = useLeitura(
    id ? `tabelas:${id}` : null,
    (db) => query(collection(db, "price_tables"), where("contract_id", "==", id)),
    tabelaDoRegistro,
  );
  const aditivos = useLeitura(id ? `aditivos:${id}` : null, (db) => collection(db, "contracts", id!, "aditivos"), aditivoDoRegistro);

  const abrir = (proximo: Dialogo) => {
    setErro(null);
    setDialogo(proximo);
  };
  const fechar = () => {
    if (!ocupado) setDialogo(null);
  };

  /** Grava pela callable; o erro fica no diálogo. */
  async function gravar(
    nome: CallableDoContrato,
    dados: Record<string, unknown>,
    sucesso: string,
    depois?: (resultado: Record<string, unknown>) => void,
  ) {
    setOcupado(true);
    setErro(null);
    try {
      const resultado = await chamarComercial(nome, dados);
      setDialogo(null);
      toast({ title: sucesso });
      depois?.(resultado);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  }

  const selecionar = (contratoId: string) => {
    const href = hrefDoContrato(contratoId);
    // O clique já leva até a ficha (mesmo no contrato que está aberto); o efeito do link não repete.
    rolouAte.current = contratoId;
    if (href) navigate(href, { replace: true });
    rolarAteAFicha();
  };

  const estado = contratos.erro ? "erro" : contratos.itens === null ? "carregando" : "pronto";

  return (
    <>
      <ContratosView
        somenteLeitura={somenteLeitura}
        estado={estado}
        contratos={lista}
        clientes={clientes}
        hoje={hoje}
        filtro={filtro}
        onFiltro={(proximo) => {
          setFiltro(proximo);
          // A ficha passa para o primeiro contrato do filtro.
          navigate(ROTA_CONTRATOS, { replace: true });
        }}
        selecionado={selecionado}
        onSelecionar={selecionar}
        tabelas={carga(tabelas)}
        aditivos={carga(aditivos)}
        ocupado={ocupado}
        acoes={{
          novoContrato: () => abrir({ tipo: "novo", chave: novaChave() }),
          editar: () => {
            if (selecionado) abrir({ tipo: "editar", chave: novaChave(), contrato: selecionado });
          },
          adicionarTabela: () => {
            if (selecionado && !somenteLeitura) abrir({ tipo: "tabela", chave: novaChave(), contrato: selecionado });
          },
          registrarAditivo: () => {
            // Com o histórico lido: o número sugerido é o seguinte ao último.
            if (selecionado && aditivos.itens) {
              abrir({ tipo: "aditivo", chave: novaChave(), contrato: selecionado, aditivos: aditivos.itens });
            }
          },
        }}
      />

      <ContratoDialog
        aberto={dialogo?.tipo === "novo" || dialogo?.tipo === "editar"}
        ocupado={ocupado}
        erro={erro}
        onCancelar={fechar}
        contrato={dialogo?.tipo === "editar" ? dialogo.contrato : null}
        clientes={clientes}
        onSalvar={(dados) => {
          if (dialogo?.tipo === "novo") {
            void gravar("saveContract", payloadNovoContrato(dados, dialogo.chave), "Contrato criado", (resultado) => {
              const href = typeof resultado.contrato_id === "string" ? hrefDoContrato(resultado.contrato_id) : null;
              setFiltro("vigentes");
              if (href) navigate(href, { replace: true });
            });
          } else if (dialogo?.tipo === "editar") {
            void gravar("saveContract", payloadEdicaoContrato(dialogo.contrato, dados, dialogo.chave), "Contrato salvo");
          }
        }}
      />
      <RegistrarAditivoDialog
        aberto={dialogo?.tipo === "aditivo"}
        ocupado={ocupado}
        erro={erro}
        onCancelar={fechar}
        contrato={dialogo?.tipo === "aditivo" ? dialogo.contrato : null}
        aditivos={dialogo?.tipo === "aditivo" ? dialogo.aditivos : SEM_ADITIVOS}
        tabelas={tabelas.itens ?? SEM_TABELAS}
        onSalvar={(aditivo) => {
          if (dialogo?.tipo !== "aditivo") return;
          void gravar("recordAditivo", payloadAditivo(dialogo.contrato.id, aditivo, dialogo.chave), "Aditivo registrado");
        }}
      />
      <TabelaDoContratoDialog
        aberto={dialogo?.tipo === "tabela"}
        contratoNome={dialogo?.tipo === "tabela" ? dialogo.contrato.dados.nome : ""}
        inicioDoContrato={dialogo?.tipo === "tabela" ? dialogo.contrato.dados.vigente_de : ""}
        ocupado={ocupado}
        erro={erro}
        onCancelar={fechar}
        onSalvar={(form) => {
          if (dialogo?.tipo !== "tabela" || somenteLeitura) return;
          void gravar("saveContractPriceTable", payloadDaTabela(dialogo.contrato.id, form, dialogo.chave), "Tabela adicionada");
        }}
      />
    </>
  );
}

const SEM_ADITIVOS: Aditivo[] = [];
const SEM_TABELAS: TabelaDoContrato[] = [];
