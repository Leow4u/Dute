import { AvisoDeEspera } from "@/components/ui/aviso-de-espera";
import { Progresso } from "@/components/ui/progresso";
import { restanteDoEnvio, type EnvioDeFotos } from "@/lib/carregando/use-envio-de-fotos";
import { useEspera } from "@/lib/carregando/use-espera";
import { cn } from "@/lib/utils";

/** "4 fotos enviadas". */
export function fotosEnviadas(n: number): string {
  return n === 1 ? "1 foto enviada" : `${n} fotos enviadas`;
}

/**
 * O progresso das fotos que sobem (carregamento v2, parte 11 e momento 6):
 * o `Progresso` de contagem e, aos 10 s, "Demorando mais que o normal · 0:12
 * · cerca de 20 s". Na escrita, sem "Tentar de novo": a foto que para 70 s
 * sem um byte novo fica "não enviada", com o dela. O `aviso` é o da escolha
 * que passou do limite ("Só 4 fotos sobem por vez.").
 */
export function ProgressoDasFotos<T>({ fotos, aviso, className }: { fotos: EnvioDeFotos<T>; aviso?: string | null; className?: string }) {
  // O envio que anda não desiste pelo relógio: quem desiste é a foto parada.
  const espera = useEspera(fotos.enviando, { desisteMs: Number.POSITIVE_INFINITY });
  if (fotos.itens.length === 0 && !aviso) return null;
  const feitas = fotos.itens.filter((item) => item.estado === "feito").length;
  return (
    <div data-fotos-enviando="" className={cn("grid gap-3", className)}>
      {aviso ? <p className="text-sm font-bold text-amber-soft-foreground">{aviso}</p> : null}
      <Progresso
        forma="contagem"
        titulo="Enviando fotos"
        concluido={fotosEnviadas(feitas)}
        itens={fotos.itens.map((item, indice) => ({
          rotulo: `Foto ${indice + 1}`,
          estado: item.estado,
          fracao: item.fracao,
          miniatura: item.miniatura,
          onTentar: item.estado === "erro" ? () => fotos.tentarDeNovo(item.chave) : undefined,
        }))}
      />
      {fotos.enviando && espera.calmo ? (
        <AvisoDeEspera fase="demorando" tipo="escrita" desdeMs={espera.decorridoMs} restanteMs={restanteDoEnvio(fotos.itens, espera.decorridoMs)} />
      ) : null}
    </div>
  );
}
