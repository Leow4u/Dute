import { UserPlus } from "lucide-react";
import { useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { CarregandoNaRegiao } from "@/components/ui/carregando-na-regiao";
import { BlocoSemConexao } from "@/components/ui/erro-na-leitura";
import { Esqueleto } from "@/components/ui/esqueleto";
import { FalhaNaSecao } from "@/components/ui/falha-na-secao";
import { useAppUser } from "@/lib/auth";
import { portalScreens, type CustomerRow } from "@/lib/customer-registry";
import { normalizeProfileRole } from "@/lib/modules";
import { peopleOfCustomer, pendingInvitesLabel, type Person } from "@/lib/pessoas";
import { DialogosDasPessoas, useAcoesDasPessoas, type AcoesDasPessoas } from "./acoes";
import { ConviteDialog, pedidoDePortal, type PedidoDeConvite } from "./convite";
import { usePessoas } from "./dados";
import { ListaDePessoas } from "./lista";

/**
 * As pessoas do portal na página do cliente (docs/mockups/ConfigClientePessoas.dc.html):
 * cada cliente tem a própria tela, e a seção Portal do cliente lista quem
 * entra, os convites pendentes e, a pedido, os arquivados, com as mesmas
 * ações de Pessoas e acessos. O "Convidar" abre ali o convite do portal, já
 * com o cliente. A página (components/clientes/pagina-do-cliente.tsx) só põe
 * as peças no lugar; a leitura e as ações moram aqui.
 */

export type PessoasDoCliente = {
  /** "Convidar", no cabeçalho da seção; só onde o convite é aceito. */
  convidar: ReactNode;
  /** As pessoas, embaixo dos dados do portal. */
  lista: ReactNode;
  /** As confirmações e o convite, fora da página. */
  dialogos: ReactNode;
};

export function usePessoasDoCliente(row: CustomerRow | null): PessoasDoCliente {
  const { user } = useAppUser();
  const actorRole = normalizeProfileRole(user?.publicMetadata.role);
  const pessoas = usePessoas({ convites: row !== null });
  const [pedido, setPedido] = useState<PedidoDeConvite | null>(null);
  const [verArquivados, setVerArquivados] = useState(false);
  const acoes = useAcoesDasPessoas({
    refresh: pessoas.refresh,
    onConvidarDeNovo: (person: Person) =>
      row && setPedido({ tipo: "portal", nome: person.name, email: person.email, cliente: row.code, fixo: true }),
  });
  if (!row) return { convidar: null, lista: null, dialogos: null };

  const doCliente = peopleOfCustomer(pessoas.people, row.code);
  const temGente = doCliente.ativos.length + doCliente.pendentes.length + doCliente.arquivados.length > 0;
  const comPortal = row.profile.template.portal !== null && row.profile.portalStatus === "active";
  return {
    convidar: row.invitable ? (
      <Button type="button" variant="secondary" size="sm" onClick={() => setPedido(pedidoDePortal(row.code, true))}>
        <UserPlus aria-hidden="true" />
        Convidar
      </Button>
    ) : null,
    lista:
      comPortal || temGente || pessoas.carregando || pessoas.erro ? (
        <ListaDoPortal
          nome={row.name}
          {...doCliente}
          verArquivados={verArquivados}
          onVerArquivados={() => setVerArquivados((atual) => !atual)}
          acoes={acoes}
          carregando={pessoas.carregando}
          erro={pessoas.erro}
          semConexao={Boolean(pessoas.falta && pessoas.falta.lidaEm === null)}
          tentando={pessoas.tentando}
          onTentar={() => void pessoas.refresh()}
        />
      ) : null,
    dialogos: (
      <>
        <DialogosDasPessoas acoes={acoes} />
        <ConviteDialog
          pedido={pedido}
          onFechar={() => setPedido(null)}
          clientes={row.invitable ? [{ code: row.code, name: row.name, telas: portalScreens(row.profile) }] : []}
          actorRole={actorRole}
          onCriado={pessoas.refresh}
        />
      </>
    ),
  };
}

function ListaDoPortal({
  nome,
  ativos,
  pendentes,
  arquivados,
  verArquivados,
  onVerArquivados,
  acoes,
  carregando,
  erro,
  semConexao = false,
  tentando,
  onTentar,
}: {
  nome: string;
  ativos: Person[];
  pendentes: Person[];
  arquivados: Person[];
  verArquivados: boolean;
  onVerArquivados: () => void;
  acoes: AcoesDasPessoas;
  carregando: boolean;
  erro: boolean;
  /** Sem rede e sem nada lido: o aviso da conexão no lugar da lista. */
  semConexao?: boolean;
  tentando: boolean;
  onTentar: () => void;
}) {
  const visiveis = [...ativos, ...pendentes, ...(verArquivados ? arquivados : [])];
  // Antes de ler (e sem leitura), o bloco no lugar do número: nunca "Pessoas · 0" (carregamento v2, parte 13e).
  const lida = !carregando && !erro;
  const titulo = ["Pessoas", String(ativos.length), pendentes.length ? pendingInvitesLabel(pendentes.length) : null].filter(Boolean).join(" · ");
  return (
    <div className="border-t border-border/60">
      <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3 gap-y-1 px-5 pt-3">
        <h3 className="text-xs font-extrabold uppercase tracking-wider text-muted-foreground">
          {lida ? (
            titulo
          ) : (
            <>
              Pessoas · <Esqueleto forma="contagem" />
            </>
          )}
        </h3>
        {arquivados.length && !carregando && !erro ? (
          <button
            type="button"
            aria-expanded={verArquivados}
            onClick={onVerArquivados}
            className="rounded text-sm font-bold text-foreground underline underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
          >
            {`Arquivados · ${arquivados.length}`}
          </button>
        ) : null}
      </div>
      {carregando ? (
        <CarregandoNaRegiao rotulo="Carregando pessoas…" className="px-5 pb-4 pt-2" />
      ) : semConexao ? (
        <div className="px-5 pb-4 pt-2">
          <BlocoSemConexao tentando={tentando} onTentar={onTentar} />
        </div>
      ) : erro ? (
        <FalhaNaSecao mensagem="Não foi possível ler as pessoas." tentando={tentando} onTentar={onTentar} className="px-5 pb-4 pt-2" />
      ) : visiveis.length ? (
        <div className="pb-1">
          <ListaDePessoas modo="cliente" rotulo={`Pessoas do portal de ${nome}`} pessoas={visiveis} acoes={acoes} />
        </div>
      ) : (
        <p className="px-5 pb-4 pt-1 text-sm font-semibold text-muted-foreground">Ninguém no portal</p>
      )}
    </div>
  );
}
