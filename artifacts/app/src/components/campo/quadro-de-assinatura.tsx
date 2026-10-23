import { useEffect, useRef, useState } from "react";
import { Pencil } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * O quadro em que o responsável do cliente assina com o dedo (parte 3.9b;
 * docs/mockups/Campo2Concluir.dc.html). Na tela, o traço tem a cor do texto
 * do tema (claro ou escuro); cada traço termina exportando a imagem em PNG
 * com tinta escura no fundo branco, como no papel, que é a mesma imagem da
 * impressão da OS. Um toque sem traço não conta. Limpar é desenhar de novo.
 * O quadro não rola a página enquanto se assina.
 */

/** A tinta e o papel da imagem exportada (não do quadro na tela). */
const TINTA = "#161616";
const PAPEL = "#ffffff";

/** A assinatura em tinta escura sobre branco, do tamanho do quadro. */
function noPapel(quadro: HTMLCanvasElement): HTMLCanvasElement | null {
  const tinta = document.createElement("canvas");
  const papel = document.createElement("canvas");
  tinta.width = papel.width = quadro.width;
  tinta.height = papel.height = quadro.height;
  const comTinta = tinta.getContext("2d");
  const comPapel = papel.getContext("2d");
  if (!comTinta || !comPapel) return null;
  // O traço vira máscara: só onde há traço fica a tinta.
  comTinta.fillStyle = TINTA;
  comTinta.fillRect(0, 0, tinta.width, tinta.height);
  comTinta.globalCompositeOperation = "destination-in";
  comTinta.drawImage(quadro, 0, 0);
  comPapel.fillStyle = PAPEL;
  comPapel.fillRect(0, 0, papel.width, papel.height);
  comPapel.drawImage(tinta, 0, 0);
  return papel;
}

export function QuadroDeAssinatura({
  id,
  assinada,
  rotulo,
  limpar,
  onAssinatura,
}: {
  id: string;
  assinada: boolean;
  /** Quem assina, para o leitor de tela: "Assinatura de Renata Campos". */
  rotulo: string;
  /** Muda a cada "Limpar": o quadro volta em branco. */
  limpar: number;
  onAssinatura: (assinatura: Blob | null) => void;
}) {
  const quadro = useRef<HTMLCanvasElement | null>(null);
  const desenhando = useRef(false);
  const tracou = useRef(false);
  const ultimo = useRef<{ x: number; y: number } | null>(null);
  const [emBranco, setEmBranco] = useState(true);

  // O tamanho real do quadro na tela (e a densidade do aparelho), em branco.
  useEffect(() => {
    const canvas = quadro.current;
    const contexto = canvas?.getContext("2d");
    setEmBranco(true);
    if (!canvas || !contexto) return;
    const escala = window.devicePixelRatio || 1;
    const { width, height } = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.round(width * escala));
    canvas.height = Math.max(1, Math.round(height * escala));
    contexto.setTransform(escala, 0, 0, escala, 0, 0);
    contexto.clearRect(0, 0, width, height);
    contexto.lineWidth = 2.4;
    contexto.lineCap = "round";
    contexto.lineJoin = "round";
    contexto.strokeStyle = getComputedStyle(canvas).color || TINTA;
  }, [limpar]);

  function ponto(evento: React.PointerEvent<HTMLCanvasElement>) {
    const caixa = evento.currentTarget.getBoundingClientRect();
    return { x: evento.clientX - caixa.left, y: evento.clientY - caixa.top };
  }

  function parar() {
    desenhando.current = false;
    ultimo.current = null;
  }

  return (
    <div className="relative">
      <canvas
        id={id}
        ref={quadro}
        role="img"
        aria-label={assinada ? rotulo : "Quadro de assinatura em branco"}
        className={cn("block h-36 w-full cursor-crosshair touch-none rounded-lg border-2 bg-card text-foreground", assinada ? "border-border" : "border-dashed border-input")}
        onPointerDown={(evento) => {
          evento.currentTarget.setPointerCapture(evento.pointerId);
          desenhando.current = true;
          tracou.current = false;
          setEmBranco(false);
          ultimo.current = ponto(evento);
        }}
        onPointerMove={(evento) => {
          const contexto = quadro.current?.getContext("2d");
          if (!desenhando.current || !contexto || !ultimo.current) return;
          const atual = ponto(evento);
          contexto.beginPath();
          contexto.moveTo(ultimo.current.x, ultimo.current.y);
          contexto.lineTo(atual.x, atual.y);
          contexto.stroke();
          tracou.current = true;
          ultimo.current = atual;
        }}
        onPointerUp={() => {
          if (!desenhando.current) return;
          parar();
          const imagem = tracou.current && quadro.current ? noPapel(quadro.current) : null;
          imagem?.toBlob((arquivo) => onAssinatura(arquivo), "image/png");
        }}
        onPointerCancel={parar}
      />
      {assinada || !emBranco ? null : (
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 text-sm font-semibold text-muted-foreground">
          <Pencil className="size-4" />
          Assinar aqui
        </span>
      )}
    </div>
  );
}
