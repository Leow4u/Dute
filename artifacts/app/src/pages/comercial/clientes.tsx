import { useEffect, useMemo, useState } from "react";
import { collection, doc, getDoc, query, where } from "firebase/firestore";

import { useToast } from "@/hooks/use-toast";
import { chamarComercial, novaChave, type CallableDoCadastro } from "@/lib/comercial/api";
import {
  avisoDaIdentidade,
  cadastroDoDocumento,
  contatoDoDocumento,
  contratoDoDocumento,
  empresasSugeridas,
  filtrarCadastros,
  hojeLocal,
  localDoDocumento,
  payloadAtivoContato,
  payloadAtivoLocal,
  payloadContato,
  payloadEdicao,
  payloadLocal,
  payloadMarcarCliente,
  payloadNovoProspect,
  type CadastroComercial,
  type ContatoResumo,
  type LocalResumo,
  type Segmento,
} from "@/lib/comercial/clientes";
import { carga, useLeitura } from "@/lib/comercial/leitura";
import { useAppUser } from "@/lib/auth";
import { firestore } from "@/lib/firebase";

import { ContatoDialog, EditarCadastroDialog, LocalDialog, MarcarClienteDialog, NovoProspectDialog } from "./clientes-dialogos";
import { ABA_INICIAL, ClientesView, type FichaAba } from "./clientes-view";

/**
 * Comercial › Clientes e prospects (docs/mockups/ComClientes.dc.html; parte 13
 * de docs/plataforma/fase-6-comercial.md). Lê pelo Firestore, como as regras
 * permitem a owner, admin e comercial (`customers`, `customer_locations`,
 * `customer_contacts`; `contracts` por canReadPrices()), e grava só pelas
 * callables de functions/comercial, com chave de idempotência.
 */

type Dialogo =
  | { tipo: "prospect"; chave: string }
  // O cadastro de quando o diálogo abriu: o formulário não se refaz a cada snapshot.
  | { tipo: "editar"; chave: string; cadastro: CadastroComercial }
  | { tipo: "marcar"; chave: string }
  | { tipo: "local"; chave: string; local: LocalResumo | null }
  | { tipo: "contato"; chave: string; contato: ContatoResumo | null };

/** Nome do responsável: o próprio usuário, ou o perfil quando quem lê pode (owner e admin). */
function useNomeDoResponsavel(uid: string | null): string | null {
  const { user } = useAppUser();
  const [nomes, setNomes] = useState<Record<string, string | null>>({});
  useEffect(() => {
    if (!uid || uid === user?.uid || uid in nomes || !firestore) return;
    let ativo = true;
    getDoc(doc(firestore, "users", uid))
      .then((snapshot) => {
        const nome = snapshot.get("nome");
        if (ativo) setNomes((atual) => ({ ...atual, [uid]: typeof nome === "string" && nome.trim() ? nome.trim() : null }));
      })
      .catch(() => {
        // O comercial não lê o perfil de outra pessoa: o campo fica com o traço.
        if (ativo) setNomes((atual) => ({ ...atual, [uid]: null }));
      });
    return () => {
      ativo = false;
    };
  }, [uid, user?.uid, nomes]);
  if (!uid) return null;
  if (uid === user?.uid) return user?.fullName || null;
  return nomes[uid] ?? null;
}

const TELA_ESTREITA = "(max-width: 1023px)";

export default function ComercialClientesPage() {
  const { toast } = useToast();
  const { user } = useAppUser();
  const [segmento, setSegmento] = useState<Segmento>("todos");
  const [busca, setBusca] = useState("");
  const [selecionadoId, setSelecionadoId] = useState<string | null>(null);
  const [aba, setAba] = useState<FichaAba>(ABA_INICIAL);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const hoje = hojeLocal();

  const cadastros = useLeitura("customers", (db) => collection(db, "customers"), cadastroDoDocumento);
  const contratos = useLeitura("contracts", (db) => collection(db, "contracts"), contratoDoDocumento);

  const lista = cadastros.itens ?? [];
  const selecionado = useMemo<CadastroComercial | null>(() => {
    const escolhido = lista.find((cadastro) => cadastro.id === selecionadoId);
    if (escolhido) return escolhido;
    const { clientes, prospects } = filtrarCadastros(lista, segmento, busca);
    return clientes[0] ?? prospects[0] ?? null;
  }, [lista, selecionadoId, segmento, busca]);
  const code = selecionado?.code ?? null;

  const locais = useLeitura(
    code ? `locais:${code}` : null,
    (db) => query(collection(db, "customer_locations"), where("customer_code", "==", code)),
    localDoDocumento,
  );
  const contatos = useLeitura(
    code ? `contatos:${code}` : null,
    (db) => query(collection(db, "customer_contacts"), where("customer_code", "==", code)),
    contatoDoDocumento,
  );
  // Sugestões do campo Empresa: os contatos de todos os clientes, lidos só com o diálogo aberto.
  const todosOsContatos = useLeitura(
    dialogo?.tipo === "contato" ? "contatos:todos" : null,
    (db) => collection(db, "customer_contacts"),
    contatoDoDocumento,
  );
  const responsavel = useNomeDoResponsavel(selecionado?.responsavelUid ?? null);

  const abrir = (proximo: Dialogo) => {
    setErro(null);
    setDialogo(proximo);
  };
  const fechar = () => {
    if (!ocupado) setDialogo(null);
  };

  /** Grava pela callable. No diálogo, o erro fica nele; na linha, vira aviso. */
  async function gravar(
    nome: CallableDoCadastro,
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
      const mensagem = error instanceof Error ? error.message : "Não foi possível salvar.";
      if (dialogo) setErro(mensagem);
      else toast({ title: "Não foi possível salvar", description: mensagem, variant: "destructive" });
    } finally {
      setOcupado(false);
    }
  }

  const selecionar = (id: string) => {
    setSelecionadoId(id);
    // No celular a ficha fica embaixo da lista: leva a pessoa até ela.
    if (typeof window !== "undefined" && window.matchMedia?.(TELA_ESTREITA).matches) {
      window.requestAnimationFrame(() =>
        document.querySelector('[aria-label="Ficha do cliente"]')?.scrollIntoView({ behavior: "smooth", block: "start" }),
      );
    }
  };

  const estado = cadastros.erro ? "erro" : cadastros.itens === null ? "carregando" : "pronto";

  return (
    <>
      <ClientesView
        estado={estado}
        cadastros={lista}
        contratos={carga(contratos)}
        hoje={hoje}
        segmento={segmento}
        onSegmento={setSegmento}
        busca={busca}
        onBusca={setBusca}
        selecionado={selecionado}
        onSelecionar={selecionar}
        aba={aba}
        onAba={setAba}
        locais={carga(locais)}
        contatos={carga(contatos)}
        responsavel={responsavel}
        ocupado={ocupado}
        acoes={{
          novoProspect: () => abrir({ tipo: "prospect", chave: novaChave() }),
          editar: () => {
            if (selecionado) abrir({ tipo: "editar", chave: novaChave(), cadastro: selecionado });
          },
          marcarCliente: () => abrir({ tipo: "marcar", chave: novaChave() }),
          novoLocal: () => abrir({ tipo: "local", chave: novaChave(), local: null }),
          editarLocal: (local) => abrir({ tipo: "local", chave: novaChave(), local }),
          alternarLocal: (local) => {
            if (!selecionado) return;
            void gravar(
              "saveCustomerLocation",
              payloadAtivoLocal(selecionado.code, local, !local.ativo, novaChave()),
              local.ativo ? "Local desativado" : "Local reativado",
            );
          },
          novoContato: () => abrir({ tipo: "contato", chave: novaChave(), contato: null }),
          editarContato: (contato) => abrir({ tipo: "contato", chave: novaChave(), contato }),
          alternarContato: (contato) => {
            if (!selecionado) return;
            void gravar(
              "saveCustomerContact",
              payloadAtivoContato(selecionado.code, contato, !contato.ativo, novaChave()),
              contato.ativo ? "Contato desativado" : "Contato reativado",
            );
          },
        }}
      />

      <NovoProspectDialog
        aberto={dialogo?.tipo === "prospect"}
        ocupado={ocupado}
        erro={erro}
        onCancelar={fechar}
        cadastros={lista}
        onSalvar={(form) => {
          if (dialogo?.tipo !== "prospect") return;
          void gravar("saveCommercialCustomer", payloadNovoProspect(form, dialogo.chave), "Prospect criado", (resultado) => {
            if (typeof resultado.customer_id === "string") setSelecionadoId(resultado.customer_id);
            setSegmento("todos");
            setBusca("");
            setAba(ABA_INICIAL);
          });
        }}
      />
      <EditarCadastroDialog
        aberto={dialogo?.tipo === "editar"}
        ocupado={ocupado}
        erro={erro}
        onCancelar={fechar}
        cadastro={dialogo?.tipo === "editar" ? dialogo.cadastro : null}
        aviso={avisoDaIdentidade(user?.publicMetadata.role)}
        onSalvar={(form) => {
          if (dialogo?.tipo !== "editar") return;
          void gravar("saveCommercialCustomer", payloadEdicao(dialogo.cadastro, form, dialogo.chave), "Cadastro salvo");
        }}
      />
      <MarcarClienteDialog
        aberto={dialogo?.tipo === "marcar"}
        ocupado={ocupado}
        erro={erro}
        onCancelar={fechar}
        cadastro={selecionado}
        onConfirmar={() => {
          if (dialogo?.tipo !== "marcar" || !selecionado) return;
          void gravar("saveCommercialCustomer", payloadMarcarCliente(selecionado, dialogo.chave), "Marcado como cliente");
        }}
      />
      <LocalDialog
        aberto={dialogo?.tipo === "local"}
        ocupado={ocupado}
        erro={erro}
        onCancelar={fechar}
        local={dialogo?.tipo === "local" ? dialogo.local : null}
        onSalvar={(form) => {
          if (dialogo?.tipo !== "local" || !selecionado) return;
          void gravar(
            "saveCustomerLocation",
            payloadLocal(selecionado.code, form, dialogo.chave, dialogo.local),
            dialogo.local ? "Local salvo" : "Local criado",
          );
        }}
      />
      <ContatoDialog
        aberto={dialogo?.tipo === "contato"}
        ocupado={ocupado}
        erro={erro}
        onCancelar={fechar}
        contato={dialogo?.tipo === "contato" ? dialogo.contato : null}
        empresas={
          selecionado
            ? empresasSugeridas([...(contatos.itens ?? []), ...(todosOsContatos.itens ?? [])], lista, selecionado)
            : []
        }
        onSalvar={(form) => {
          if (dialogo?.tipo !== "contato" || !selecionado) return;
          void gravar(
            "saveCustomerContact",
            payloadContato(selecionado.code, form, dialogo.chave, dialogo.contato),
            dialogo.contato ? "Contato salvo" : "Contato criado",
          );
        }}
      />
    </>
  );
}
