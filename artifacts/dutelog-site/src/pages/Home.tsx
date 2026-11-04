import { contactHref, serviceHref } from "../content";
import {
  Arrow,
  Button,
  ClosingCta,
  Journal,
  Photo,
  TextLink,
} from "../components/ui";
import { Journey } from "../components/Journey";

export function HomePage() {
  return (
    <>
      <section className="home-hero" id="inicio">
        <div className="hero-photo">
          <Photo
            name="corporate"
            alt="Cena ilustrativa de uma mudança em ambiente corporativo"
            eager
          />
        </div>
        <div className="hero-shade" />
        <div className="container hero-content">
          <h1>
            Sua empresa muda.
            <br /> A gente
            <br /> <em>movimenta.</em>
          </h1>
          <div className="hero-bottom">
            <div>
              <p>
                Espaços, pessoas e operações em transformação.
                <br /> Logística Corporativa para cada novo capítulo.
              </p>
              <Button href={contactHref("logistica-corporativa")}>
                Planejar meu projeto
              </Button>
            </div>
            <a className="scroll-hint" href="#possibilidades">
              <span>Explore as possibilidades</span>
              <span className="scroll-line" />
            </a>
          </div>
        </div>
        <div className="hero-index">
          <span>01 / 03</span>
          <span>Logística Corporativa</span>
          <a href="/logistica-corporativa/">
            Conhecer <Arrow diagonal />
          </a>
        </div>
      </section>
      <section className="intro-section section" id="possibilidades">
        <div className="container">
          <div className="intro-top">
            <h2 className="reveal">
              Muito além
              <br /> de mudar
              <br /> <span className="muted-word">de endereço.</span>
            </h2>
            <div className="intro-note reveal">
              <span className="red-rule" />
              <p>
                Uma empresa está sempre em movimento. Entre salas, entre sedes,
                entre o que existe hoje e o que vem depois.
              </p>
              <p>
                A Dutelog conecta soluções de Logística Corporativa, Transporte
                de Cargas e Armazenagem.
              </p>
            </div>
          </div>
          <div className="intro-composition">
            <a className="intro-image" href="/logistica-corporativa/">
              <Photo
                name="detail"
                alt="Detalhe ilustrativo de identificação de equipamento protegido"
              />
              <span>
                O cuidado está nos detalhes. <Arrow diagonal />
              </span>
            </a>
            <div className="intro-links">
              <a href={serviceHref("mudanca-corporativa")}>
                <small>01 · Novos espaços</small>
                <h3>
                  Mudança
                  <br /> corporativa
                </h3>
                <Arrow diagonal />
              </a>
              <a href={serviceHref("inventario")}>
                <small>02 · Bens organizados</small>
                <h3>
                  Inventário
                  <br /> e mobiliário
                </h3>
                <Arrow diagonal />
              </a>
              <a href={serviceHref("transporte-de-tecnologias")}>
                <small>03 · Operações conectadas</small>
                <h3>
                  Tecnologia
                  <br /> e operações
                </h3>
                <Arrow diagonal />
              </a>
            </div>
          </div>
          <div className="section-end">
            <TextLink href="/logistica-corporativa/">
              Explore as 7 soluções corporativas
            </TextLink>
          </div>
        </div>
      </section>
      <Journey />
      <section className="section other-solutions" id="solucoes">
        <div className="container">
          <div className="section-heading">
            <h2 className="reveal">
              Uma operação.
              <br /> Mais possibilidades.
            </h2>
            <p>
              Da movimentação ao espaço para guardar.
              <br /> Encontre a solução para o seu momento.
            </p>
          </div>
          <div className="solution-pair">
            <a className="solution-photo" href="/transporte-de-cargas/">
              <Photo
                name="transport"
                alt="Caminhão em cena ilustrativa de transporte"
              />
              <div>
                <small>02 · Dedicado e Fracionado</small>
                <h3>
                  Transporte
                  <br /> de Cargas
                </h3>
                <span>
                  <Arrow diagonal />
                </span>
              </div>
            </a>
            <a className="solution-photo" href="/armazenagem/">
              <Photo name="storage" alt="Cena ilustrativa de armazenagem" />
              <div>
                <small>03 · Espaço e organização</small>
                <h3>Armazenagem</h3>
                <span>
                  <Arrow diagonal />
                </span>
              </div>
            </a>
          </div>
        </div>
      </section>
      <section className="about-band" id="empresa">
        <div className="container about-band-grid">
          <span className="section-label">A Dutelog</span>
          <h2>
            O que move
            <br /> a sua empresa
            <br /> <span>também nos move.</span>
          </h2>
          <div>
            <p>
              Um olhar para os bens.
              <br /> Outro para as pessoas e os espaços.
              <br /> Uma conversa para conectar tudo.
            </p>
            <TextLink href="/a-dutelog/">Conheça a Dutelog</TextLink>
          </div>
        </div>
      </section>
      <Journal />
      <ClosingCta />
    </>
  );
}
