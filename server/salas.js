// =====================================================
// Salas, códigos de entrada e participantes
// =====================================================
const crypto = require('crypto');
const config = require('./config');
const { criarRouter, criarTransporte } = require('./midia');

// Sem 0/O e 1/I pra ninguém confundir na hora de digitar o código
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAMANHO_CODIGO = 6;

/** @type {Map<string, Sala>} código -> sala */
const salas = new Map();

// -----------------------------------------------------
// Utilitários
// -----------------------------------------------------
function gerarCodigo() {
  let codigo;
  do {
    codigo = Array.from({ length: TAMANHO_CODIGO }, () => ALFABETO[crypto.randomInt(ALFABETO.length)]).join('');
  } while (salas.has(codigo));
  return codigo;
}

// Aceita "abc-123", " ABC 123 " etc. e devolve "ABC123"
function normalizarCodigo(texto) {
  return String(texto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, TAMANHO_CODIGO);
}

// Remove caracteres de controle, espaços extras e corta no tamanho máximo
function limparTexto(texto, max) {
  return String(texto ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
}

function enviar(ws, evento, dados) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ evento, dados }));
}

// =====================================================
// Classe Sala
// =====================================================
class Sala {
  constructor(codigo, router) {
    this.codigo = codigo;
    this.router = router;
    /** @type {Map<string, Participante>} */
    this.participantes = new Map();
    this.chat = []; // últimas mensagens (quem entra depois vê o histórico)
    this.timerFechamento = null;
    this.agendarFechamento(); // se ninguém entrar, a sala some sozinha
  }

  // ---------- Fecha a sala depois de um tempo vazia ----------
  agendarFechamento() {
    clearTimeout(this.timerFechamento);
    this.timerFechamento = setTimeout(() => this.fechar(), config.minutosSalaVazia * 60_000);
  }

  cancelarFechamento() {
    clearTimeout(this.timerFechamento);
    this.timerFechamento = null;
  }

  fechar() {
    this.cancelarFechamento();
    for (const p of this.participantes.values()) p.ws.close(4000, 'Sala encerrada');
    this.router.close(); // fecha transportes, produtores e consumidores juntos
    salas.delete(this.codigo);
    console.log(`Sala ${this.codigo} fechada`);
  }

  // ---------- Mensagens pra todo mundo da sala ----------
  enviarParaTodos(evento, dados, excetoId = null) {
    for (const p of this.participantes.values()) {
      if (p.id !== excetoId) enviar(p.ws, evento, dados);
    }
  }

  // ---------- Procura produtores (telas/áudios sendo transmitidos) ----------
  todosProdutores() {
    const lista = [];
    for (const p of this.participantes.values()) {
      for (const produtor of p.produtores.values()) lista.push(produtor);
    }
    return lista;
  }

  acharProdutor(produtorId) {
    return this.todosProdutores().find((p) => p.id === produtorId) ?? null;
  }

  consumidoresDe(produtorId) {
    const lista = [];
    for (const p of this.participantes.values()) {
      for (const c of p.consumidores.values()) if (c.producerId === produtorId) lista.push(c);
    }
    return lista;
  }

  // ---------------------------------------------------
  // Economia de processamento:
  // se ninguém está assistindo uma tela, avisa quem transmite
  // pra PAUSAR o envio (o navegador para de codificar o vídeo).
  // Também manda quantas pessoas estão assistindo.
  // ---------------------------------------------------
  atualizarEspectadores(produtor) {
    if (!produtor || produtor.closed) return;
    const assistindo = this.consumidoresDe(produtor.id).filter((c) => !c.closed && !c.paused);
    const quantidade = assistindo.length;
    if (produtor.appData.espectadores === quantidade) return;

    const estavaAtivo = produtor.appData.espectadores > 0;
    produtor.appData.espectadores = quantidade;

    const dono = this.participantes.get(produtor.appData.participanteId);
    if (dono) enviar(dono.ws, 'controleEnvio', { produtorId: produtor.id, espectadores: quantidade });

    // Voltou a ter alguém assistindo -> pede um quadro-chave pra imagem aparecer rápido
    if (!estavaAtivo && quantidade > 0 && produtor.kind === 'video') {
      setTimeout(() => {
        for (const c of this.consumidoresDe(produtor.id)) {
          if (!c.closed && !c.paused) c.requestKeyFrame().catch(() => {});
        }
      }, 800);
    }
  }
}

// =====================================================
// Classe Participante
// =====================================================
class Participante {
  constructor(ws, sala, nome) {
    this.id = crypto.randomUUID();
    this.ws = ws;
    this.sala = sala;
    this.nome = nome;
    this.transportes = new Map();
    this.produtores = new Map();
    this.consumidores = new Map();
    this.ultimasMensagens = []; // pra limitar spam no chat
  }

  resumo() {
    return { id: this.id, nome: this.nome };
  }
}

function resumoProdutor(produtor, dono) {
  return {
    produtorId: produtor.id,
    participanteId: dono.id,
    nome: dono.nome,
    kind: produtor.kind,
    tipo: produtor.appData.tipo,
  };
}

// =====================================================
// Criar sala (chamado pela rota POST /api/salas)
// =====================================================
async function criarSala() {
  if (salas.size >= config.maxSalas) {
    throw new Error('O servidor atingiu o limite de salas. Tente mais tarde.');
  }
  const router = await criarRouter();
  const codigo = gerarCodigo();
  salas.set(codigo, new Sala(codigo, router));
  console.log(`Sala ${codigo} criada`);
  return codigo;
}

function infoSala(codigoBruto) {
  const sala = salas.get(normalizarCodigo(codigoBruto));
  if (!sala) return { existe: false };
  return { existe: true, codigo: sala.codigo, pessoas: sala.participantes.size };
}

// =====================================================
// Sinalização: cada conexão WebSocket é um participante
// Formato: cliente -> { id, metodo, dados }
//          servidor -> { id, ok, dados | erro }   (resposta)
//          servidor -> { evento, dados }          (aviso)
// =====================================================
function tratarConexao(ws) {
  /** @type {Participante | null} */
  let participante = null;

  // ---------- Helpers da conexão ----------
  const sala = () => participante.sala;

  function obterTransporte(transporteId, direcao) {
    const t = participante.transportes.get(transporteId);
    if (!t || t.appData.direcao !== direcao) throw new Error('Transporte inválido');
    return t;
  }

  function avisarProdutorFechado(produtor) {
    participante.produtores.delete(produtor.id);
    sala().enviarParaTodos('produtorFechado', {
      produtorId: produtor.id,
      participanteId: participante.id,
    });
  }

  // ---------- Métodos que o navegador pode chamar ----------
  const metodos = {
    // Entrar numa sala com o código
    async entrar({ codigo, nome }) {
      if (participante) throw new Error('Você já está numa sala');
      const s = salas.get(normalizarCodigo(codigo));
      if (!s) throw new Error('Sala não encontrada. Confira o código.');
      if (s.participantes.size >= config.maxPessoasPorSala) throw new Error('A sala está cheia.');

      participante = new Participante(ws, s, limparTexto(nome, 30) || 'Anônimo');
      s.participantes.set(participante.id, participante);
      s.cancelarFechamento();
      s.enviarParaTodos('participanteEntrou', participante.resumo(), participante.id);

      return {
        codigo: s.codigo,
        meuId: participante.id,
        rtpCapabilities: s.router.rtpCapabilities,
        participantes: [...s.participantes.values()].map((p) => p.resumo()),
        produtores: s.todosProdutores().map((p) => resumoProdutor(p, s.participantes.get(p.appData.participanteId))),
        chat: s.chat,
      };
    },

    // Criar o "cano" de envio ou de recebimento
    async criarTransporte({ direcao }) {
      if (direcao !== 'envio' && direcao !== 'recebimento') throw new Error('Direção inválida');
      const jaTem = [...participante.transportes.values()].some((t) => t.appData.direcao === direcao);
      if (jaTem) throw new Error(`Já existe um transporte de ${direcao}`);

      const t = await criarTransporte(sala().router);
      t.appData.direcao = direcao;
      participante.transportes.set(t.id, t);
      t.observer.on('close', () => participante?.transportes.delete(t.id));

      return {
        id: t.id,
        iceParameters: t.iceParameters,
        iceCandidates: t.iceCandidates,
        dtlsParameters: t.dtlsParameters,
      };
    },

    async conectarTransporte({ transporteId, dtlsParameters }) {
      const t = participante.transportes.get(transporteId);
      if (!t) throw new Error('Transporte inválido');
      await t.connect({ dtlsParameters });
    },

    // Começar a transmitir (vídeo da tela ou áudio da tela)
    async produzir({ transporteId, kind, rtpParameters }) {
      if (kind !== 'video' && kind !== 'audio') throw new Error('Tipo de mídia inválido');
      const jaTemDoTipo = [...participante.produtores.values()].some((p) => p.kind === kind);
      if (jaTemDoTipo) throw new Error('Você já está transmitindo');

      const t = obterTransporte(transporteId, 'envio');
      const tipo = kind === 'video' ? 'tela' : 'audio';
      const produtor = await t.produce({
        kind,
        rtpParameters,
        appData: { participanteId: participante.id, tipo, espectadores: -1 },
      });
      participante.produtores.set(produtor.id, produtor);

      // Se o transporte cair (pessoa saiu), avisa a sala
      const dono = participante;
      produtor.on('transportclose', () => {
        dono.produtores.delete(produtor.id);
        dono.sala.enviarParaTodos('produtorFechado', { produtorId: produtor.id, participanteId: dono.id });
      });

      sala().enviarParaTodos('novoProdutor', resumoProdutor(produtor, participante), participante.id);
      // Roda depois da resposta, pra o navegador já conhecer o produtor
      setImmediate(() => sala().atualizarEspectadores(produtor));
      return { id: produtor.id };
    },

    async fecharProdutor({ produtorId }) {
      const produtor = participante.produtores.get(produtorId);
      if (!produtor) return;
      produtor.close();
      avisarProdutorFechado(produtor);
    },

    // Começar a receber a tela/áudio de alguém (começa pausado)
    async consumir({ produtorId, transporteId, rtpCapabilities }) {
      const s = sala();
      const produtor = s.acharProdutor(produtorId);
      if (!produtor) throw new Error('Essa transmissão já terminou');
      if (produtor.appData.participanteId === participante.id) throw new Error('Não dá pra assistir a si mesmo');
      if (!s.router.canConsume({ producerId: produtorId, rtpCapabilities })) {
        throw new Error('Seu navegador não suporta o codec dessa transmissão');
      }

      const t = obterTransporte(transporteId, 'recebimento');
      const consumidor = await t.consume({ producerId: produtorId, rtpCapabilities, paused: true });
      participante.consumidores.set(consumidor.id, consumidor);

      const dono = participante;
      const aoFechar = () => {
        dono.consumidores.delete(consumidor.id);
        s.atualizarEspectadores(produtor);
      };
      consumidor.on('transportclose', aoFechar);
      consumidor.on('producerclose', aoFechar);

      return {
        id: consumidor.id,
        produtorId,
        kind: consumidor.kind,
        rtpParameters: consumidor.rtpParameters,
      };
    },

    // Retomar/pausar = mostrar/ocultar a tela de alguém (pausado não gasta banda)
    async retomarConsumidor({ consumidorId }) {
      const c = participante.consumidores.get(consumidorId);
      if (!c) throw new Error('Consumidor inválido');
      await c.resume();
      sala().atualizarEspectadores(sala().acharProdutor(c.producerId));
    },

    async pausarConsumidor({ consumidorId }) {
      const c = participante.consumidores.get(consumidorId);
      if (!c) throw new Error('Consumidor inválido');
      await c.pause();
      sala().atualizarEspectadores(sala().acharProdutor(c.producerId));
    },

    // Chat da sala
    async chat({ texto }) {
      const limpo = limparTexto(texto, 500);
      if (!limpo) return;

      // Anti-spam: no máximo 5 mensagens a cada 5 segundos
      const agora = Date.now();
      participante.ultimasMensagens = participante.ultimasMensagens.filter((t) => agora - t < 5000);
      if (participante.ultimasMensagens.length >= 5) throw new Error('Calma! Muitas mensagens seguidas.');
      participante.ultimasMensagens.push(agora);

      const mensagem = { participanteId: participante.id, nome: participante.nome, texto: limpo, hora: agora };
      const s = sala();
      s.chat.push(mensagem);
      if (s.chat.length > 50) s.chat.shift();
      s.enviarParaTodos('chat', mensagem);
    },
  };

  // ---------- Recebe as mensagens do navegador ----------
  ws.on('message', async (bruto) => {
    let msg;
    try {
      msg = JSON.parse(bruto);
    } catch {
      return;
    }
    const { id, metodo, dados } = msg ?? {};
    const responder = (ok, conteudo) => {
      if (ws.readyState !== ws.OPEN) return;
      ws.send(JSON.stringify(ok ? { id, ok, dados: conteudo } : { id, ok, erro: conteudo }));
    };

    try {
      const funcao = Object.hasOwn(metodos, metodo) ? metodos[metodo] : null;
      if (!funcao) throw new Error('Método desconhecido');
      if (metodo !== 'entrar' && !participante) throw new Error('Entre numa sala primeiro');
      responder(true, (await funcao(dados ?? {})) ?? null);
    } catch (erro) {
      responder(false, erro.message || 'Erro');
    }
  });

  // ---------- Saída (fechou a aba, caiu a internet...) ----------
  ws.on('close', () => {
    if (!participante) return;
    const p = participante;
    const s = p.sala;
    // Fechar os transportes fecha os produtores e consumidores juntos
    for (const t of [...p.transportes.values()]) t.close();
    s.participantes.delete(p.id);
    s.enviarParaTodos('participanteSaiu', { id: p.id });
    if (s.participantes.size === 0 && salas.has(s.codigo)) s.agendarFechamento();
  });
}

module.exports = { criarSala, infoSala, tratarConexao };
