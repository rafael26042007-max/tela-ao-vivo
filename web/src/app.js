// =====================================================
// Tela ao Vivo - app do navegador (versão P2P)
// Fluxo: acordar servidor -> início (criar/entrar) -> sala
// =====================================================
import { Sinalizacao } from './conexao.js';
import { MalhaP2P, QUALIDADES, codecsDisponiveis } from './p2p.js';

// =====================================================
// Endereço do servidor (vem do config.js)
// =====================================================
const BASE = String(window.TELA_AO_VIVO?.servidor ?? '').replace(/\/+$/, '');
const api = (caminho) => `${BASE}${caminho}`;
const URL_WS = BASE
  ? `${BASE.replace(/^http/, 'ws')}/ws`
  : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;

// =====================================================
// Elementos da página
// =====================================================
const $ = (id) => document.getElementById(id);
const el = {
  telaInicio: $('tela-inicio'),
  telaSala: $('tela-sala'),
  statusServidor: $('status-servidor'),
  campoNome: $('campo-nome'),
  campoCodigo: $('campo-codigo'),
  campoSenhaCriar: $('campo-senha-criar'),
  campoSenhaEntrar: $('campo-senha-entrar'),
  botaoCriar: $('botao-criar'),
  formEntrar: $('form-entrar'),
  erroInicio: $('erro-inicio'),

  textoCodigo: $('texto-codigo'),
  iconeSenha: $('icone-senha'),
  botaoCopiar: $('botao-copiar'),
  botaoSair: $('botao-sair'),
  selectQualidade: $('select-qualidade'),
  selectCodec: $('select-codec'),
  checkAudio: $('check-audio'),
  botaoTransmitir: $('botao-transmitir'),
  infoEspectadores: $('info-espectadores'),
  aviso: $('aviso-sala'),
  grade: $('grade-telas'),
  vazio: $('vazio'),
  contadorPessoas: $('contador-pessoas'),
  listaPessoas: $('lista-pessoas'),
  listaChat: $('lista-chat'),
  formChat: $('form-chat'),
  campoChat: $('campo-chat'),
};

// =====================================================
// Estado do app
// =====================================================
const estado = {
  servidorPronto: false,
  sinal: null,
  malha: null,
  codigo: null,
  meuId: null,
  token: null, // pra voltar pra sala se a conexão com o servidor cair
  pessoas: new Map(), // id -> { nome, transmitindo }
  telas: new Map(), // id -> { tile, video, status, ... } (telas dos outros)
  streams: new Map(), // id -> MediaStream recebido daquela pessoa
  mudos: new Set(), // ids com o som desligado por mim
  minhaTela: null, // { tile, status }
  mudandoTransmissao: false,
  timerPing: null,
};

// =====================================================
// Utilidades
// =====================================================
function guardar(chave, valor) {
  try { localStorage.setItem(chave, valor); } catch { /* navegador bloqueou */ }
}
function ler(chave) {
  try { return localStorage.getItem(chave); } catch { return null; }
}

function normalizarCodigo(texto) {
  return String(texto ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function criar(tag, classe, texto) {
  const elemento = document.createElement(tag);
  if (classe) elemento.className = classe;
  if (texto !== undefined) elemento.textContent = texto; // textContent = seguro contra HTML malicioso
  return elemento;
}

const nomeDe = (id) => estado.pessoas.get(id)?.nome ?? 'Alguém';

let timerAviso = null;
function mostrarAviso(texto, fixo = false) {
  el.aviso.textContent = texto;
  el.aviso.hidden = false;
  clearTimeout(timerAviso);
  if (!fixo) timerAviso = setTimeout(() => (el.aviso.hidden = true), 8000);
}

function esconderAviso() {
  el.aviso.hidden = true;
}

function mostrarErroInicio(texto) {
  el.erroInicio.textContent = texto;
}

function setCarregando(sim) {
  const bloqueado = sim || !estado.servidorPronto;
  el.botaoCriar.disabled = bloqueado;
  el.formEntrar.querySelector('button').disabled = bloqueado;
}

// =====================================================
// ACORDAR O SERVIDOR
// No plano grátis do Render, ele desliga depois de 15 min parado
// e leva até ~1 minuto pra voltar. O site já abre na hora e espera.
// =====================================================
async function acordarServidor() {
  const inicio = Date.now();
  el.statusServidor.className = 'status-servidor';
  el.statusServidor.textContent = 'Conectando ao servidor...';
  const avisoLento = setTimeout(() => {
    el.statusServidor.textContent = 'Acordando o servidor... (no plano grátis isso pode levar até 1 minuto)';
  }, 2500);

  while (Date.now() - inicio < 120_000) {
    try {
      const controle = new AbortController();
      const limite = setTimeout(() => controle.abort(), 15_000);
      const resposta = await fetch(api('/saude'), { signal: controle.signal, cache: 'no-store' });
      clearTimeout(limite);
      if (resposta.ok) {
        clearTimeout(avisoLento);
        estado.servidorPronto = true;
        el.statusServidor.className = 'status-servidor ok';
        el.statusServidor.textContent = 'Servidor online';
        setCarregando(false);
        return;
      }
    } catch {
      // ainda acordando -> tenta de novo
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  clearTimeout(avisoLento);
  el.statusServidor.className = 'status-servidor erro';
  el.statusServidor.textContent = 'O servidor não respondeu. ';
  const tentar = criar('button', 'botao pequeno', 'Tentar de novo');
  tentar.addEventListener('click', acordarServidor);
  el.statusServidor.append(tentar);
}

// =====================================================
// TELA DE INÍCIO
// =====================================================

// ---------- Preenche nome salvo e código do link (?sala=ABC123) ----------
el.campoNome.value = ler('nome') ?? '';
const codigoDoLink = normalizarCodigo(new URLSearchParams(location.search).get('sala'));
if (codigoDoLink) el.campoCodigo.value = codigoDoLink;
(el.campoNome.value ? el.campoCodigo : el.campoNome).focus();
acordarServidor();

// ---------- Criar sala ----------
el.botaoCriar.addEventListener('click', async () => {
  if (!validarNome()) return;
  setCarregando(true);
  mostrarErroInicio('');
  try {
    const senha = el.campoSenhaCriar.value;
    const resposta = await fetch(api('/api/salas'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || 'Erro ao criar a sala');
    await entrarNaSala(dados.codigo, senha);
  } catch (erro) {
    mostrarErroInicio(erro.message === 'Failed to fetch' ? 'Sem conexão com o servidor.' : erro.message);
    setCarregando(false);
  }
});

// ---------- Entrar com código ----------
el.formEntrar.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (!validarNome()) return;
  const codigo = normalizarCodigo(el.campoCodigo.value);
  if (codigo.length !== 6) {
    mostrarErroInicio('O código tem 6 caracteres.');
    el.campoCodigo.focus();
    return;
  }

  // Campo de senha ainda escondido? Pergunta se a sala tem senha
  if (el.campoSenhaEntrar.hidden) {
    setCarregando(true);
    try {
      const resposta = await fetch(api(`/api/salas/${codigo}`));
      const info = await resposta.json();
      if (!resposta.ok) throw new Error(info.erro || 'Erro ao procurar a sala');
      if (!info.existe) throw new Error('Sala não encontrada. Confira o código.');
      if (info.cheia) throw new Error('A sala está cheia.');
      if (info.temSenha) {
        el.campoSenhaEntrar.hidden = false;
        el.campoSenhaEntrar.focus();
        mostrarErroInicio('Esta sala tem senha. Digite e clique em Entrar.');
        return;
      }
    } catch (erro) {
      mostrarErroInicio(erro.message === 'Failed to fetch' ? 'Sem conexão com o servidor.' : erro.message);
      return;
    } finally {
      setCarregando(false);
    }
  }

  entrarNaSala(codigo, el.campoSenhaEntrar.value);
});

el.campoCodigo.addEventListener('input', () => {
  el.campoCodigo.value = normalizarCodigo(el.campoCodigo.value);
  // Trocou o código -> esconde a senha de novo (pode ser outra sala)
  el.campoSenhaEntrar.hidden = true;
  el.campoSenhaEntrar.value = '';
});

function validarNome() {
  const nome = el.campoNome.value.trim();
  if (!nome) {
    mostrarErroInicio('Digite seu nome primeiro.');
    el.campoNome.focus();
    return false;
  }
  guardar('nome', nome);
  return true;
}

// =====================================================
// ENTRAR NA SALA
// =====================================================
async function entrarNaSala(codigo, senha = '') {
  setCarregando(true);
  mostrarErroInicio('');
  const sinal = new Sinalizacao(URL_WS);

  try {
    await sinal.aberto;
    const info = await sinal.pedir('entrar', { codigo, nome: el.campoNome.value.trim(), senha });
    estado.sinal = sinal;
    registrarEventos(sinal);
    aplicarEstado(info);

    // ---------- Monta a tela da sala ----------
    el.telaInicio.hidden = true;
    el.telaSala.hidden = false;
    el.textoCodigo.textContent = info.codigo;
    el.iconeSenha.hidden = !info.temSenha;
    document.title = `Sala ${info.codigo} · Tela ao Vivo`;
    history.replaceState(null, '', `${location.pathname}?sala=${info.codigo}`);
    prepararControles();
    for (const m of info.chat) adicionarMensagem(m);

    // Mantém o servidor acordado enquanto a sala está aberta
    estado.timerPing = setInterval(() => sinal.pedir('ping').catch(() => {}), 4 * 60_000);
  } catch (erro) {
    sinal.fechar();
    mostrarErroInicio(erro.message);
  } finally {
    setCarregando(false);
  }
}

// -----------------------------------------------------
// Aplica o estado que o servidor mandou (ao entrar ou reconectar)
// -----------------------------------------------------
function aplicarEstado(info) {
  estado.codigo = info.codigo;
  estado.meuId = info.meuId;
  estado.token = info.token;

  if (!estado.malha) {
    estado.malha = new MalhaP2P(estado.sinal, info.meuId, info.iceServers);
    registrarEventosMalha(estado.malha);
  }

  // Quem saiu enquanto eu estava desconectado
  const presentes = new Set(info.participantes.map((p) => p.id));
  for (const id of [...estado.pessoas.keys()]) if (!presentes.has(id)) removerPessoa(id);

  // Quem está na sala agora
  for (const p of info.participantes) {
    estado.pessoas.set(p.id, { nome: p.nome, transmitindo: p.transmitindo });
    if (p.id === estado.meuId) continue;
    estado.malha.par(p.id); // conexão direta com essa pessoa
    p.transmitindo ? garantirTile(p.id) : removerTile(p.id);
  }
  renderizarPessoas();
}

// ---------- Avisos que o servidor manda ----------
function registrarEventos(sinal) {
  sinal.on('participanteEntrou', (p) => {
    estado.pessoas.set(p.id, { nome: p.nome, transmitindo: p.transmitindo });
    estado.malha.par(p.id);
    renderizarPessoas();
    adicionarMensagemSistema(`${p.nome} entrou`);
  });

  sinal.on('participanteSaiu', ({ id }) => {
    const nome = estado.pessoas.get(id)?.nome;
    removerPessoa(id);
    if (nome) adicionarMensagemSistema(`${nome} saiu`);
  });

  sinal.on('transmissao', ({ participanteId, ativo }) => {
    const pessoa = estado.pessoas.get(participanteId);
    if (pessoa) pessoa.transmitindo = ativo;
    if (participanteId !== estado.meuId) ativo ? garantirTile(participanteId) : removerTile(participanteId);
    renderizarPessoas();
  });

  sinal.on('chat', adicionarMensagem);

  // ---------- Conexão com o SERVIDOR (o vídeo P2P continua funcionando) ----------
  sinal.on('desconectado', () => {
    mostrarAviso('Conexão com o servidor caiu. Reconectando... (as telas continuam funcionando)', true);
  });

  sinal.on('reconectado', async () => {
    try {
      const info = await sinal.pedir('reconectar', { codigo: estado.codigo, id: estado.meuId, token: estado.token });
      aplicarEstado(info);
      mostrarAviso('Reconectado ao servidor!');
    } catch {
      mostrarAviso('Você ficou tempo demais desconectado e saiu da sala. Recarregue a página para entrar de novo.', true);
      el.botaoTransmitir.disabled = true;
    }
  });

  sinal.on('encerrado', ({ motivo }) => {
    mostrarAviso(`${motivo || 'Conexão encerrada'}. Recarregue a página para entrar de novo.`, true);
    el.botaoTransmitir.disabled = true;
  });
}

// ---------- Avisos da malha P2P ----------
function registrarEventosMalha(malha) {
  malha.on('midiaRemota', ({ id, stream }) => {
    estado.streams.set(id, stream);
    const tela = estado.telas.get(id);
    if (tela && tela.video.srcObject !== stream) {
      tela.video.srcObject = stream;
      tela.tocar();
    }
  });

  malha.on('estadoConexao', ({ id, estado: conexao }) => {
    const tela = estado.telas.get(id);
    if (!tela) return;
    const textos = {
      new: 'Conectando...',
      connecting: 'Conectando...',
      disconnected: 'Conexão instável...',
      failed: 'Não foi possível conectar',
    };
    tela.conectando.textContent = textos[conexao] ?? '';
    tela.conectando.hidden = conexao === 'connected' || tela.oculto;
  });

  malha.on('falhaConexao', ({ id }) => {
    mostrarAviso(
      `Não deu pra conectar direto com ${nomeDe(id)}. A rede de um de vocês pode estar bloqueando conexões diretas (P2P).`,
      true
    );
  });

  malha.on('espectadores', atualizarInfoEspectadores);
}

function removerPessoa(id) {
  estado.pessoas.delete(id);
  estado.streams.delete(id);
  estado.malha?.removerPar(id);
  removerTile(id);
  renderizarPessoas();
}

// =====================================================
// CONTROLES DE TRANSMISSÃO
// =====================================================
function prepararControles() {
  // ---------- Codecs que este navegador consegue enviar ----------
  const nomes = { VP8: 'VP8 (compatível)', H264: 'H264 (pode usar a GPU)' };
  el.selectCodec.replaceChildren();
  for (const codec of codecsDisponiveis()) {
    const opcao = criar('option', null, nomes[codec] ?? codec);
    opcao.value = codec;
    el.selectCodec.append(opcao);
  }
  const codecSalvo = ler('codec');
  if (codecSalvo && [...el.selectCodec.options].some((o) => o.value === codecSalvo)) el.selectCodec.value = codecSalvo;

  const qualidadeSalva = ler('qualidade');
  if (qualidadeSalva && QUALIDADES[qualidadeSalva]) el.selectQualidade.value = qualidadeSalva;

  el.selectCodec.addEventListener('change', () => guardar('codec', el.selectCodec.value));
  el.selectQualidade.addEventListener('change', () => guardar('qualidade', el.selectQualidade.value));

  // ---------- Dá pra transmitir daqui? ----------
  if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
    el.botaoTransmitir.disabled = true;
    mostrarAviso(
      !window.isSecureContext
        ? 'Esta página não está em HTTPS: você pode assistir, mas não transmitir.'
        : 'Este navegador não permite compartilhar a tela (use Chrome, Edge ou Firefox no computador). Você ainda pode assistir.',
      true
    );
  }
}

el.botaoTransmitir.addEventListener('click', () => {
  if (estado.mudandoTransmissao) return;
  estado.malha.transmitindo ? pararTransmissao() : comecarTransmissao();
});

// ---------- Começar ----------
async function comecarTransmissao() {
  const qualidade = el.selectQualidade.value;
  const q = QUALIDADES[qualidade];
  const comAudio = el.checkAudio.checked;
  estado.mudandoTransmissao = true;

  let stream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({
      video: { width: { max: q.largura }, height: { max: q.altura }, frameRate: { max: q.fps } },
      audio: comAudio,
      selfBrowserSurface: 'exclude', // não deixa escolher a própria aba (efeito espelho infinito)
      surfaceSwitching: 'include',
      systemAudio: comAudio ? 'include' : 'exclude',
    });
  } catch (erro) {
    estado.mudandoTransmissao = false;
    if (erro.name !== 'NotAllowedError') mostrarAviso(`Não foi possível capturar a tela: ${erro.message}`);
    return; // NotAllowedError = a pessoa cancelou a janela
  }

  el.botaoTransmitir.disabled = true;
  try {
    // Pede ao servidor (ele confere o limite de telas da sala)
    await estado.sinal.pedir('transmissao', { ativo: true });
    estado.malha.transmitir(stream, { qualidade, codec: el.selectCodec.value });

    // Clicou em "Parar compartilhamento" na barra do navegador
    stream.getVideoTracks()[0].addEventListener('ended', () => pararTransmissao());

    estado.minhaTela = criarTileMeu(stream);
    if (comAudio && stream.getAudioTracks().length === 0) {
      mostrarAviso('O áudio não foi incluído. No Chrome, marque "Compartilhar áudio" na janela de escolha.');
    }
    atualizarBotaoTransmitir(true);
    estado.malha.atualizarEspectadores();
  } catch (erro) {
    stream.getTracks().forEach((t) => t.stop());
    estado.malha.pararTransmissao();
    mostrarAviso(`Não foi possível transmitir: ${erro.message}`);
  } finally {
    el.botaoTransmitir.disabled = false;
    estado.mudandoTransmissao = false;
  }
}

// ---------- Parar ----------
async function pararTransmissao() {
  if (!estado.malha?.transmitindo) return;
  estado.mudandoTransmissao = true;
  estado.malha.pararTransmissao();
  estado.minhaTela?.tile.remove();
  estado.minhaTela = null;
  atualizarBotaoTransmitir(false);
  await estado.sinal.pedir('transmissao', { ativo: false }).catch(() => {});
  estado.mudandoTransmissao = false;
}

function atualizarBotaoTransmitir(transmitindo) {
  el.botaoTransmitir.textContent = transmitindo ? 'Parar transmissão' : 'Transmitir minha tela';
  el.botaoTransmitir.classList.toggle('perigo', transmitindo);
  el.botaoTransmitir.classList.toggle('principal', !transmitindo);
  el.selectQualidade.disabled = transmitindo;
  el.selectCodec.disabled = transmitindo;
  el.checkAudio.disabled = transmitindo;
  if (!transmitindo) el.infoEspectadores.textContent = '';
  const eu = estado.pessoas.get(estado.meuId);
  if (eu) eu.transmitindo = transmitindo;
  renderizarPessoas();
  atualizarVazio();
}

// Quantas pessoas estão vendo a MINHA tela
function atualizarInfoEspectadores(quantidade) {
  const texto =
    quantidade === 0
      ? 'Ninguém assistindo: sem envio, sem gasto'
      : `👁 ${quantidade} ${quantidade === 1 ? 'pessoa assistindo' : 'pessoas assistindo'}`;
  el.infoEspectadores.textContent = texto;
  if (estado.minhaTela) estado.minhaTela.status.textContent = texto;
}

// =====================================================
// TELAS DOS OUTROS
// =====================================================
function garantirTile(id) {
  if (estado.telas.has(id)) return;

  const tile = criar('div', 'tile');
  const video = criar('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = estado.mudos.has(id);
  const stream = estado.streams.get(id);
  if (stream) video.srcObject = stream;

  // ---------- Camadas por cima do vídeo ----------
  const conectando = criar('div', 'tile-pausado', 'Conectando...');
  const pausado = criar('div', 'tile-pausado clicavel', 'Tela oculta (você não está recebendo o vídeo). Clique para ver.');
  pausado.hidden = true;

  // ---------- Barra com nome e botões ----------
  const barra = criar('div', 'tile-barra');
  const nome = criar('span', null, nomeDe(id));
  const acoes = criar('div', 'acoes');

  const botaoSom = criar('button', 'botao pequeno', video.muted ? '🔇' : '🔊');
  botaoSom.title = 'Ligar/desligar o som desta transmissão';
  botaoSom.addEventListener('click', () => {
    const mudo = !estado.mudos.has(id);
    mudo ? estado.mudos.add(id) : estado.mudos.delete(id);
    video.muted = mudo;
    botaoSom.textContent = mudo ? '🔇' : '🔊';
  });

  const botaoOcultar = criar('button', 'botao pequeno', 'Ocultar');
  const tela = { tile, video, conectando, oculto: false };

  // Se o navegador bloquear vídeo com som automático, começa mudo (senão nem aparece)
  tela.tocar = () => {
    video.play().catch(() => {
      video.muted = true;
      estado.mudos.add(id);
      botaoSom.textContent = '🔇';
      video.play().catch(() => {});
    });
  };
  const alternarOculto = () => {
    tela.oculto = !tela.oculto;
    estado.malha.ocultar(id, tela.oculto); // quem transmite para de mandar o vídeo pra mim
    pausado.hidden = !tela.oculto;
    if (tela.oculto) conectando.hidden = true;
    botaoOcultar.textContent = tela.oculto ? 'Mostrar' : 'Ocultar';
  };
  botaoOcultar.addEventListener('click', alternarOculto);
  pausado.addEventListener('click', alternarOculto);

  const botaoCheia = criar('button', 'botao pequeno', '⛶');
  botaoCheia.title = 'Tela cheia';
  botaoCheia.addEventListener('click', () => video.requestFullscreen?.());
  video.addEventListener('dblclick', () => video.requestFullscreen?.());

  // Some o "Conectando..." quando o primeiro quadro chega
  video.addEventListener('loadeddata', () => (conectando.hidden = true));

  acoes.append(botaoSom, botaoOcultar, botaoCheia);
  barra.append(nome, acoes);
  tile.append(video, conectando, pausado, barra);
  el.grade.append(tile);
  estado.telas.set(id, tela);
  if (stream) tela.tocar();
  atualizarVazio();
}

function removerTile(id) {
  const tela = estado.telas.get(id);
  if (!tela) return;
  tela.tile.remove();
  estado.telas.delete(id);
  atualizarVazio();
}

// ---------- Prévia da MINHA tela ----------
function criarTileMeu(stream) {
  const tile = criar('div', 'tile minha');
  const video = criar('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true;
  video.srcObject = new MediaStream(stream.getVideoTracks());

  const barra = criar('div', 'tile-barra');
  const status = criar('span', 'info', '');
  barra.append(criar('strong', null, 'Você (transmitindo)'), status);
  tile.append(video, barra);
  el.grade.prepend(tile);
  return { tile, status };
}

function atualizarVazio() {
  el.vazio.hidden = el.grade.querySelector('.tile') !== null;
}

// =====================================================
// PESSOAS
// =====================================================
function renderizarPessoas() {
  el.listaPessoas.replaceChildren();
  for (const [id, pessoa] of estado.pessoas) {
    const item = criar('li');
    const esquerda = criar('span', null, pessoa.nome);
    if (id === estado.meuId) esquerda.append(criar('span', 'voce', ' (você)'));
    item.append(esquerda);
    if (pessoa.transmitindo) item.append(criar('span', 'etiqueta', 'AO VIVO'));
    el.listaPessoas.append(item);
  }
  el.contadorPessoas.textContent = estado.pessoas.size;
}

// =====================================================
// CHAT
// =====================================================
el.formChat.addEventListener('submit', async (e) => {
  e.preventDefault();
  const texto = el.campoChat.value.trim();
  if (!texto) return;
  el.campoChat.value = '';
  try {
    await estado.sinal.pedir('chat', { texto });
  } catch (erro) {
    el.campoChat.value = texto;
    mostrarAviso(erro.message);
  }
});

function adicionarMensagem(m) {
  const item = criar('li');
  const hora = new Date(m.hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  item.append(criar('span', 'autor', m.nome), document.createTextNode(m.texto), criar('span', 'hora', hora));
  rolarChat(item);
}

function adicionarMensagemSistema(texto) {
  rolarChat(criar('li', 'hora', texto));
}

function rolarChat(item) {
  const estavaNoFim = el.listaChat.scrollHeight - el.listaChat.scrollTop - el.listaChat.clientHeight < 40;
  el.listaChat.append(item);
  if (estavaNoFim) el.listaChat.scrollTop = el.listaChat.scrollHeight;
}

// =====================================================
// TOPO: copiar link e sair
// =====================================================
el.botaoCopiar.addEventListener('click', async () => {
  const link = `${location.origin}${location.pathname}?sala=${estado.codigo}`;
  try {
    await navigator.clipboard.writeText(link);
    el.botaoCopiar.textContent = 'Copiado!';
    setTimeout(() => (el.botaoCopiar.textContent = 'Copiar link'), 2000);
  } catch {
    mostrarAviso(`Link da sala: ${link}`, true);
  }
});

el.botaoSair.addEventListener('click', async () => {
  esconderAviso();
  if (estado.malha?.transmitindo) await pararTransmissao();
  await estado.sinal?.pedir('sair').catch(() => {});
  clearInterval(estado.timerPing);
  estado.malha?.fechar();
  estado.sinal?.fechar();
  location.href = location.pathname; // volta pro início (sem o ?sala=)
});

// Fechou a aba: avisa o servidor na hora (senão ele espera a reconexão)
window.addEventListener('pagehide', () => {
  if (estado.sinal?.conectado) estado.sinal.ws.send(JSON.stringify({ id: 0, metodo: 'sair', dados: {} }));
});
