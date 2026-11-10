import type { ReactNode } from "react";

import { cssDaFolha } from "@/features/warehouse-ops/lista-de-separacao-documento";
import type { FolhaDoRomaneio } from "@/lib/warehouse-ops/romaneio";
import { pesoDoVolume } from "@/lib/warehouse-ops/volumes-do-pedido";

/**
 * O romaneio impresso (separação com caixas, parte 4c;
 * docs/mockups/WmsSepararRomaneio.dc.html): o papel que acompanha o pedido,
 * com o conteúdo de cada volume, o código do cliente, a quantidade e o peso,
 * o lacre e o total de volumes. Vai ao cliente: não cita caixa, posição nem
 * valor. O navegador imprime só a área .print-area (index.css), como a lista
 * de separação. É papel: fica branco nos dois temas, por isso as cores fixas
 * (PAPER_FILES em lib/theme-colors.test.ts).
 *
 * O pedido grande passa de uma folha: o cabeçalho da tabela se repete em cada
 * página, a linha não se parte, e o volume pequeno não se divide entre duas
 * folhas. O número e o peso do volume vêm na primeira linha dele; as outras
 * ficam em branco nessas colunas, para o volume grande quebrar de página sem
 * célula partida. O rodapé de cada página ("PED-0001 · página 1 de 2") vem
 * das caixas de margem do @page.
 */

const numero = new Intl.NumberFormat("pt-BR");

/** O volume com até estas linhas fica inteiro numa folha; o maior quebra onde a folha acabar. */
export const LINHAS_DO_VOLUME_INTEIRO = 12;

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-[9.5px] font-bold uppercase leading-4 tracking-[0.04em] text-[#5F6368]">{rotulo}</span>
      <b className="block break-words text-[12.5px] font-bold leading-[18px]">{children}</b>
    </div>
  );
}

const TH = "border-b-[1.5px] border-[#161616] p-1.5 text-left text-[9.5px] font-extrabold uppercase tracking-[0.06em] text-[#5F6368]";
const TD = "px-1.5 py-1 align-top text-[11px]";
/** A última linha do volume fecha com o traço forte; as outras, com o fino (nas colunas do volume e do peso, sem traço). */
const FIM = "border-b-[1.5px] border-[#161616]";
const MEIO = "border-b border-[#E5E5E1]";

export function RomaneioDocumento({ folha }: { folha: FolhaDoRomaneio }) {
  return (
    <article
      aria-label={`Romaneio ${folha.numero}`}
      className="print-area mx-auto flex w-[794px] max-w-none shrink-0 flex-col gap-3 bg-white px-10 py-[34px] text-[12px] leading-[1.4] text-[#161616]"
    >
      <style>{cssDaFolha(folha.numero)}</style>

      <header className="flex items-end justify-between gap-4 border-b-[3px] border-[#E71C23] pb-2.5">
        <img src="/dutelog-logo.png" alt="Dutelog" className="h-9 w-auto" />
        <div className="text-right">
          <span className="block text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#5F6368]">Romaneio</span>
          <h1 className="text-[30px] font-extrabold leading-[1.05] tabular-nums">{folha.numero}</h1>
        </div>
      </header>

      <div className="grid grid-cols-4 gap-x-3.5 gap-y-2">
        <Campo rotulo="Cliente">{folha.cliente || "—"}</Campo>
        <Campo rotulo="Destino">{folha.destino || "—"}</Campo>
        <Campo rotulo="Para quando">{folha.paraQuando || "—"}</Campo>
        <Campo rotulo="Lacre">{folha.lacre || "—"}</Campo>
        <Campo rotulo="Volumes">{numero.format(folha.volumes.length)}</Campo>
        <Campo rotulo="Unidades">{numero.format(folha.unidades)}</Campo>
        <Campo rotulo="Separado">{folha.separado || "—"}</Campo>
        <Campo rotulo="Por">{folha.por || "—"}</Campo>
      </div>

      <table className="w-full table-fixed border-collapse">
        <colgroup>
          <col className="w-[56px]" />
          <col />
          <col className="w-[170px]" />
          <col className="w-[60px]" />
          <col className="w-[110px]" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col" className={TH}>
              Volume
            </th>
            <th scope="col" className={TH}>
              Conteúdo
            </th>
            <th scope="col" className={TH}>
              Código
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Qtd.
            </th>
            <th scope="col" className={`${TH} text-right`}>
              Peso
            </th>
          </tr>
        </thead>
        {folha.volumes.map((volume) => {
          // O volume sem conteúdo lido (o volume único de antes) sai com as unidades dele.
          const itens = volume.itens.length ? volume.itens : [{ nome: "—", codigo: "", quantidade: volume.unidades }];
          return (
            <tbody key={volume.id} className={itens.length <= LINHAS_DO_VOLUME_INTEIRO ? "break-inside-avoid" : undefined}>
              {itens.map((item, indice) => {
                const borda = indice === itens.length - 1 ? FIM : MEIO;
                const lateral = indice === itens.length - 1 ? FIM : "";
                return (
                  <tr key={`${item.codigo}-${item.nome}`} className="break-inside-avoid">
                    {indice === 0 ? (
                      <th scope="rowgroup" className={`${TD} ${lateral} text-left text-[14px] font-extrabold tabular-nums`}>
                        {numero.format(volume.numero)}
                      </th>
                    ) : (
                      <td className={`${TD} ${lateral}`} />
                    )}
                    <td className={`${TD} ${borda} break-words text-[12px] font-semibold`}>{item.nome}</td>
                    <td className={`${TD} ${borda} whitespace-nowrap`}>{item.codigo}</td>
                    <td className={`${TD} ${borda} text-right text-[12px] font-extrabold tabular-nums`}>{numero.format(item.quantidade)}</td>
                    <td className={`${TD} ${lateral} whitespace-nowrap text-right font-bold tabular-nums`}>{indice === 0 ? pesoDoVolume(volume.pesoKg) : null}</td>
                  </tr>
                );
              })}
            </tbody>
          );
        })}
      </table>

      {/* Na impressão, o rodapé de cada página é o das caixas de margem. */}
      <footer className="no-print flex justify-between border-t border-[#E5E5E1] pt-2 text-[9.5px] font-semibold text-[#5F6368]">
        <span>app.dutelog.com.br</span>
        <span className="tabular-nums">{folha.numero}</span>
      </footer>
    </article>
  );
}
