# Ambiente local com emuladores

Para conferir as telas do Comercial de verdade, no navegador, sem tocar em
nenhuma nuvem: Auth, Firestore e Functions (as duas codebases, `functions/wms`
e `functions/comercial`) rodam na máquina, com dado sintético. O projeto
emulado é `dute-homolog`, porque a liberação do Comercial vale só nele
(`artifacts/app/src/lib/liberacao.ts` e `functions/comercial/src/domain/liberacao.ts`).

Nada aqui altera o `firebase.json`, o CI ou a produção. O modo local só existe
no servidor de desenvolvimento do Vite (`import.meta.env.DEV`) e só liga com
`VITE_FIREBASE_EMULATORS=1`; num build de produção não tem efeito
(`artifacts/app/src/lib/emuladores.test.ts` trava).

## Pré-requisitos

- Firebase CLI (`firebase --version`; aqui, 15.x). Sem ele global:
  `npx firebase-tools` no lugar de `firebase`.
- **Java 21 ou mais novo** no `PATH` para o emulador do Firestore. O Java 8 que
  costuma vir primeiro no `PATH` não serve. Na máquina do Leonardo há o JRE 21
  em `C:\Program Files\Eclipse Adoptium\jre-21.0.11.10-hotspot`.
- Dependências instaladas: `corepack pnpm install`, `npm --prefix functions/wms ci`
  e `npm --prefix functions/comercial ci`.

## Passo a passo

Cada bloco roda num terminal PowerShell próprio, sempre com a pasta na frente.

### 1. Compilar as functions

O emulador carrega `lib/`, não o TypeScript. Refaça o build sempre que mudar
código de `functions/`.

```powershell
cd C:\DEV\Dute
npm --prefix functions/wms run build
npm --prefix functions/comercial run build
```

### 2. Subir os emuladores (terminal 1)

```powershell
cd C:\DEV\Dute
$env:PATH = "C:\Program Files\Eclipse Adoptium\jre-21.0.11.10-hotspot\bin;" + $env:PATH
$env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"
firebase emulators:start --config firebase.local.json --project dute-homolog --only auth,firestore,functions
```

Espere `All emulators ready`. Portas: Auth 9199, Firestore 8188, Functions
5101 (UI desligada; hub 4410 e logging 4510). `FUNCTIONS_DISCOVERY_TIMEOUT`
é necessário porque o `functions/wms` demora mais de 10 s para carregar e o
padrão do CLI desiste nesse prazo (o Comercial subiria sozinho, o WMS não). Os
avisos sobre `firebase-functions` desatualizado e sobre Node 24 no lugar do 22
são esperados. As regras são as do `firestore.rules` da raiz.

Os dados vivem na memória do emulador: ao parar, somem. Para repetir a conferência,
suba de novo e rode o seed.

### 3. Semear os dados de teste (terminal 2)

```powershell
cd C:\DEV\Dute
$env:FIRESTORE_EMULATOR_HOST = "127.0.0.1:8188"
$env:FIREBASE_AUTH_EMULATOR_HOST = "127.0.0.1:9199"
node tools/emulador-local/seed.mjs
```

Para apagar o emulador e semear de novo sem reiniciá-lo, acrescente `--refazer`.

O seed grava pelas funções de domínio de `functions/comercial` (as mesmas das
callables), então recibos, eventos, números de demanda e RV saem como no
sistema. Ele **aborta sem fazer nada** se as duas variáveis acima faltarem ou
não apontarem para `127.0.0.1`/`localhost`.

O que ele cria:

- **Cadastro:** BTG legada (sem `stage`, com sigla), Cliente Alfa e Cliente Beta
  (clientes com sigla) e dois prospects (Prospect Gama e Prospect Delta).
- **Locais e contatos:** Sede e Filial do Alfa e Matriz do Beta; no Alfa, a
  contato Renata Teste da gerenciadora "Gerenciadora Teste Ltda" e o Paulo
  Teste; no Beta, a Lúcia Teste.
- **Contratos:** `alfa-2026` (por demanda, autorização por pedido e aceite,
  pagamento por faixas do dia da NF) e `beta-2026` (medição mensal).
- **Tabelas de preço** (pela carga real, CSV sintético de 13 itens): Padrão
  Dutelog, Cliente Alfa Comercial, Cliente Alfa Noturna e Cliente Beta
  Comercial.
- **Orçamentos do Alfa, em etapas diferentes:** 10001 rascunho, 10002 para
  aprovar (tabela Noturna), 10003 aguardando o cliente e 10004 demanda
  executada com a RV de execução validada, aguardando a autorização de
  faturamento.
- **Medição** do mês corrente do Beta, em rascunho, com uma linha.

Tudo é fictício; o e-mail dos usuários é `@teste.local`.

### 4. Subir o app (terminal 3)

O Vite deste app lê o `.env` da **raiz** do repositório (`envDir` em
`vite.config.ts`). Copie o modelo para lá:

```powershell
cd C:\DEV\Dute
Copy-Item artifacts\app\.env.local.example .env.local
corepack pnpm --filter "@workspace/app" run dev
```

Abra o endereço que o Vite mostrar (porta 5173, ou a de `PORT`). O
`.env.local` está no `.gitignore`. **Apague-o quando terminar**
(`Remove-Item C:\DEV\Dute\.env.local`): ele vale também para `vite build`, e
um build manual de publicação não deve levar a configuração fictícia. O
caminho normal de publicação é o CI, que não vê esse arquivo.

## Usuários de teste

Senha de todos, válida só no Auth emulado: `Teste@2026-local`.

| Papel | E-mail | O que deve ver |
| --- | --- | --- |
| owner | owner@teste.local | Tudo. É o único que aprova orçamento (botão "Aprovar" no 10002) |
| admin | admin@teste.local | Tudo do Comercial; não aprova orçamento |
| comercial | comercial@teste.local | Módulo Comercial (Orçamentos, Clientes, Contratos, Autorizações, Medições); monta e envia, não aprova |
| financeiro | financeiro@teste.local | Entrada do módulo financeiro; no Comercial só registra a autorização de faturamento (Autorizações), sem editar itens nem preço |
| interno | interno@teste.local | WMS e Operação; o Comercial não aparece, as callables recusam |
| cliente | cliente.btg@teste.local | Portal da BTG (armazenagem e faturas); sem Comercial |

Operação e campo nunca veem valores; preço só para owner, admin, financeiro e
comercial.

## Limitações

- O Storage não é emulado (anexos e fotos não funcionam). Os anexos do Comercial
  são referência em texto no v1.
- Agent Dute, Genkit e qualquer coisa que chame serviço externo (Gemini, e-mail)
  não funcionam: não há chaves nem rede de propósito.
- O WMS tem pouco dado: só a BTG e os clientes de teste, sem estoque, posições
  nem pedidos. Para ver o WMS cheio, cadastre pela própria tela.
- Convites e e-mail de redefinição de senha não saem; o Auth emulado só aceita
  e-mail e senha.

## Avisos de segurança

- **Não aponte nada daqui para a nuvem.** O seed recusa rodar sem as variáveis
  do emulador, mas o resto (o `firebase.local.json` e o `.env.local`) só é
  seguro porque as chaves são fictícias e o `VITE_FIREBASE_EMULATORS=1`
  redireciona o app. Sem essa variável, o app em desenvolvimento tentaria o
  Firebase real com chave inválida e falharia.
- Sem `--only auth,firestore,functions` o CLI tentaria subir outros emuladores
  e usar as credenciais da máquina. Use o comando exato acima. O aviso "calls to
  these services from the Functions emulator will affect production" é sobre
  serviços que as functions daqui não usam (Storage, Pub/Sub); as functions
  do WMS que tocam neles não devem ser exercitadas neste ambiente.
- A senha de teste está no código de propósito: é de emulador, não existe fora
  dele. Nunca reaproveite essa senha em outro lugar.
- Nenhum dado real entra aqui. Não copie exports de produção, `tmp/` nem
  `.secrets/` para o emulador.
- Pare tudo ao terminar: `Ctrl+C` no terminal dos emuladores e no do Vite.
