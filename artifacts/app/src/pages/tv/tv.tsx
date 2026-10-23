import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { chamarOperacao } from "@/lib/operacao/api";
import { RELEITURA_MS, RELOGIO_MS, painelDaTv, quadroLido } from "@/lib/tv/quadro";

import { TvView, type EstadoDaTv } from "./tv-view";

/**
 * A TV da sala (parte 3.12b): relê o quadro sozinha a cada 30 segundos e anda
 * o relógio a cada 15; sem conexão, segue com o último quadro. Pede ao
 * navegador para não apagar a tela, quando ele deixa.
 */

/**
 * Quantos cartões cabem numa coluna pela altura da janela: o cabeçalho, os
 * indicadores, o título da coluna, o "+ N OS" e o rodapé levam ~430 px; o
 * cartão mais alto (em execução), ~215 px com o espaço entre eles.
 */
export function cartoesPorColuna(altura: number): number {
  return Math.max(2, Math.floor((altura - 430) / 215));
}

function useAgora(intervalo: number): Date {
  const [agora, setAgora] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setAgora(new Date()), intervalo);
    return () => window.clearInterval(id);
  }, [intervalo]);
  return agora;
}

function useAltura(): number {
  const [altura, setAltura] = useState(() => (typeof window === "undefined" ? 1080 : window.innerHeight));
  useEffect(() => {
    const medir = () => setAltura(window.innerHeight);
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, []);
  return altura;
}

type Trava = { release: () => Promise<void> };

/** A tela não apaga enquanto a TV está aberta (Screen Wake Lock), onde o navegador permite. */
function useTelaAcesa() {
  useEffect(() => {
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (tipo: "screen") => Promise<Trava> } }).wakeLock;
    if (!wakeLock) return undefined;
    let trava: Trava | null = null;
    let ativo = true;
    const pedir = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const nova = await wakeLock.request("screen");
        if (ativo) trava = nova;
        else void nova.release();
      } catch {
        trava = null;
      }
    };
    void pedir();
    document.addEventListener("visibilitychange", pedir);
    return () => {
      ativo = false;
      document.removeEventListener("visibilitychange", pedir);
      void trava?.release().catch(() => undefined);
    };
  }, []);
}

export default function Tv() {
  const agora = useAgora(RELOGIO_MS);
  const altura = useAltura();
  useTelaAcesa();
  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const leitura = useQuery({
    queryKey: ["operacao", "tv"],
    queryFn: async () => {
      const quadro = quadroLido(await chamarOperacao("getRoomBoard", {}));
      if (!quadro) throw new Error("Quadro ilegível.");
      return quadro;
    },
    refetchInterval: RELEITURA_MS,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
    retry: 2,
  });
  const painel = useMemo(() => (leitura.data ? painelDaTv(leitura.data, agora) : null), [leitura.data, agora]);
  const estado: EstadoDaTv = leitura.data ? "pronto" : leitura.isError ? "erro" : "carregando";
  return (
    <TvView
      estado={estado}
      painel={painel}
      agora={agora}
      atualizadoEm={leitura.data?.geradoEm ?? null}
      semConexao={Boolean(leitura.data) && leitura.isError}
      porColuna={cartoesPorColuna(altura)}
      basePath={basePath}
    />
  );
}
