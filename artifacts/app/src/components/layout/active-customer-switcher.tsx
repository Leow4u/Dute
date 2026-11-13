import { useState, type ReactNode } from "react";
import { Link } from "wouter";
import { Building2, Check, ChevronsUpDown, Plus, RefreshCw } from "lucide-react";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFaltaNaTela } from "@/components/ui/erro-na-leitura";
import { Esqueleto } from "@/components/ui/esqueleto";
import { Spinner } from "@/components/ui/spinner";
import { useActiveCustomer } from "@/lib/active-customer-context";
import { useTentarDeNovo } from "@/lib/carregando/estado-da-conexao";
import { useEspera } from "@/lib/carregando/use-espera";
import { ehFaltaDeConexao } from "@/lib/conexao";
import { templateStatusLabel } from "@/lib/operations";
import { cn } from "@/lib/utils";

/** O que o nome do cliente diz quando a lista dos clientes não veio. */
function useTextoDaFalta(erro: unknown): string {
  const falta = useFaltaNaTela();
  if (!ehFaltaDeConexao(erro)) return "Não carregou";
  return falta === "sem-conexao" ? "Sem conexão" : "Reconectando…";
}

/**
 * Seletor do cliente ativo na área interna. Recebimento, contagem, caixas,
 * etiquetas, documentos e notas do agente vão para o cliente escolhido, e a
 * lista de Itens mostra só os dele. Mapa, Início e Pedidos mostram todos.
 * Fica na barra preta do shell v3 da Armazenagem (parte 4.7), logo abaixo do
 * seletor de módulo, e no cabeçalho do celular. Sem legenda: o nome do
 * cliente e a troca.
 *
 * Até a lista dos clientes (`client_profiles`) chegar, o lugar do nome tem o
 * bloco do esqueleto e, passados 300 ms, a caixa de 16 px no lugar da seta,
 * nunca o cliente legado como se fosse o escolhido (carregamento v2, momento
 * 1). A lista que não veio diz a falta ("Não carregou", "Reconectando…" ou
 * "Sem conexão") no lugar do nome, com o ícone de tentar de novo no lugar da
 * seta, e o toque tenta de novo: sem a lista, o botão não diz que abre um
 * menu (sem `aria-haspopup`). Nos dois, o gatilho é o mesmo botão,
 * `aria-disabled` para o menu, e o foco não cai. No celular, o alvo tem 44 px.
 */
export function ActiveCustomerSwitcher({
  variant,
  canManageCustomers,
}: {
  variant: "v3" | "v3-cabecalho";
  canManageCustomers: boolean;
}) {
  const { options, active, setCode, isLoading, falhou, erro, tentar, tentando } = useActiveCustomer();
  const [aberto, setAberto] = useState(false);
  const tentarDeNovo = useTentarDeNovo();
  const textoDaFalta = useTextoDaFalta(erro);
  const pronto = !isLoading && !falhou;
  // A caixa no lugar da seta: na primeira leitura, aos 300 ms; na nova tentativa, também, e pelo menos 500 ms.
  const espera = useEspera(isLoading || tentando, { segurarMinimo: tentando });
  const template = active.profile.template;
  const rotulo = isLoading
    ? "Carregando o cliente ativo"
    : falhou
      ? `Cliente ativo: ${textoDaFalta.replace(/…$/, "")}. ${tentando ? "Tentando de novo" : "Tentar de novo"}`
      : `Cliente ativo: ${active.name}. Trocar cliente`;
  const v3 = variant === "v3";

  // O nome: o bloco enquanto a lista lê, a falta quando ela não veio, ou o cliente ativo.
  const nome: ReactNode = isLoading ? (
    <Esqueleto forma="texto" className={cn("block h-2.5 w-21", v3 ? "my-1.25" : "")} />
  ) : falhou ? (
    <span className={cn("block truncate", v3 ? "text-sm font-bold text-v3-header-foreground" : "")}>{textoDaFalta}</span>
  ) : (
    <span className={cn("block truncate", v3 ? "text-sm font-bold text-v3-header-foreground" : "")}>{active.name}</span>
  );
  const seta = espera.visivel ? (
    <Spinner tamanho={16} calmo={espera.calmo} className="shrink-0 text-v3-header-foreground" />
  ) : falhou ? (
    <RefreshCw className={cn("shrink-0", v3 ? "size-4 text-v3-header-foreground/70" : "size-3.5 opacity-70")} aria-hidden="true" />
  ) : (
    <ChevronsUpDown className={cn("shrink-0", v3 ? "size-4 text-v3-header-foreground/70" : "size-3.5 opacity-70")} aria-hidden="true" />
  );
  // Sem a lista, o toque tenta de novo: o botão não diz que abre um menu (o Radix o diz; aqui, por cima).
  const doMenu = falhou ? { "aria-haspopup": undefined, "aria-expanded": undefined } : {};

  const trigger = v3 ? (
    <DropdownMenuTrigger
      className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left outline-none transition-colors hover:bg-v3-header-foreground/10 focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80"
      aria-label={rotulo}
      aria-disabled={isLoading || tentando || undefined}
      aria-busy={espera.visivel || undefined}
      data-cliente-ativo={isLoading ? "carregando" : falhou ? "falhou" : "pronto"}
      {...doMenu}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-v3-header-foreground/15 text-v3-header-foreground">
        <Building2 className="size-4" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs font-semibold text-v3-header-foreground/65">Cliente ativo</span>
        {nome}
      </span>
      {seta}
    </DropdownMenuTrigger>
  ) : (
    <DropdownMenuTrigger
      className="flex h-11 min-w-0 max-w-full items-center gap-2 rounded-lg px-1.5 text-sm font-bold text-v3-header-foreground outline-none focus-visible:ring-2 focus-visible:ring-v3-header-foreground/80"
      aria-label={rotulo}
      aria-disabled={isLoading || tentando || undefined}
      aria-busy={espera.visivel || undefined}
      data-cliente-ativo={isLoading ? "carregando" : falhou ? "falhou" : "pronto"}
      {...doMenu}
    >
      <Building2 className="size-4 shrink-0" aria-hidden="true" />
      {nome}
      {seta}
    </DropdownMenuTrigger>
  );

  return (
    <DropdownMenu
      open={pronto && aberto}
      onOpenChange={(quer) => {
        if (!quer) {
          setAberto(false);
          return;
        }
        // Lendo, o menu não abre; sem a lista, o toque tenta de novo (acordando a conexão de quem lê).
        if (pronto) setAberto(true);
        else if (falhou && !tentando) tentarDeNovo(tentar);
      }}
    >
      {trigger}
      <DropdownMenuContent align="start" side="bottom" collisionPadding={16} className="v3 w-[300px]">
        <DropdownMenuLabel className="text-sm font-semibold">Cliente ativo</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {options.map((option) => {
          const selected = option.code === active.code;
          return (
            <DropdownMenuItem
              key={option.code}
              className="flex cursor-pointer items-start gap-2 py-2"
              onSelect={() => setCode(option.code)}
            >
              <Check className={cn("mt-0.5 h-4 w-4 shrink-0", selected ? "opacity-100" : "opacity-0")} />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{option.name}</span>
                <span className="block truncate text-xs text-muted-foreground">
                  {option.profile.template.label}
                  {option.profile.template.status === "building" ? " · em construção" : ""}
                  {option.paused ? " · pausado" : ""}
                </span>
              </span>
            </DropdownMenuItem>
          );
        })}
        <DropdownMenuSeparator />
        <div className="px-2 py-1.5 text-xs leading-5 text-muted-foreground">
          Modelo de {active.name}: {template.label} ({templateStatusLabel(template).toLowerCase()})
          {active.profile.pack ? ` · pacote ${active.profile.pack.key}` : ""}
        </div>
        {canManageCustomers ? (
          <DropdownMenuItem asChild>
            <Link href="/configuracoes/clientes" className="cursor-pointer">
              <Plus className="mr-2 h-4 w-4" />
              Cadastrar ou editar clientes
            </Link>
          </DropdownMenuItem>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
