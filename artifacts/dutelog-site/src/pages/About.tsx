import { Breadcrumbs, ClosingCta, Photo, TextLink } from "../components/ui";

export function AboutPage() {
  return (
    <>
      <Breadcrumbs items={[{ label: "A Dutelog" }]} />
      <section className="about-intro container">
        <h1>
          O que move a sua empresa
          <br />
          <span className="muted-word">também nos move.</span>
        </h1>
        <div className="about-collage">
          <div className="about-image">
            <Photo
              name="corporate"
              alt="Cena ilustrativa de Logística Corporativa"
              eager
            />
          </div>
          <div className="about-red">
            <img src="/dutelog-logo-light.png" alt="Dutelog" />
            <p>
              Espaços.
              <br /> Bens.
              <br /> Possibilidades.
            </p>
          </div>
          <div className="about-statement">
            <p>
              A logística está nas grandes mudanças.
              <br /> E também nos detalhes que conectam uma etapa à outra.
            </p>
          </div>
        </div>
      </section>
      <section className="section about-manifesto">
        <div className="container manifesto-grid">
          <span className="section-label">Nossa proposta de atuação</span>
          <h2>
            Olhar o todo.
            <br /> Cuidar de cada parte.
          </h2>
          <div>
            <p>
              Na Dutelog, Logística Corporativa, Transporte de Cargas e
              Armazenagem fazem parte da mesma conversa: o próximo movimento da
              sua empresa.
            </p>
            <p>
              Mudar um escritório, organizar bens, remanejar ambientes ou
              planejar um transporte começa por compreender o contexto. É a
              partir dele que as soluções se conectam.
            </p>
            <TextLink href="/solucoes/">Conheça nossas soluções</TextLink>
          </div>
        </div>
      </section>
      <section className="section">
        <div className="container">
          <div className="section-heading">
            <h2>
              Três maneiras
              <br /> de conectar soluções.
            </h2>
          </div>
          <div className="principles">
            <article>
              <span>01</span>
              <h3>
                Escuta antes
                <br /> da resposta.
              </h3>
              <p>
                Entender a necessidade é o ponto de partida para discutir o
                escopo.
              </p>
            </article>
            <article>
              <span>02</span>
              <h3>
                Detalhes fazem
                <br /> parte do todo.
              </h3>
              <p>
                Itens, espaços, acessos e destinos precisam conversar entre si.
              </p>
            </article>
            <article>
              <span>03</span>
              <h3>
                Cada projeto,
                <br /> uma combinação.
              </h3>
              <p>
                Conectar serviços a partir do cenário que a empresa apresenta.
              </p>
            </article>
          </div>
        </div>
      </section>
      <ClosingCta />
    </>
  );
}
