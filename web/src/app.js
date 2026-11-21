// =====================================================
// Tela ao Vivo - app do navegador
// Fluxo: início (criar/entrar) -> sala (transmitir, assistir, chat)
// =====================================================
import { Sinalizacao } from './conexao.js';
import { ClienteMidia, QUALIDADES } from './midia.js';

// =====================================================
// Elementos da página
// =====================================================
const $ = (id) => document.getElementById(id);
const el = {
  telaInicio: $('tela-inicio'),
  telaSala: $('tela-sala'),
  campoNome: $('campo-nome'),
  campoCodigo: $('campo-codigo'),
  campoSenhaCriar: $('campo-senha-criar'),
  campoSenhaEntrar: $('campo-senha-entrar'),
  iconeSenha: $('icone-senha'),
  botaoCriar: $('botao-criar'),
  formEntrar: $('form-entrar'),
  erroInicio: $('erro-inicio'),

  textoCodigo: $('texto-codigo'),
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
  audios: $('audios'),
};

// =====================================================
// Estado do app
// =====================================================
const estado = {
  sinal: null,
  midia: null,
  codigo: null,
  meuId: null,
  pronto: null, // Promise: resolve quando a mídia está pronta pra consumir
  pessoas: new Map(), // participanteId -> nome
  produtores: new Map(), // produtorId -> { participanteId, tipo } (de todo mundo)
  telas: new Map(), // produtorId -> { consumidor, elemento, participanteId, tipo, cancelado }
  mudos: new Set(), // participanteIds com o som desligado por mim
  minhaTela: null, // { stream, tile, video }
  mudandoTransmissao: false,
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

let timerAviso = null;
function mostrarAviso(texto, fixo = false) {
  el.aviso.textContent = texto;
  el.aviso.hidden = false;
  clearTimeout(timerAviso);
  if (!fixo) timerAviso = setTimeout(() => (el.aviso.hidden = true), 8000);
}

function mostrarErroInicio(texto) {
  el.erroInicio.textContent = texto;
}

function setCarregando(sim) {
  el.botaoCriar.disabled = sim;
  el.formEntrar.querySelector('button').disabled = sim;
}

// =====================================================
// TELA DE INÍCIO
// =====================================================

// ---------- Preenche nome salvo e código do link (?sala=ABC123) ----------
el.campoNome.value = ler('nome') ?? '';
const codigoDoLink = normalizarCodigo(new URLSearchParams(location.search).get('sala'));
if (codigoDoLink) el.campoCodigo.value = codigoDoLink;
(el.campoNome.value ? el.campoCodigo : el.campoNome).focus();

// ---------- Criar sala ----------
el.botaoCriar.addEventListener('click', async () => {
  if (!validarNome()) return;
  setCarregando(true);
  mostrarErroInicio('');
  try {
    const senha = el.campoSenhaCriar.value;
    const resposta = await fetch('/api/salas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || 'Erro ao criar a sala');
    await entrarNaSala(dados.codigo, senha);
  } catch (erro) {
    mostrarErroInicio(erro.message);
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

  // ---------- Campo de senha ainda escondido? Pergunta se a sala tem senha ----------
  if (el.campoSenhaEntrar.hidden) {
    setCarregando(true);
    try {
      const resposta = await fetch(`/api/salas/${codigo}`);
      const info = await resposta.json();
      if (!resposta.ok) throw new Error(info.erro || 'Erro ao procurar a sala');
      if (!info.existe) throw new Error('Sala não encontrada. Confira o código.');
      if (info.temSenha) {
        el.campoSenhaEntrar.hidden = false;
        el.campoSenhaEntrar.focus();
        mostrarErroInicio('Esta sala tem senha. Digite e clique em Entrar.');
        return;
      }
    } catch (erro) {
      mostrarErroInicio(erro.message);
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

  const protocolo = location.protocol === 'https:' ? 'wss' : 'ws';
  const sinal = new Sinalizacao(`${protocolo}://${location.host}/ws`);

  let liberar;
  estado.pronto = new Promise((resolve) => (liberar = resolve));

  try {
    await sinal.aberto;
    estado.sinal = sinal;
    registrarEventos(sinal);

    const info = await sinal.pedir('entrar', { codigo, nome: el.campoNome.value.trim(), senha });
    estado.codigo = info.codigo;
    estado.meuId = info.meuId;
    for (const p of info.participantes) estado.pessoas.set(p.id, p.nome);

    estado.midia = new ClienteMidia(sinal);
    estado.midia.aoMudarEspectadores = atualizarInfoEspectadores;
    await estado.midia.iniciar(info.rtpCapabilities);
    liberar();

    // ---------- Monta a tela da sala ----------
    el.telaInicio.hidden = true;
    el.telaSala.hidden = false;
    el.textoCodigo.textContent = info.codigo;
    el.iconeSenha.hidden = !info.temSenha;
    document.title = `Sala ${info.codigo} · Tela ao Vivo`;
    history.replaceState(null, '', `/?sala=${info.codigo}`);
    prepararControles();
    for (const m of info.chat) adicionarMensagem(m);
    for (const p of info.produtores) aoNovoProdutor(p);
    renderizarPessoas();
  } catch (erro) {
    sinal.fechar();
    estado.sinal = null;
    mostrarErroInicio(erro.message);
  } finally {
    setCarregando(false);
  }
}

// ---------- Avisos que o servidor manda ----------
function registrarEventos(sinal) {
  sinal.on('participanteEntrou', (p) => {
    estado.pessoas.set(p.id, p.nome);
    renderizarPessoas();
    adicionarMensagemSistema(`${p.nome} entrou`);
  });

  sinal.on('participanteSaiu', ({ id }) => {
    const nome = estado.pessoas.get(id);
    estado.pessoas.delete(id);
    for (const [produtorId, info] of estado.produtores) {
      if (info.participanteId === id) aoProdutorFechado({ produtorId });
    }
    renderizarPessoas();
    if (nome) adicionarMensagemSistema(`${nome} saiu`);
  });

  sinal.on('novoProdutor', aoNovoProdutor);
  sinal.on('produtorFechado', aoProdutorFechado);
  sinal.on('chat', adicionarMensagem);

  sinal.on('desconectado', ({ motivo }) => {
    mostrarAviso(`Conexão com o servidor perdida${motivo ? ` (${motivo})` : ''}. Recarregue a página para voltar.`, true);
    el.botaoTransmitir.disabled = true;
    el.formChat.querySelector('button').disabled = true;
  });
}

// =====================================================
// CONTROLES DE TRANSMISSÃO
// =====================================================
function prepararControles() {
  // ---------- Codecs que este navegador consegue enviar ----------
  const nomes = { VP8: 'VP8 (compatível)', H264: 'H264 (pode usar a GPU)' };
  el.selectCodec.replaceChildren();
  for (const codec of estado.midia.codecsDisponiveis()) {
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
  const temCaptura = !!navigator.mediaDevices?.getDisplayMedia;
  if (!window.isSecureContext || !temCaptura || !estado.midia.podeTransmitir) {
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
  estado.midia.transmitindo ? pararTransmissao() : comecarTransmissao();
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
    const produtor = await estado.midia.transmitir(stream, { qualidade, codec: el.selectCodec.value });
    // Clicou em "Parar compartilhamento" na barra do navegador
    produtor.on('trackended', () => pararTransmissao());

    estado.minhaTela = { stream, ...criarTileMeu(stream) };
    if (comAudio && stream.getAudioTracks().length === 0) {
      mostrarAviso('O áudio não foi incluído. No Chrome, marque "Compartilhar áudio" na janela de escolha.');
    }
    atualizarBotaoTransmitir(true);
  } catch (erro) {
    stream.getTracks().forEach((t) => t.stop());
    await estado.midia.pararTransmissao();
    mostrarAviso(`Não foi possível transmitir: ${erro.message}`);
  } finally {
    el.botaoTransmitir.disabled = false;
    estado.mudandoTransmissao = false;
  }
}

// ---------- Parar ----------
async function pararTransmissao() {
  if (!estado.midia.transmitindo && !estado.minhaTela) return;
  estado.mudandoTransmissao = true;
  await estado.midia.pararTransmissao();
  if (estado.minhaTela) {
    estado.minhaTela.stream.getTracks().forEach((t) => t.stop());
    estado.minhaTela.tile.remove();
    estado.minhaTela = null;
  }
  atualizarBotaoTransmitir(false);
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
  renderizarPessoas();
  atualizarVazio();
}

// Quantas pessoas estão vendo a MINHA tela
function atualizarInfoEspectadores(quantidade) {
  const texto =
    quantidade === 0
      ? 'Ninguém assistindo: envio pausado pra economizar'
      : `👁 ${quantidade} ${quantidade === 1 ? 'pessoa assistindo' : 'pessoas assistindo'}`;
  el.infoEspectadores.textContent = texto;
  if (estado.minhaTela) estado.minhaTela.status.textContent = texto;
}

// =====================================================
// TELAS DOS OUTROS (consumir)
// =====================================================
async function aoNovoProdutor(p) {
  estado.produtores.set(p.produtorId, { participanteId: p.participanteId, tipo: p.tipo });
  renderizarPessoas();
  if (p.participanteId === estado.meuId) return;

  const entrada = { participanteId: p.participanteId, tipo: p.tipo, consumidor: null, elemento: null, cancelado: false };
  estado.telas.set(p.produtorId, entrada);

  try {
    await estado.pronto;
    const consumidor = await estado.midia.consumir(p.produtorId);
    if (entrada.cancelado) {
      consumidor.close(); // a transmissão acabou enquanto conectava
      return;
    }
    entrada.consumidor = consumidor;
    entrada.elemento = p.tipo === 'tela' ? criarTileRemoto(p, entrada) : criarAudio(p, consumidor);
  } catch (erro) {
    estado.telas.delete(p.produtorId);
    if (!entrada.cancelado) mostrarAviso(`Não foi possível abrir a transmissão de ${p.nome}: ${erro.message}`);
  }
  atualizarVazio();
}

function aoProdutorFechado({ produtorId }) {
  estado.produtores.delete(produtorId);
  const entrada = estado.telas.get(produtorId);
  if (entrada) {
    entrada.cancelado = true;
    entrada.consumidor?.close();
    entrada.elemento?.remove();
    estado.telas.delete(produtorId);
  }
  renderizarPessoas();
  atualizarVazio();
}

// ---------- Cartão com a tela de outra pessoa ----------
function criarTileRemoto(p, entrada) {
  const tile = criar('div', 'tile');
  const video = criar('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = true; // o som vem pelo <audio> separado
  video.srcObject = new MediaStream([entrada.consumidor.track]);

  // ---------- Overlay de "oculto" ----------
  const pausado = criar('div', 'tile-pausado', 'Tela oculta (sem gastar internet). Clique para ver.');
  pausado.hidden = true;

  // ---------- Barra com nome e botões ----------
  const barra = criar('div', 'tile-barra');
  const nome = criar('span', null, p.nome);
  const acoes = criar('div', 'acoes');

  const botaoSom = criar('button', 'botao pequeno', estado.mudos.has(p.participanteId) ? '🔇' : '🔊');
  botaoSom.title = 'Ligar/desligar o som desta transmissão';
  botaoSom.addEventListener('click', () => {
    const mudo = !estado.mudos.has(p.participanteId);
    mudo ? estado.mudos.add(p.participanteId) : estado.mudos.delete(p.participanteId);
    botaoSom.textContent = mudo ? '🔇' : '🔊';
    for (const audio of el.audios.querySelectorAll('audio')) {
      if (audio.dataset.participante === p.participanteId) audio.muted = mudo;
    }
  });

  const botaoOcultar = criar('button', 'botao pequeno', 'Ocultar');
  const alternarOculto = async () => {
    const ocultar = !entrada.consumidor.paused;
    botaoOcultar.disabled = true;
    try {
      ocultar ? await estado.midia.pausarConsumidor(entrada.consumidor) : await estado.midia.retomarConsumidor(entrada.consumidor);
      pausado.hidden = !ocultar;
      botaoOcultar.textContent = ocultar ? 'Mostrar' : 'Ocultar';
    } catch (erro) {
      mostrarAviso(erro.message);
    } finally {
      botaoOcultar.disabled = false;
    }
  };
  botaoOcultar.addEventListener('click', alternarOculto);
  pausado.addEventListener('click', alternarOculto);

  const botaoCheia = criar('button', 'botao pequeno', '⛶');
  botaoCheia.title = 'Tela cheia';
  botaoCheia.addEventListener('click', () => video.requestFullscreen?.());
  video.addEventListener('dblclick', () => video.requestFullscreen?.());

  acoes.append(botaoSom, botaoOcultar, botaoCheia);
  barra.append(nome, acoes);
  tile.append(video, pausado, barra);
  el.grade.append(tile);
  return tile;
}

// ---------- Áudio de outra pessoa (invisível) ----------
function criarAudio(p, consumidor) {
  const audio = criar('audio');
  audio.autoplay = true;
  audio.dataset.participante = p.participanteId;
  audio.muted = estado.mudos.has(p.participanteId);
  audio.srcObject = new MediaStream([consumidor.track]);
  el.audios.append(audio);
  audio.play().catch(() => {});
  return audio;
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
  const status = criar('span', 'info', el.infoEspectadores.textContent || 'Conectando...');
  barra.append(criar('strong', null, 'Você (transmitindo)'), status);
  tile.append(video, barra);
  el.grade.prepend(tile);
  return { tile, video, status };
}

function atualizarVazio() {
  el.vazio.hidden = el.grade.querySelector('.tile') !== null;
}

// =====================================================
// PESSOAS
// =====================================================
function renderizarPessoas() {
  const aoVivo = new Set();
  for (const info of estado.produtores.values()) if (info.tipo === 'tela') aoVivo.add(info.participanteId);
  if (estado.midia?.transmitindo) aoVivo.add(estado.meuId);

  el.listaPessoas.replaceChildren();
  for (const [id, nome] of estado.pessoas) {
    const item = criar('li');
    const esquerda = criar('span', null, nome);
    if (id === estado.meuId) esquerda.append(criar('span', 'voce', ' (você)'));
    item.append(esquerda);
    if (aoVivo.has(id)) item.append(criar('span', 'etiqueta', 'AO VIVO'));
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
  const link = `${location.origin}/?sala=${estado.codigo}`;
  try {
    await navigator.clipboard.writeText(link);
    el.botaoCopiar.textContent = 'Copiado!';
    setTimeout(() => (el.botaoCopiar.textContent = 'Copiar link'), 2000);
  } catch {
    mostrarAviso(`Link da sala: ${link}`, true);
  }
});

el.botaoSair.addEventListener('click', async () => {
  if (estado.midia?.transmitindo) await pararTransmissao();
  estado.sinal?.fechar();
  location.href = '/';
});
