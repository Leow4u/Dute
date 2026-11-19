import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { collection, limit, onSnapshot, orderBy, query, where, type Timestamp } from "firebase/firestore";

import { registrarAcesso } from "./acesso";
import { firestore } from "./firebase";
import { contagemNaoLida, corDoAvatar, horaDaBolha, horaDaLista, iniciais, mascararTelefone, nomeDoContato, rotuloDoDia, rotuloDoStatus, rotuloDoTipo } from "./formatar";
import { LINHAS_ZAP, linhaPorId, rotuloDoChip, tomDoAgente, type LinhaZap } from "./linhas";
import { escreverRota, lerRota } from "./rota";

type Direcao = "in" | "out";

type Conversa = {
  id: string;
  phone_number_id: string;
  contact_name?: string;
  contact_wa_id: string;
  last_preview: string;
  last_direction: Direcao;
  last_type: string;
  last_message_at: Date | null;
};

type Mensagem = {
  id: string;
  direction: Direcao;
  type: string;
  text: string;
  occurred_at: Date | null;
  status?: string;
};

type Filtro = "todas" | "nao-lidas" | string;

const ALTURAS = [8, 14, 22, 12, 26, 18, 10, 24, 28, 16, 9, 20, 26, 14, 8, 18, 24, 12, 16, 22, 10, 14, 8, 12];

export function Painel({ nome, aoSair }: { nome: string | null; aoSair: () => void }) {
  const [rota, setRota] = useState(() => lerRota(window.location.hash));
  const [conversas, setConversas] = useState<Conversa[] | null>(null);
  const [historico, setHistorico] = useState<{ conversa: string; itens: Mensagem[] } | null>(null);
  const mensagens = historico && historico.conversa === rota.conversa ? historico.itens : null;
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState("");
  const [buscaNaConversa, setBuscaNaConversa] = useState("");
  const [buscando, setBuscando] = useState(false);
  const [filtro, setFiltro] = useState<Filtro>("todas");
  const [dadosAbertos, setDadosAbertos] = useState(true);
  const [noFim, setNoFim] = useState(true);
  const [vistos, setVistos] = useState<Record<string, number>>({});
  const [aviso, setAviso] = useState("");
  const painel = useRef<HTMLDivElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const origemNaLista = useRef<{ posicao: number; botao: HTMLButtonElement } | null>(null);
  const rotaAnterior = useRef(rota);
  const caixa = useRef<HTMLDivElement>(null);
  const abertoAntes = useRef<string | null>(null);

  useEffect(() => {
    const aoMudar = () => setRota(lerRota(window.location.hash));
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);

  useEffect(() => {
    const viewport = window.visualViewport;
    const app = painel.current;
    if (!viewport || !app) return;
    // No Safari, o teclado reduz a área visível sem necessariamente alterar 100dvh.
    let quadro = 0;
    const agendarAjuste = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(() => {
        if (document.activeElement instanceof HTMLInputElement && viewport.scale === 1) {
          app.style.setProperty("--zap-viewport-height", `${viewport.height}px`);
        } else {
          app.style.removeProperty("--zap-viewport-height");
        }
      });
    };
    viewport.addEventListener("resize", agendarAjuste);
    app.addEventListener("focusin", agendarAjuste);
    app.addEventListener("focusout", agendarAjuste);
    return () => {
      cancelAnimationFrame(quadro);
      viewport.removeEventListener("resize", agendarAjuste);
      app.removeEventListener("focusin", agendarAjuste);
      app.removeEventListener("focusout", agendarAjuste);
      app.style.removeProperty("--zap-viewport-height");
    };
  }, []);

  useLayoutEffect(() => {
    const antes = rotaAnterior.current;
    rotaAnterior.current = rota;
    const app = painel.current;
    if (!app) return;
    if (!rota.conversa && antes.conversa) {
      const origem = origemNaLista.current;
      if (origem && lista.current) lista.current.scrollTop = origem.posicao;
      if (origem?.botao.isConnected) origem.botao.focus({ preventScroll: true });
      else app.querySelector<HTMLHeadingElement>(".lh h1")?.focus({ preventScroll: true });
      origemNaLista.current = null;
    } else if (rota.contato && !antes.contato) {
      app.querySelector<HTMLButtonElement>(".back-contact")?.focus({ preventScroll: true });
    } else if (antes.contato && rota.conversa) {
      app.querySelector<HTMLButtonElement>(".mobile-contact")?.focus({ preventScroll: true });
    } else if (rota.conversa && !antes.conversa) {
      app.querySelector<HTMLButtonElement>(".ch .back")?.focus({ preventScroll: true });
    }
  }, [rota]);

  useEffect(() => {
    registrarAcesso("entered");
  }, []);

  useEffect(() => {
    if (rota.conversa) registrarAcesso("opened", rota.conversa);
  }, [rota.conversa]);

  useEffect(() => {
    if (!firestore) return;
    const consulta = query(collection(firestore, "zap_conversations"), orderBy("last_message_at", "desc"), limit(200));
    return onSnapshot(consulta, (snap) => {
      setErro(null);
      setConversas(snap.docs.map((documento) => conversaDe(documento.id, documento.data())));
    }, () => setErro("Não foi possível ler as conversas."));
  }, []);

  useEffect(() => {
    const id = rota.conversa;
    if (!firestore || !id) {
      setHistorico(null);
      return;
    }
    setBuscaNaConversa("");
    setBuscando(false);
    const consulta = query(collection(firestore, "zap_messages"), where("conversation_id", "==", id), orderBy("occurred_at", "asc"), limit(300));
    return onSnapshot(consulta, (snap) => {
      setErro(null);
      setHistorico({ conversa: id, itens: snap.docs.map((documento) => mensagemDe(documento.id, documento.data())) });
    }, () => setErro("Não foi possível ler a conversa."));
  }, [rota.conversa]);

  const aberta = conversas?.find((conversa) => conversa.id === rota.conversa) ?? null;
  const linhaAberta = aberta ? linhaPorId(aberta.phone_number_id) : null;
  const vistoAberto = rota.conversa ? vistoDe(rota.conversa, vistos) : 0;
  const naoLidasAbertas = useMemo(() => {
    if (!mensagens) return 0;
    return contagemNaoLida("in", null, vistoAberto, mensagens.map((mensagem) => ({ direction: mensagem.direction, em: mensagem.occurred_at?.getTime() ?? 0 })));
  }, [mensagens, vistoAberto]);

  useEffect(() => {
    if (!rota.conversa) {
      abertoAntes.current = null;
      return;
    }
    if (!mensagens || abertoAntes.current === rota.conversa) return;
    const quadro = caixa.current;
    if (!quadro || !quadro.clientHeight) return;
    abertoAntes.current = rota.conversa;
    const marco = quadro.querySelector("[data-nao-lidas]");
    if (marco) marco.scrollIntoView({ block: "center" });
    else quadro.scrollTop = quadro.scrollHeight;
    setNoFim(quadro.scrollHeight - quadro.scrollTop - quadro.clientHeight < 80);
  }, [mensagens, rota.conversa, rota.contato]);

  function abrir(hash: string, origem: "lista" | "conversa" | null) {
    if (window.location.hash === hash) return;
    window.history.pushState({ zapOrigem: origem }, "", hash);
    setRota(lerRota(hash));
  }

  function voltar(para: "lista" | "conversa") {
    if (window.history.state?.zapOrigem === para) {
      window.history.back();
      return;
    }
    // Um link direto também precisa de volta, mesmo sem histórico no painel.
    const hash = escreverRota(rota.linha, para === "conversa" ? rota.conversa : null);
    window.history.replaceState(null, "", hash);
    setRota(lerRota(hash));
  }

  function visto(id: string) {
    return vistoDe(id, vistos);
  }

  function marcar(id: string, em: number) {
    try {
      localStorage.setItem(`zap-visto:${id}`, String(em));
    } catch {
      // O navegador pode recusar o armazenamento. A conta continua na memória.
    }
    setVistos((atual) => ({ ...atual, [id]: em }));
  }

  function aoRolar() {
    const quadro = caixa.current;
    if (!quadro || !quadro.clientHeight || !rota.conversa || !mensagens) return;
    const fim = quadro.scrollHeight - quadro.scrollTop - quadro.clientHeight < 80;
    setNoFim(fim);
    if (!fim) return;
    const ultimo = mensagens.reduce((maior, mensagem) => Math.max(maior, mensagem.occurred_at?.getTime() ?? 0), 0);
    if (ultimo > visto(rota.conversa)) marcar(rota.conversa, ultimo);
  }

  function irAoFim() {
    const quadro = caixa.current;
    if (!quadro) return;
    quadro.scrollTop = quadro.scrollHeight;
    aoRolar();
  }

  const termo = busca.trim().toLowerCase();
  const digitos = termo.replace(/\D/g, "");
  const visiveis = (conversas ?? []).filter((conversa) => {
    const quantidade = quantidadeDa(conversa, mensagens, rota.conversa, visto(conversa.id));
    if (filtro === "nao-lidas" && quantidade === 0) return false;
    if (filtro !== "todas" && filtro !== "nao-lidas" && conversa.phone_number_id !== filtro) return false;
    if (!termo) return true;
    const nome = nomeDoContato(conversa.contact_name, conversa.contact_wa_id).toLowerCase();
    if (nome.includes(termo) || conversa.last_preview.toLowerCase().includes(termo)) return true;
    return digitos.length >= 3 && conversa.contact_wa_id.includes(digitos);
  });
  const totalNaoLidas = (conversas ?? []).filter((conversa) => quantidadeDa(conversa, mensagens, rota.conversa, visto(conversa.id)) > 0).length;
  const filtroDeLinha = filtro === "todas" || filtro === "nao-lidas" ? "" : filtro;
  const textoDaBusca = buscaNaConversa.trim().toLowerCase();
  const mensagensVisiveis = (mensagens ?? []).filter((mensagem) => !textoDaBusca || mensagem.text.toLowerCase().includes(textoDaBusca) || rotuloDoTipo(mensagem.type).toLowerCase().includes(textoDaBusca));
  const tela = rota.conversa ? "conversa" : "lista";

  return (
    <div ref={painel} className="app" data-tela={tela} data-contato={rota.contato && aberta ? "aberto" : "fechado"} data-dados={dadosAbertos && aberta ? "aberto" : "fechado"}>
      <nav className="rail" aria-label="Painel">
        <img src="/logo-d.png" alt="Dutelog" />
        <button type="button" className="it on" aria-current="page" aria-label="Conversas">
          <Icone nome="chat" />
          {totalNaoLidas > 0 ? <span className="dot" /> : null}
        </button>
        <button type="button" className="it" aria-disabled="true" aria-label="Linhas, em breve"><Icone nome="lines" /></button>
        <button type="button" className="it" aria-disabled="true" aria-label="Avisos, em breve"><Icone nome="bell" /></button>
        <button type="button" className="it" aria-disabled="true" aria-label="Ajustes, em breve"><Icone nome="gear" /></button>
        <span className="sp" />
        <button type="button" className="av" onClick={aoSair} aria-label={`Sair, ${nome ?? "administração"}`}>{iniciais(nome ?? "AD")}</button>
      </nav>

      <section className="list" aria-label="Conversas">
        <div className="mobile-brand">
          <img src="/logo-d.png" alt="" /><strong>Dutelog</strong><span>Dute Zap</span>
          <button type="button" className="sair" onClick={aoSair}>Sair</button>
        </div>
        <div className="lh">
          <h1 tabIndex={-1}>Conversas</h1>
          <span className="live"><i />Ao vivo</span>
          <button type="button" className="sair" onClick={aoSair}>Sair</button>
        </div>
        <label className="search">
          <Icone nome="srch" />
          <span className="sr">Buscar nome, número ou mensagem</span>
          <input type="search" value={busca} onChange={(evento) => setBusca(evento.target.value)} placeholder="Buscar conversas" />
        </label>
        <div className="chips" role="toolbar" aria-label="Filtrar conversas">
          <button type="button" className={filtro === "todas" ? "chip on" : "chip"} aria-pressed={filtro === "todas"} onClick={() => setFiltro("todas")}>Todas</button>
          <button type="button" className={filtro === "nao-lidas" ? "chip on" : "chip"} aria-pressed={filtro === "nao-lidas"} onClick={() => setFiltro("nao-lidas")}>
            Não lidas{totalNaoLidas > 0 ? <b>{totalNaoLidas}</b> : null}
          </button>
          {LINHAS_ZAP.map((linha) => (
            <button key={linha.phone_number_id} type="button" className={filtro === linha.phone_number_id ? "chip chip-agent on" : "chip chip-agent"} aria-pressed={filtro === linha.phone_number_id} onClick={() => setFiltro(linha.phone_number_id)}>
              {rotuloDoChip(linha)}
            </button>
          ))}
          <span className={filtroDeLinha ? "chip-line-wrap on" : "chip-line-wrap"}>
            <select className={filtroDeLinha ? "chip chip-line on" : "chip chip-line"} aria-label="Filtrar por linha" value={filtroDeLinha} onChange={(evento) => setFiltro(evento.target.value || "todas")}>
              <option value="">Linha</option>
              {LINHAS_ZAP.map((linha) => <option key={linha.phone_number_id} value={linha.phone_number_id}>{rotuloDoChip(linha)}</option>)}
            </select>
            <Icone nome="bk" />
          </span>
        </div>
        {erro ? <p className="faixa" role="alert">{erro}</p> : null}
        <div className="rows" ref={lista}>
          {conversas === null ? <p className="vazio">Carregando…</p> : null}
          {conversas && visiveis.length === 0 ? <p className="vazio">Nenhuma conversa.</p> : null}
          {visiveis.map((conversa) => {
            const linha = linhaPorId(conversa.phone_number_id);
            const tom = tomDoAgente(linha?.agente ?? "");
            const quantidade = quantidadeDa(conversa, mensagens, rota.conversa, visto(conversa.id));
            const nomeContato = nomeDoContato(conversa.contact_name, conversa.contact_wa_id);
            return (
              <button type="button" key={conversa.id} className={conversa.id === rota.conversa ? "row sel" : "row"} aria-current={conversa.id === rota.conversa ? "true" : undefined} onClick={(evento) => {
                if (!rota.conversa) origemNaLista.current = { posicao: lista.current?.scrollTop ?? 0, botao: evento.currentTarget };
                abrir(escreverRota(conversa.phone_number_id, conversa.id), rota.conversa ? null : "lista");
              }}>
                <span className="pic" style={{ background: corDoAvatar(nomeContato) }} aria-hidden="true">{iniciais(nomeContato)}</span>
                <span className="rb">
                  <span className="r1">
                    <span className="nm">{nomeContato}</span>
                    {conversa.last_message_at ? <time className={quantidade > 0 ? "tm un" : "tm"} dateTime={conversa.last_message_at.toISOString()}>{horaDaLista(conversa.last_message_at)}</time> : null}
                  </span>
                  <span className="bd" style={{ "--badge-bg": tom.fundo, "--badge-ink": tom.texto } as CSSProperties}>{linha ? `${linha.nome} · ${linha.area}` : "Linha"}</span>
                  <span className="r2">
                    <span className="pv">{previa(conversa)}</span>
                    {quantidade > 0 ? <span className="cnt">{quantidade}</span> : null}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section className="chat" aria-label="Conversa aberta">
        {aberta ? (
          <Cabeca
            conversa={aberta}
            linha={linhaAberta}
            dadosAbertos={dadosAbertos}
            buscando={buscando}
            busca={buscaNaConversa}
            aoVoltar={() => voltar("lista")}
            aoContato={() => abrir(escreverRota(rota.linha, rota.conversa, true), "conversa")}
            aoDados={() => setDadosAbertos((atual) => !atual)}
            aoBuscar={() => setBuscando((atual) => !atual)}
            aoTexto={setBuscaNaConversa}
          />
        ) : (
          <header className="ch">
            {rota.conversa ? <button type="button" className="ic back" onClick={() => voltar("lista")} aria-label="Voltar às conversas"><Icone nome="bk" /></button> : null}
            <div className="t"><b>Conversa</b><span>{rota.conversa ? conversas === null ? "Carregando conversa…" : "Dados do contato indisponíveis." : "Selecione uma conversa."}</span></div>
          </header>
        )}
        <div className="msgs" ref={caixa} onScroll={aoRolar}>
          {!rota.conversa ? <p className="vazio">Selecione uma conversa.</p> : null}
          {rota.conversa && mensagens === null ? <p className="vazio">Carregando…</p> : null}
          {blocos(mensagensVisiveis, vistoAberto).map((bloco) => {
            if (bloco.tipo === "dia") return <span key={bloco.chave} className="day">{bloco.rotulo}</span>;
            if (bloco.tipo === "nao-lidas") return <span key={bloco.chave} className="unr" data-nao-lidas="">{bloco.n === 1 ? "1 mensagem não lida" : `${bloco.n} mensagens não lidas`}</span>;
            return bloco.mensagem ? <Bolha key={bloco.mensagem.id} mensagem={bloco.mensagem} nome={aberta ? nomeDoContato(aberta.contact_name, aberta.contact_wa_id) : ""} aoAviso={setAviso} /> : null;
          })}
          {!noFim && rota.conversa ? (
            <button type="button" className="live-pill" onClick={irAoFim}><Icone nome="dn" />Nova mensagem</button>
          ) : null}
        </div>
        <p className="sr" role="status">{aviso}</p>
        <footer className="ft">
          <p className="n"><Icone nome="lock" /><span>Somente leitura<span className="desktop-readonly"> — responder pelo painel em breve</span></span></p>
          <button type="button" className="btn" disabled aria-describedby="assumir-breve">
            <Icone nome="hand" />Assumir conversa<small id="assumir-breve">Em breve</small>
          </button>
        </footer>
      </section>

      {aberta ? (
        <aside className="info" aria-label="Dados do contato">
          <div className="ih"><button type="button" className="ic back-contact" aria-label="Voltar à conversa" onClick={() => voltar("conversa")}><Icone nome="bk" /></button>Dados do contato</div>
          <div className="ip">
            <span className="pic" style={{ background: corDoAvatar(nomeDoContato(aberta.contact_name, aberta.contact_wa_id)) }} aria-hidden="true">{iniciais(nomeDoContato(aberta.contact_name, aberta.contact_wa_id))}</span>
            <b>{nomeDoContato(aberta.contact_name, aberta.contact_wa_id)}</b>
            <span>{mascararTelefone(aberta.contact_wa_id)}</span>
          </div>
          <div className="sec">
            <h2>Atendimento</h2>
            <p className="kv"><span>Agente</span><b>{linhaAberta?.nome ?? "Linha"}</b></p>
            <p className="kv"><span>Linha</span><b>{linhaAberta ? `${linhaAberta.area} · ${linhaAberta.telefone}` : aberta.phone_number_id}</b></p>
            <p className="kv"><span>Primeiro contato</span><b>{primeiroContato(mensagens)}</b></p>
            <p className="kv"><span>Mensagens</span><b>{mensagens ? String(mensagens.length) : "…"}</b></p>
            <p className="kv"><span>Última atividade</span><b>{aberta.last_message_at ? `${rotuloDoDia(aberta.last_message_at)}, ${horaDaBolha(aberta.last_message_at)}` : "—"}</b></p>
          </div>
          <div className="sec">
            <h2>Privacidade</h2>
            <p className="lgpd"><Icone nome="sh" /><span>Conversas de clientes: acesso restrito a administradores e registrado em log (LGPD). Retenção definida pela Dutelog.</span></p>
          </div>
        </aside>
      ) : null}
    </div>
  );
}

function Cabeca({ conversa, linha, dadosAbertos, buscando, busca, aoVoltar, aoContato, aoDados, aoBuscar, aoTexto }: {
  conversa: Conversa;
  linha: LinhaZap | null;
  dadosAbertos: boolean;
  buscando: boolean;
  busca: string;
  aoVoltar: () => void;
  aoContato: () => void;
  aoDados: () => void;
  aoBuscar: () => void;
  aoTexto: (valor: string) => void;
}) {
  const nome = nomeDoContato(conversa.contact_name, conversa.contact_wa_id);
  const linhaDoContato = linha ? `${linha.nome} · ${linha.area}` : "Linha";
  return (
    <header className="ch">
      <button type="button" className="ic back" onClick={aoVoltar} aria-label="Voltar às conversas"><Icone nome="bk" /></button>
      <button type="button" className="mobile-contact" onClick={aoContato} aria-label={`Dados do contato: ${nome}`}>
        <span className="pic" style={{ background: corDoAvatar(nome) }} aria-hidden="true">{iniciais(nome)}</span>
        <span className="t"><b>{nome}</b><span>{linhaDoContato}</span></span>
        <Icone nome="inf" />
      </button>
      <span className="pic desktop-contact" style={{ background: corDoAvatar(nome) }} aria-hidden="true">{iniciais(nome)}</span>
      <div className="t desktop-contact">
        <b>{nome}</b>
        <span>{mascararTelefone(conversa.contact_wa_id)} · {linhaDoContato}</span>
      </div>
      <span className="ro"><Icone nome="eye" /><span>Somente leitura</span></span>
      <button type="button" className={buscando ? "ic on" : "ic"} aria-pressed={buscando} aria-label="Buscar nesta conversa" onClick={aoBuscar}><Icone nome="srch" /></button>
      <button type="button" className={dadosAbertos ? "ic on hide" : "ic hide"} aria-pressed={dadosAbertos} aria-label="Dados do contato" onClick={aoDados}><Icone nome="inf" /></button>
      {buscando ? <input className="busca-conversa" value={busca} onChange={(evento) => aoTexto(evento.target.value)} placeholder="Buscar nesta conversa" aria-label="Buscar nesta conversa" /> : null}
    </header>
  );
}

function Bolha({ mensagem, nome, aoAviso }: { mensagem: Mensagem; nome: string; aoAviso: (texto: string) => void }) {
  const hora = mensagem.occurred_at ? horaDaBolha(mensagem.occurred_at) : "";
  return (
    <div className={mensagem.direction === "out" ? "b o" : "b in"}>
      {mensagem.direction === "in" ? <span className="who">{nome}</span> : null}
      {mensagem.type === "audio" ? <Audio id={mensagem.id} aoAviso={aoAviso} /> : null}
      {mensagem.type === "image" || mensagem.type === "document" || mensagem.type === "video" || mensagem.type === "sticker" ? (
        <span className="img" role="img" aria-label={rotuloDoTipo(mensagem.type)}><span className="box">{rotuloDoTipo(mensagem.type)}</span></span>
      ) : null}
      {mensagem.type !== "audio" && mensagem.text ? <span className="cap">{mensagem.text}</span> : null}
      {mensagem.type !== "text" && mensagem.type !== "audio" && mensagem.type !== "image" && mensagem.type !== "document" && mensagem.type !== "video" && mensagem.type !== "sticker" && !mensagem.text ? <span className="cap">{rotuloDoTipo(mensagem.type)}</span> : null}
      <span className="m">
        {hora}
        {mensagem.direction === "out" ? <Tiques status={mensagem.status} /> : null}
      </span>
    </div>
  );
}

function Audio({ id, aoAviso }: { id: string; aoAviso: (texto: string) => void }) {
  const alturas = ALTURAS.map((valor, indice) => valor + ((soma(id) + indice) % 5) - 2);
  return (
    <div className="aud">
      <button type="button" className="pl" aria-label="Áudio ainda não baixado" onClick={() => aoAviso("O arquivo de áudio não é baixado neste painel.")}>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5v14l11-7z" /></svg>
      </button>
      <span className="wf" aria-hidden="true">{alturas.map((altura, indice) => <i key={indice} className={indice < 9 ? "p" : ""} style={{ height: altura }} />)}</span>
    </div>
  );
}

function Tiques({ status }: { status?: string }) {
  const rotulo = rotuloDoStatus(status);
  if (!status || status === "failed" || !rotulo) return status === "failed" ? <span>Falhou</span> : null;
  const duplo = status !== "sent";
  return (
    <svg className="tique" viewBox="0 0 24 24" role="img" aria-label={rotulo}>
      {duplo ? <path d="M2 12.5l4.5 4.5L16 7.5M12 15l1.5 1.5L22 7.5" /> : <path d="M5 12.5l4.5 4.5L19 7.5" />}
    </svg>
  );
}

function previa(conversa: Conversa) {
  const icone = conversa.last_type === "audio" ? "mic" : conversa.last_type === "image" || conversa.last_type === "sticker" || conversa.last_type === "video" ? "cam" : "";
  return (
    <>
      {conversa.last_direction === "out" ? <Icone nome="chk" /> : null}
      {icone ? <Icone nome={icone} /> : null}
      <span>{conversa.last_preview || rotuloDoTipo(conversa.last_type)}</span>
    </>
  );
}

function blocos(mensagens: Mensagem[], visto: number) {
  const saida: { tipo: "dia" | "nao-lidas" | "msg"; chave: string; rotulo?: string; n?: number; mensagem?: Mensagem }[] = [];
  let dia = "";
  let divisor = false;
  const quantidade = mensagens.filter((mensagem) => mensagem.direction === "in" && (mensagem.occurred_at?.getTime() ?? 0) > visto).length;
  for (const mensagem of mensagens) {
    if (mensagem.occurred_at) {
      const chave = rotuloDoDia(mensagem.occurred_at);
      if (chave !== dia) {
        dia = chave;
        saida.push({ tipo: "dia", chave: `dia-${chave}-${mensagem.id}`, rotulo: chave });
      }
    }
    const em = mensagem.occurred_at?.getTime() ?? 0;
    if (!divisor && quantidade > 0 && mensagem.direction === "in" && em > visto) {
      divisor = true;
      saida.push({ tipo: "nao-lidas", chave: `nl-${mensagem.id}`, n: quantidade });
    }
    saida.push({ tipo: "msg", chave: mensagem.id, mensagem });
  }
  return saida;
}

function primeiroContato(mensagens: Mensagem[] | null): string {
  const datas = (mensagens ?? []).map((mensagem) => mensagem.occurred_at).filter((data): data is Date => data !== null);
  if (datas.length === 0) return "—";
  const primeira = datas.reduce((menor, data) => (data < menor ? data : menor));
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" }).format(primeira);
}

function quantidadeDa(conversa: Conversa, mensagens: Mensagem[] | null, aberta: string | null, vistoEm: number): number {
  if (aberta === conversa.id && mensagens) {
    return contagemNaoLida(conversa.last_direction, conversa.last_message_at?.getTime() ?? null, vistoEm, mensagens.map((mensagem) => ({ direction: mensagem.direction, em: mensagem.occurred_at?.getTime() ?? 0 })));
  }
  return contagemNaoLida(conversa.last_direction, conversa.last_message_at?.getTime() ?? null, vistoEm);
}

function vistoDe(id: string, memoria: Record<string, number>): number {
  if (id in memoria) return memoria[id] ?? 0;
  try {
    const valor = Number(localStorage.getItem(`zap-visto:${id}`));
    return Number.isFinite(valor) ? valor : 0;
  } catch {
    return 0;
  }
}

function soma(id: string): number {
  return [...id].reduce((total, letra) => total + letra.charCodeAt(0), 0);
}

function conversaDe(id: string, dados: Record<string, unknown>): Conversa {
  return {
    id,
    phone_number_id: typeof dados.phone_number_id === "string" ? dados.phone_number_id : "",
    ...(typeof dados.contact_name === "string" ? { contact_name: dados.contact_name } : {}),
    contact_wa_id: typeof dados.contact_wa_id === "string" ? dados.contact_wa_id : "",
    last_preview: typeof dados.last_preview === "string" ? dados.last_preview : "",
    last_direction: dados.last_direction === "out" ? "out" : "in",
    last_type: typeof dados.last_type === "string" ? dados.last_type : "text",
    last_message_at: comoData(dados.last_message_at),
  };
}

function mensagemDe(id: string, dados: Record<string, unknown>): Mensagem {
  return {
    id,
    direction: dados.direction === "out" ? "out" : "in",
    type: typeof dados.type === "string" ? dados.type : "unknown",
    text: typeof dados.text === "string" ? dados.text : "",
    occurred_at: comoData(dados.occurred_at),
    ...(typeof dados.status === "string" ? { status: dados.status } : {}),
  };
}

function comoData(valor: unknown): Date | null {
  if (valor && typeof valor === "object" && "toDate" in valor && typeof (valor as Timestamp).toDate === "function") {
    const data = (valor as Timestamp).toDate();
    return data instanceof Date ? data : null;
  }
  return null;
}

function Icone({ nome }: { nome: string }) {
  const traco = { fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" className={`icone ${nome}`}>
      {nome === "chat" ? <path {...traco} d="M4 5h16v11H9l-5 4z" /> : null}
      {nome === "lines" ? <><circle {...traco} cx="9" cy="8" r="3.2" /><path {...traco} d="M3 20c0-3.5 2.7-6 6-6s6 2.5 6 6M16 5a3 3 0 010 6M18 14c2 .7 3 2.6 3 6" /></> : null}
      {nome === "bell" ? <path {...traco} d="M6 17V11a6 6 0 0112 0v6l1.5 2h-15zM10 21h4" /> : null}
      {nome === "gear" ? <><circle {...traco} cx="12" cy="12" r="3" /><path {...traco} d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" /></> : null}
      {nome === "srch" ? <><circle {...traco} cx="11" cy="11" r="6.5" /><path {...traco} d="M16 16l5 5" /></> : null}
      {nome === "inf" ? <><circle {...traco} cx="12" cy="12" r="9" /><path {...traco} d="M12 11v6M12 7.5v.1" /></> : null}
      {nome === "mic" ? <><rect {...traco} x="9" y="3" width="6" height="11" rx="3" /><path {...traco} d="M5 11a7 7 0 0014 0M12 18v3" /></> : null}
      {nome === "cam" ? <><rect {...traco} x="3" y="6" width="18" height="14" rx="3" /><circle {...traco} cx="12" cy="13" r="3.5" /></> : null}
      {nome === "chk" ? <path {...traco} d="M2 12.5l4.5 4.5L16 7.5M12 15l1.5 1.5L22 7.5" /> : null}
      {nome === "lock" ? <><rect {...traco} x="5" y="11" width="14" height="9" rx="2" /><path {...traco} d="M8 11V8a4 4 0 018 0v3" /></> : null}
      {nome === "eye" ? <><path {...traco} d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" /><circle {...traco} cx="12" cy="12" r="3" /></> : null}
      {nome === "dn" ? <path {...traco} d="M12 5v14M6 13l6 6 6-6" /> : null}
      {nome === "bk" ? <path {...traco} d="M15 5l-7 7 7 7" /> : null}
      {nome === "hand" ? <path {...traco} d="M8 12V6a1.5 1.5 0 013 0v5M11 11V4.5a1.5 1.5 0 013 0V11M14 11V6a1.5 1.5 0 013 0v7c0 4-2 7-6 7-3 0-4-2-6-5l-1-2a1.5 1.5 0 012.5-1.5L8 14" /> : null}
      {nome === "sh" ? <path {...traco} d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z" /> : null}
    </svg>
  );
}
