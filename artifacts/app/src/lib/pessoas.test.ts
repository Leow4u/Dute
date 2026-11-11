import { describe, expect, it } from "vitest";

import { LEGACY_CUSTOMER_CODE } from "./active-customer";
import {
  buildPeople,
  clientIndex,
  countSituations,
  inSituation,
  isClientPerson,
  matchesSearch,
  peopleOfCustomer,
  pendingInvitesLabel,
  personInitials,
  personStatus,
  portalPeopleLabel,
  teamInFilter,
  teamRoles,
  type Invite,
  type Person,
} from "./pessoas";

/** As regras de Pessoas e acessos que a página de Pessoas e a página do cliente usam iguais. */

const USUARIOS: Array<Record<string, unknown>> = [
  { id: "leo", nome: "Leonardo", email: "diretoria@dutelog.example", role: "owner" },
  { id: "marina", nome: "Marina Alves", email: "marina@dutelog.example", role: "interno" },
  { id: "ana", nome: "Ana Souza", email: "ana@btg.example", role: "cliente", customer_code: "BTG Pactual" },
  { id: "legado", nome: "Pessoa antiga", email: "antiga@btg.example", role: "cliente" },
  { id: "bia", nome: "Bia Lima", email: "bia@itau.example", role: "cliente", customer_code: "ITAU", access_disabled: true },
  { id: "oculta", nome: "Oculta", email: "oculta@itau.example", role: "cliente", customer_code: "ITAU", access_disabled: true, directory_hidden: true },
];
const CONVITES: Invite[] = [
  { id: "t1", nome: "Tiago Moreira", email: "tiago@btg.example", role: "cliente", customer_code: "BTG Pactual", status: "pending", email_status: "sent", email_requested_at: "2026-10-20T12:00:00.000Z" },
  { id: "t2", nome: "Carla Mendes", email: "carla@dutelog.example", role: "campo", status: "pending", email_status: "failed" },
  { id: "t3", nome: "Usado", email: "usado@btg.example", role: "cliente", customer_code: "BTG Pactual", status: "used" },
];

const pessoas = buildPeople(USUARIOS, CONVITES);
const porNome = (nome: string) => pessoas.find((pessoa) => pessoa.name === nome)!;

describe("a lista de pessoas", () => {
  it("junta os perfis e os convites pendentes, sem quem saiu da lista nem o convite usado", () => {
    expect(pessoas.map((pessoa) => pessoa.name)).toEqual([
      "Leonardo", "Marina Alves", "Ana Souza", "Pessoa antiga", "Carla Mendes", "Tiago Moreira", "Bia Lima",
    ]);
    expect(porNome("Tiago Moreira")).toMatchObject({ kind: "invite", state: "pending", customerCode: "BTG Pactual" });
    expect(porNome("Bia Lima").state).toBe("removed");
  });

  it("separa a equipe das pessoas do portal pelo perfil", () => {
    expect(pessoas.filter((pessoa) => !isClientPerson(pessoa)).map((pessoa) => pessoa.name)).toEqual(["Leonardo", "Marina Alves", "Carla Mendes"]);
  });

  it("'Todos' é quem tem acesso ou convite; os arquivados ficam à parte", () => {
    const equipe = pessoas.filter((pessoa) => !isClientPerson(pessoa));
    expect(countSituations(equipe)).toEqual({ todos: 3, ativos: 2, pendentes: 1, arquivados: 0 });
    expect(countSituations(pessoas)).toEqual({ todos: 6, ativos: 4, pendentes: 2, arquivados: 1 });
    expect(inSituation(porNome("Bia Lima"), "todos")).toBe(false);
    expect(inSituation(porNome("Bia Lima"), "arquivados")).toBe(true);
  });

  it("a situação do convite diz o envio do e-mail e o dia do pedido", () => {
    expect(personStatus(porNome("Tiago Moreira"))).toEqual({ label: "Convite pendente", detail: "E-mail enviado · 20/10" });
    expect(personStatus(porNome("Carla Mendes"))).toEqual({ label: "Convite pendente", detail: "Falha no envio do e-mail" });
    expect(personStatus(porNome("Ana Souza"))).toEqual({ label: "Ativo", detail: null });
    expect(personStatus(porNome("Bia Lima"))).toEqual({ label: "Acesso removido", detail: null });
  });

  it("a equipe filtrada pela situação e pelo perfil; os perfis do filtro são os que a equipe tem", () => {
    expect(teamInFilter(pessoas, "todos", "todos").map((pessoa) => pessoa.name)).toEqual(["Leonardo", "Marina Alves", "Carla Mendes"]);
    expect(teamInFilter(pessoas, "todos", "interno").map((pessoa) => pessoa.name)).toEqual(["Marina Alves"]);
    expect(teamInFilter(pessoas, "pendentes", "todos").map((pessoa) => pessoa.name)).toEqual(["Carla Mendes"]);
    expect(teamInFilter(pessoas, "ativos", "campo")).toEqual([]);
    expect(teamRoles(pessoas)).toEqual(["owner", "interno", "campo"]);
  });

  it("a busca acha pelo nome ou pelo e-mail, sem acento nem maiúscula", () => {
    expect(matchesSearch(porNome("Marina Alves"), "MARINA@")).toBe(true);
    expect(matchesSearch({ name: "João Conceição", email: "joao@x.example" }, "conceicao")).toBe(true);
    expect(matchesSearch(porNome("Marina Alves"), "tiago")).toBe(false);
    expect(matchesSearch(porNome("Marina Alves"), "  ")).toBe(true);
  });
});

describe("os clientes", () => {
  const CLIENTES = [
    { code: "BTG Pactual", name: "BTG", archived: false, portalActive: true },
    { code: "TECH", name: "TechPrime Escritórios", archived: false, portalActive: true },
    { code: "ITAU", name: "Itaú Unibanco", archived: false, portalActive: false },
    { code: "SAFRA", name: "Banco Safra", archived: true, portalActive: false },
  ];

  it("o índice: uma linha por cliente com portal, com quem entra e os convites; o sem portal só com gente", () => {
    const indice = clientIndex(pessoas, CLIENTES);
    expect(indice.map((linha) => [linha.name, linha.ativos.map((p) => p.name), linha.pendentes.map((p) => p.name)])).toEqual([
      ["BTG", ["Ana Souza", ...(LEGACY_CUSTOMER_CODE === "BTG Pactual" ? ["Pessoa antiga"] : [])], ["Tiago Moreira"]],
      ...(LEGACY_CUSTOMER_CODE === "BTG Pactual" ? [] : [[LEGACY_CUSTOMER_CODE, ["Pessoa antiga"], []]]),
      ["TechPrime Escritórios", [], []],
    ]);
  });

  it("o cliente fora do cadastro com gente aparece pelo código", () => {
    const outra: Person = { ...porNome("Ana Souza"), key: "user:x", id: "x", name: "Xavier", customerCode: "NOVO" };
    expect(clientIndex([outra], CLIENTES).map((linha) => linha.name)).toEqual(["NOVO", "BTG", "TechPrime Escritórios"].sort((a, b) => a.localeCompare(b, "pt-BR")));
  });

  it("as pessoas do portal de um cliente: ativas, convites e arquivadas", () => {
    expect(peopleOfCustomer(pessoas, "ITAU")).toEqual({ ativos: [], pendentes: [], arquivados: [porNome("Bia Lima")] });
    const btg = peopleOfCustomer(pessoas, "BTG Pactual");
    expect(btg.pendentes.map((p) => p.name)).toEqual(["Tiago Moreira"]);
  });

  it("os rótulos das contagens", () => {
    expect([portalPeopleLabel(0), portalPeopleLabel(1), portalPeopleLabel(4)]).toEqual(["Ninguém no portal", "1 pessoa", "4 pessoas"]);
    expect([pendingInvitesLabel(1), pendingInvitesLabel(2)]).toEqual(["1 convite pendente", "2 convites pendentes"]);
    expect([personInitials("Ana Souza"), personInitials("leonardo"), personInitials("123")]).toEqual(["AS", "L", "?"]);
  });
});
