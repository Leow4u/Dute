import type { ReactNode } from "react";

import { EMISSOR_DO_DOCUMENTO, NOME_DA_DUTELOG, cabecalhoDoEmissor, type Emissor } from "@/lib/comercial/emissor";
import type { DocumentoDaOs, LocalNoDocumento } from "@/lib/operacao/os-documento";

/**
 * A OS impressa, via operacional (parte 3.9d; docs/mockups/OSImpressao.dc.html):
 * o papel que a equipe leva ao local. O navegador imprime só a área
 * .print-area (index.css), como o orçamento do Comercial
 * (components/comercial/orcamento-documento.tsx). É papel: fica branco nos
 * dois temas, por isso as cores fixas (PAPER_FILES em lib/theme-colors.test.ts).
 * Sem valor.
 */

/** Uma seção do papel, com o título na faixa cinza. Também no comprovante do portal (parte 4.3d). */
export function Secao({ titulo, children, className }: { titulo: string; children: ReactNode; className?: string }) {
  return (
    <section aria-label={titulo} className={`break-inside-avoid overflow-hidden rounded-[6px] border border-[#CFCFCB] ${className ?? ""}`}>
      <h2 className="border-b border-[#CFCFCB] bg-[#F5F5F3] px-3 py-[5px] text-[11px] font-extrabold uppercase tracking-[0.08em] text-[#3F403F]">{titulo}</h2>
      {children}
    </section>
  );
}

export function Campo({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <span className="block text-[11px] font-bold leading-4 text-[#5F6368]">{rotulo}</span>
      <b className="block break-words text-[12.5px] font-bold leading-[18px]">{children}</b>
    </div>
  );
}

function Local({ titulo, local }: { titulo: string; local: LocalNoDocumento | null }) {
  return (
    <Secao titulo={titulo} className="flex-1">
      <div className="flex flex-col gap-2 px-3 py-2">
        <Campo rotulo="Endereço">{local?.endereco ?? "—"}</Campo>
        <Campo rotulo="Contato no local">{local?.contato ?? "—"}</Campo>
      </div>
    </Secao>
  );
}

function Assinatura({ rotulo, nome, detalhe, imagem }: { rotulo: string; nome: string; detalhe: string; imagem?: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-1 flex-col gap-1">
      <div className="flex h-[60px] items-end justify-center border-b border-[#161616]">{imagem}</div>
      <b className="text-[12px] font-extrabold">{rotulo}</b>
      <span className="text-[11px] font-semibold text-[#3F403F]">
        {nome} · {detalhe}
      </span>
    </div>
  );
}

export function OsDocumento({ documento, urlDaAssinatura, emissor = EMISSOR_DO_DOCUMENTO }: { documento: DocumentoDaOs; urlDaAssinatura: string | null; emissor?: Emissor }) {
  const cabecalho = cabecalhoDoEmissor(emissor);
  const aceite = documento.aceite;
  return (
    <article
      aria-label={`OS ${documento.numero}`}
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
          <span className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-[#5F6368]">Ordem de serviço</span>
          <h1 className="text-[28px] font-extrabold leading-none tabular-nums">Nº {documento.numero}</h1>
          {documento.servicos ? <span className="text-[12px] font-extrabold text-[#AD0015]">{documento.servicos}</span> : null}
          <span className="text-[11px] font-semibold text-[#5F6368]">{documento.emissao}</span>
        </div>
      </header>

      <div className="flex gap-3">
        <Secao titulo="Cliente" className="flex-[1.2]">
          <div className="grid grid-cols-2 gap-2 px-3 py-2">
            <div className="col-span-2">
              <Campo rotulo="Cliente">{documento.cliente}</Campo>
            </div>
            <Campo rotulo="Demanda">{documento.demanda}</Campo>
            {documento.titulo ? <Campo rotulo="Pedido">{documento.titulo}</Campo> : null}
          </div>
        </Secao>
        <Secao titulo="Agendamento e equipe" className="flex-1">
          <div className="grid grid-cols-2 gap-2 px-3 py-2">
            <div className="col-span-2">
              <Campo rotulo="Data e janela">{documento.janela ?? "—"}</Campo>
            </div>
            <div className="col-span-2">
              <Campo rotulo="Equipe">{documento.equipe.length ? documento.equipe.join(", ") : "—"}</Campo>
            </div>
            <div className="col-span-2">
              <Campo rotulo="Veículos">{documento.veiculos.length ? documento.veiculos.join(", ") : "—"}</Campo>
            </div>
          </div>
        </Secao>
      </div>

      <div className="flex gap-3">
        <Local titulo="Origem" local={documento.origem} />
        <Local titulo="Destino" local={documento.destino} />
      </div>

      <Secao titulo="Itens">
        <table className="w-full table-fixed border-collapse text-[12px]">
          <colgroup>
            <col className="w-[56px]" />
            <col />
            <col className="w-[52px]" />
            <col className="w-[76px]" />
            <col className="w-[76px]" />
          </colgroup>
          <thead>
            <tr className="text-left text-[11px] font-extrabold text-[#3F403F]">
              <th className="border-b border-[#CFCFCB] px-2 py-[6px]">Código</th>
              <th className="border-b border-[#CFCFCB] px-2 py-[6px]">Item</th>
              <th className="border-b border-[#CFCFCB] px-2 py-[6px]">Unid.</th>
              <th className="border-b border-[#CFCFCB] px-2 py-[6px] text-right">Previsto</th>
              <th className="border-b border-[#CFCFCB] px-2 py-[6px] text-right">Feito</th>
            </tr>
          </thead>
          <tbody>
            {documento.itens.map((item) => (
              <tr key={item.id} className="break-inside-avoid align-top font-semibold">
                <td className="border-b border-[#E5E5E1] px-2 py-1.5 tabular-nums text-[#3F403F]">{item.codigo ?? ""}</td>
                <td className="break-words border-b border-[#E5E5E1] px-2 py-1.5">{item.item}</td>
                <td className="border-b border-[#E5E5E1] px-2 py-1.5">{item.unidade}</td>
                <td className="border-b border-[#E5E5E1] px-2 py-1.5 text-right tabular-nums">{item.previsto}</td>
                <td className="border-b border-[#E5E5E1] px-2 py-1.5 text-right tabular-nums">{item.feito ?? <span aria-hidden="true" className="inline-block w-12 border-b border-[#8A8A86]" />}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Secao>

      {documento.instrucoes ? (
        <Secao titulo="Instruções">
          <p className="whitespace-pre-line px-3 py-2 text-[12px] font-semibold">{documento.instrucoes}</p>
        </Secao>
      ) : null}

      <div className="mt-auto flex gap-7 pt-6">
        <Assinatura rotulo="Líder Dutelog" nome={documento.lider ?? "______________"} detalhe="data ____/____/______" />
        <Assinatura rotulo="Motorista" nome={documento.motorista ?? "______________"} detalhe="CNH ______________" />
        {aceite ? (
          <Assinatura
            rotulo={aceite.semAceite ? "Sem aceite no local" : "Cliente / recebedor"}
            nome={aceite.nome}
            detalhe={aceite.detalhe}
            imagem={urlDaAssinatura ? <img src={urlDaAssinatura} alt={`Assinatura de ${aceite.nome}`} className="h-[56px] w-auto object-contain" /> : null}
          />
        ) : (
          <Assinatura rotulo="Cliente / recebedor" nome="Nome ______________" detalhe="Doc. ______________ · ___:___" />
        )}
      </div>

      <footer className="flex justify-between border-t border-[#E5E5E1] pt-2 text-[10px] font-semibold text-[#5F6368]">
        <span>app.dutelog.com.br</span>
        <span className="tabular-nums">OS {documento.numero} · via operacional</span>
      </footer>
    </article>
  );
}
