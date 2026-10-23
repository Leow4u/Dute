import type { ReactNode } from "react";

/**
 * Layout da rota /tv (parte 3.12b): tela cheia, sem menu nem barra, sempre
 * escura, com a fonte da v3. O escuro vale só aqui dentro: a preferência de
 * tema de quem abre a TV para conferir não muda.
 */
export default function TvLayout({ children }: { children: ReactNode }) {
  return (
    <div className="v3">
      <div className="dark bg-background text-foreground">{children}</div>
    </div>
  );
}
