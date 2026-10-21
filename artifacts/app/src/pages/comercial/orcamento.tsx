import { useEffect, useMemo, useRef, useState } from "react";
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
  VARIANTE_PADRAO,
  acoesDoOrcamento,
  avisoDeRecalculo,
  catalogoDaTabela,
  classificarErro,
  formDoOrcamento,
  formSujo,
  itemDoCatalogoDoDocumento,
  payloadAvancar,
  payloadDuplicar,
  payloadSalvar,
  pendenciasParaEnviar,
  previaDosTotais,
  problemasDoFormulario,
  type AcaoDeAvanco,
  type FormOrcamento,
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
 * situação que a tela viu. A prévia dos totais é de lib/dominio; o valor que
 * vale é o que o servidor devolve. Erro de situação ou edição divergente
 * mostra a mensagem do servidor e recarrega o orçamento.
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

  // --- Formulário: o original (do servidor) e o que a pessoa está montando ---------------
  const versao = item ? `${item.edicao}|${item.status}|${item.etapa}` : null;
  const [carregado, setCarregado] = useState<{ versao: string; original: FormOrcamento } | null>(null);
  const [form, setForm] = useState<FormOrcamento | null>(null);
  /** A gravação que a tela espera ver chegar (edição e situação): chegou, o formulário volta ao servidor. */
  const [aguardar, setAguardar] = useState<{ edicao: number; status: string } | null>(null);
  const sujo = Boolean(carregado && form && formSujo(carregado.original, form));

  const sincronizar = () => {
    if (!versao || !demandaDoc || !quoteDoc) return;
    const original = formDoOrcamento(demandaDoc, quoteDoc);
    setCarregado({ versao, original });
    setForm(original);
  };

  useEffect(() => {
    if (!versao || !item) return;
    const chegou = aguardar !== null && item.edicao >= aguardar.edicao && item.status === aguardar.status;
    if (chegou) setAguardar(null);
    // Mudou no servidor: volta ao que está gravado, menos quando a pessoa está no meio de uma mudança.
    if (!carregado || chegou || (carregado.versao !== versao && !sujo)) sincronizar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [versao, aguardar]);

  // --- Gravação --------------------------------------------------------------------
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ tipo: "erro" | "info"; texto: string } | null>(null);
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [erroDoDialogo, setErroDoDialogo] = useState<string | null>(null);
  /** A chave da intenção: repetir a mesma chamada (rede caiu) reaproveita a chave; outra chamada, chave nova. */
  const tentativa = useRef<{ assinatura: string; chave: string } | null>(null);

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
      sincronizar();
    }
  }

  async function salvar(variante?: string): Promise<{ edicao: number } | null> {
    if (!form || !carregado || !item) return null;
    const problemas = problemasDoFormulario(form);
    if (problemas.length) {
      setAviso({ tipo: "erro", texto: problemas.join(" ") });
      return null;
    }
    const payload = payloadSalvar({ original: carregado.original, form, numero, edicao: item.edicao, chave: "", variante });
    if (Object.keys(payload).length <= 4) return { edicao: item.edicao };
    const previa = previaDosTotais(form.linhas);
    setOcupado(true);
    setAviso(null);
    try {
      const resultado = await chamarComercial<ResultadoDoSave>("saveQuote", comChave("saveQuote", payload));
      tentativa.current = null;
      setAguardar({ edicao: resultado.edicao, status: resultado.status });
      // Trocar a tabela muda o preço de propósito; no salvamento comum, a diferença é recálculo do servidor.
      const recalculo = variante ? null : avisoDeRecalculo(previa.completa ? previa.totalCents : null, resultado.total_cents);
      if (recalculo) setAviso({ tipo: "info", texto: recalculo });
      toast({ title: variante ? `Tabela ${variante}` : "Orçamento salvo" });
      return { edicao: resultado.edicao };
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
      setAguardar({ edicao: resultado.edicao, status: resultado.status });
      toast({ title: sucesso });
      return true;
    } catch (error) {
      tratarErro(error);
      return false;
    } finally {
      setOcupado(false);
    }
  }

  async function enviar() {
    if (!form || !item) return;
    const faltam = pendenciasParaEnviar(form);
    if (faltam.length) {
      setAviso({ tipo: "erro", texto: `Falta ${faltam.join(", ")} para enviar para aprovação.` });
      return;
    }
    let edicao = item.edicao;
    if (sujo) {
      const salvo = await salvar();
      if (!salvo) return;
      edicao = salvo.edicao;
    }
    await avancar("submit", { status: "rascunho", edicao }, "Enviado para aprovação");
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
      setForm((atual) => (atual ? { ...atual, contatoId: resultado.contato_id } : atual));
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
  if (!item || !form || !carregado) return <EstadoDoOrcamento estado="carregando" />;

  const contratoLido =
    contratoId && contrato.dados ? contratoDoDocumento(contratoId, contrato.dados) : contrato.dados === null ? null : undefined;
  const autor = nomeDe(item.autorUid);
  const aprovador = item.aprovacao ? nomeDe(item.aprovacao.porUid) : null;
  let situacao: string | null = null;
  if (item.status === "para_aprovar") situacao = ["Enviado para aprovação", dataHoraCurta(item.passoEm)].filter(Boolean).join(" · ");
  if (item.status === "aprovado" && item.aprovacao) {
    situacao = [aprovador ? `Aprovado por ${aprovador}` : "Aprovado", dataHoraCurta(item.aprovacao.em)].filter(Boolean).join(" · ");
  }
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
    situacao,
    devolucao: item.devolucao
      ? {
          nota: item.devolucao.nota,
          detalhe: [devolveu ? `Devolvido por ${devolveu}` : "Devolvido", dataHoraCurta(item.devolucao.em)].filter(Boolean).join(" · "),
        }
      : null,
  };
  const acoes = acoesDoOrcamento({ status: item.status, role, uid: user?.uid, autorUid: item.autorUid, etapa: item.etapa });
  const listaDeContatos = contatos.itens ?? [];
  const empresas = Array.from(new Set([item.cliente, ...listaDeContatos.map((contato) => contato.empresa ?? "")].filter(Boolean)));

  return (
    <>
      <MontarView
        dados={dados}
        form={form}
        onForm={(muda) => setForm((atual) => (atual ? muda(atual) : atual))}
        sujo={sujo}
        acoes={acoes}
        contatos={listaDeContatos}
        locais={ordenarLocais(locais.itens ?? [])}
        catalogo={catalogo}
        ocupado={ocupado}
        aviso={aviso}
        handlers={{
          salvar: () => void salvar(),
          enviar: () => void enviar(),
          duplicar: () => void duplicar(),
          editar: () => {
            if (item.status === "para_aprovar") void avancar("return", { status: "para_aprovar", edicao: item.edicao }, "Voltou para a montagem");
            if (item.status === "aprovado") void avancar("edit", { status: "aprovado", edicao: item.edicao }, "Voltou para a montagem");
          },
          aprovar: () => void avancar("approve", { status: item.status, edicao: item.edicao }, "Orçamento aprovado"),
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
        ocupado={ocupado}
        notaObrigatoria={user?.uid !== item.autorUid}
        onCancelar={() => setDialogo(null)}
        onDevolver={async (nota) => {
          const feito = await avancar("return", { status: "para_aprovar", edicao: item.edicao }, "Devolvido para a montagem", nota);
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
