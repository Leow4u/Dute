import { useEffect, useMemo, useReducer, useRef, useState } from "react";
import { collection, getDocs, query, where } from "firebase/firestore";
import { useLocation, useSearch } from "wouter";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { chamarComercial, novaChave, type CallableDoComercial } from "@/lib/comercial/api";
import {
  cadastroDoDocumento,
  contatoDoDocumento,
  contratoDoDocumento,
  localDoDocumento,
  ordenarLocais,
  payloadContato,
  type FormContato,
} from "@/lib/comercial/clientes";
import { useDocumento, useLeitura, useNomes } from "@/lib/comercial/leitura";
import {
  SINCRONIA_INICIAL,
  VARIANTE_PADRAO,
  acoesDoOrcamento,
  avisoDeRecalculo,
  catalogoDaTabela,
  classificarErro,
  desatualizado,
  ehAtalhoDeSalvar,
  formDoOrcamento,
  formSujo,
  itemDoCatalogoDoDocumento,
  payloadAvancar,
  payloadDuplicar,
  payloadSalvar,
  pendenciasParaEnviar,
  previaDosTotais,
  problemasDoFormulario,
  saidaPedeConfirmacao,
  sincronia,
  situacaoDoCabecalho,
  type AcaoDeAvanco,
  type ItemDaTabela,
  type ItemDoCatalogoDoc,
} from "@/lib/comercial/montar";
import { hrefDoContrato } from "@/lib/comercial/navegacao";
import {
  dataHoraCurta,
  diasNaEtapa,
  hrefDoOrcamento,
  itemDaFila,
  rotuloDoContratoDoOrcamento,
  type StatusOrcamento,
} from "@/lib/comercial/orcamentos";
import { useAppUser } from "@/lib/auth";
import { firestore } from "@/lib/firebase";

import { ContatoDialog } from "./clientes-dialogos";
import { EstadoDoOrcamento, MontarView, type DadosDoOrcamento } from "./orcamento-view";

/**
 * Comercial › Montar orçamento (docs/mockups/ComOrcamento.dc.html; parte 11
 * de docs/plataforma/fase-6-comercial.md), aberto pela fila com ?numero=.
 * Lê pelo Firestore (`demands`, `quotes`, `price_tables`, `lpu_items`,
 * `contracts`, `customers`, `customer_contacts`, `customer_locations`) e grava
 * só pelas callables saveQuote e advanceQuote, com `request_id`, a edição e a
 * situação em que o formulário se baseia (lib/comercial/montar.ts,
 * sincronia). A prévia dos totais é de lib/dominio; o valor que vale é o que
 * o servidor devolve. Erro de situação ou edição divergente mostra a
 * mensagem do servidor e recarrega o orçamento com o último que chegou.
 * Mudança não salva pede confirmação para sair; Ctrl+S salva.
 */

type Registro = Record<string, unknown>;

function texto(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function inteiro(value: unknown): number | null {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

type ResultadoDoSave = { numero: string; rotulo: string; edicao: number; status: StatusOrcamento; total_cents: number };
type ResultadoDoAvanco = { edicao: number; status: StatusOrcamento; ja_feito: boolean };

/** Quanto a tela espera a própria gravação chegar pelo onSnapshot antes de destravar com o que tem. */
const ESPERA_DA_GRAVACAO_MS = 15_000;

const HORA_DE_SAO_PAULO = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** "10:12" em São Paulo: a hora do último salvamento. */
function horaDeAgora(): string {
  return HORA_DE_SAO_PAULO.format(new Date());
}

/** Os itens do catálogo (lpu_items), lidos uma vez quando o orçamento tem tabela. */
function useItensDoCatalogo(ativo: boolean): Map<string, ItemDoCatalogoDoc> | "carregando" | "erro" {
  const [estado, setEstado] = useState<Map<string, ItemDoCatalogoDoc> | "carregando" | "erro">("carregando");
  useEffect(() => {
    if (!ativo) return undefined;
    if (!firestore) {
      setEstado("erro");
      return undefined;
    }
    let vivo = true;
    getDocs(collection(firestore, "lpu_items"))
      .then((snapshot) => {
        if (vivo) setEstado(new Map(snapshot.docs.map((row) => [row.id, itemDoCatalogoDoDocumento(row.data())])));
      })
      .catch(() => {
        if (vivo) setEstado("erro");
      });
    return () => {
      vivo = false;
    };
  }, [ativo]);
  return estado;
}

function DevolverDialog({
  aberto,
  ocupado,
  notaObrigatoria,
  onCancelar,
  onDevolver,
}: {
  aberto: boolean;
  ocupado: boolean;
  notaObrigatoria: boolean;
  onCancelar: () => void;
  onDevolver: (nota: string) => void;
}) {
  const [nota, setNota] = useState("");
  useEffect(() => {
    if (aberto) setNota("");
  }, [aberto]);
  return (
    <Dialog open={aberto} onOpenChange={(open) => (!open && !ocupado ? onCancelar() : undefined)}>
      <DialogContent className="v3 max-w-md">
        <form
          className="grid gap-4"
          onSubmit={(evento) => {
            evento.preventDefault();
            if (!notaObrigatoria || nota.trim()) onDevolver(nota);
          }}
        >
          <DialogHeader>
            <DialogTitle>Devolver para montagem</DialogTitle>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor="devolver-nota">Nota</Label>
            <Textarea id="devolver-nota" rows={4} value={nota} onChange={(evento) => setNota(evento.target.value)} maxLength={1000} />
          </div>
          <DialogFooter className="gap-2">
            <Button type="button" variant="outline" onClick={onCancelar} disabled={ocupado}>
              Cancelar
            </Button>
            <Button type="submit" disabled={ocupado || (notaObrigatoria && !nota.trim())}>
              {ocupado ? "Devolvendo..." : "Devolver"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type Dialogo = { tipo: "devolver" } | { tipo: "contato"; chave: string };

function MontarOrcamento({ numero }: { numero: string }) {
  const { toast } = useToast();
  const { user } = useAppUser();
  const [, navegar] = useLocation();
  const role = user?.publicMetadata.role ?? null;

  const demanda = useDocumento(`demands/${numero}`);
  const quote = useDocumento(`quotes/${numero}`);
  const demandaDoc = demanda.dados as Registro | null | undefined;
  const quoteDoc = quote.dados as Registro | null | undefined;
  const code = texto(demandaDoc?.customer_code);
  const contratoId = texto(demandaDoc?.contrato_id) || null;
  const tabelaId = texto((quoteDoc?.tabela as Registro | undefined)?.id) || null;

  const cadastro = useLeitura(
    code ? `cadastro:${code}` : null,
    (db) => query(collection(db, "customers"), where("customer_code", "==", code)),
    cadastroDoDocumento,
  );
  const contatos = useLeitura(
    code ? `contatos:${code}` : null,
    (db) => query(collection(db, "customer_contacts"), where("customer_code", "==", code)),
    contatoDoDocumento,
  );
  const locais = useLeitura(
    code ? `locais:${code}` : null,
    (db) => query(collection(db, "customer_locations"), where("customer_code", "==", code)),
    localDoDocumento,
  );
  const contrato = useDocumento(contratoId ? `contracts/${contratoId}` : null);
  const tabela = useDocumento(tabelaId ? `price_tables/${tabelaId}` : null);
  const itensDoCatalogo = useItensDoCatalogo(Boolean(tabelaId));
  const catalogo = useMemo<ItemDaTabela[] | "carregando" | "erro">(() => {
    if (!tabelaId) return [];
    if (tabela.erro) return "erro";
    if (tabela.dados === undefined || itensDoCatalogo === "carregando") return "carregando";
    // Sem o catálogo, os itens entram com a descrição da tabela.
    return catalogoDaTabela(tabela.dados?.precos, itensDoCatalogo === "erro" ? new Map() : itensDoCatalogo);
  }, [tabelaId, tabela.erro, tabela.dados, itensDoCatalogo]);

  const item = demandaDoc && quoteDoc ? itemDaFila(numero, demandaDoc, quoteDoc) : null;
  const nomeDe = useNomes(item ? [item.autorUid, item.aprovacao?.porUid, item.devolucao?.porUid] : []);

  // --- Formulário: o servidor ao vivo e o que a pessoa está montando (montar.ts, sincronia) ----
  // A edição e a situação que vão para a callable são as da base do formulário, nunca as do
  // snapshot mais novo: assim o servidor recusa a gravação feita sobre uma edição velha.
  const versao = item ? `${item.edicao}|${item.status}|${item.etapa}` : null;
  const [estado, despachar] = useReducer(sincronia, SINCRONIA_INICIAL);
  useEffect(() => {
    if (!versao || !item || !demandaDoc || !quoteDoc) return;
    despachar({
      tipo: "servidor",
      servidor: { versao, edicao: item.edicao, status: item.status, original: formDoOrcamento(demandaDoc, quoteDoc) },
    });
    // O que chega do servidor muda a versão (edição, situação ou etapa).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versao]);
  const { base, form } = estado;
  const sujo = Boolean(base && form && formSujo(base.original, form));

  // --- Gravação --------------------------------------------------------------------
  const [ocupado, setOcupado] = useState(false);
  // Até a gravação desta tela chegar pelo onSnapshot, nada se edita: o que voltar substitui o formulário.
  const travado = ocupado || estado.aguardar !== null;
  const [aviso, setAviso] = useState<{ tipo: "erro" | "info"; texto: string } | null>(null);
  const [salvoEm, setSalvoEm] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [erroDoDialogo, setErroDoDialogo] = useState<string | null>(null);
  /** A chave da intenção: repetir a mesma chamada (rede caiu) reaproveita a chave; outra chamada, chave nova. */
  const tentativa = useRef<{ assinatura: string; chave: string } | null>(null);

  // A gravação que não chega pelo onSnapshot (conexão caída) não trava a tela para sempre.
  useEffect(() => {
    if (!estado.aguardar) return undefined;
    const espera = window.setTimeout(() => despachar({ tipo: "recarregar" }), ESPERA_DA_GRAVACAO_MS);
    return () => window.clearTimeout(espera);
  }, [estado.aguardar]);

  // Mudança não salva: o navegador pergunta antes de fechar ou recarregar, e o link para outra
  // tela do app (abas, menu, fila) pede confirmação.
  useEffect(() => {
    if (!sujo) return undefined;
    const antesDeSair = (evento: BeforeUnloadEvent) => {
      evento.preventDefault();
      evento.returnValue = "";
    };
    const noClique = (evento: MouseEvent) => {
      if (evento.defaultPrevented || evento.button !== 0 || evento.metaKey || evento.ctrlKey || evento.shiftKey || evento.altKey) {
        return;
      }
      const link = evento.target instanceof Element ? evento.target.closest("a[href]") : null;
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== "_self") || link.hasAttribute("download")) return;
      if (!saidaPedeConfirmacao(link.getAttribute("href"), window.location)) return;
      if (!window.confirm("Sair sem salvar? As alterações deste orçamento se perdem.")) {
        evento.preventDefault();
        evento.stopPropagation();
      }
    };
    window.addEventListener("beforeunload", antesDeSair);
    document.addEventListener("click", noClique, true);
    return () => {
      window.removeEventListener("beforeunload", antesDeSair);
      document.removeEventListener("click", noClique, true);
    };
  }, [sujo]);

  // Ctrl+S (Cmd+S) é o Salvar da tela, não o "salvar página" do navegador.
  const atalhoDeSalvar = useRef<() => void>(() => undefined);
  useEffect(() => {
    const tecla = (evento: KeyboardEvent) => {
      if (!ehAtalhoDeSalvar(evento)) return;
      evento.preventDefault();
      atalhoDeSalvar.current();
    };
    window.addEventListener("keydown", tecla);
    return () => window.removeEventListener("keydown", tecla);
  }, []);

  function comChave(nome: CallableDoComercial, payload: Registro, campo: "request_id" | "idempotency_key" = "request_id"): Registro {
    const assinatura = `${nome}:${JSON.stringify({ ...payload, [campo]: null })}`;
    if (tentativa.current?.assinatura !== assinatura) tentativa.current = { assinatura, chave: novaChave() };
    return { ...payload, [campo]: tentativa.current.chave };
  }

  function tratarErro(error: unknown) {
    const { mensagem, recarregar } = classificarErro(error);
    setAviso({ tipo: "erro", texto: recarregar ? `${mensagem} O orçamento foi recarregado.` : mensagem });
    if (recarregar) {
      tentativa.current = null;
      // A recarga usa o último que o onSnapshot entregou (no reducer), não o que a tela tinha no clique.
      despachar({ tipo: "recarregar" });
    }
  }

  async function salvar(variante?: string): Promise<{ edicao: number; recalculo: string | null } | null> {
    if (!form || !base) return null;
    const payload = payloadSalvar({ original: base.original, form, numero, edicao: base.edicao, chave: "", variante });
    if (Object.keys(payload).length <= 4) {
      toast({ title: "Sem alterações para salvar" });
      return { edicao: base.edicao, recalculo: null };
    }
    const problemas = problemasDoFormulario(form);
    if (problemas.length) {
      setAviso({ tipo: "erro", texto: problemas.join(" ") });
      return null;
    }
    const previa = previaDosTotais(form.linhas);
    setOcupado(true);
    setAviso(null);
    try {
      const resultado = await chamarComercial<ResultadoDoSave>("saveQuote", comChave("saveQuote", payload));
      tentativa.current = null;
      despachar({ tipo: "gravou", edicao: resultado.edicao, status: resultado.status });
      setSalvoEm(horaDeAgora());
      // Trocar a tabela muda o preço de propósito; no salvamento comum, a diferença é recálculo do servidor.
      const recalculo = variante ? null : avisoDeRecalculo(previa.completa ? previa.totalCents : null, resultado.total_cents);
      if (recalculo) setAviso({ tipo: "info", texto: recalculo });
      toast({ title: variante ? `Tabela ${variante}` : "Orçamento salvo" });
      return { edicao: resultado.edicao, recalculo };
    } catch (error) {
      tratarErro(error);
      return null;
    } finally {
      setOcupado(false);
    }
  }

  async function avancar(acao: AcaoDeAvanco, esperado: { status: StatusOrcamento; edicao: number }, sucesso: string, nota?: string) {
    setOcupado(true);
    setAviso(null);
    try {
      const resultado = await chamarComercial<ResultadoDoAvanco>(
        "advanceQuote",
        comChave("advanceQuote", payloadAvancar(acao, { numero, ...esperado }, "", nota)),
      );
      tentativa.current = null;
      despachar({ tipo: "gravou", edicao: resultado.edicao, status: resultado.status });
      toast({ title: sucesso });
      return true;
    } catch (error) {
      tratarErro(error);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  /** A edição e a situação em que o formulário se baseia (o que a pessoa viu). */
  const esperadoDaBase = (): { status: StatusOrcamento; edicao: number } | null =>
    base ? { status: base.status as StatusOrcamento, edicao: base.edicao } : null;

  async function enviar() {
    if (!form || !base) return;
    const faltam = pendenciasParaEnviar(form);
    if (faltam.length) {
      setAviso({ tipo: "erro", texto: `Falta ${faltam.join(", ")} para enviar para aprovação.` });
      return;
    }
    let esperado = { status: base.status as StatusOrcamento, edicao: base.edicao };
    if (sujo) {
      const salvo = await salvar();
      if (!salvo) return;
      // O servidor recalculou o total: a pessoa vê o valor que vale antes de mandar para o aprovador.
      if (salvo.recalculo) return;
      esperado = { status: "rascunho", edicao: salvo.edicao };
    }
    await avancar("submit", esperado, "Enviado para aprovação");
  }

  async function duplicar() {
    if (sujo) {
      setAviso({ tipo: "erro", texto: "Salve antes de duplicar: a cópia sai do que está gravado." });
      return;
    }
    setOcupado(true);
    setAviso(null);
    try {
      const resultado = await chamarComercial<ResultadoDoSave>("saveQuote", comChave("saveQuote", payloadDuplicar(numero, "")));
      tentativa.current = null;
      toast({ title: `Orçamento ${resultado.rotulo ?? resultado.numero} criado` });
      navegar(hrefDoOrcamento(resultado.numero));
    } catch (error) {
      tratarErro(error);
    } finally {
      setOcupado(false);
    }
  }

  async function salvarContato(formContato: FormContato) {
    if (dialogo?.tipo !== "contato") return;
    setOcupado(true);
    setErroDoDialogo(null);
    try {
      const resultado = await chamarComercial<{ contato_id: string }>("saveCustomerContact", payloadContato(code, formContato, dialogo.chave));
      setDialogo(null);
      despachar({ tipo: "editar", muda: (atual) => ({ ...atual, contatoId: resultado.contato_id }) });
      toast({ title: "Contato criado" });
    } catch (error) {
      setErroDoDialogo(error instanceof Error ? error.message : "Não foi possível salvar.");
    } finally {
      setOcupado(false);
    }
  }

  // --- Estados ---------------------------------------------------------------------
  if (demanda.erro || quote.erro) return <EstadoDoOrcamento estado="erro" />;
  if (demandaDoc === null || quoteDoc === null) return <EstadoDoOrcamento estado="nao_encontrado" />;
  if (!item || !form || !base) return <EstadoDoOrcamento estado="carregando" />;

  const contratoLido =
    contratoId && contrato.dados ? contratoDoDocumento(contratoId, contrato.dados) : contrato.dados === null ? null : undefined;
  const autor = nomeDe(item.autorUid);
  const aprovador = item.aprovacao ? nomeDe(item.aprovacao.porUid) : null;
  const devolveu = item.devolucao ? nomeDe(item.devolucao.porUid) : null;
  const dados: DadosDoOrcamento = {
    numero,
    rotulo: item.rotulo,
    tipoRv: item.tipoRv,
    status: item.status,
    edicao: item.edicao,
    etapa: item.etapa,
    diasNaEtapa: diasNaEtapa(item.etapaDesde, new Date()),
    cliente: item.cliente,
    prospect: (cadastro.itens ?? []).some((linha) => linha.estagio === "prospect"),
    contrato: rotuloDoContratoDoOrcamento(contratoId, contratoLido),
    contratoHref: contratoId ? hrefDoContrato(contratoId) : null,
    autor,
    tabelaNome: item.tabelaNome,
    variante: item.variante ?? VARIANTE_PADRAO,
    dataBase: item.dataBase,
    subtotalCents: inteiro(quoteDoc?.subtotal_cents),
    ajustesCents: inteiro(quoteDoc?.ajustes_cents),
    totalCents: item.totalCents,
    situacao: situacaoDoCabecalho({ status: item.status, passoEm: item.passoEm, aprovacao: item.aprovacao, aprovador }),
    devolucao: item.devolucao
      ? {
          nota: item.devolucao.nota,
          detalhe: [devolveu ? `Devolvido por ${devolveu}` : "Devolvido", dataHoraCurta(item.devolucao.em)].filter(Boolean).join(" · "),
        }
      : null,
  };
  const acoes = acoesDoOrcamento({ status: item.status, role, uid: user?.uid, autorUid: item.autorUid, etapa: item.etapa });
  atalhoDeSalvar.current = () => {
    if (acoes.editavel && !travado) void salvar();
  };
  const listaDeContatos = contatos.itens ?? [];
  const empresas = Array.from(new Set([item.cliente, ...listaDeContatos.map((contato) => contato.empresa ?? "")].filter(Boolean)));

  return (
    <>
      <MontarView
        dados={dados}
        form={form}
        onForm={(muda) => despachar({ tipo: "editar", muda })}
        sujo={sujo}
        acoes={acoes}
        contatos={listaDeContatos}
        locais={ordenarLocais(locais.itens ?? [])}
        catalogo={catalogo}
        ocupado={travado}
        aviso={aviso}
        salvoEm={salvoEm}
        desatualizado={desatualizado(estado)}
        handlers={{
          salvar: () => void salvar(),
          enviar: () => void enviar(),
          duplicar: () => void duplicar(),
          editar: () => {
            const esperado = esperadoDaBase();
            if (esperado?.status === "para_aprovar") void avancar("return", esperado, "Voltou para a montagem");
            if (esperado?.status === "aprovado") void avancar("edit", esperado, "Voltou para a montagem");
          },
          aprovar: () => {
            const esperado = esperadoDaBase();
            if (esperado) void avancar("approve", esperado, "Orçamento aprovado");
          },
          devolver: () => setDialogo({ tipo: "devolver" }),
          trocarVariante: (variante) => void salvar(variante),
          novoContato: () => {
            setErroDoDialogo(null);
            setDialogo({ tipo: "contato", chave: novaChave() });
          },
        }}
      />
      <DevolverDialog
        aberto={dialogo?.tipo === "devolver"}
        ocupado={travado}
        notaObrigatoria={user?.uid !== item.autorUid}
        onCancelar={() => setDialogo(null)}
        onDevolver={async (nota) => {
          const esperado = esperadoDaBase();
          if (!esperado) return;
          const feito = await avancar("return", esperado, "Devolvido para a montagem", nota);
          if (feito) setDialogo(null);
        }}
      />
      <ContatoDialog
        aberto={dialogo?.tipo === "contato"}
        ocupado={ocupado}
        erro={erroDoDialogo}
        onCancelar={() => setDialogo(null)}
        contato={null}
        empresas={empresas}
        onSalvar={(formContato) => void salvarContato(formContato)}
      />
    </>
  );
}

export default function ComercialOrcamentoPage() {
  const numero = (new URLSearchParams(useSearch()).get("numero") ?? "").trim();
  if (!/^\d{5,8}$/.test(numero)) return <EstadoDoOrcamento estado="nao_encontrado" />;
  // Outro número (duplicar, voltar) é outra tela: o formulário recomeça.
  return <MontarOrcamento key={numero} numero={numero} />;
}
