import { useEffect, useState } from "react";
import { onAuthStateChanged, signOut, type User } from "firebase/auth";
import { doc, onSnapshot } from "firebase/firestore";

import { Entrar } from "./entrar";
import { firebaseAuth, firebaseConfigError, firestore } from "./firebase";
import { Painel } from "./painel";
import { podeVerZap } from "./papel";

type Sessao =
  | { estado: "config" }
  | { estado: "carregando" }
  | { estado: "fora" }
  | { estado: "perfil"; usuario: User }
  | { estado: "negado"; usuario: User }
  | { estado: "dentro"; usuario: User; nome: string | null };

export function App() {
  const sessao = useSessao();

  if (sessao.estado === "config") {
    return (
      <main className="entrada">
        <section className="cartao">
          <h1>Painel do Zap</h1>
          <p className="aviso" role="alert">{firebaseConfigError}</p>
        </section>
      </main>
    );
  }
  if (sessao.estado === "carregando" || sessao.estado === "perfil") {
    return <main className="entrada"><p className="carregando">Carregando…</p></main>;
  }
  if (sessao.estado === "fora") return <Entrar />;
  if (sessao.estado === "negado") {
    return (
      <main className="entrada">
        <section className="cartao">
          <h1>Painel do Zap</h1>
          <p>Este painel é só da administração.</p>
          <button type="button" onClick={() => firebaseAuth && void signOut(firebaseAuth)}>Sair</button>
        </section>
      </main>
    );
  }
  return <Painel nome={sessao.nome} aoSair={() => firebaseAuth && void signOut(firebaseAuth)} />;
}

function useSessao(): Sessao {
  const [usuario, setUsuario] = useState<User | null | undefined>(firebaseConfigError ? null : undefined);
  const [perfil, setPerfil] = useState<"carregando" | "negado" | { nome: string | null }>("carregando");

  useEffect(() => {
    if (!firebaseAuth || firebaseConfigError) return;
    return onAuthStateChanged(firebaseAuth, (proximo) => {
      setUsuario(proximo);
      setPerfil("carregando");
    });
  }, []);

  useEffect(() => {
    if (!usuario || !firestore) return;
    return onSnapshot(doc(firestore, "users", usuario.uid), (snap) => {
      const dados = snap.data();
      if (!podeVerZap(dados?.role, dados?.access_disabled)) {
        setPerfil("negado");
        return;
      }
      setPerfil({ nome: typeof dados?.nome === "string" ? dados.nome : null });
    }, () => setPerfil("negado"));
  }, [usuario]);

  if (firebaseConfigError) return { estado: "config" };
  if (usuario === undefined) return { estado: "carregando" };
  if (!usuario) return { estado: "fora" };
  if (perfil === "carregando") return { estado: "perfil", usuario };
  if (perfil === "negado") return { estado: "negado", usuario };
  return { estado: "dentro", usuario, nome: perfil.nome };
}
