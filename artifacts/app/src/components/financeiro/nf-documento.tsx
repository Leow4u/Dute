import type { ReactNode } from "react";

import { EMISSOR_DO_DOCUMENTO, NOME_DA_DUTELOG, cabecalhoDoEmissor, type Emissor } from "@/lib/comercial/emissor";
import type { DemandaDoDemonstrativo, DemonstrativoDaNf } from "@/lib/financeiro/nf-documento";

/**
 * A via comercial da NF (parte 4.2d): o demonstrativo que acompanha a NF,
 * com o que foi cobrado em cada demanda. O navegador imprime só a área
 * .print-area (index.css), como a OS (components/operacao/os-documento.tsx)
 * e o orçamento do Comercial. É papel: fica branco nos dois temas, por isso
 * as cores fixas (PAPER_FILES em lib/theme-colors.test.ts). Tem valor: só
 * quem lê preço abre a tela.
 */

function Secao({ titulo, children, className }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={titulo} className={`break-inside-avoid overflow-hidden rounded-[6px] border border-[#CFCFCB] ${className ?? ""}`}>
      <h2 className="border-b border-[#CFCFCB] bg-[#F5F5F3] px-3 py-[5px] text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#3F403F]">{titulo}</h2>
      {children}
    </section>
  );
}

function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] font-bold leading-4 text-[#5F6368]">{rotulo}</span>
      <b className="block break-words text-[12.5px] font-bold leading-[18px]">{children}</b>
    </div>
  );
}

function Demanda({ demanda }: { demanda: DemandaDoDemonstrativo }) {
  const detalhes = [demanda.titulo, demanda.refCliente ? `Ref. ${demanda.refCliente}` : null, demanda.autorizacao].filter(Boolean).join(" · ");
  return (
    <Secao titulo={`Demanda ${demanda.rotulo}`}>
      {detalhes ? <p className="border-b border-[#E5E5E1] px-3 py-1.5 text-[12px] font-bold">{detalhes}</p> : null}
      <table className="w-full table-fixed border-collapse text-[12px]">
        <colgroup>
          <col />
          <col className="w-[52px]" />
          <col className="w-[60px]" />
          <col className="w-[92px]" />
          <col className="w-[100px]" />
        </colgroup>
        <thead>
          <tr className="text-left text-[11px] font-extrabold text-[#3F403F]">
            <th className="border-b border-[#CFCFCB] px-2 py-[6px]">Item</th>
            <th className="border-b border-[#CFCFCB] px-2 py-[6px]">Unid.</th>
            <th className="border-b border-[#CFCFCB] px-2 py-[6px] text-right">Qtde</th>
            <th className="border-b border-[#CFCFCB] px-2 py-[6px] text-right">Valor unit.</th>
            <th className="border-b border-[#CFCFCB] px-2 py-[6px] text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {demanda.linhas.map((linha) => (
            <tr key={linha.chave} className="break-inside-avoid align-top font-semibold">
              <td className="break-words border-b border-[#E5E5E1] px-2 py-1.5">{linha.item}</td>
              <td className="border-b border-[#E5E5E1] px-2 py-1.5">{linha.unidade}</td>
              <td className="border-b border-[#E5E5E1] px-2 py-1.5 text-right tabular-nums">{linha.quantidade}</td>
              <td className="border-b border-[#E5E5E1] px-2 py-1.5 text-right tabular-nums">{linha.valorUnitario}</td>
              <td className="border-b border-[#E5E5E1] px-2 py-1.5 text-right tabular-nums">{linha.total}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="font-extrabold">
            <td colSpan={4} className="px-2 py-[6px] text-right">
              Total da demanda
            </td>
            <td className="px-2 py-[6px] text-right tabular-nums">{demanda.total}</td>
          </tr>
        </tfoot>
      </table>
    </Secao>
  );
}

export function NfDocumento({ documento, emissor = EMISSOR_DO_DOCUMENTO }: { documento: DemonstrativoDaNf; emissor?: Emissor }) {
  const cabecalho = cabecalhoDoEmissor(emissor);
  return (
    <article
      aria-label={documento.titulo}
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
          <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#5F6368]">Demonstrativo de faturamento</span>
          <h1 className="text-[28px] font-extrabold leading-none tabular-nums">{documento.titulo}</h1>
          <span className="text-[12px] font-extrabold text-[#AD0015]">{documento.cliente}</span>
        </div>
      </header>

      <Secao titulo="Cobrança">
        <div className="grid grid-cols-4 gap-2 px-3 py-2">
          <Campo rotulo="Cliente">{documento.cliente}</Campo>
          {documento.campos.map((campo) => (
            <Campo key={campo.rotulo} rotulo={campo.rotulo}>
              {campo.valor}
            </Campo>
          ))}
        </div>
      </Secao>

      {documento.demandas.map((demanda) => (
        <Demanda key={demanda.numero} demanda={demanda} />
      ))}

      {documento.observacao ? (
        <Secao titulo="Observação">
          <p className="whitespace-pre-line px-3 py-2 text-[12px] font-semibold">{documento.observacao}</p>
        </Secao>
      ) : null}

      <div className="flex items-baseline justify-end gap-4 border-t-[2px] border-[#161616] pt-2">
        <span className="text-[13px] font-extrabold uppercase tracking-[0.08em]">Total da NF</span>
        <b className="text-[22px] font-extrabold tabular-nums">{documento.total}</b>
      </div>

      <footer className="mt-auto flex justify-between border-t border-[#E5E5E1] pt-2 text-[10px] font-semibold text-[#5F6368]">
        <span>app.dutelog.com.br</span>
        <span className="tabular-nums">{documento.titulo} · via comercial</span>
      </footer>
    </article>
  );
}
