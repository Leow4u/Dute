import { Link } from "wouter";

import { useInicioDoComercial } from "@/lib/comercial/use-inicio";
import { abreComercial } from "@/lib/comercial/navegacao";
import { useInicioDoFinanceiro } from "@/lib/financeiro/use-a-faturar";
import { abreFinanceiro } from "@/lib/financeiro/navegacao";
import { secoesDoRadar, type FonteDoRadar, type SecaoDoRadar } from "@/lib/agente/radar";
import { canAccessModule, WMS_ROLES, type ProfileRole } from "@/lib/modules";
import { abreOperacao } from "@/lib/operacao/navegacao";
import { useInicioDaOperacao } from "@/lib/operacao/use-inicio";
import { useInicioDoWms } from "@/lib/use-inicio-do-wms";
import { cn } from "@/lib/utils";

/**
 * O radar do Agent Dute (parte 5.5k): o "Precisa de você" de cada módulo que
 * a pessoa abre, com as mesmas leituras dos Inícios. Sem legenda: o módulo,
 * as linhas e o link de cada uma.
 */

export function useRadarDoAgente(role: ProfileRole | null | undefined, uid: string | null | undefined): SecaoDoRadar[] {
  const veArmazenagem = canAccessModule(role, WMS_ROLES);
  const veComercial = abreComercial(role);
  const veOperacao = abreOperacao(role);
  const veFinanceiro = abreFinanceiro(role);
  const wms = useInicioDoWms(role, veArmazenagem);
  const comercial = useInicioDoComercial(role, uid, veComercial);
  const operacao = useInicioDaOperacao(role, new Date(), veOperacao);
  const financeiro = useInicioDoFinanceiro(role, new Date(), veFinanceiro);
  const fontes: FonteDoRadar[] = [
    ...(veArmazenagem ? [{ modulo: "wms" as const, itens: wms.items, carregando: wms.carregando, falhas: wms.falhas }] : []),
    ...(veComercial ? [{ modulo: "comercial" as const, ...comercial }] : []),
    ...(veOperacao ? [{ modulo: "operacao" as const, ...operacao }] : []),
    ...(veFinanceiro ? [{ modulo: "financeiro" as const, ...financeiro }] : []),
  ];
  return secoesDoRadar(fontes);
}

export function RadarView({ secoes }: { secoes: readonly SecaoDoRadar[] }) {
  return (
    <div className="flex flex-col gap-4">
      {secoes.map((secao) => (
        <section key={secao.modulo} aria-labelledby={`radar-${secao.modulo}`} className="flex flex-col gap-2">
          <h3 id={`radar-${secao.modulo}`} className="text-sm font-semibold">
            {secao.rotulo}
          </h3>
          {secao.estado === "carregando" ? (
            <p className="text-sm text-muted-foreground">Carregando…</p>
          ) : secao.estado === "falhou" ? (
            <p className="text-sm text-muted-foreground">Não carregou</p>
          ) : secao.linhas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nada pendente</p>
          ) : (
            <ul className="flex flex-col gap-1.5">
              {secao.linhas.map((linha) => (
                <li key={linha.id}>
                  <Link
                    href={linha.href}
                    className={cn(
                      "flex items-center gap-2 rounded-lg border px-3 py-2 text-sm hover:bg-muted",
                      linha.alerta ? "border-destructive-soft-border bg-destructive-soft text-destructive-soft-foreground" : "border-border bg-card",
                    )}
                  >
                    <span className="min-w-0 flex-1">{linha.titulo}</span>
                    {linha.alerta ? <span className="shrink-0 text-xs font-semibold">Urgente</span> : null}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  );
}

export function RadarDoAgente({ role, uid }: { role: ProfileRole | null | undefined; uid: string | null | undefined }) {
  return <RadarView secoes={useRadarDoAgente(role, uid)} />;
}
