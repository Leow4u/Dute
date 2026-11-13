import { useRef } from "react";

import { AvisoDeEspera } from "@/components/ui/aviso-de-espera";
import { Progresso } from "@/components/ui/progresso";
import { estimativaEstavel, restanteDoEnvio, restanteExibido, type EnvioDeFotos, type EstimativaNaTela } from "@/lib/carregando/use-envio-de-fotos";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";

/** "4 fotos enviadas". */
export function fotosEnviadas(n: number): string {
  return n === 1 ? "1 foto enviada" : `${n} fotos enviadas`;
}

/** "2 fotos não enviadas": o fim da vez em que nenhuma subiu. */
export function fotosNaoEnviadas(n: number): string {
  return n === 1 ? "1 foto não enviada" : `${n} fotos não enviadas`;
}

/**
 * O progresso das fotos que sobem (carregamento v2, parte 11 e momento 6):
 * o `Progresso` de contagem e, aos 10 s, "Demorando mais que o normal · 0:12
 * · cerca de 20 s". O lugar do aviso fica guardado enquanto há fotos na
 * lista, para ele entrar sem empurrar o que está embaixo (a prancha guarda
 * os 44 px). A estimativa conta para baixo sem piscar e sai quando a foto
 * que sobe está há 10 s sem um byte novo. Na escrita, sem "Tentar de novo":
 * a foto que para 70 s sem um byte novo fica "não enviada", com o dela. O
 * `aviso` é o da escolha que passou do limite ("Só 4 fotos sobem por vez.").
 */
export function ProgressoDasFotos<T>({ fotos, aviso, className }: { fotos: EnvioDeFotos<T>; aviso?: string | null; className?: string }) {
  // O envio que anda não desiste pelo relógio: quem desiste é a foto parada.
  const espera = useEspera(fotos.enviando, { desisteMs: Number.POSITIVE_INFINITY });
  const estimativa = useRef<EstimativaNaTela | null>(null);
  const demorando = fotos.enviando && espera.calmo;
  const conta = demorando ? restanteDoEnvio(fotos.itens, espera.decorridoMs, performance.now()) : undefined;
  estimativa.current = estimativaEstavel(estimativa.current, conta, espera.decorridoMs);
  if (fotos.itens.length === 0 && !aviso) return null;
  const feitas = fotos.itens.filter((item) => item.estado === "feito").length;
  const falhas = fotos.itens.filter((item) => item.estado === "erro").length;
  return (
    <div data-fotos-enviando="" className={cn("grid gap-3", className)}>
      {aviso ? <p className="text-sm font-bold text-amber-soft-foreground">{aviso}</p> : null}
      <Progresso
        forma="contagem"
        titulo="Enviando fotos"
        concluido={feitas > 0 || falhas === 0 ? fotosEnviadas(feitas) : fotosNaoEnviadas(falhas)}
        itens={fotos.itens.map((item, indice) => ({
          rotulo: `Foto ${indice + 1}`,
          estado: item.estado,
          fracao: item.fracao,
          miniatura: item.miniatura,
          onTentar: item.estado === "erro" ? () => fotos.tentarDeNovo(item.chave) : undefined,
        }))}
      />
      {fotos.itens.length ? (
        <div data-lugar-do-aviso="" className="grid min-h-9 items-center max-sm:min-h-14">
          {demorando ? (
            <AvisoDeEspera fase="demorando" tipo="escrita" desdeMs={espera.decorridoMs} restanteMs={restanteExibido(estimativa.current, espera.decorridoMs)} />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
