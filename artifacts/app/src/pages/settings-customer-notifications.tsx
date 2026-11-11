import { collection, query, where } from "firebase/firestore";
import { useCallback, useRef, useState } from "react";
import { MODELO_DE_AVISO_ROTULO, type ModeloDeAviso } from "@workspace/dominio";
import { Pencil, Plus } from "lucide-react";

import { Selo } from "@/components/clientes/partes";
import { Button } from "@/components/ui/button";
import { chamarComercial, novaChave } from "@/lib/comercial/api";
import {
  contatoDoDocumento,
  payloadAtivoContato,
  payloadContato,
  type ContatoResumo,
  type FormContato,
} from "@/lib/comercial/clientes";
import { useLeitura, type Leitura } from "@/lib/comercial/leitura";
import { ContatoDialog } from "./comercial/clientes-dialogos";

const MODELOS_DO_ESTOQUE: readonly ModeloDeAviso[] = ["estoque_parado", "estoque_disponivel"];

export type ContatosDeAviso = {
  leitura: Leitura<ContatoResumo>;
  /** Os contatos do cliente, os ativos primeiro, por nome. */
  lista: ContatoResumo[];
  reler: () => void;
};

/**
 * Os contatos do cliente que recebem avisos por e-mail (`customer_contacts`),
 * ao vivo. Código null: nada a ler (cliente arquivado, ou o Comercial fora
 * do ambiente). A página do cliente lê uma vez e usa na faixa de números e na seção.
 */
export function useContatosDeAviso(code: string | null): ContatosDeAviso {
  const [tentativa, setTentativa] = useState(0);
  const leitura = useLeitura(
    code ? `avisos-do-cliente:${code}:${tentativa}` : null,
    (db) => query(collection(db, "customer_contacts"), where("customer_code", "==", code)),
    contatoDoDocumento,
  );
  const lista = (leitura.itens ?? [])
    .filter((contato) => contato.customerCode === code)
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, "pt-BR"));
  const reler = useCallback(() => setTentativa((atual) => atual + 1), []);
  return { leitura, lista, reler };
}

type Props = {
  customer: { code: string; name: string };
  contatos: ContatosDeAviso;
};

/**
 * "Avisos por e-mail" na página do cliente (docs/mockups/ConfigCliente.dc.html):
 * os mesmos contatos e preferências do Comercial, aqui só com os avisos de
 * estoque. Criar e editar abrem o diálogo do contato; desativar e reativar
 * gravam direto, com a mesma chave na retentativa.
 */
export default function SettingsCustomerNotifications({ customer, contatos }: Props) {
  // Uma troca de cliente descarta o formulário, a chave e os erros anteriores.
  return <CustomerNotificationsSection key={customer.code} customer={customer} contatos={contatos} />;
}

function CustomerNotificationsSection({ customer, contatos }: Props) {
  const [editor, setEditor] = useState<{ contato: ContatoResumo | null; chave: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const gravando = useRef(false);
  const alternancias = useRef(new Map<string, { ativo: boolean; chave: string }>());
  const { leitura, lista } = contatos;
  const empresas = [...new Set([customer.name, ...lista.flatMap((contato) => (contato.empresa ? [contato.empresa] : []))])];

  function abrirEditor(contato: ContatoResumo | null) {
    if (gravando.current) return;
    setErro(null);
    setConfirmacao("");
    setEditor({ contato, chave: novaChave() });
  }

  function fecharEditor() {
    if (gravando.current) return;
    setErro(null);
    setEditor(null);
  }

  async function gravar(payload: Record<string, unknown>, mensagem: string, depois?: () => void) {
    // O ref fecha a janela entre dois eventos antes do próximo render.
    if (gravando.current) return;
    gravando.current = true;
    setOcupado(true);
    setErro(null);
    setConfirmacao("");
    try {
      await chamarComercial("saveCustomerContact", payload);
      depois?.();
      setEditor(null);
      setConfirmacao(mensagem);
    } catch (error) {
      setErro(error instanceof Error ? error.message : "Não foi possível salvar o contato.");
    } finally {
      gravando.current = false;
      setOcupado(false);
    }
  }

  function salvarContato(form: FormContato) {
    if (!editor) return;
    void gravar(
      payloadContato(customer.code, form, editor.chave, editor.contato),
      editor.contato ? "Contato salvo" : "Contato criado",
    );
  }

  function alternarContato(contato: ContatoResumo) {
    if (gravando.current) return;
    const ativo = !contato.ativo;
    let tentativa = alternancias.current.get(contato.id);
    if (!tentativa || tentativa.ativo !== ativo) {
      tentativa = { ativo, chave: novaChave() };
      alternancias.current.set(contato.id, tentativa);
    }
    // Resposta perdida: a retentativa usa a mesma chave, até o sucesso.
    void gravar(
      payloadAtivoContato(customer.code, contato, ativo, tentativa.chave),
      ativo ? "Contato reativado" : "Contato desativado",
      () => alternancias.current.delete(contato.id),
    );
  }

  return (
    <section id="avisos-por-email" aria-labelledby="avisos-por-email-titulo" className="scroll-mt-6 rounded-lg border border-border bg-card xl:col-span-2">
      <div className="flex min-h-16 items-center justify-between gap-3 border-b border-border/60 px-5 py-3">
        <h2 id="avisos-por-email-titulo" className="text-base font-extrabold">
          Avisos por e-mail
        </h2>
        <Button type="button" variant="secondary" size="sm" onClick={() => abrirEditor(null)} disabled={ocupado || leitura.erro || leitura.itens === null}>
          <Plus aria-hidden="true" />
          Novo contato
        </Button>
      </div>
      {leitura.erro ? (
        <div className="flex flex-wrap items-center gap-3 px-5 py-4">
          <p role="alert" className="text-sm font-semibold text-destructive">
            Não foi possível carregar os contatos.
          </p>
          <Button type="button" variant="outline" size="sm" onClick={contatos.reler}>
            Tentar novamente
          </Button>
        </div>
      ) : leitura.itens === null ? (
        <p role="status" className="px-5 py-4 text-sm font-semibold text-muted-foreground">
          Carregando contatos…
        </p>
      ) : lista.length ? (
        <ul className="divide-y divide-border/60">
          {lista.map((contato) => {
            const avisos = MODELOS_DO_ESTOQUE.filter((modelo) => contato.avisos.includes(modelo));
            return (
              <li
                key={contato.id}
                className="grid gap-3 px-5 py-3.5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,0.9fr)_minmax(0,1.6fr)_auto] lg:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{contato.nome}</p>
                  <p className="break-words text-sm text-muted-foreground">{contato.email ?? "Sem e-mail"}</p>
                </div>
                <div>
                  <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-bold">{contato.papelRotulo}</span>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {avisos.length ? (
                    avisos.map((modelo) => (
                      <span
                        key={modelo}
                        className="inline-flex h-6 items-center rounded-md border border-info-soft-border bg-info-soft px-2.5 text-xs font-bold text-info-soft-foreground"
                      >
                        {MODELO_DE_AVISO_ROTULO[modelo]}
                      </span>
                    ))
                  ) : (
                    <span className="text-sm text-muted-foreground">Nenhum aviso de estoque</span>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-1.5 lg:justify-end">
                  <Selo tom={contato.ativo ? "ok" : "off"}>{contato.ativo ? "Ativo" : "Desativado"}</Selo>
                  <Button type="button" variant="ghost" size="sm" disabled={ocupado} onClick={() => abrirEditor(contato)}>
                    <Pencil aria-hidden="true" />
                    Editar
                  </Button>
                  <Button type="button" variant="ghost" size="sm" disabled={ocupado} onClick={() => alternarContato(contato)}>
                    {contato.ativo ? "Desativar" : "Reativar"}
                  </Button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="px-5 py-4 text-sm font-semibold text-muted-foreground">Nenhum contato cadastrado.</p>
      )}
      {erro && !editor ? (
        <p role="alert" className="px-5 pb-4 text-sm font-semibold text-destructive">
          {erro}
        </p>
      ) : null}
      <p role="status" className="px-5 pb-1 text-sm font-semibold text-success-soft-foreground empty:hidden">
        {confirmacao}
      </p>
      {editor ? (
        <ContatoDialog
          aberto
          ocupado={ocupado}
          erro={erro}
          onCancelar={fecharEditor}
          contato={editor.contato}
          empresas={empresas}
          onSalvar={salvarContato}
          modelos={MODELOS_DO_ESTOQUE}
          emailObrigatorio
          papelEditavel={false}
          titulo={editor.contato ? `Editar ${editor.contato.nome} · ${customer.name}` : `Novo contato · ${customer.name}`}
        />
      ) : null}
    </section>
  );
}
