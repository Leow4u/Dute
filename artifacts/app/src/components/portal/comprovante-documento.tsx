import { Campo, Secao } from "@/components/operacao/os-documento";
import { EMISSOR_DO_DOCUMENTO, NOME_DA_DUTELOG, cabecalhoDoEmissor, type Emissor } from "@/lib/comercial/emissor";
import type { ComprovanteDaOs } from "@/lib/portal/comprovante";

/**
 * O comprovante da OS concluída, via do cliente (parte 4.3d): o papel A4 no
 * molde da OS impressa (components/operacao/os-documento.tsx). O navegador
 * imprime só a área .print-area, e o cliente salva em PDF. É papel: fica
 * branco nos dois temas, por isso as cores fixas (PAPER_FILES em
 * lib/theme-colors.test.ts). Sem valor.
 */

export function ComprovanteDocumento({
  comprovante,
  urls,
  emissor = EMISSOR_DO_DOCUMENTO,
}: {
  comprovante: ComprovanteDaOs;
  /** A URL de cada arquivo do Storage (a assinatura e as fotos), pelo caminho. */
  urls: Readonly<Record<string, string>>;
  emissor?: Emissor;
}) {
  const cabecalho = cabecalhoDoEmissor(emissor);
  const { aceite } = comprovante;
  const urlDaAssinatura = aceite.assinatura ? (urls[aceite.assinatura] ?? null) : null;
  const fotos = comprovante.fotos.flatMap((caminho) => (urls[caminho] ? [{ caminho, url: urls[caminho] }] : []));
  return (
    <article
      aria-label={`Comprovante da OS ${comprovante.numero}`}
      className="print-area relative mx-auto flex w-[794px] max-w-none shrink-0 flex-col gap-3 overflow-hidden bg-white px-10 py-9 text-[12.5px] leading-[1.45] text-[#161616]"
    >
      <style>{"@media print { @page { size: A4; } }"}</style>

      <header className="flex items-start justify-between gap-6 border-b-[3px] border-[#E71C23] pb-3">
        <div className="flex flex-col gap-2">
          <img src="/dutelog-logo.png" alt={NOME_DA_DUTELOG} className="h-9 w-auto self-start" />
          <div>
            <b className="block text-[13px] font-extrabold">{cabecalho.nome}</b>
            {cabecalho.linha ? <span className="block text-[11px] font-semibold tabular-nums text-[#3F403F]">{cabecalho.linha}</span> : null}
          </div>
        </div>
        <div className="flex flex-col items-end gap-0.5 text-right">
          <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#5F6368]">Comprovante de execução</span>
          <h2 className="text-[28px] font-extrabold leading-none tabular-nums">OS {comprovante.numero}</h2>
          <span className="text-[12px] font-extrabold text-[#AD0015]">{comprovante.servicos}</span>
          <span className="text-[11px] font-semibold text-[#5F6368]">Concluída em {comprovante.concluidaEm}</span>
        </div>
      </header>

      <div className="flex gap-3">
        <Secao titulo="Cliente" className="flex-1">
          <div className="grid grid-cols-2 gap-2 px-3 py-2">
            <div className="col-span-2">
              <Campo rotulo="Cliente">{comprovante.cliente}</Campo>
            </div>
            <Campo rotulo="Demanda">{comprovante.demanda}</Campo>
          </div>
        </Secao>
        <Secao titulo="Execução" className="flex-1">
          <div className="grid gap-2 px-3 py-2">
            <Campo rotulo="Data e janela">{comprovante.janela ?? "—"}</Campo>
            <Campo rotulo="Motorista e veículo">{comprovante.motorista ?? "—"}</Campo>
          </div>
        </Secao>
      </div>

      <div className="flex gap-3">
        <Secao titulo="Origem" className="flex-1">
          <p className="px-3 py-2 font-bold">{comprovante.origem ?? "—"}</p>
        </Secao>
        <Secao titulo="Destino" className="flex-1">
          <p className="px-3 py-2 font-bold">{comprovante.destino ?? "—"}</p>
        </Secao>
      </div>

      <Secao titulo="Itens">
        <table className="w-full table-fixed border-collapse text-[12px]">
          <colgroup>
            <col />
            <col className="w-[64px]" />
            <col className="w-[84px]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[11px] font-extrabold text-[#3F403F]">
              <th className="border-b border-[#CFCFCB] px-2 py-[6px]">Item</th>
              <th className="border-b border-[#CFCFCB] px-2 py-[6px]">Unid.</th>
              <th className="border-b border-[#CFCFCB] px-2 py-[6px] text-right">Feito</th>
            </tr>
          </thead>
          <tbody>
            {comprovante.itens.map((item) => (
              <tr key={item.id} className="break-inside-avoid align-top font-semibold">
                <td className="break-words border-b border-[#E5E5E1] px-2 py-1.5">{item.item}</td>
                <td className="border-b border-[#E5E5E1] px-2 py-1.5">{item.unidade}</td>
                <td className="border-b border-[#E5E5E1] px-2 py-1.5 text-right tabular-nums">{item.feito}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Secao>

      <Secao titulo="Recebimento">
        <div className="flex items-end gap-6 px-3 py-3">
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex h-[60px] items-end border-b border-[#161616]">
              {urlDaAssinatura ? <img src={urlDaAssinatura} alt={`Assinatura de ${aceite.nome ?? "quem recebeu"}`} className="h-[56px] w-auto object-contain" /> : null}
            </div>
            <b className="text-[12px] font-extrabold">{aceite.nome ?? "—"}</b>
            {aceite.detalhe ? <span className="text-[11px] font-semibold text-[#3F403F]">{aceite.detalhe}</span> : null}
          </div>
        </div>
      </Secao>

      {fotos.length ? (
        <Secao titulo="Fotos do final">
          <ul className="grid grid-cols-3 gap-2 p-2">
            {fotos.map((foto, indice) => (
              <li key={foto.caminho} className="break-inside-avoid">
                <img src={foto.url} alt={`Foto do final ${indice + 1}`} className="aspect-[4/3] w-full rounded-[4px] object-cover" />
              </li>
            ))}
          </ul>
        </Secao>
      ) : null}

      <footer className="mt-auto flex justify-between border-t border-[#E5E5E1] pt-2 text-[10px] font-semibold text-[#5F6368]">
        <span>app.dutelog.com.br</span>
        <span className="tabular-nums">OS {comprovante.numero} · via do cliente</span>
      </footer>
    </article>
  );
}
