import { lazy, Suspense, useState } from "react";
import { BookOpen, LayoutDashboard, MessageCircle } from "lucide-react";
import { Link } from "wouter";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAppUser } from "@/lib/auth";
import { canAccessModule, getRouteProfileRoles } from "@/lib/modules";
import { cn } from "@/lib/utils";

const AgentChatPanel = lazy(() => import("./agent-chat-panel"));

/**
 * Agent Dute como assistente sempre à mão, em vez de um item de menu. O
 * painel completo (aprovação de notificações, memória, conhecimento) segue
 * em /agente, aberto a partir daqui.
 */
export function AgentDock() {
  const { user } = useAppUser();
  const [open, setOpen] = useState(false);
  const role = user?.publicMetadata.role;

  // Mesmo público que já via o Agent Dute no menu.
  if (!canAccessModule(role, getRouteProfileRoles("/agente"))) return null;

  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn(
          "fixed bottom-5 right-5 z-30 flex items-center gap-2 rounded-full bg-foreground px-4 py-3 text-sm font-semibold text-background shadow-[0_12px_32px_rgba(15,23,42,.25)] transition-transform duration-200 hover:-translate-y-0.5 md:bottom-8 md:right-8",
          open && "hidden",
        )}
      >
        <MessageCircle className="size-5" aria-hidden="true" />
        <span className="hidden sm:inline">Perguntar ao Agent Dute</span>
        <span className="sr-only sm:hidden">Perguntar ao Agent Dute</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="right"
          className="flex w-full flex-col gap-0 p-0 sm:max-w-md"
        >
          <SheetHeader className="border-b border-border/70 px-5 pb-4 pt-5 text-left">
            <SheetTitle>Agent Dute</SheetTitle>
            <SheetDescription>Recomenda. Quem decide é você.</SheetDescription>
            <div className="flex flex-wrap gap-2 pt-2">
              <Link
                href="/agente"
                onClick={close}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground/75 hover:bg-muted"
              >
                <LayoutDashboard className="size-3.5" aria-hidden="true" />
                Painel e notificações
              </Link>
              <Link
                href="/agente/conhecimento"
                onClick={close}
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-foreground/75 hover:bg-muted"
              >
                <BookOpen className="size-3.5" aria-hidden="true" />
                Conhecimento
              </Link>
            </div>
          </SheetHeader>
          {open ? (
            <Suspense
              fallback={
                <p className="px-5 py-4 text-sm text-muted-foreground">
                  Carregando...
                </p>
              }
            >
              <AgentChatPanel />
            </Suspense>
          ) : null}
        </SheetContent>
      </Sheet>
    </>
  );
}
