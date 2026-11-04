import { useEffect, useRef, useState } from "react";
import { Arrow, Photo } from "./ui";
import type { ImageName } from "../content";

const steps: {
  title: string;
  text: string;
  image: ImageName;
  detail: string;
}[] = [
  {
    title: "Entender.",
    text: "Sua operação tem uma história. O primeiro passo é conhecer os espaços, os bens e as prioridades.",
    image: "detail",
    detail: "Cenário · Escopo · Prioridades",
  },
  {
    title: "Planejar.",
    text: "Uma visão do todo, com atenção a cada parte. Origem, destino e etapas conectados ao seu projeto.",
    image: "corporate",
    detail: "Ambientes · Sequência · Responsabilidades",
  },
  {
    title: "Movimentar.",
    text: "Cada item tem um destino. A movimentação ganha forma a partir do que foi combinado.",
    image: "transport",
    detail: "Proteção · Movimentação · Conferência",
  },
];
export function Journey() {
  const section = useRef<HTMLElement>(null),
    track = useRef<HTMLDivElement>(null),
    progress = useRef<HTMLElement>(null);
  const [current, setCurrent] = useState(1);
  const currentRef = useRef(1);
  useEffect(() => {
    const media = window.matchMedia(
      "(min-width: 900px) and (prefers-reduced-motion: no-preference)",
    );
    let frame = 0;
    const update = () => {
      frame = 0;
      if (!section.current || !track.current) return;
      section.current.classList.toggle("journey-animated", media.matches);
      if (!media.matches) {
        track.current.style.transform = "";
        return;
      }
      const rect = section.current.getBoundingClientRect();
      const available =
        section.current.offsetHeight - (window.innerHeight - 78);
      const position = Math.min(
        1,
        Math.max(0, (78 - rect.top) / Math.max(available, 1)),
      );
      const distance = Math.max(
        0,
        track.current.scrollWidth - window.innerWidth,
      );
      track.current.style.transform = `translate3d(${-position * distance}px,0,0)`;
      if (progress.current) progress.current.style.width = `${position * 100}%`;
      const step = Math.round(position * 2) + 1;
      if (currentRef.current !== step) {
        currentRef.current = step;
        setCurrent(step);
      }
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    media.addEventListener("change", schedule);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      media.removeEventListener("change", schedule);
    };
  }, []);
  const move = (direction: number) => {
    if (!section.current) return;
    const target = Math.min(3, Math.max(1, current + direction));
    const start =
      section.current.getBoundingClientRect().top + window.scrollY - 78;
    const length = section.current.offsetHeight - (window.innerHeight - 78);
    window.scrollTo({
      top: start + length * ((target - 1) / 2),
      behavior: "smooth",
    });
  };
  return (
    <section className="journey" ref={section}>
      <div className="journey-sticky">
        <div className="container">
          <div className="journey-heading">
            <div>
              <span className="section-label">
                Do primeiro detalhe ao próximo espaço
              </span>
              <h2>
                Todo movimento
                <br /> começa com um plano.
              </h2>
            </div>
            <p>
              Entender o cenário. Conectar as etapas.
              <br /> Definir o que precisa acontecer.
            </p>
          </div>
        </div>
        <div className="journey-window">
          <div className="journey-track" ref={track}>
            {steps.map((step, i) => (
              <article className="journey-card" key={step.title}>
                <Photo
                  name={step.image}
                  alt={`Cena ilustrativa da etapa ${step.title}`}
                />
                <div className="journey-overlay" />
                <span className="journey-number">0{i + 1}</span>
                <div className="journey-copy">
                  <h3>{step.title}</h3>
                  <p>{step.text}</p>
                  <span>{step.detail}</span>
                </div>
              </article>
            ))}
          </div>
        </div>
        <div className="container journey-controls">
          <div className="journey-meter">
            <span>0{current}</span>
            <div>
              <i ref={progress} />
            </div>
            <span>03</span>
          </div>
          <div className="journey-arrows">
            <button
              onClick={() => move(-1)}
              disabled={current === 1}
              aria-label="Etapa anterior"
            >
              <Arrow />
            </button>
            <button
              onClick={() => move(1)}
              disabled={current === 3}
              aria-label="Próxima etapa"
            >
              <Arrow />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
