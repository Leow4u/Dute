import { forwardRef, useRef, useState, type ComponentPropsWithoutRef } from "react";
import { collection, doc, limit, orderBy, query, where } from "firebase/firestore";
import { Bell } from "lucide-react";
import { Link } from "wouter";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useAppUser } from "@/lib/auth";
import { chamarOperacao } from "@/lib/operacao/api";
import { useDocumento, useLeitura } from "@/lib/operacao/leitura";
import {
  AVISOS_NO_SINO,
  avisoDoPortal,
  avisoNovo,
  avisosNovos,
  quandoDoAviso,
  rotuloDoSino,
  vistosAteDoDocumento,
  type AvisoDoPortal,
} from "@/lib/portal/avisos";
import { cn } from "@/lib/utils";

/**
 * O sino do portal (docs/plataforma/fase-4-financeiro.md, parte 4.6c;
 * docs/mockups/Portal.dc.html): o botão com o ponto quando há aviso novo e a
 * lista dos últimos avisos, cada um levando à tela dele. Abrir o sino marca
 * tudo como visto; enquanto ele fica aberto, os novos continuam marcados.
 * Sem legenda: rótulos, dados e ações. Segue o docs/sistema-visual.md do WMS
 * até o portal adotar a v3.
 */

type BotaoDoSinoProps = ComponentPropsWithoutRef<"button"> & { novos: number };

export const BotaoDoSino = forwardRef<HTMLButtonElement, BotaoDoSinoProps>(function BotaoDoSino({ novos, className, ...props }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      aria-label={rotuloDoSino(novos)}
      className={cn(
        "relative flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-sidebar-foreground/80 outline-none transition-colors duration-200 hover:bg-card hover:text-sidebar-foreground focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
      {...props}
    >
      <Bell className="h-5 w-5" aria-hidden="true" />
      {novos > 0 ? <span aria-hidden="true" className="absolute right-2.5 top-2.5 size-2.5 rounded-full border-2 border-sidebar bg-primary" /> : null}
    </button>
  );
});

export type ListaDeAvisosProps = {
  avisos: AvisoDoPortal[] | null;
  erro: boolean;
  /** Até quando o login tinha visto ao abrir o sino: o que veio depois fica marcado como novo. */
  vistosAte: Date | null;
  agora: Date;
  onEscolher?: () => void;
};

export function ListaDeAvisos({ avisos, erro, vistosAte, agora, onEscolher }: ListaDeAvisosProps) {
  return (
    <div className="flex max-h-[min(28rem,70dvh)] flex-col">
      <h2 className="border-b border-border/60 px-4 py-3 text-sm font-semibold text-foreground">Avisos</h2>
      {erro ? (
        <p role="alert" className="px-4 py-6 text-sm text-destructive">
          Não foi possível carregar.
        </p>
      ) : avisos === null ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Carregando...</p>
      ) : !avisos.length ? (
        <p className="px-4 py-6 text-sm text-muted-foreground">Nenhum aviso.</p>
      ) : (
        <ul className="min-h-0 overflow-y-auto p-1">
          {avisos.map((aviso) => {
            const novo = avisoNovo(aviso, vistosAte);
            return (
              <li key={aviso.id}>
                <Link
                  href={aviso.link}
                  onClick={onEscolher}
                  className="flex gap-3 rounded-lg px-3 py-2.5 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span aria-hidden="true" className={cn("mt-1.5 size-2 shrink-0 rounded-full", novo ? "bg-primary" : "bg-transparent")} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className={cn("text-sm text-foreground", novo ? "font-semibold" : "font-medium")}>
                      {novo ? <span className="sr-only">Novo: </span> : null}
                      {aviso.titulo}
                    </span>
                    {aviso.texto ? <span className="text-xs text-muted-foreground">{aviso.texto}</span> : null}
                    <span className="text-xs text-muted-foreground">{quandoDoAviso(aviso.criadoEm, agora)}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** O sino do cliente: os últimos avisos e até quando este login os viu, ao vivo. */
export function SinoDoPortal({ lado = "right", className }: { lado?: "right" | "bottom"; className?: string }) {
  const { user } = useAppUser();
  const uid = user?.uid ?? null;
  const codigo = user?.publicMetadata.role === "cliente" ? (user.publicMetadata.customer_code ?? null) : null;
  const leitura = useLeitura(
    codigo ? `client_notifications:${codigo}` : null,
    (db) => query(collection(db, "client_notifications"), where("customer_code", "==", codigo ?? "-"), orderBy("created_at", "desc"), limit(AVISOS_NO_SINO)),
    avisoDoPortal,
  );
  const marca = useDocumento(
    uid && codigo ? `client_notification_reads:${uid}` : null,
    (db) => doc(db, "client_notification_reads", uid ?? "-"),
    (_id, dados) => vistosAteDoDocumento(dados),
  );
  const [aberto, setAberto] = useState(false);
  // O que estava visto ao abrir: os novos continuam marcados até fechar.
  const [vistosAoAbrir, setVistosAoAbrir] = useState<Date | null>(null);
  const marcando = useRef(false);
  const vistosAte = marca.item ?? null;
  const novos = leitura.itens ? avisosNovos(leitura.itens, vistosAte) : 0;

  if (!codigo) return null;

  function mudar(abrir: boolean) {
    setAberto(abrir);
    if (!abrir) return;
    setVistosAoAbrir(vistosAte);
    if (!novos || marcando.current) return;
    marcando.current = true;
    // Marcar é só conveniência: se falhar, o ponto volta na próxima abertura.
    void chamarOperacao("markNotificationsRead", {})
      .catch(() => undefined)
      .finally(() => {
        marcando.current = false;
      });
  }

  return (
    <Popover open={aberto} onOpenChange={mudar}>
      <PopoverTrigger asChild>
        <BotaoDoSino novos={novos} className={className} />
      </PopoverTrigger>
      <PopoverContent side={lado} align="end" collisionPadding={16} className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <ListaDeAvisos avisos={leitura.itens} erro={leitura.erro} vistosAte={vistosAoAbrir} agora={new Date()} onEscolher={() => setAberto(false)} />
      </PopoverContent>
    </Popover>
  );
}
