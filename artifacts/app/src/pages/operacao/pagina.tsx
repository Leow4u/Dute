import { useEffect, useRef, useState } from "react";
import { collection } from "firebase/firestore";
import { useSearch } from "wouter";

import {
  colaboradorDaLeitura,
  emailDoAppNaAlteracao,
  porNome,
  veiculoDaLeitura,
  type ColaboradorDaLista,
  type VeiculoDaLista,
} from "@/lib/operacao/cadastro";
import { chamarOperacao, mensagemDoErro, novaChave } from "@/lib/operacao/api";
import { useLeitura } from "@/lib/operacao/leitura";
import { colaboradorDaBusca, veiculoDaBusca } from "@/lib/operacao/navegacao";

import {
  ColaboradoresView,
  VeiculosView,
  fichaDoColaborador,
  fichaDoVeiculo,
  fichaVaziaColaborador,
  fichaVaziaVeiculo,
  type EstadoDaLista,
  type FichaColaborador,
  type FichaVeiculo,
} from "./cadastro-view";

type FichaAberta<T> = { chave: string; valores: T };

function estadoDe<T>(leitura: { itens: T[] | null; erro: boolean }): EstadoDaLista {
  if (leitura.erro) return "erro";
  if (!leitura.itens) return "carregando";
  return "pronto";
}

export function PaginaColaboradores() {
  const leitura = useLeitura("collaborators", (db) => collection(db, "collaborators"), colaboradorDaLeitura);
  const itens = porNome(leitura.itens ?? []);
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<(FichaAberta<FichaColaborador> & { pessoa: ColaboradorDaLista | null }) | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // O Início leva direto à ficha (/operacao/colaboradores?id=col_...): abre
  // quando o cadastro chega, uma vez por pedido.
  const pedido = colaboradorDaBusca(useSearch());
  const atendido = useRef<string | null>(null);
  useEffect(() => {
    if (!pedido || atendido.current === pedido || !leitura.itens) return;
    atendido.current = pedido;
    const pessoa = leitura.itens.find((item) => item.id === pedido);
    if (pessoa) setAberta({ chave: novaChave(), pessoa, valores: fichaDoColaborador(pessoa) });
  }, [pedido, leitura.itens]);

  async function gravar(dados: Record<string, unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await chamarOperacao("saveCollaborator", dados);
      setAberta(null);
    } catch (error) {
      setErro(mensagemDoErro(error));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <ColaboradoresView
      estado={estadoDe(leitura)}
      itens={itens}
      busca={busca}
      onBusca={setBusca}
      ficha={aberta?.valores ?? null}
      editando={aberta?.pessoa ?? null}
      onFicha={(valores) => setAberta((atual) => (atual ? { ...atual, valores } : atual))}
      onNovo={() => {
        setErro(null);
        setAberta({ chave: novaChave(), pessoa: null, valores: fichaVaziaColaborador() });
      }}
      onAbrir={(pessoa) => {
        setErro(null);
        setAberta({ chave: novaChave(), pessoa, valores: fichaDoColaborador(pessoa) });
      }}
      onFechar={() => {
        setErro(null);
        setAberta(null);
      }}
      ocupado={ocupado}
      erro={erro}
      onSalvar={() => {
        if (!aberta) return;
        const { valores, chave, pessoa } = aberta;
        const cnh = {
          cnh_categoria: valores.cnhCategoria || null,
          cnh_validade: valores.cnhValidade || null,
        };
        const vinculo = {
          vinculo: valores.vinculo,
          empresa: valores.vinculo === "terceiro" ? valores.empresa.trim() || null : null,
          papeis: valores.papeis,
        };
        if (!pessoa) {
          void gravar({
            action: "create",
            idempotency_key: chave,
            nome: valores.nome,
            cpf: valores.cpf,
            funcao: valores.funcao,
            telefone: valores.telefone || null,
            ...cnh,
            ...vinculo,
            usuario_email: valores.usuarioEmail.trim().toLowerCase() || null,
          });
          return;
        }
        void gravar({
          action: "update",
          idempotency_key: chave,
          id: pessoa.id,
          expected_edicao: pessoa.edicao,
          nome: valores.nome,
          cpf: valores.cpf,
          funcao: valores.funcao,
          telefone: valores.telefone || null,
          ...cnh,
          ...vinculo,
          ...emailDoAppNaAlteracao(pessoa.usuarioEmail, valores.usuarioEmail),
        });
      }}
      onAtivo={(ativo) => {
        const pessoa = aberta?.pessoa;
        if (!pessoa) return;
        void gravar({
          action: "set_active",
          idempotency_key: novaChave(),
          id: pessoa.id,
          expected_edicao: pessoa.edicao,
          ativo,
        });
      }}
    />
  );
}

export function PaginaVeiculos() {
  const leitura = useLeitura("vehicles", (db) => collection(db, "vehicles"), veiculoDaLeitura);
  const itens = porNome(leitura.itens ?? []);
  const [busca, setBusca] = useState("");
  const [aberta, setAberta] = useState<(FichaAberta<FichaVeiculo> & { veiculo: VeiculoDaLista | null }) | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  // O Início leva direto à ficha (/operacao/veiculos?id=vei_..., parte 3.13b):
  // abre quando o cadastro chega, uma vez por pedido.
  const pedido = veiculoDaBusca(useSearch());
  const atendido = useRef<string | null>(null);
  useEffect(() => {
    if (!pedido || atendido.current === pedido || !leitura.itens) return;
    atendido.current = pedido;
    const veiculo = leitura.itens.find((item) => item.id === pedido);
    if (veiculo) setAberta({ chave: novaChave(), veiculo, valores: fichaDoVeiculo(veiculo) });
  }, [pedido, leitura.itens]);

  async function gravar(dados: Record<string, unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await chamarOperacao("saveVehicle", dados);
      setAberta(null);
    } catch (error) {
      setErro(mensagemDoErro(error));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <VeiculosView
      estado={estadoDe(leitura)}
      itens={itens}
      busca={busca}
      onBusca={setBusca}
      ficha={aberta?.valores ?? null}
      editando={aberta?.veiculo ?? null}
      onFicha={(valores) => setAberta((atual) => (atual ? { ...atual, valores } : atual))}
      onNovo={() => {
        setErro(null);
        setAberta({ chave: novaChave(), veiculo: null, valores: fichaVaziaVeiculo() });
      }}
      onAbrir={(veiculo) => {
        setErro(null);
        setAberta({ chave: novaChave(), veiculo, valores: fichaDoVeiculo(veiculo) });
      }}
      onFechar={() => {
        setErro(null);
        setAberta(null);
      }}
      ocupado={ocupado}
      erro={erro}
      onSalvar={() => {
        if (!aberta) return;
        const { valores, chave, veiculo } = aberta;
        const capacidade = {
          capacidade_kg: Number(valores.capacidadeKg),
          capacidade_m3: Number(valores.capacidadeM3.replace(",", ".")),
        };
        const dono = {
          dono: valores.dono,
          empresa: valores.dono === "terceiro" ? valores.empresa.trim() || null : null,
          revisao_em: valores.revisaoEm || null,
        };
        if (!veiculo) {
          void gravar({
            action: "create",
            idempotency_key: chave,
            placa: valores.placa,
            tipo: valores.tipo,
            modelo: valores.modelo || null,
            ...capacidade,
            ...dono,
          });
          return;
        }
        void gravar({
          action: "update",
          idempotency_key: chave,
          id: veiculo.id,
          expected_edicao: veiculo.edicao,
          placa: valores.placa,
          tipo: valores.tipo,
          modelo: valores.modelo || null,
          ...capacidade,
          ...dono,
        });
      }}
      onAtivo={(ativo) => {
        const veiculo = aberta?.veiculo;
        if (!veiculo) return;
        void gravar({
          action: "set_active",
          idempotency_key: novaChave(),
          id: veiculo.id,
          expected_edicao: veiculo.edicao,
          ativo,
        });
      }}
    />
  );
}
