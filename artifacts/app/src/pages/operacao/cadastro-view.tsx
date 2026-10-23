import type { FormEvent, ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  CATEGORIAS_CNH,
  DONOS_DE_VEICULO,
  DONO_ROTULO,
  PAPEIS_DE_CAMPO,
  PAPEL_ROTULO,
  VINCULOS,
  VINCULO_ROTULO,
  resumoDoColaborador,
  resumoDoVeiculo,
  type ColaboradorDaLista,
  type DonoDeVeiculo,
  type PapelDeCampo,
  type VeiculoDaLista,
  type Vinculo,
} from "@/lib/operacao/cadastro";

export type EstadoDaLista = "carregando" | "erro" | "pronto";

export type FichaColaborador = {
  nome: string;
  cpf: string;
  funcao: string;
  telefone: string;
  cnhCategoria: string;
  cnhValidade: string;
  vinculo: Vinculo;
  empresa: string;
  papeis: PapelDeCampo[];
  usuarioEmail: string;
};

export type FichaVeiculo = {
  placa: string;
  tipo: string;
  modelo: string;
  capacidadeKg: string;
  capacidadeM3: string;
  dono: DonoDeVeiculo;
  empresa: string;
  revisaoEm: string;
};

const FICHA_COLABORADOR: FichaColaborador = {
  nome: "",
  cpf: "",
  funcao: "",
  telefone: "",
  cnhCategoria: "",
  cnhValidade: "",
  vinculo: "proprio",
  empresa: "",
  papeis: [],
  usuarioEmail: "",
};

const FICHA_VEICULO: FichaVeiculo = {
  placa: "",
  tipo: "",
  modelo: "",
  capacidadeKg: "",
  capacidadeM3: "",
  dono: "proprio",
  empresa: "",
  revisaoEm: "",
};

export function fichaVaziaColaborador(): FichaColaborador {
  return { ...FICHA_COLABORADOR, papeis: [] };
}

export function fichaVaziaVeiculo(): FichaVeiculo {
  return { ...FICHA_VEICULO };
}

export function fichaDoColaborador(item: ColaboradorDaLista): FichaColaborador {
  return {
    nome: item.nome,
    cpf: item.cpf,
    funcao: item.funcao,
    telefone: item.telefone,
    cnhCategoria: item.cnhCategoria,
    cnhValidade: item.cnhValidade,
    vinculo: item.vinculo,
    empresa: item.empresa,
    papeis: [...item.papeis],
    usuarioEmail: item.usuarioEmail,
  };
}

export function fichaDoVeiculo(item: VeiculoDaLista): FichaVeiculo {
  return {
    placa: item.placa,
    tipo: item.tipo,
    modelo: item.modelo,
    capacidadeKg: item.capacidadeKg,
    capacidadeM3: item.capacidadeM3,
    dono: item.dono,
    empresa: item.empresa,
    revisaoEm: item.revisaoEm,
  };
}

/** Marca ou desmarca um papel, mantendo a ordem da lista. */
export function alternarPapel(papeis: readonly PapelDeCampo[], papel: PapelDeCampo, marcado: boolean): PapelDeCampo[] {
  return PAPEIS_DE_CAMPO.filter((item) => (item === papel ? marcado : papeis.includes(item)));
}

function buscaInclui(texto: string, busca: string): boolean {
  const termo = busca.trim().toLocaleLowerCase("pt-BR");
  if (!termo) return true;
  return texto.toLocaleLowerCase("pt-BR").includes(termo);
}

function Campo({ id, rotulo, children }: { id: string; rotulo: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{rotulo}</Label>
      {children}
    </div>
  );
}

const campoClasse = "flex h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground";

function Moldura({
  titulo,
  estado,
  erro,
  vazio,
  novo,
  onNovo,
  busca,
  onBusca,
  children,
}: {
  titulo: string;
  estado: EstadoDaLista;
  erro: string | null;
  vazio: string;
  novo: string;
  onNovo: () => void;
  busca: string;
  onBusca: (value: string) => void;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold text-foreground">{titulo}</h1>
        <Button type="button" onClick={onNovo}>{novo}</Button>
      </header>
      {erro ? <p role="alert" className="text-sm text-destructive">{erro}</p> : null}
      <Campo id={`${titulo}-busca`} rotulo="Busca">
        <Input id={`${titulo}-busca`} value={busca} onChange={(event) => onBusca(event.target.value)} />
      </Campo>
      {estado === "carregando" ? <p className="text-sm text-muted-foreground">Carregando</p> : null}
      {estado === "erro" ? <p role="alert" className="text-sm text-destructive">Não foi possível carregar o cadastro.</p> : null}
      {estado === "pronto" && !children ? <p className="text-sm text-muted-foreground">{vazio}</p> : null}
      {estado === "pronto" ? children : null}
    </section>
  );
}

function Linha({
  titulo,
  detalhe,
  ativo,
  onAbrir,
}: {
  titulo: string;
  detalhe: string;
  ativo: boolean;
  onAbrir: () => void;
}) {
  return (
    <li className="border-b border-border last:border-b-0">
      <button type="button" onClick={onAbrir} className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-surface-hover">
        <span className={ativo ? "font-medium text-foreground" : "font-medium text-muted-foreground"}>{titulo}</span>
        <span className="text-sm text-muted-foreground">{detalhe}</span>
        {ativo ? null : <span className="text-sm text-muted-foreground">Desativado</span>}
      </button>
    </li>
  );
}

export function ColaboradoresView({
  estado,
  itens,
  busca,
  onBusca,
  ficha,
  editando,
  onFicha,
  onNovo,
  onAbrir,
  onFechar,
  onSalvar,
  onAtivo,
  ocupado,
  erro,
}: {
  estado: EstadoDaLista;
  itens: ColaboradorDaLista[];
  busca: string;
  onBusca: (value: string) => void;
  ficha: FichaColaborador | null;
  editando: ColaboradorDaLista | null;
  onFicha: (ficha: FichaColaborador) => void;
  onNovo: () => void;
  onAbrir: (item: ColaboradorDaLista) => void;
  onFechar: () => void;
  onSalvar: () => void;
  onAtivo: (ativo: boolean) => void;
  ocupado: boolean;
  erro: string | null;
}) {
  const visiveis = itens.filter((item) => buscaInclui(`${item.nome} ${item.funcao} ${item.cpf} ${item.telefone} ${item.empresa}`, busca));
  if (ficha) {
    return (
      <form
        className="flex max-w-xl flex-col gap-5"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSalvar();
        }}
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-foreground">{editando ? editando.nome : "Novo colaborador"}</h1>
          <Button type="submit" disabled={ocupado}>Salvar</Button>
        </header>
        {erro ? <p role="alert" className="text-sm text-destructive">{erro}</p> : null}
        <Campo id="colaborador-nome" rotulo="Nome">
          <Input id="colaborador-nome" value={ficha.nome} onChange={(event) => onFicha({ ...ficha, nome: event.target.value })} />
        </Campo>
        <Campo id="colaborador-cpf" rotulo="CPF">
          <Input id="colaborador-cpf" inputMode="numeric" value={ficha.cpf} onChange={(event) => onFicha({ ...ficha, cpf: event.target.value })} />
        </Campo>
        <Campo id="colaborador-funcao" rotulo="Função">
          <Input id="colaborador-funcao" value={ficha.funcao} onChange={(event) => onFicha({ ...ficha, funcao: event.target.value })} />
        </Campo>
        <Campo id="colaborador-telefone" rotulo="Telefone">
          <Input id="colaborador-telefone" type="tel" value={ficha.telefone} onChange={(event) => onFicha({ ...ficha, telefone: event.target.value })} />
        </Campo>
        <Campo id="colaborador-cnh" rotulo="Categoria da CNH">
          <select id="colaborador-cnh" className={campoClasse} value={ficha.cnhCategoria} onChange={(event) => onFicha({ ...ficha, cnhCategoria: event.target.value })}>
            <option value="">Sem CNH</option>
            {CATEGORIAS_CNH.map((categoria) => <option key={categoria} value={categoria}>{categoria}</option>)}
          </select>
        </Campo>
        <Campo id="colaborador-validade" rotulo="Validade da CNH">
          <Input id="colaborador-validade" type="date" value={ficha.cnhValidade} onChange={(event) => onFicha({ ...ficha, cnhValidade: event.target.value })} />
        </Campo>
        <Campo id="colaborador-vinculo" rotulo="Vínculo">
          <select
            id="colaborador-vinculo"
            className={campoClasse}
            value={ficha.vinculo}
            onChange={(event) => onFicha({ ...ficha, vinculo: event.target.value as Vinculo })}
          >
            {VINCULOS.map((vinculo) => <option key={vinculo} value={vinculo}>{VINCULO_ROTULO[vinculo]}</option>)}
          </select>
        </Campo>
        {ficha.vinculo === "terceiro" ? (
          <Campo id="colaborador-empresa" rotulo="Empresa">
            <Input id="colaborador-empresa" value={ficha.empresa} onChange={(event) => onFicha({ ...ficha, empresa: event.target.value })} />
          </Campo>
        ) : null}
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-foreground">Papéis</legend>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {PAPEIS_DE_CAMPO.map((papel) => (
              <label key={papel} className="flex items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  className="size-4"
                  checked={ficha.papeis.includes(papel)}
                  onChange={(event) => onFicha({ ...ficha, papeis: alternarPapel(ficha.papeis, papel, event.target.checked) })}
                />
                {PAPEL_ROTULO[papel]}
              </label>
            ))}
          </div>
        </fieldset>
        <Campo id="colaborador-app" rotulo="E-mail do app">
          <Input id="colaborador-app" type="email" value={ficha.usuarioEmail} onChange={(event) => onFicha({ ...ficha, usuarioEmail: event.target.value })} />
        </Campo>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={onFechar}>Voltar</Button>
          {editando ? (
            <Button type="button" variant="secondary" disabled={ocupado} onClick={() => onAtivo(!editando.ativo)}>
              {editando.ativo ? "Desativar" : "Reativar"}
            </Button>
          ) : null}
        </div>
      </form>
    );
  }
  return (
    <Moldura titulo="Colaboradores" estado={estado} erro={erro} vazio="Nenhum colaborador" novo="Novo colaborador" onNovo={onNovo} busca={busca} onBusca={onBusca}>
      {visiveis.length ? (
        <ul className="overflow-hidden rounded-lg border border-border bg-card">
          {visiveis.map((item) => (
            <Linha key={item.id} titulo={item.nome} detalhe={resumoDoColaborador(item)} ativo={item.ativo} onAbrir={() => onAbrir(item)} />
          ))}
        </ul>
      ) : null}
    </Moldura>
  );
}

export function VeiculosView({
  estado,
  itens,
  busca,
  onBusca,
  ficha,
  editando,
  onFicha,
  onNovo,
  onAbrir,
  onFechar,
  onSalvar,
  onAtivo,
  ocupado,
  erro,
}: {
  estado: EstadoDaLista;
  itens: VeiculoDaLista[];
  busca: string;
  onBusca: (value: string) => void;
  ficha: FichaVeiculo | null;
  editando: VeiculoDaLista | null;
  onFicha: (ficha: FichaVeiculo) => void;
  onNovo: () => void;
  onAbrir: (item: VeiculoDaLista) => void;
  onFechar: () => void;
  onSalvar: () => void;
  onAtivo: (ativo: boolean) => void;
  ocupado: boolean;
  erro: string | null;
}) {
  const visiveis = itens.filter((item) => buscaInclui(`${item.placa} ${item.tipo} ${item.modelo} ${item.empresa}`, busca));
  if (ficha) {
    return (
      <form
        className="flex max-w-xl flex-col gap-5"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          onSalvar();
        }}
      >
        <header className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-2xl font-semibold text-foreground">{editando ? editando.placa : "Novo veículo"}</h1>
          <Button type="submit" disabled={ocupado}>Salvar</Button>
        </header>
        {erro ? <p role="alert" className="text-sm text-destructive">{erro}</p> : null}
        <Campo id="veiculo-placa" rotulo="Placa">
          <Input id="veiculo-placa" value={ficha.placa} onChange={(event) => onFicha({ ...ficha, placa: event.target.value })} />
        </Campo>
        <Campo id="veiculo-tipo" rotulo="Tipo">
          <Input id="veiculo-tipo" value={ficha.tipo} onChange={(event) => onFicha({ ...ficha, tipo: event.target.value })} />
        </Campo>
        <Campo id="veiculo-modelo" rotulo="Modelo">
          <Input id="veiculo-modelo" value={ficha.modelo} onChange={(event) => onFicha({ ...ficha, modelo: event.target.value })} />
        </Campo>
        <Campo id="veiculo-kg" rotulo="Capacidade (kg)">
          <Input id="veiculo-kg" inputMode="numeric" value={ficha.capacidadeKg} onChange={(event) => onFicha({ ...ficha, capacidadeKg: event.target.value })} />
        </Campo>
        <Campo id="veiculo-m3" rotulo="Capacidade (m³)">
          <Input id="veiculo-m3" inputMode="decimal" value={ficha.capacidadeM3} onChange={(event) => onFicha({ ...ficha, capacidadeM3: event.target.value })} />
        </Campo>
        <Campo id="veiculo-dono" rotulo="Dono">
          <select
            id="veiculo-dono"
            className={campoClasse}
            value={ficha.dono}
            onChange={(event) => onFicha({ ...ficha, dono: event.target.value as DonoDeVeiculo })}
          >
            {DONOS_DE_VEICULO.map((dono) => <option key={dono} value={dono}>{DONO_ROTULO[dono]}</option>)}
          </select>
        </Campo>
        {ficha.dono === "terceiro" ? (
          <Campo id="veiculo-empresa" rotulo="Empresa">
            <Input id="veiculo-empresa" value={ficha.empresa} onChange={(event) => onFicha({ ...ficha, empresa: event.target.value })} />
          </Campo>
        ) : null}
        <Campo id="veiculo-revisao" rotulo="Próxima revisão">
          <Input id="veiculo-revisao" type="date" value={ficha.revisaoEm} onChange={(event) => onFicha({ ...ficha, revisaoEm: event.target.value })} />
        </Campo>
        <div className="flex flex-wrap gap-3">
          <Button type="button" variant="secondary" onClick={onFechar}>Voltar</Button>
          {editando ? (
            <Button type="button" variant="secondary" disabled={ocupado} onClick={() => onAtivo(!editando.ativo)}>
              {editando.ativo ? "Desativar" : "Reativar"}
            </Button>
          ) : null}
        </div>
      </form>
    );
  }
  return (
    <Moldura titulo="Veículos" estado={estado} erro={erro} vazio="Nenhum veículo" novo="Novo veículo" onNovo={onNovo} busca={busca} onBusca={onBusca}>
      {visiveis.length ? (
        <ul className="overflow-hidden rounded-lg border border-border bg-card">
          {visiveis.map((item) => (
            <Linha key={item.id} titulo={item.placa} detalhe={[item.tipo, resumoDoVeiculo(item)].filter(Boolean).join(" · ")} ativo={item.ativo} onAbrir={() => onAbrir(item)} />
          ))}
        </ul>
      ) : null}
    </Moldura>
  );
}
