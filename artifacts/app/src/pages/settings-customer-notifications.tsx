import { collection, query, where } from "firebase/firestore";
import { useRef, useState } from "react";
import { MODELO_DE_AVISO_ROTULO, type ModeloDeAviso } from "@workspace/dominio";
import { Pencil, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { chamarComercial, novaChave } from "@/lib/comercial/api";
import {
  contatoDoDocumento,
  payloadAtivoContato,
  payloadContato,
  type ContatoResumo,
  type FormContato,
} from "@/lib/comercial/clientes";
import { useLeitura } from "@/lib/comercial/leitura";
import { ContatoDialog } from "./comercial/clientes-dialogos";

const MODELOS_DO_ESTOQUE: readonly ModeloDeAviso[] = ["estoque_parado", "estoque_disponivel"];

type Props = {
  customer: { code: string; name: string };
  onClose: () => void;
};

/** Os mesmos contatos e preferências do cliente, acessíveis pela Configuração. */
export default function SettingsCustomerNotifications({ customer, onClose }: Props) {
  // Uma troca de cliente descarta o formulário, a chave e os erros anteriores.
  return <CustomerNotificationsSession key={customer.code} customer={customer} onClose={onClose} />;
}

function CustomerNotificationsSession({ customer, onClose }: Props) {
  const [editor, setEditor] = useState<{ contato: ContatoResumo | null; chave: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [confirmacao, setConfirmacao] = useState("");
  const [tentativaDeLeitura, setTentativaDeLeitura] = useState(0);
  const gravando = useRef(false);
  const alternancias = useRef(new Map<string, { ativo: boolean; chave: string }>());
  const opener = useRef(typeof document === "undefined" ? null : document.activeElement as HTMLElement | null);
  const contatos = useLeitura(
    `avisos-do-cliente:${customer.code}:${tentativaDeLeitura}`,
    (db) => query(collection(db, "customer_contacts"), where("customer_code", "==", customer.code)),
    contatoDoDocumento,
  );
  const lista = (contatos.itens ?? [])
    .filter((contato) => contato.customerCode === customer.code)
    .sort((a, b) => Number(b.ativo) - Number(a.ativo) || a.nome.localeCompare(b.nome, "pt-BR"));
  const empresas = [...new Set([customer.name, ...lista.flatMap((contato) => contato.empresa ? [contato.empresa] : [])])];

  function abrirEditor(contato: ContatoResumo | null) {
    if (gravando.current) return;
    setErro(null);
    setConfirmacao("");
    setEditor({ contato, chave: novaChave() });
  }

  function voltarALista() {
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

  if (editor) {
    return (
      <ContatoDialog
        aberto
        ocupado={ocupado}
        erro={erro}
        onCancelar={voltarALista}
        contato={editor.contato}
        empresas={empresas}
        onSalvar={salvarContato}
        modelos={MODELOS_DO_ESTOQUE}
        emailObrigatorio
        papelEditavel={false}
        titulo={editor.contato ? `Editar ${editor.contato.nome} · ${customer.name}` : `Novo contato · ${customer.name}`}
      />
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !gravando.current && onClose()}>
      <DialogContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (!document.querySelector('[role="dialog"]') && opener.current?.isConnected) opener.current.focus();
        }}
        className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle>Avisos por e-mail · {customer.name}</DialogTitle>
        </DialogHeader>
        <div>
          <Button type="button" onClick={() => abrirEditor(null)} disabled={ocupado || contatos.erro || contatos.itens === null}>
            <Plus className="h-4 w-4" />
            Novo contato
          </Button>
        </div>
        {contatos.erro ? (
          <div className="space-y-3">
            <p role="alert" className="text-sm text-destructive">Não foi possível carregar os contatos.</p>
            <Button type="button" variant="outline" onClick={() => setTentativaDeLeitura((atual) => atual + 1)}>
              Tentar novamente
            </Button>
          </div>
        ) : contatos.itens === null ? (
          <p role="status" className="text-sm text-muted-foreground">Carregando contatos…</p>
        ) : lista.length ? (
          <ul className="divide-y divide-border rounded-lg border border-border">
            {lista.map((contato) => {
              const avisos = MODELOS_DO_ESTOQUE.filter((modelo) => contato.avisos.includes(modelo));
              return (
                <li key={contato.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 space-y-1">
                    <p className="font-semibold">{contato.nome}</p>
                    <p className="break-words text-sm text-muted-foreground">{contato.email ?? "Sem e-mail"}</p>
                    <p className="text-xs font-semibold text-muted-foreground">{contato.ativo ? "Ativo" : "Desativado"}</p>
                    <p className="text-sm text-muted-foreground">
                      {avisos.length ? avisos.map((modelo) => MODELO_DE_AVISO_ROTULO[modelo]).join(" · ") : "Nenhum aviso de estoque"}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Button type="button" variant="ghost" size="sm" disabled={ocupado} onClick={() => abrirEditor(contato)}>
                      <Pencil className="h-4 w-4" />
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
          <p className="text-sm text-muted-foreground">Nenhum contato cadastrado.</p>
        )}
        {erro ? <p role="alert" className="text-sm text-destructive">{erro}</p> : null}
        <p role="status" className="text-sm text-success-soft-foreground">{confirmacao}</p>
        <DialogFooter>
          <Button type="button" variant="outline" disabled={ocupado} onClick={onClose}>Fechar</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
