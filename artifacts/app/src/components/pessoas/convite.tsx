import { useMutation } from "@tanstack/react-query";
import { Send } from "lucide-react";
import { useRef, useState } from "react";

import { Pilula } from "@/components/clientes/partes";
import { BotaoDeAcao } from "@/components/ui/botao-de-acao";
import { Dialog, DialogCancelar, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { assignableRoles, roleLabel } from "@/lib/access";
import type { ProfileRole } from "@/lib/modules";
import { humanApiError } from "@/lib/permissions";
import { modulesForPerson } from "@/lib/platform-modules";
import { cn } from "@/lib/utils";
import { copyInviteLink, jsonOrThrow } from "./acoes";

/**
 * O convite (docs/mockups/ConfigPessoasConvite.dc.html e
 * ConfigPessoasConviteCliente.dc.html): para a equipe, os perfis em lista com
 * os módulos que cada um abre neste ambiente; para o portal, o cliente
 * (escolhido, ou já dado pela página dele), o perfil Cliente e as telas do
 * portal. O convite só sai com o cliente escolhido: nunca o primeiro da
 * lista. Repetir depois de uma falha manda o mesmo token e o mesmo recibo.
 */

export type ClienteDoConvite = { code: string; name: string; telas: string[] };

export type PedidoDeConvite =
  | { tipo: "equipe"; nome: string; email: string; role: ProfileRole | null }
  | { tipo: "portal"; nome: string; email: string; cliente: string; fixo: boolean };

export function pedidoDeEquipe(): PedidoDeConvite {
  return { tipo: "equipe", nome: "", email: "", role: null };
}

export function pedidoDePortal(cliente = "", fixo = false): PedidoDeConvite {
  return { tipo: "portal", nome: "", email: "", cliente, fixo };
}

/** Os perfis da equipe que quem convida pode dar: os de assignableRoles, sem o Cliente. */
export function perfisDaEquipe(actorRole: ProfileRole | null): ProfileRole[] {
  return assignableRoles(actorRole).filter((role) => role !== "cliente");
}

/** Os módulos que o perfil abre neste ambiente: a mesma regra da tela de entrada. */
export function modulosDoPerfil(role: ProfileRole): string[] {
  return modulesForPerson(role, null).map((entry) => entry.module.label);
}

function makeInviteToken() {
  const bytes = new Uint8Array(18);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

type ConviteProps = {
  pedido: PedidoDeConvite | null;
  onFechar: () => void;
  /** Clientes com portal e armazenagem, os que a Function aceita no convite. */
  clientes: ClienteDoConvite[];
  actorRole: ProfileRole | null;
  /** Depois do convite criado ou da falha: ler as pessoas de novo. */
  onCriado: () => Promise<void> | void;
};

export function ConviteDialog({ pedido, onFechar, ...rest }: ConviteProps) {
  return (
    <Dialog open={pedido !== null} onOpenChange={(open) => !open && onFechar()}>
      {pedido ? (
        // Outro pedido (outra pessoa, outro cliente) começa um formulário novo.
        <FormularioDoConvite
          key={`${pedido.tipo}:${pedido.email}:${pedido.tipo === "portal" ? pedido.cliente : (pedido.role ?? "")}`}
          pedido={pedido}
          onFechar={onFechar}
          {...rest}
        />
      ) : null}
    </Dialog>
  );
}

function FormularioDoConvite({ pedido, onFechar, clientes, actorRole, onCriado }: ConviteProps & { pedido: PedidoDeConvite }) {
  const { toast } = useToast();
  const perfis = perfisDaEquipe(actorRole);
  const [nome, setNome] = useState(pedido.nome);
  const [email, setEmail] = useState(pedido.email);
  const [role, setRole] = useState<ProfileRole | null>(() => {
    if (pedido.tipo !== "equipe") return "cliente";
    if (pedido.role && perfis.includes(pedido.role)) return pedido.role;
    return perfis.includes("interno") ? "interno" : (perfis[0] ?? null);
  });
  const [cliente, setCliente] = useState(pedido.tipo === "portal" ? pedido.cliente : "");
  const portal = pedido.tipo === "portal";
  const escolhido = clientes.find((item) => item.code === cliente) ?? null;
  const opcoes = clientes.length ? clientes : cliente ? [{ code: cliente, name: cliente, telas: [] }] : [];
  const faltaCliente = portal && !cliente;

  const createAttempt = useRef<{ fingerprint: string; token: string; idempotency_key: string } | null>(null);
  const createInvite = useMutation({
    mutationFn: async () => {
      const fields = {
        nome: nome.trim(),
        email: email.trim().toLowerCase(),
        role: portal ? "cliente" : role,
        customer_code: portal ? cliente : "Dutelog",
      };
      const fingerprint = JSON.stringify(fields);
      if (createAttempt.current?.fingerprint !== fingerprint) {
        createAttempt.current = { fingerprint, token: makeInviteToken(), idempotency_key: crypto.randomUUID() };
      }
      const { token, idempotency_key } = createAttempt.current;
      const response = await fetch("/api/invites", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, idempotency_key, ...fields }),
      });
      await jsonOrThrow(response, "Não foi possível criar o convite.");
      return token;
    },
    onSuccess: async (token) => {
      createAttempt.current = null;
      onFechar();
      await onCriado();
      const copied = await copyInviteLink(token);
      toast({
        title: "Convite criado",
        description: copied
          ? "O envio por e-mail foi agendado. O link também foi copiado."
          : "O envio por e-mail foi agendado. Você pode copiar o link nas ações do convite.",
      });
    },
    onError: async (error) => {
      await onCriado();
      toast({ title: "Convite não criado", description: humanApiError(error, "Tente novamente em instantes."), variant: "destructive" });
    },
  });

  const titulo = portal
    ? pedido.fixo
      ? `Convidar para o portal · ${escolhido?.name ?? cliente}`
      : "Convidar para o portal"
    : "Convidar para a equipe";

  return (
    <DialogContent aria-describedby={undefined} className="max-h-[90vh] overflow-y-auto sm:max-w-[600px]" ocupado={createInvite.isPending}>
      <DialogHeader>
        <DialogTitle className="text-xl font-extrabold tracking-tight">{titulo}</DialogTitle>
      </DialogHeader>
      <form
        id="invite-form"
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (faltaCliente || !role || createInvite.isPending) return;
          createInvite.mutate();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="invite-nome">Nome</Label>
            <Input id="invite-nome" value={nome} onChange={(event) => setNome(event.target.value)} />
          </div>
          <div className="flex min-w-0 flex-col gap-1.5">
            <Label htmlFor="invite-email">E-mail</Label>
            <Input id="invite-email" type="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          </div>
        </div>

        {portal ? (
          <>
            {pedido.fixo ? null : (
              <div className="flex min-w-0 flex-col gap-1.5">
                <Label htmlFor="invite-cliente">Cliente</Label>
                <Select value={cliente} onValueChange={setCliente}>
                  <SelectTrigger id="invite-cliente">
                    <SelectValue placeholder="Escolha o cliente" />
                  </SelectTrigger>
                  <SelectContent>
                    {opcoes.map((item) => (
                      <SelectItem key={item.code} value={item.code}>
                        {item.name || item.code}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <dl className="grid gap-2.5 rounded-lg bg-muted px-4 py-3 text-sm sm:grid-cols-[132px_minmax(0,1fr)]">
              <dt className="font-semibold text-muted-foreground">Perfil</dt>
              <dd className="font-semibold">{roleLabel("cliente")}</dd>
              {escolhido ? (
                <>
                  <dt className="font-semibold text-muted-foreground">Telas do portal</dt>
                  <dd className="font-semibold">{escolhido.telas.length ? escolhido.telas.join(", ") : "—"}</dd>
                </>
              ) : null}
            </dl>
          </>
        ) : (
          <div className="flex min-w-0 flex-col gap-1.5">
            <span id="invite-perfil" className="text-sm font-medium leading-none">
              Perfil
            </span>
            <RadioGroup
              aria-labelledby="invite-perfil"
              value={role ?? ""}
              onValueChange={(value) => setRole(value as ProfileRole)}
              className="mt-1 gap-0 overflow-hidden rounded-lg border border-border"
            >
              {perfis.map((perfil) => (
                <label
                  key={perfil}
                  htmlFor={`invite-perfil-${perfil}`}
                  className={cn(
                    "flex min-h-12 cursor-pointer flex-wrap items-center gap-x-3 gap-y-1.5 border-l-2 border-t border-t-border/60 px-3.5 py-2 first:border-t-0",
                    role === perfil ? "border-l-primary bg-primary/5" : "border-l-transparent hover:bg-muted/60",
                  )}
                >
                  <RadioGroupItem id={`invite-perfil-${perfil}`} value={perfil} />
                  <span className="min-w-28 text-sm font-bold">{roleLabel(perfil)}</span>
                  <span className="ml-auto flex flex-wrap justify-end gap-1.5">
                    {modulosDoPerfil(perfil).map((modulo) => (
                      <Pilula key={modulo}>{modulo}</Pilula>
                    ))}
                  </span>
                </label>
              ))}
            </RadioGroup>
          </div>
        )}
      </form>
      <DialogFooter className="gap-2">
        <DialogCancelar variant="ghost" onClick={onFechar} />
        <BotaoDeAcao
          type="submit"
          form="invite-form"
          estado={createInvite.isPending ? "andamento" : "repouso"}
          icone={<Send aria-hidden="true" />}
          rotulo="Enviar convite"
          andamento="Enviando…"
          bloqueado={!createInvite.isPending && (faltaCliente || !role)}
        />
      </DialogFooter>
    </DialogContent>
  );
}
