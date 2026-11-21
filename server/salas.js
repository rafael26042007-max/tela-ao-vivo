// =====================================================
// Salas, códigos de entrada, participantes e sinalização P2P
//
// O vídeo NÃO passa por aqui: vai direto de um navegador pro outro.
// Este servidor só:
//   - guarda as salas (código, senha, quem está dentro, chat)
//   - repassa as mensagens que os navegadores trocam pra se conectar
//     (oferta/resposta SDP e candidatos ICE)
// =====================================================
const crypto = require('crypto');
const config = require('./config');
const { gerarHash, conferir } = require('./senha');
const limites = require('./limites');

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
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ evento, dados }));
}

function mesmoToken(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// =====================================================
// Classe Sala
// =====================================================
class Sala {
  constructor(codigo, senhaGuardada = null) {
    this.codigo = codigo;
    this.senhaGuardada = senhaGuardada; // { sal, hash } ou null (sala aberta)
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
    for (const p of this.participantes.values()) {
      clearTimeout(p.timerSaida);
      p.ws?.close(4000, 'Sala encerrada');
    }
    salas.delete(this.codigo);
    console.log(`Sala ${this.codigo} fechada`);
  }

  // ---------- Mensagens pra todo mundo da sala ----------
  enviarParaTodos(evento, dados, excetoId = null) {
    for (const p of this.participantes.values()) {
      if (p.id !== excetoId) enviar(p.ws, evento, dados);
    }
  }

  quantosTransmitindo() {
    return [...this.participantes.values()].filter((p) => p.transmitindo).length;
  }

  resumo() {
    return [...this.participantes.values()].map((p) => p.resumo());
  }

  // ---------- Remove alguém de vez ----------
  remover(participante) {
    clearTimeout(participante.timerSaida);
    if (!this.participantes.delete(participante.id)) return;
    this.enviarParaTodos('participanteSaiu', { id: participante.id });
    if (this.participantes.size === 0 && salas.has(this.codigo)) this.agendarFechamento();
  }
}

// =====================================================
// Classe Participante
// =====================================================
class Participante {
  constructor(ws, sala, nome) {
    this.id = crypto.randomUUID();
    this.token = crypto.randomBytes(24).toString('base64url'); // pra reconectar se a conexão cair
    this.ws = ws;
    this.sala = sala;
    this.nome = nome;
    this.transmitindo = false;
    this.timerSaida = null;
    this.ultimasMensagens = []; // pra limitar spam no chat
  }

  resumo() {
    return { id: this.id, nome: this.nome, transmitindo: this.transmitindo };
  }
}

// Estado da sala que o navegador recebe ao entrar (ou reconectar)
function estadoParaCliente(sala, participante) {
  return {
    codigo: sala.codigo,
    temSenha: !!sala.senhaGuardada,
    meuId: participante.id,
    token: participante.token,
    participantes: sala.resumo(),
    chat: sala.chat,
    iceServers: config.iceServers,
    limites: {
      maxPessoas: config.maxPessoasPorSala,
      maxTransmissoes: config.maxTransmissoesPorSala,
    },
  };
}

// =====================================================
// Criar sala (chamado pela rota POST /api/salas)
// =====================================================
async function criarSala({ senha } = {}) {
  if (salas.size >= config.maxSalas) {
    throw new Error('O servidor atingiu o limite de salas. Tente mais tarde.');
  }
  const senhaTexto = String(senha ?? '');
  if (senhaTexto.length > config.tamanhoMaxSenha) throw new Error('Senha muito longa.');
  const senhaGuardada = senhaTexto ? await gerarHash(senhaTexto) : null;

  const codigo = gerarCodigo();
  salas.set(codigo, new Sala(codigo, senhaGuardada));
  console.log(`Sala ${codigo} criada${senhaGuardada ? ' (com senha)' : ''}`);
  return codigo;
}

// Usado pela tela inicial pra saber se precisa pedir senha
function infoSala(codigoBruto) {
  const sala = salas.get(normalizarCodigo(codigoBruto));
  if (!sala) return { existe: false };
  return {
    existe: true,
    codigo: sala.codigo,
    temSenha: !!sala.senhaGuardada,
    cheia: sala.participantes.size >= config.maxPessoasPorSala,
  };
}

function estatisticas() {
  let pessoas = 0;
  for (const s of salas.values()) pessoas += s.participantes.size;
  return { salas: salas.size, pessoas };
}

// =====================================================
// Sinalização: cada conexão WebSocket é um participante
// Formato: cliente -> { id, metodo, dados }
//          servidor -> { id, ok, dados | erro }   (resposta)
//          servidor -> { evento, dados }          (aviso)
// =====================================================
function tratarConexao(ws, ip) {
  /** @type {Participante | null} */
  let participante = null;

  const sala = () => participante.sala;

  // ---------- Métodos que o navegador pode chamar ----------
  const metodos = {
    // Entrar numa sala com o código (e a senha, se tiver)
    async entrar({ codigo, nome, senha }) {
      if (participante) throw new Error('Você já está numa sala');

      // Anti-chute: muitos erros seguidos bloqueiam o IP por um tempo
      if (!limites.tentativasErradas.pode(ip)) {
        throw new Error('Muitas tentativas erradas. Espere alguns minutos.');
      }

      const s = salas.get(normalizarCodigo(codigo));
      if (!s) {
        limites.tentativasErradas.registrar(ip);
        throw new Error('Sala não encontrada. Confira o código.');
      }

      if (s.senhaGuardada) {
        if (!senha) throw new Error('Esta sala tem senha.');
        // Limite também por sala: protege a senha mesmo se alguém trocar de IP
        if (!limites.senhaPorSala.pode(s.codigo)) {
          throw new Error('Muitas senhas erradas nesta sala. Espere alguns minutos.');
        }
        if (!(await conferir(String(senha).slice(0, config.tamanhoMaxSenha), s.senhaGuardada))) {
          limites.tentativasErradas.registrar(ip);
          limites.senhaPorSala.registrar(s.codigo);
          throw new Error('Senha incorreta.');
        }
      }

      if (s.participantes.size >= config.maxPessoasPorSala) {
        throw new Error(`A sala está cheia (máximo ${config.maxPessoasPorSala} pessoas).`);
      }

      participante = new Participante(ws, s, limparTexto(nome, 30) || 'Anônimo');
      s.participantes.set(participante.id, participante);
      s.cancelarFechamento();
      s.enviarParaTodos('participanteEntrou', participante.resumo(), participante.id);
      return estadoParaCliente(s, participante);
    },

    // Voltar pra sala depois que a conexão com o servidor caiu
    async reconectar({ codigo, id, token }) {
      if (participante) throw new Error('Você já está numa sala');
      const s = salas.get(normalizarCodigo(codigo));
      const p = s?.participantes.get(String(id));
      if (!p || !mesmoToken(token, p.token)) throw new Error('Não foi possível voltar pra sala.');

      clearTimeout(p.timerSaida);
      p.timerSaida = null;
      if (p.ws && p.ws !== ws) p.ws.close(4001, 'Conectado em outro lugar');
      p.ws = ws;
      participante = p;
      return estadoParaCliente(s, p);
    },

    // Repassa a mensagem de conexão P2P pra outra pessoa da sala
    async sinal({ para, dados }) {
      const destino = sala().participantes.get(String(para));
      if (!destino || destino === participante) throw new Error('Participante não encontrado');
      enviar(destino.ws, 'sinal', { de: participante.id, dados });
    },

    // Avisa a sala que começou/parou de transmitir (respeitando o limite)
    async transmissao({ ativo }) {
      const s = sala();
      const quer = !!ativo;
      if (quer && !participante.transmitindo && s.quantosTransmitindo() >= config.maxTransmissoesPorSala) {
        throw new Error(
          `A sala já tem ${s.quantosTransmitindo()} telas sendo transmitidas (máximo ${config.maxTransmissoesPorSala}).`
        );
      }
      if (participante.transmitindo === quer) return;
      participante.transmitindo = quer;
      s.enviarParaTodos('transmissao', { participanteId: participante.id, ativo: quer });
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

    // Só pra manter a conexão ativa (o Render desliga serviços sem tráfego)
    async ping() {
      return { pong: Date.now() };
    },

    // Sair de propósito (botão "Sair")
    async sair() {
      const p = participante;
      participante = null;
      p.sala.remover(p);
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
      const livres = ['entrar', 'reconectar', 'ping'];
      if (!livres.includes(metodo) && !participante) throw new Error('Entre numa sala primeiro');
      responder(true, (await funcao(dados ?? {})) ?? null);
    } catch (erro) {
      responder(false, erro.message || 'Erro');
    }
  });

  // ---------- Conexão caiu: espera um pouco antes de tirar da sala ----------
  // (o vídeo P2P continua funcionando enquanto o navegador reconecta)
  ws.on('close', () => {
    const p = participante;
    if (!p || p.ws !== ws) return;
    p.ws = null;
    p.timerSaida = setTimeout(() => p.sala.remover(p), config.segundosParaReconectar * 1000);
  });
}

module.exports = { criarSala, infoSala, estatisticas, tratarConexao };
