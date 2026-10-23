/**
 * Os playbooks iniciais do Agent Dute (parte 5.5f): cópia literal de
 * INITIAL_PLAYBOOKS de functions/wms/src/domain/agent-playbooks.ts, que o
 * núcleo carrega para o cliente ativo. Entram como pendentes e só valem
 * depois de aprovados pela coordenação. O teste agente-revisao.test.ts trava
 * a cópia: não edite aqui sem editar lá.
 */

export type PlaybookAudience = "equipe" | "todos";

export type InitialPlaybook = {
  slug: string;
  title: string;
  audience: PlaybookAudience;
  when: string;
  steps: string[];
  open_points: string[];
};

export const INITIAL_PLAYBOOKS: InitialPlaybook[] = [
  {
    slug: "aprovar",
    title: "Aprovar uma solicitação do cliente",
    audience: "equipe",
    when: "Chegou um pedido ou um aviso de envio do cliente aguardando decisão.",
    steps: [
      "Abra Pedidos › Em aberto, no bloco Para aprovar. As mais urgentes e mais antigas aparecem primeiro.",
      "Confira cliente, itens, quantidades e a observação (destino, data, NF).",
      "Pedido: confira se há saldo dos itens. Se faltar, o sistema recusa a aprovação com \"Saldo insuficiente\".",
      "Aviso de envio: confira NF, itens esperados e data prevista de chegada.",
      "Clique em Aprovar. O pedido reserva o estoque e vai para Para separar; o aviso de envio vira uma chegada prevista em Estoque › Receber.",
      "Se faltar dado ou saldo, clique em Recusar e escreva o motivo. O cliente vê esse texto no portal.",
    ],
    open_points: [
      "Prazo para decidir uma solicitação (ex.: no mesmo dia útil).",
      "Quem pode aprovar e se há limite (quantidade, item especial).",
      "Quando ligar para o cliente antes de recusar.",
    ],
  },
  {
    slug: "receber",
    title: "Receber mercadoria",
    audience: "equipe",
    when: "A mercadoria chegou na Dutelog, com ou sem aviso de envio do cliente.",
    steps: [
      "Abra Estoque › Receber. Abra a chegada prevista (aviso aprovado) ou registre uma chegada avulsa.",
      "Conte fisicamente cada item e informe a quantidade contada em cada linha.",
      "Salve a conferência. O sistema marca cada linha como OK, falta ou sobra.",
      "Tudo OK: conclua a entrada. Só nesse momento o saldo fica disponível para o cliente.",
      "Se houver falta, sobra ou avaria, siga o playbook Recebimento com divergência.",
    ],
    open_points: [
      "Se a NF é conferida contra o pedido de compra do cliente, e por quem.",
      "Horário de recebimento e quem pode assinar o canhoto.",
      "Onde o volume fica até ser guardado.",
    ],
  },
  {
    slug: "divergencia",
    title: "Recebimento com divergência (falta, sobra ou avaria)",
    audience: "equipe",
    when: "Na conferência, a quantidade não bate com o esperado ou algum volume chegou danificado.",
    steps: [
      "Informe na conferência a quantidade real contada. O sistema sinaliza a falta ou a sobra na linha.",
      "Para concluir uma entrada com divergência, escreva a justificativa de fechamento. Sem ela o sistema não conclui.",
      "O estoque entra só com a quantidade conferida, nunca com a da NF.",
    ],
    open_points: [
      "O que fazer com item avariado: se entra na contagem, se é fotografado e onde fica guardado.",
      "Como e em quanto tempo avisar o cliente (e o fornecedor, se for o caso).",
      "Se sobra é aceita no estoque ou devolvida.",
    ],
  },
  {
    slug: "separar",
    title: "Separar e embalar um pedido",
    audience: "equipe",
    when: "Um pedido aprovado está em Para separar.",
    steps: [
      "Abra Pedidos › Em aberto, no bloco Para separar.",
      "Separe fisicamente os itens e confira cada quantidade.",
      "Embale e anote o número do lacre.",
      "Clique em Separado e informe o lacre. O sistema registra a separação e a embalagem, e o pedido vai para Para entregar.",
      "Faltou item ou veio avariado: não marque como separado.",
    ],
    open_points: [
      "Quem avisar, e como, quando falta item ou há avaria na separação.",
      "Se a separação é conferida por uma segunda pessoa.",
      "Padrão de embalagem e de lacre.",
    ],
  },
  {
    slug: "entregar",
    title: "Entregar um pedido",
    audience: "equipe",
    when: "O pedido está em Para entregar.",
    steps: [
      "Abra Pedidos › Em aberto, no bloco Para entregar.",
      "Na saída, informe quem levou e a placa.",
      "Na entrega, informe quem recebeu (opcional) e confirme Entregue.",
      "O sistema baixa o estoque, consome a reserva e fecha o pedido. O cliente vê como entregue no portal.",
    ],
    open_points: [
      "Se o canhoto ou comprovante assinado é obrigatório, e onde fica guardado.",
      "Janelas de entrega por local (ex.: a anotação já aprovada da Faria Lima, até 11h).",
    ],
  },
  {
    slug: "pedido-portal",
    title: "Como fazer um pedido pelo portal",
    audience: "todos",
    when: "O cliente quer retirar itens do estoque dele.",
    steps: [
      "Em Estoque, busque o item, escolha o tamanho e a quantidade e clique em Adicionar.",
      "Abra Pedido, no topo da tela, e preencha o destino (agência, prédio ou centro de custo), Para quando e, na observação, contato e janela de entrega.",
      "Confira e envie. A Dutelog aprova, separa e entrega.",
      "Acompanhe em Pedidos: aguardando aprovação, separando, a caminho e entregue.",
      "Também dá para pedir ao Agent Dute, por exemplo: \"monta um pedido de 10 polos M para a Faria Lima na sexta\". Ele prepara o rascunho; quem confere e envia é você.",
    ],
    open_points: [
      "Antecedência mínima para pedir.",
      "Horários de entrega e como pedir algo urgente.",
    ],
  },
  {
    slug: "envio-portal",
    title: "Como avisar um envio de mercadoria para a Dutelog",
    audience: "todos",
    when: "O cliente vai mandar mercadoria para o estoque da Dutelog.",
    steps: [
      "Em Envios para a Dutelog, crie um aviso: anexe a NF (o sistema lê os itens) ou informe os itens, e a data prevista de chegada.",
      "Envie. A Dutelog aprova o aviso e confere a mercadoria quando ela chega.",
      "Acompanhe em Envios para a Dutelog: avisado, chegou e foi conferido (com quanto chegou de fato e as diferenças) ou recusado com o motivo. Enquanto está só avisado, dá para cancelar.",
      "Também dá para anexar a NF no Agent Dute; ele prepara o aviso para você conferir e enviar.",
    ],
    open_points: [
      "Endereço e horário de recebimento da Dutelog.",
      "Se é preciso agendar a chegada.",
    ],
  },
];
