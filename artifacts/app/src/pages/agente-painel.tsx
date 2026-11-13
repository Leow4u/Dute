import { Suspense, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { collection, getCountFromServer } from "firebase/firestore";

import { CarregandoTela } from "@/components/ui/carregando-tela";
import { useToast } from "@/hooks/use-toast";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { playbooksKey } from "@/lib/agent-playbooks";
import { routinesKey } from "@/lib/agent-routines";
import { CHAVE_DAS_ANOTACOES, chaveNoAlvo, clienteDoNucleo } from "@/lib/agente/cliente";
import { abreAgenteDoNucleo, revisaODoAgente } from "@/lib/agente/navegacao";
import { useAppUser } from "@/lib/auth";
import { firestore } from "@/lib/firebase";
import type { HomeInboxItem } from "@/lib/home-inbox";
import { itensDoInicioDoWms } from "@/lib/inicio-do-wms";
import type { ItemDoInicio } from "@/lib/inicio-do-modulo";
import { canAccessModule, getRouteProfileRoles, type ProfileRole } from "@/lib/modules";
import { telaSobDemanda } from "@/lib/telas-no-aparelho";
import { useInicioDoWms } from "@/lib/use-inicio-do-wms";

import { PainelDoAgenteView, type AbaDoAgente, type DecisaoDaNota } from "./agente-painel-view";

/**
 * Agent Dute › Painel (proposta aprovada pelo Leonardo em 04/11/2026). Com o
 * agente do núcleo, o painel é o "Para decidir": as linhas do agente no
 * "Precisa de você" da Armazenagem (as mesmas leituras e a mesma contagem do
 * Início), com a anotação decidida aqui, pela callable decideDuteNote, que
 * grava o evento. Ao lado, o que vale no agente. Fora da liberação do agente,
 * fica o painel antigo (pages/ai-control.tsx).
 */

const PainelAntigo = telaSobDemanda(() => import("./ai-control"));

/** As linhas do "Precisa de você" que são do agente: o alerta de itens parados, as anotações e os playbooks para aprovar. */
export const LINHAS_DO_AGENTE: readonly string[] = ["stock-alerts", "agent-notes", "agent-playbooks"];

/** A chave da contagem dos documentos do Conhecimento. */
export const CHAVE_DOS_DOCUMENTOS = ["agent-knowledge-count"] as const;

/** As linhas do agente, na ordem do Início; no painel, o nome do agente não se repete. */
export function linhasDoPainel(itens: readonly HomeInboxItem[]): ItemDoInicio[] {
  return itensDoInicioDoWms(itens.filter((item) => LINHAS_DO_AGENTE.includes(item.id))).map((item) => ({ ...item, title: item.title.replace(" do Agent Dute", "") }));
}

const ABAS = [
  { href: "/agente", rotulo: "Conversa" },
  { href: "/agente/painel", rotulo: "Painel" },
  { href: "/agente/conhecimento", rotulo: "Conhecimento" },
] as const;

/** As abas do agente que o papel abre, com a tela aberta marcada. */
export function abasDoAgente(role: ProfileRole | null | undefined, atual: string): AbaDoAgente[] {
  return ABAS.filter((aba) => canAccessModule(role, getRouteProfileRoles(aba.href))).map((aba) => ({ ...aba, atual: aba.href === atual }));
}

/** As falhas que importam ao painel: as do armazém e das solicitações ficam no Início. */
const FALHAS_DO_PAINEL = ["alertas", "Agent Dute"];

async function contarDocumentos(): Promise<number | null> {
  if (!firestore) return null;
  return (await getCountFromServer(collection(firestore, "ai_agent_knowledge"))).data().count;
}

function PainelDoAgente({ role }: { role: ProfileRole }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { code } = useActiveCustomer();
  const agente = useMemo(() => clienteDoNucleo("wms", code), [code]);
  const decide = revisaODoAgente(role);
  const inicio = useInicioDoWms(role);
  // As mesmas chaves do Início e do Conhecimento: a leitura sai uma vez, e a decisão atualiza os três.
  const chaveDasNotas = chaveNoAlvo(agente, CHAVE_DAS_ANOTACOES);
  const notas = useQuery({ queryKey: chaveDasNotas, queryFn: () => agente.anotacoes.listar(), enabled: decide });
  const playbooks = useQuery({ queryKey: chaveNoAlvo(agente, playbooksKey), queryFn: () => agente.playbooks.listar(), enabled: decide });
  const rotinas = useQuery({ queryKey: chaveNoAlvo(agente, routinesKey), queryFn: () => agente.rotinas.listar() });
  const documentos = useQuery({ queryKey: CHAVE_DOS_DOCUMENTOS, queryFn: contarDocumentos, enabled: decide });
  const decidir = useMutation({
    mutationFn: ({ id, acao, text, visibility }: DecisaoDaNota) => agente.anotacoes.decidir(id, acao, { text, visibility }),
    onSuccess: (_resultado, decisao) => {
      toast({ title: decisao.acao === "approve" ? "Anotação aprovada: o Agent Dute passa a considerar" : "Anotação recusada" });
      void queryClient.invalidateQueries({ queryKey: chaveDasNotas });
    },
    onError: (erro) => toast({ title: "Não foi possível salvar", description: erro instanceof Error ? erro.message : "", variant: "destructive" }),
  });

  const lista = notas.data?.notes ?? [];
  return (
    <PainelDoAgenteView
      abas={abasDoAgente(role, "/agente/painel")}
      carregando={inicio.carregando}
      falhas={inicio.falhas.filter((falha) => FALHAS_DO_PAINEL.includes(falha))}
      linhas={linhasDoPainel(inicio.items)}
      notas={lista.filter((nota) => nota.status === "pending")}
      numeros={{
        anotacoes: notas.data ? lista.filter((nota) => nota.status === "active").length : null,
        playbooks: playbooks.data ? playbooks.data.playbooks.filter((playbook) => playbook.status === "active").length : null,
        documentos: documentos.data ?? null,
        rotinas: rotinas.data ? rotinas.data.routines.length : null,
      }}
      decidindo={decidir.isPending}
      decidir={(decisao) => decidir.mutate(decisao)}
    />
  );
}

export default function PainelDoAgentePage() {
  const { user } = useAppUser();
  const role = user?.publicMetadata.role;
  if (!role || !abreAgenteDoNucleo(role)) {
    return (
      <Suspense fallback={<CarregandoTela titulo="Painel" />}>
        <PainelAntigo />
      </Suspense>
    );
  }
  return <PainelDoAgente role={role} />;
}
