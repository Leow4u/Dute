import { useEffect, useRef, useState } from "react";
import { collection, limit, onSnapshot, orderBy, query, where, type Timestamp } from "firebase/firestore";

import { registrarAcesso } from "./acesso";
import { firestore } from "./firebase";
import { formatarHorario, nomeDoContato, rotuloDoStatus, rotuloDoTipo } from "./formatar";
import { LINHA_PILOTO, LINHAS_ZAP, linhaPorId } from "./linhas";
import { escreverRota, lerRota } from "./rota";

type Conversa = {
  id: string;
  contact_name?: string;
  contact_wa_id: string;
  last_preview: string;
  last_direction: "in" | "out";
  last_message_at: Date | null;
};

type Mensagem = {
  id: string;
  direction: "in" | "out";
  type: string;
  text: string;
  occurred_at: Date | null;
  status?: string;
};

export function Painel({ nome, aoSair }: { nome: string | null; aoSair: () => void }) {
  const [rota, setRota] = useState(() => lerRota(window.location.hash));
  const [conversas, setConversas] = useState<Conversa[] | null>(null);
  const [mensagens, setMensagens] = useState<Mensagem[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const fim = useRef<HTMLDivElement>(null);
  const catalogo = linhaPorId(rota.linha);
  const linha = catalogo ?? { phone_number_id: rota.linha, agente: "desconhecido", nome: "Linha", area: "Fora do catálogo", telefone: "" };
  const etapa = rota.conversa ? "conversa" : rota.linhas ? "linhas" : "conversas";

  useEffect(() => {
    const aoMudar = () => setRota(lerRota(window.location.hash));
    window.addEventListener("hashchange", aoMudar);
    return () => window.removeEventListener("hashchange", aoMudar);
  }, []);

  useEffect(() => {
    registrarAcesso("entered");
  }, []);

  useEffect(() => {
    if (rota.conversa) registrarAcesso("opened", rota.conversa);
  }, [rota.conversa]);

  useEffect(() => {
    if (!firestore) return;
    setConversas(null);
    const consulta = query(collection(firestore, "zap_conversations"), where("phone_number_id", "==", linha.phone_number_id), orderBy("last_message_at", "desc"), limit(100));
    return onSnapshot(consulta, (snap) => {
      setErro(null);
      setConversas(snap.docs.map((documento) => conversaDe(documento.id, documento.data())));
    }, () => setErro("Não foi possível ler as conversas."));
  }, [linha.phone_number_id]);

  useEffect(() => {
    if (!firestore || !rota.conversa) {
      setMensagens(null);
      return;
    }
    setMensagens(null);
    const consulta = query(collection(firestore, "zap_messages"), where("conversation_id", "==", rota.conversa), orderBy("occurred_at", "asc"), limit(300));
    return onSnapshot(consulta, (snap) => {
      setErro(null);
      setMensagens(snap.docs.map((documento) => mensagemDe(documento.id, documento.data())));
    }, () => setErro("Não foi possível ler a conversa."));
  }, [rota.conversa]);

  useEffect(() => {
    fim.current?.scrollIntoView({ block: "end" });
  }, [mensagens]);

  function abrirLinha(phoneNumberId: string) {
    const proxima = escreverRota(phoneNumberId, null);
    window.location.hash = proxima;
    setRota({ linha: phoneNumberId, conversa: null, linhas: false });
  }

  function abrirConversa(id: string) {
    const proxima = escreverRota(linha.phone_number_id, id);
    window.location.hash = proxima;
    setRota({ linha: linha.phone_number_id, conversa: id, linhas: false });
  }

  const aberta = conversas?.find((conversa) => conversa.id === rota.conversa) ?? null;

  return (
    <div className="zap">
      <header className="topo">
        <div>
          <p className="marca">Dutelog</p>
          <h1>Zap</h1>
        </div>
        <p className="ao-vivo"><span className="ponto" aria-hidden="true" />Ao vivo</p>
        <p className="quem">{nome ?? "Administração"}</p>
        <button type="button" className="secundario" onClick={aoSair}>Sair</button>
      </header>
      {erro ? <p className="faixa" role="alert">{erro}</p> : null}
      <div className="colunas" data-etapa={etapa}>
        <section className="coluna linhas" aria-label="Linhas">
          <h2>Linhas</h2>
          <ul>
            {LINHAS_ZAP.map((item) => (
              <li key={item.phone_number_id}>
                <button type="button" className={item.phone_number_id === linha.phone_number_id ? "selecionado" : ""} aria-current={item.phone_number_id === linha.phone_number_id ? "true" : undefined} onClick={() => abrirLinha(item.phone_number_id)}>
                  <strong>{item.nome}</strong>
                  <span>{item.area}</span>
                  <span className="mudo">{item.telefone}</span>
                  {item.phone_number_id === LINHA_PILOTO ? <em>Piloto</em> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="coluna conversas" aria-label="Conversas">
          <button type="button" className="voltar" onClick={() => { const proxima = `#/linhas/${linha.phone_number_id}`; window.location.hash = proxima; setRota({ linha: linha.phone_number_id, conversa: null, linhas: true }); }}>Linhas</button>
          <h2>{linha.nome} · {linha.area}</h2>
          {conversas === null ? <p className="mudo">Carregando…</p> : null}
          {conversas && conversas.length === 0 ? <p>Nenhuma conversa nesta linha.</p> : null}
          <ul>
            {conversas?.map((conversa) => (
              <li key={conversa.id}>
                <button type="button" className={conversa.id === rota.conversa ? "selecionado" : ""} aria-current={conversa.id === rota.conversa ? "true" : undefined} onClick={() => abrirConversa(conversa.id)}>
                  <strong>{nomeDoContato(conversa.contact_name, conversa.contact_wa_id)}</strong>
                  <span>{conversa.last_direction === "out" ? "Enviada · " : ""}{conversa.last_preview}</span>
                  {conversa.last_message_at ? <time dateTime={conversa.last_message_at.toISOString()}>{formatarHorario(conversa.last_message_at)}</time> : null}
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="coluna fio" aria-label="Conversa aberta">
          <button type="button" className="voltar" onClick={() => abrirLinha(linha.phone_number_id)}>Conversas</button>
          {rota.conversa && aberta ? (
            <>
              <h2>{nomeDoContato(aberta.contact_name, aberta.contact_wa_id)}</h2>
              <p className="mudo">{nomeDoContato(undefined, aberta.contact_wa_id)} · Só visualização</p>
            </>
          ) : (
            <h2>Conversa</h2>
          )}
          {!rota.conversa ? <p>Selecione uma conversa.</p> : null}
          {rota.conversa && mensagens === null ? <p className="mudo">Carregando…</p> : null}
          <ol className="mensagens">
            {mensagens?.map((mensagem) => (
              <li key={mensagem.id} className={mensagem.direction === "out" ? "saida" : "entrada"}>
                {mensagem.type !== "text" ? <span className="tipo">{rotuloDoTipo(mensagem.type)}</span> : null}
                {mensagem.text ? <p>{mensagem.text}</p> : null}
                <small>
                  {mensagem.direction === "out" ? "Enviada" : "Recebida"}
                  {mensagem.occurred_at ? ` · ${formatarHorario(mensagem.occurred_at)}` : ""}
                  {mensagem.direction === "out" && rotuloDoStatus(mensagem.status) ? ` · ${rotuloDoStatus(mensagem.status)}` : ""}
                </small>
              </li>
            ))}
          </ol>
          <div ref={fim} />
        </section>
      </div>
    </div>
  );
}

function conversaDe(id: string, dados: Record<string, unknown>): Conversa {
  return {
    id,
    ...(typeof dados.contact_name === "string" ? { contact_name: dados.contact_name } : {}),
    contact_wa_id: typeof dados.contact_wa_id === "string" ? dados.contact_wa_id : "",
    last_preview: typeof dados.last_preview === "string" ? dados.last_preview : "",
    last_direction: dados.last_direction === "out" ? "out" : "in",
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
