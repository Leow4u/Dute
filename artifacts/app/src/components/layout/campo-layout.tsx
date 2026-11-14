import { useEffect, useRef, type ReactNode } from "react";
import { CloudOff, X } from "lucide-react";
import { Link, useLocation } from "wouter";

import { AccountMenu } from "@/components/layout/account-menu";
import { Spinner } from "@/components/ui/spinner";
import { useAppAuth, useAppUser } from "@/lib/auth";
import { useAnuncio } from "@/lib/carregando/anunciador";
import { useEspera } from "@/lib/carregando/use-espera";
import { FilaDoCampoProvider, useFilaDoCampo } from "@/lib/campo/fila-do-campo";
import { ROTA_CAMPO } from "@/lib/campo/navegacao";
import { rememberReturnPath } from "@/lib/settings-nav";
import { cn } from "@/lib/utils";

/**
 * Layout das rotas /campo (parte 3.8b): o celular da equipe, sem barra
 * lateral. No topo, o aviso da fila quando há registro esperando ou sem
 * sinal ("Sem sinal · 4 registros guardados"), e as falhas que a callable
 * recusou. É dado, não legenda.
 *
 * Enviando o que a fila guardou, a caixa do carregamento gira no lugar do
 * ícone (parte 13g), no relógio da espera: o registro que vai na hora (com
 * sinal, cada toque passa uns milissegundos na fila) não mostra a faixa nem
 * fala; a que envia mostra a faixa aos 300 ms, por pelo menos 500 ms, e a
 * volta calma depois de 10 s. Quando o sinal volta, a faixa "Sem sinal" fica
 * até o envio aparecer, sem piscar entre uma e outra. A faixa não é região
 * viva: o Anunciador diz uma vez, quando ela aparece, que a fila envia, e
 * retira o anúncio que ainda esperava a vez se o envio acabou antes; a falta
 * de sinal ele já diz ("Sem conexão").
 */

function AvisoDaFila() {
  const { aviso, online, falhas, dispensarFalha } = useFilaDoCampo();
  const enviando = aviso !== null && online;
  const espera = useEspera(enviando, { segurarMinimo: true });
  // O texto da faixa enquanto ela segura o mínimo de 500 ms depois do envio.
  const textoDoEnvio = useRef<string | null>(null);
  if (enviando) textoDoEnvio.current = aviso;
  // A faixa "Sem sinal" que estava na tela fica até o envio aparecer (ou acabar antes dos 300 ms).
  const semSinal = useRef<string | null>(null);
  if (aviso !== null && !online) semSinal.current = aviso;
  else if (!enviando || espera.visivel) semSinal.current = null;
  const anunciar = useAnuncio();
  useEffect(() => {
    if (!espera.visivel) return undefined;
    return anunciar("Enviando os registros guardados");
  }, [espera.visivel, anunciar]);
  const faixa = espera.visivel ? { texto: textoDoEnvio.current, online: true } : semSinal.current ? { texto: semSinal.current, online: false } : null;
  return (
    <>
      {faixa ? (
        <p
          className={cn(
            "flex items-center justify-center gap-2 px-4 py-2 text-sm font-semibold",
            faixa.online ? "bg-info-soft text-info-soft-foreground" : "bg-amber-soft text-amber-soft-foreground",
          )}
        >
          {faixa.online ? <Spinner calmo={espera.calmo} /> : <CloudOff aria-hidden="true" className="size-4" />}
          {faixa.texto}
        </p>
      ) : null}
      {falhas.map((falha) => (
        <div key={falha.chave} role="alert" className="flex items-start gap-2 bg-destructive-soft px-4 py-2 text-sm text-destructive-soft-foreground">
          <span className="min-w-0 flex-1">
            <span className="font-semibold">{falha.rotulo}</span> · {falha.mensagem}
          </span>
          <button type="button" aria-label={`Dispensar ${falha.rotulo}`} onClick={() => dispensarFalha(falha.chave)} className="flex size-6 shrink-0 items-center justify-center rounded hover:bg-background/40">
            <X aria-hidden="true" className="size-4" />
          </button>
        </div>
      ))}
    </>
  );
}

export default function CampoLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useAppUser();
  const { signOut } = useAppAuth();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    rememberReturnPath(`${location}${window.location.search}`);
  }, [location]);

  return (
    <FilaDoCampoProvider>
      <div className="flex min-h-dvh flex-col bg-background">
        <header className="sticky top-0 z-20 border-b border-border bg-card">
          <div className="mx-auto flex h-14 w-full max-w-xl items-center justify-between gap-3 px-4">
            <Link href={ROTA_CAMPO} className="flex items-center gap-2 rounded focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-foco">
              <img src={`${basePath}/dutelog-mark-180.png`} alt="" aria-hidden="true" className="size-8 rounded-lg" />
              <span className="text-base font-bold text-foreground">Minhas OS</span>
            </Link>
            <AccountMenu basePath={basePath} compact cabecalho variante="v3" signOut={signOut} user={user} />
          </div>
          <AvisoDaFila />
        </header>
        <main className="mx-auto w-full max-w-xl flex-1 px-4 py-5">{children}</main>
      </div>
    </FilaDoCampoProvider>
  );
}
