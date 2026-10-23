import { horaDe, type FichaDaOs, type VistoriaLida } from "@/lib/operacao/ficha-da-os";

/**
 * A vistoria enviada ao Comercial (parte 3.11a), só leitura: por ambiente, os
 * itens levantados e as fotos; as medidas, o acesso e as observações. É o
 * que a OS de vistoria mostra depois do envio, no celular e no escritório.
 * Sem valor e sem legenda.
 */

function quantidade(valor: string): string {
  return valor.replace(".", ",");
}

export function VistoriaEnviada({ vistoria, fotos, urls }: { vistoria: VistoriaLida; fotos: FichaDaOs["fotos"]; urls: Readonly<Record<string, string>> }) {
  const acesso: Array<[string, string]> = [
    ["Horário de carga", vistoria.acesso.horarioDeCarga ?? ""],
    ["Vaga de carga", vistoria.acesso.vagaDeCarga ?? ""],
  ].filter((linha): linha is [string, string] => Boolean(linha[1]));
  return (
    <div className="flex flex-col gap-4">
      <ul className="flex flex-col gap-3">
        {vistoria.ambientes.map((ambiente) => (
          <li key={ambiente.nome} className="flex flex-col gap-2 rounded-lg border border-border p-3">
            <h3 className="text-sm font-semibold text-foreground">{ambiente.nome}</h3>
            {ambiente.itens.length ? (
              <ul className="flex flex-col gap-1">
                {ambiente.itens.map((item) => (
                  <li key={item.lpuItemId} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="text-foreground">{item.item}</span>
                    <span className="shrink-0 font-semibold tabular-nums text-foreground">
                      {quantidade(item.quantidade)}
                      {item.unidade ? ` ${item.unidade.toLocaleLowerCase("pt-BR")}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : null}
            {ambiente.fotos.length ? (
              <ul className="grid grid-cols-4 gap-2">
                {ambiente.fotos.map((id) => {
                  const foto = fotos.find((gravada) => gravada.id === id);
                  const url = foto ? urls[foto.caminho] : undefined;
                  return (
                    <li key={id} className="relative aspect-square overflow-hidden rounded-md border border-border bg-muted">
                      {url && foto ? (
                        <img src={url} alt={`${ambiente.nome} · ${horaDe(foto.instante)}`} className="size-full object-cover" loading="lazy" />
                      ) : (
                        <span className="sr-only">{`${ambiente.nome} · foto`}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </li>
        ))}
      </ul>
      {vistoria.medidas.length || acesso.length ? (
        <dl className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
          {[...vistoria.medidas.map((medida): [string, string] => [medida.nome, medida.valor]), ...acesso].map(([rotulo, valor]) => (
            <div key={rotulo} className="contents">
              <dt className="text-muted-foreground">{rotulo}</dt>
              <dd className="font-semibold text-foreground">{valor}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {vistoria.observacoes ? <p className="whitespace-pre-line text-sm text-foreground">{vistoria.observacoes}</p> : null}
    </div>
  );
}
