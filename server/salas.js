// =====================================================
// Salas, códigos de entrada, participantes e sinalização P2P
//
// O vídeo NÃO passa por aqui: vai direto de um navegador pro outro.
// Este servidor só:
//   - guarda as salas (código, senha, dono, quem está dentro, chat)
//   - repassa as mensagens que os navegadores trocam pra se conectar
//   - deixa a pessoa voltar pra sala (F5, queda de internet, servidor
//     reiniciado) usando o bilhete criptografado (ver bilhete.js)
// =====================================================
const crypto = require('crypto');
const config = require('./config');
const { gerarHash, conferir } = require('./senha');
const { criarBilhete, abrirBilhete } = require('./bilhete');
const { obterIceServers } = require('./turn');
const limites = require('./limites');

// Sem 0/O e 1/I pra ninguém confundir na hora de digitar o código
const ALFABETO = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TAMANHO_CODIGO = 6;

/** @type {Map<string, Sala>} código -> sala */
const salas = new Map();

// =====================================================
// Utilitários
// =====================================================
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
  return String(texto ?? '').replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
}

function enviar(ws, evento, dados) {
  if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify({ evento, dados }));
}

function mesmoSegredo(a, b) {
  const x = Buffer.from(String(a ?? ''));
  const y = Buffer.from(String(b ?? ''));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// =====================================================
// Classe Sala
// =====================================================
class Sala {
  constructor(codigo, senhaGuardada = null, limite = config.maxPessoasPorSala) {
    this.codigo = codigo;
    this.senhaGuardada = senhaGuardada; // { sal, hash } ou null (sala aberta)
    this.limite = limite; // máximo de pessoas (o dono escolhe ao criar)
    this.chaveDono = crypto.randomBytes(18).toString('base64url'); // só quem criou recebe
    this.donoId = null;
    this.trancada = false; // trancada = ninguém novo entra
    this.recriada = false; // true = recriada depois de o servidor reiniciar
    this.expulsos = new Set(); // ids que o dono removeu (não podem voltar)
    this.idsQueSairam = new Set();
    /** @type {Map<string, Participante>} (ordem de entrada) */
    this.participantes = new Map();
    this.chat = []; // últimas mensagens (quem entra depois vê o histórico)
    this.timerFechamento = null;
    this.timerDono = null;
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
    clearTimeout(this.timerDono);
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

  // ---------- Nome repetido ganha número: "Ana", "Ana 2", "Ana 3"... ----------
  nomeUnico(nome) {
    const usados = new Set([...this.participantes.values()].map((p) => p.nome.toLowerCase()));
    if (!usados.has(nome.toLowerCase())) return nome;
    let n = 2;
    while (usados.has(`${nome} ${n}`.toLowerCase())) n++;
    return `${nome} ${n}`;
  }

  // ---------- Coloca alguém na sala ----------
  adicionar(ws, nome, { id, dono = false, transmitindo = false } = {}) {
    const p = new Participante(ws, this, this.nomeUnico(nome), id);
    p.transmitindo = transmitindo;
    this.participantes.set(p.id, p);
    if (dono) this.donoId = p.id;
    this.cancelarFechamento();
    this.enviarParaTodos('participanteEntrou', p.resumo(), p.id);
    if (dono) this.enviarParaTodos('dono', { id: p.id }, p.id);
    return p;
  }

  // ---------- Tira alguém da sala de vez ----------
  // motivo: 'saiu' (normal) ou 'removido' (pelo dono)
  remover(participante, motivo = 'saiu') {
    clearTimeout(participante.timerSaida);
    if (!this.participantes.delete(participante.id)) return;
    this.idsQueSairam.add(participante.id);
    this.enviarParaTodos('participanteSaiu', { id: participante.id, motivo });
    if (this.donoId === participante.id) {
      // O dono pode ter só apertado F5: espera 15s antes de passar o dono adiante
      this.donoId = null;
      clearTimeout(this.timerDono);
      this.timerDono = setTimeout(() => {
        if (!this.donoId) this.passarDono();
      }, 15_000);
    }
    if (this.participantes.size === 0 && salas.has(this.codigo)) this.agendarFechamento();
  }

  // ---------- O dono saiu: quem está há mais tempo vira dono ----------
  passarDono() {
    const proximo = this.participantes.values().next().value ?? null;
    this.donoId = proximo?.id ?? null;
    if (!proximo) return;
    this.enviarParaTodos('dono', { id: proximo.id });
    enviar(proximo.ws, 'bilhete', { bilhete: bilheteDe(proximo) }); // o bilhete novo diz que ele é dono
  }

  ehDono(participante) {
    return this.donoId === participante.id;
  }
}

// =====================================================
// Classe Participante
// =====================================================
class Participante {
  constructor(ws, sala, nome, id = crypto.randomUUID()) {
    this.id = id;
    this.ws = ws;
    this.sala = sala;
    this.nome = nome;
    this.transmitindo = false;
    this.timerSaida = null;
    this.ultimasMensagens = []; // pra limitar spam no chat
  }

  resumo() {
    // ausente = a conexão caiu e a pessoa ainda pode voltar (ex: celular com a tela apagada)
    return { id: this.id, nome: this.nome, transmitindo: this.transmitindo, ausente: !this.ws };
  }
}

// Bilhete da pessoa: tudo que precisa pra recriar a sala se o servidor reiniciar
function bilheteDe(p) {
  const s = p.sala;
  return criarBilhete({
    codigo: s.codigo,
    id: p.id,
    nome: p.nome,
    dono: s.donoId === p.id,
    limite: s.limite,
    senha: s.senhaGuardada
      ? { sal: s.senhaGuardada.sal.toString('base64'), hash: s.senhaGuardada.hash.toString('base64') }
      : null,
  });
}

// Estado da sala que o navegador recebe ao entrar (ou voltar)
async function estadoParaCliente(sala, participante, extra = {}) {
  return {
    codigo: sala.codigo,
    temSenha: !!sala.senhaGuardada,
    meuId: participante.id,
    meuNome: participante.nome,
    bilhete: bilheteDe(participante),
    donoId: sala.donoId,
    trancada: sala.trancada,
    participantes: sala.resumo(),
    chat: sala.chat,
    iceServers: await obterIceServers(),
    limites: {
      maxPessoas: sala.limite,
      maxTransmissoes: config.maxTransmissoesPorSala,
    },
    ...extra,
  };
}

// =====================================================
// Criar sala (chamado pela rota POST /api/salas)
// =====================================================
// Limite escolhido pelo dono: número inteiro entre 2 e o máximo permitido
function limiteValido(valor) {
  const n = Math.round(Number(valor));
  if (!Number.isFinite(n)) return config.maxPessoasPorSala;
  return Math.min(config.limiteMaximoPessoas, Math.max(2, n));
}

async function criarSala({ senha, limite } = {}) {
  if (salas.size >= config.maxSalas) {
    throw new Error('O servidor atingiu o limite de salas. Tente mais tarde.');
  }
  const senhaTexto = String(senha ?? '');
  if (senhaTexto.length > config.tamanhoMaxSenha) throw new Error('Senha muito longa.');
  const senhaGuardada = senhaTexto ? await gerarHash(senhaTexto) : null;

  const sala = new Sala(gerarCodigo(), senhaGuardada, limiteValido(limite ?? config.maxPessoasPorSala));
  salas.set(sala.codigo, sala);
  console.log(`Sala ${sala.codigo} criada (até ${sala.limite} pessoas${senhaGuardada ? ', com senha' : ''})`);
  // A chave de dono vai só pra quem criou: quem entrar com ela vira dono
  return { codigo: sala.codigo, chaveDono: sala.chaveDono };
}

// Usado pela tela inicial pra saber se precisa pedir senha
function infoSala(codigoBruto) {
  const sala = salas.get(normalizarCodigo(codigoBruto));
  if (!sala) return { existe: false };
  return {
    existe: true,
    codigo: sala.codigo,
    temSenha: !!sala.senhaGuardada,
    pessoas: sala.participantes.size,
    limite: sala.limite,
    cheia: sala.participantes.size >= sala.limite,
    trancada: sala.trancada,
  };
}

function estatisticas() {
  let pessoas = 0;
  for (const s of salas.values()) pessoas += s.participantes.size;
  return { salas: salas.size, pessoas };
}

// Avisa todo mundo antes de o servidor desligar (atualização no Render)
function avisarReinicio() {
  for (const s of salas.values()) s.enviarParaTodos('reiniciando', {});
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

  const sala = () => participante.sala;

  function exigirDono() {
    if (!sala().ehDono(participante)) throw new Error('Só o dono da sala pode fazer isso.');
  }

  // ---------- Métodos que o navegador pode chamar ----------
  const metodos = {
    // -------------------------------------------------
    // Entrar numa sala com o código (e a senha, se tiver)
    // -------------------------------------------------
    async entrar({ codigo, nome, senha, chaveDono }) {
      if (participante) throw new Error('Você já está numa sala');

      const s = salas.get(normalizarCodigo(codigo));
      if (!s) throw new Error('Sala não encontrada. Confira o código.');

      const ehCriador = mesmoSegredo(chaveDono, s.chaveDono);
      if (s.trancada && !ehCriador) throw new Error('A sala está trancada pelo dono.');

      if (s.senhaGuardada && !ehCriador) {
        if (!senha) throw new Error('Esta sala tem senha.');
        // Limite por sala: protege a senha de quem fica chutando
        if (!limites.senhaPorSala.pode(s.codigo)) {
          throw new Error('Muitas senhas erradas nesta sala. Espere alguns minutos.');
        }
        if (!(await conferir(String(senha).slice(0, config.tamanhoMaxSenha), s.senhaGuardada))) {
          limites.senhaPorSala.registrar(s.codigo);
          throw new Error('Senha incorreta.');
        }
      }

      if (s.participantes.size >= s.limite) {
        throw new Error(`A sala está cheia (máximo ${s.limite} pessoas).`);
      }

      participante = s.adicionar(ws, limparTexto(nome, 30) || 'Anônimo', { dono: ehCriador && !s.donoId });
      return estadoParaCliente(s, participante);
    },

    // -------------------------------------------------
    // Voltar pra sala com o bilhete:
    //  - a internet caiu e voltou (mesma página): continua igual
    //  - a pessoa apertou F5 (recarregou: true): entra de novo, sem pedir senha
    //  - o servidor reiniciou e a sala sumiu: recria com o mesmo código/senha/dono
    // -------------------------------------------------
    async voltar({ bilhete, recarregou = false, transmitindo = false }) {
      if (participante) throw new Error('Você já está numa sala');
      const b = abrirBilhete(bilhete);
      if (!b) throw new Error('Não foi possível voltar pra sala.');

      // ---------- A sala sumiu (servidor reiniciou)? Recria ----------
      let s = salas.get(b.codigo);
      if (!s) {
        if (salas.size >= config.maxSalas) throw new Error('O servidor atingiu o limite de salas.');
        const senha = b.senha ? { sal: Buffer.from(b.senha.sal, 'base64'), hash: Buffer.from(b.senha.hash, 'base64') } : null;
        s = new Sala(b.codigo, senha, limiteValido(b.limite ?? config.maxPessoasPorSala));
        s.recriada = true;
        s.recriadaEm = Date.now();
        salas.set(s.codigo, s);
        console.log(`Sala ${s.codigo} recriada depois do reinício`);
        // Se o dono não voltar em 30s, passa pra quem já voltou
        s.timerDono = setTimeout(() => {
          if (!s.donoId && s.participantes.size) s.passarDono();
        }, 30_000);
      }

      // Todo mundo que volta nos 2 primeiros minutos fica sabendo que a sala foi restaurada
      const recriada = !!s.recriadaEm && Date.now() - s.recriadaEm < 120_000;

      if (s.expulsos.has(b.id)) throw new Error('Você foi removido desta sala pelo dono.');

      // Manter o mesmo id = as conexões de vídeo com os outros continuam
      const existente = s.participantes.get(b.id);
      const manterId = !recarregou && (!!existente || (s.recriada && !s.idsQueSairam.has(b.id)));

      // ---------- Caso 1: só a conexão caiu e voltou ----------
      if (existente && manterId) {
        clearTimeout(existente.timerSaida);
        existente.timerSaida = null;
        if (existente.ws && existente.ws !== ws) existente.ws.close(4001, 'Conectado em outro lugar');
        existente.ws = ws;
        s.enviarParaTodos('ausente', { id: existente.id, ausente: false }, existente.id);
        participante = existente;
        return estadoParaCliente(s, existente, { recriada, reentrou: false });
      }

      // ---------- Caso 2: F5 ou voltou tarde: entra de novo ----------
      if (existente) {
        // Ex: aba duplicada com o mesmo bilhete -> a aba antiga é desconectada
        if (existente.ws && existente.ws !== ws) existente.ws.close(4001, 'Você entrou na sala em outra aba');
        s.remover(existente);
      }
      if (s.participantes.size >= s.limite) throw new Error('A sala está cheia.');

      const podeSerDono = b.dono && (!s.donoId || s.donoId === b.id);
      const podeTransmitir = manterId && transmitindo && s.quantosTransmitindo() < config.maxTransmissoesPorSala;
      participante = s.adicionar(ws, b.nome, {
        id: manterId ? b.id : undefined,
        dono: podeSerDono,
        transmitindo: podeTransmitir,
      });
      if (podeSerDono) clearTimeout(s.timerDono);
      return estadoParaCliente(s, participante, { recriada, reentrou: !manterId });
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

    // -------------------------------------------------
    // Ferramentas do dono
    // -------------------------------------------------
    async expulsar({ id }) {
      exigirDono();
      const s = sala();
      const alvo = s.participantes.get(String(id));
      if (!alvo || alvo === participante) throw new Error('Pessoa não encontrada.');
      s.expulsos.add(alvo.id);
      enviar(alvo.ws, 'expulso', {});
      alvo.ws?.close(4002, 'Removido pelo dono');
      s.remover(alvo, 'removido');
      s.enviarParaTodos('aviso', { texto: `${alvo.nome} foi removido(a) pelo dono.` });
    },

    async trancar({ trancada }) {
      exigirDono();
      const s = sala();
      s.trancada = !!trancada;
      s.enviarParaTodos('sala', { trancada: s.trancada });
    },

    // Só pra manter a conexão ativa (o Render desliga serviços sem tráfego)
    async ping() {
      return { pong: Date.now() };
    },

    // Sair de propósito (botão "Sair" ou fechar a aba)
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
      const livres = ['entrar', 'voltar', 'ping'];
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
    p.sala.enviarParaTodos('ausente', { id: p.id, ausente: true });
    p.timerSaida = setTimeout(() => p.sala.remover(p), config.segundosParaReconectar * 1000);
  });
}

module.exports = { criarSala, infoSala, estatisticas, tratarConexao, avisarReinicio };
