import { useState, type FormEvent } from "react";
import { sendPasswordResetEmail, signInWithEmailAndPassword } from "firebase/auth";

import { firebaseAuth } from "./firebase";

type Estado = {
  email: string;
  senha: string;
  erro: string | null;
  enviando: boolean;
};

const INICIAL: Estado = { email: "", senha: "", erro: null, enviando: false };

function mensagemDoLogin(erro: unknown): string {
  const codigo = erro && typeof erro === "object" && "code" in erro ? String(erro.code) : "";
  if (codigo === "auth/invalid-credential" || codigo === "auth/wrong-password" || codigo === "auth/user-not-found" || codigo === "auth/invalid-email") {
    return "E-mail ou senha não conferem.";
  }
  if (codigo === "auth/too-many-requests") return "Muitas tentativas. Espere um pouco e tente de novo.";
  if (codigo === "auth/unauthorized-domain") return "Este endereço ainda não está autorizado no login.";
  return "Não foi possível entrar.";
}

export function Entrar() {
  const [estado, setEstado] = useState<Estado>(INICIAL);

  async function entrar(evento: FormEvent<HTMLFormElement>) {
    evento.preventDefault();
    if (!firebaseAuth) return;
    setEstado((atual) => ({ ...atual, enviando: true, erro: null }));
    try {
      await signInWithEmailAndPassword(firebaseAuth, estado.email.trim(), estado.senha);
    } catch (erro) {
      setEstado((atual) => ({ ...atual, enviando: false, erro: mensagemDoLogin(erro) }));
    }
  }

  async function recuperar() {
    if (!firebaseAuth) return;
    if (!estado.email.trim()) {
      setEstado((atual) => ({ ...atual, erro: "Informe o e-mail para trocar a senha." }));
      return;
    }
    try {
      await sendPasswordResetEmail(firebaseAuth, estado.email.trim());
      setEstado((atual) => ({ ...atual, erro: "E-mail de recuperação enviado." }));
    } catch {
      setEstado((atual) => ({ ...atual, erro: "Não foi possível enviar o e-mail para trocar a senha. Confira o endereço." }));
    }
  }

  return (
    <main className="entrada">
      <form className="cartao" onSubmit={entrar}>
        <p className="marca">Dutelog</p>
        <h1>Painel do Zap</h1>
        <p className="apoio">Acompanhe as conversas de WhatsApp. Só a administração entra.</p>
        <label htmlFor="email">E-mail</label>
        <input id="email" name="email" type="email" autoComplete="username" value={estado.email} onChange={(evento) => setEstado((atual) => ({ ...atual, email: evento.target.value }))} required />
        <label htmlFor="senha">Senha</label>
        <input id="senha" name="senha" type="password" autoComplete="current-password" value={estado.senha} onChange={(evento) => setEstado((atual) => ({ ...atual, senha: evento.target.value }))} required />
        {estado.erro ? <p className="aviso" role="alert">{estado.erro}</p> : null}
        <button type="submit" disabled={estado.enviando} aria-busy={estado.enviando}>{estado.enviando ? "Entrando…" : "Entrar"}</button>
        <button type="button" className="secundario" onClick={() => void recuperar()}>Esqueci a senha</button>
      </form>
    </main>
  );
}
