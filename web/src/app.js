// =====================================================
// Tela ao Vivo - app do navegador (versão P2P)
// Fluxo: acordar servidor -> início (criar/entrar) -> sala
// =====================================================
import { Sinalizacao } from './conexao.js';
import { MalhaP2P, QUALIDADES, CAPTURA_AUTOMATICA, codecsDisponiveis } from './p2p.js';

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
  progresso: $('progresso'),
  progressoBarra: $('progresso-barra'),
  campoNome: $('campo-nome'),
  campoCodigo: $('campo-codigo'),
  campoSenhaCriar: $('campo-senha-criar'),
  checkSenha: $('check-senha'),
  selectLimite: $('select-limite'),
  esperaVaga: $('espera-vaga'),
  textoEspera: $('texto-espera'),
  botaoCancelarEspera: $('botao-cancelar-espera'),
  campoSenhaEntrar: $('campo-senha-entrar'),
  botaoCriar: $('botao-criar'),
  formEntrar: $('form-entrar'),
  erroInicio: $('erro-inicio'),

  textoCodigo: $('texto-codigo'),
  iconeSenha: $('icone-senha'),
  seloTrancada: $('selo-trancada'),
  botaoCopiar: $('botao-copiar'),
  botaoTrancar: $('botao-trancar'),
  botaoSair: $('botao-sair'),
  selectQualidade: $('select-qualidade'),
  infoQualidade: $('info-qualidade'),
  avisoUltra: $('aviso-ultra'),
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
  naoLidas: $('nao-lidas'),
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
  bilhete: null, // comprovante pra voltar pra sala (F5, queda, servidor reiniciado)
  donoId: null,
  trancada: false,
  pessoas: new Map(), // id -> { nome, transmitindo }
  telas: new Map(), // id -> { tile, video, ... } (telas dos outros)
  streams: new Map(), // id -> MediaStream recebido daquela pessoa
  mudos: new Set(), // ids com o som desligado por mim
  volumes: new Map(), // id -> volume (0 a 1)
  destaque: null, // id da tela em destaque (grande)
  minhaTela: null, // { tile, status }
  espectadores: [], // ids de quem vê a MINHA tela
  voltando: new Map(), // id -> timer (pessoas que podem voltar depois de o servidor reiniciar)
  limite: 8, // máximo de pessoas da sala (o dono escolheu)
  timerEspera: null, // sala cheia: tentando entrar de tempos em tempos
  saidasRecentes: new Map(), // nome -> timer (quem saiu há pouco: se voltar logo, o chat nem fica sabendo)
  naoLidas: 0,
  chatVisivel: true,
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

// ---------- Sessão da aba (pra voltar depois do F5) ----------
// sessionStorage: some quando a aba fecha, mas sobrevive ao F5
const CHAVE_SESSAO = 'tela-ao-vivo-sessao';
function salvarSessao() {
  try { sessionStorage.setItem(CHAVE_SESSAO, JSON.stringify({ codigo: estado.codigo, bilhete: estado.bilhete })); } catch { /* ok */ }
}
function lerSessao() {
  try { return JSON.parse(sessionStorage.getItem(CHAVE_SESSAO) || 'null'); } catch { return null; }
}
function apagarSessao() {
  try { sessionStorage.removeItem(CHAVE_SESSAO); } catch { /* ok */ }
}

// Motivo de ter voltado pra tela inicial (ex: "Você foi removido da sala")
const CHAVE_AVISO = 'tela-ao-vivo-aviso';
function lerAvisoGuardado() {
  try {
    const texto = sessionStorage.getItem(CHAVE_AVISO);
    sessionStorage.removeItem(CHAVE_AVISO);
    return texto;
  } catch {
    return null;
  }
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

// Cada pessoa ganha uma cor fixa (calculada a partir do id)
function corDe(id) {
  let soma = 0;
  for (const c of String(id)) soma = (soma * 31 + c.charCodeAt(0)) % 360;
  return `hsl(${soma}, 70%, 65%)`;
}

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

const traduzirErro = (erro) => (erro.message === 'Failed to fetch' ? 'Sem conexão com o servidor.' : erro.message);

// Botão de "clique duas vezes pra confirmar" (sem janela de confirmação do navegador)
function confirmarComSegundoClique(botao, textoConfirmar, acao) {
  const textoOriginal = botao.textContent;
  let timer = null;
  botao.addEventListener('click', () => {
    if (botao.dataset.confirmando) {
      clearTimeout(timer);
      delete botao.dataset.confirmando;
      botao.textContent = textoOriginal;
      acao();
      return;
    }
    botao.dataset.confirmando = '1';
    botao.textContent = textoConfirmar;
    timer = setTimeout(() => {
      delete botao.dataset.confirmando;
      botao.textContent = textoOriginal;
    }, 3000);
  });
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

  // ---------- Barra de progresso (aparece se demorar) ----------
  const ESPERADO_MS = 60_000;
  let timerBarra = null;
  const avisoLento = setTimeout(() => {
    el.statusServidor.textContent = 'Acordando o servidor... Isso só acontece quando ninguém usou o site por um tempo.';
    el.progresso.hidden = false;
    timerBarra = setInterval(() => {
      const passou = Date.now() - inicio;
      // Vai até 95% em ~1 min e fica esperando ali
      el.progressoBarra.style.width = `${Math.min(95, (passou / ESPERADO_MS) * 95)}%`;
    }, 300);
  }, 2500);

  const terminar = () => {
    clearTimeout(avisoLento);
    clearInterval(timerBarra);
    el.progressoBarra.style.width = '100%';
    setTimeout(() => (el.progresso.hidden = true), 400);
  };

  while (Date.now() - inicio < 120_000) {
    try {
      const resposta = await fetch(api('/saude'), { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
      if (resposta.ok) {
        terminar();
        estado.servidorPronto = true;
        el.statusServidor.className = 'status-servidor ok';
        el.statusServidor.textContent = 'Servidor online';
        setCarregando(false);
        return true;
      }
    } catch {
      // ainda acordando -> tenta de novo
    }
    await new Promise((r) => setTimeout(r, 3000));
  }

  terminar();
  el.statusServidor.className = 'status-servidor erro';
  el.statusServidor.textContent = 'O servidor não respondeu. ';
  const tentar = criar('button', 'botao pequeno', 'Tentar de novo');
  tentar.addEventListener('click', iniciar);
  el.statusServidor.append(tentar);
  return false;
}

// =====================================================
// TELA DE INÍCIO
// =====================================================

// ---------- Preenche nome salvo e código do link (?sala=ABC123) ----------
el.campoNome.value = ler('nome') ?? '';
const codigoDoLink = normalizarCodigo(new URLSearchParams(location.search).get('sala'));
if (codigoDoLink) el.campoCodigo.value = codigoDoLink;
(el.campoNome.value ? el.campoCodigo : el.campoNome).focus();
const avisoGuardado = lerAvisoGuardado();
if (avisoGuardado) {
  el.erroInicio.textContent = avisoGuardado;
  el.erroInicio.classList.add('destaque');
}

async function iniciar() {
  const pronto = await acordarServidor();
  if (!pronto) return;

  // ---------- Apertou F5 dentro de uma sala? Volta sozinho ----------
  const sessao = lerSessao();
  if (sessao?.bilhete && (!codigoDoLink || codigoDoLink === sessao.codigo)) {
    el.statusServidor.textContent = `Voltando pra sala ${sessao.codigo}...`;
    const voltou = await conectarNaSala((sinal) => sinal.pedir('voltar', { bilhete: sessao.bilhete, recarregou: true }));
    if (!voltou) {
      apagarSessao();
      el.statusServidor.textContent = 'Servidor online';
    }
  }
}
iniciar();

// ---------- Criar sala ----------
el.botaoCriar.addEventListener('click', criarSala);

async function criarSala() {
  if (!validarNome()) return;
  setCarregando(true);
  mostrarErroInicio('');
  try {
    const senha = el.checkSenha.checked ? el.campoSenhaCriar.value : '';
    if (el.checkSenha.checked && !senha) {
      el.campoSenhaCriar.focus();
      throw new Error('Digite a senha da sala, ou desmarque "Proteger com senha".');
    }
    const limite = Number(el.selectLimite.value);
    guardar('limite', String(limite));
    const resposta = await fetch(api('/api/salas'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ senha, limite }),
    });
    const dados = await resposta.json();
    if (!resposta.ok) throw new Error(dados.erro || 'Erro ao criar a sala');
    // A chave de dono só vai pra quem criou: entrando com ela, vira o dono
    await conectarNaSala((sinal) =>
      sinal.pedir('entrar', { codigo: dados.codigo, nome: el.campoNome.value.trim(), chaveDono: dados.chaveDono })
    );
  } catch (erro) {
    mostrarErroInicio(traduzirErro(erro));
  } finally {
    setCarregando(false);
  }
}

// ---------- Enter no campo do nome: entra (se tem código) ou cria a sala ----------
el.campoNome.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || !estado.servidorPronto) return;
  e.preventDefault();
  if (normalizarCodigo(el.campoCodigo.value).length === 6) el.formEntrar.requestSubmit();
  else criarSala();
});

// ---------- Entrar com código ----------
el.formEntrar.addEventListener('submit', (e) => {
  e.preventDefault();
  if (!validarNome()) return;
  const codigo = normalizarCodigo(el.campoCodigo.value);
  if (codigo.length !== 6) {
    mostrarErroInicio('O código tem 6 caracteres.');
    el.campoCodigo.focus();
    return;
  }
  pararEspera();
  tentarEntrar(codigo);
});

async function consultarSala(codigo) {
  const resposta = await fetch(api(`/api/salas/${codigo}`), { cache: 'no-store' });
  const info = await resposta.json();
  if (!resposta.ok) throw new Error(info.erro || 'Erro ao procurar a sala');
  return info;
}

// -----------------------------------------------------
// Tenta entrar: confere a sala antes (cheia? senha? trancada?)
// -----------------------------------------------------
async function tentarEntrar(codigo) {
  // Campo de senha ainda escondido? Pergunta como está a sala antes
  if (el.campoSenhaEntrar.hidden) {
    setCarregando(true);
    try {
      const info = await consultarSala(codigo);
      if (!info.existe) throw new Error('Sala não encontrada. Confira o código.');
      if (info.trancada) throw new Error('A sala está trancada pelo dono.');
      if (info.cheia) return esperarVaga(codigo, info);
      if (info.temSenha) {
        pararEspera();
        el.campoSenhaEntrar.hidden = false;
        el.campoSenhaEntrar.focus();
        mostrarErroInicio('Esta sala tem senha. Digite e aperte Enter.');
        return;
      }
    } catch (erro) {
      pararEspera();
      mostrarErroInicio(traduzirErro(erro));
      return;
    } finally {
      setCarregando(false);
    }
  }

  pararEspera();
  const senha = el.campoSenhaEntrar.value;
  const entrou = await conectarNaSala((sinal) => sinal.pedir('entrar', { codigo, nome: el.campoNome.value.trim(), senha }));
  // Alguém pegou a vaga antes? Volta a esperar
  if (!entrou && el.erroInicio.textContent.includes('cheia')) esperarVaga(codigo);
}

// -----------------------------------------------------
// Sala cheia: fica conferindo e entra sozinho quando abrir uma vaga
// -----------------------------------------------------
function esperarVaga(codigo, info) {
  mostrarErroInicio('');
  const lotacao = info ? ` (${info.pessoas}/${info.limite})` : '';
  el.textoEspera.textContent = `A sala ${codigo} está cheia${lotacao}. Você entra sozinho quando abrir uma vaga...`;
  el.esperaVaga.hidden = false;
  document.title = 'Esperando vaga · Tela ao Vivo';

  clearTimeout(estado.timerEspera);
  estado.timerEspera = setTimeout(async () => {
    try {
      const atual = await consultarSala(codigo);
      if (!atual.existe) {
        pararEspera();
        return mostrarErroInicio('A sala foi fechada.');
      }
      if (atual.cheia) return esperarVaga(codigo, atual); // continua esperando
      tentarEntrar(codigo); // abriu vaga!
    } catch {
      esperarVaga(codigo, info); // falha de rede: tenta de novo
    }
  }, 4000);
}

function pararEspera() {
  clearTimeout(estado.timerEspera);
  estado.timerEspera = null;
  el.esperaVaga.hidden = true;
  if (document.title.startsWith('Esperando')) document.title = 'Tela ao Vivo';
}

el.botaoCancelarEspera.addEventListener('click', pararEspera);

// ---------- Senha ao criar: só aparece se marcar a caixinha ----------
el.checkSenha.addEventListener('change', () => {
  el.campoSenhaCriar.hidden = !el.checkSenha.checked;
  if (el.checkSenha.checked) el.campoSenhaCriar.focus();
  else el.campoSenhaCriar.value = '';
});
el.campoSenhaCriar.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && estado.servidorPronto) criarSala();
});

// ---------- Limite: lembra a última escolha ----------
const limiteSalvo = ler('limite');
if (limiteSalvo && [...el.selectLimite.options].some((o) => o.value === limiteSalvo)) el.selectLimite.value = limiteSalvo;

el.campoCodigo.addEventListener('input', () => {
  el.campoCodigo.value = normalizarCodigo(el.campoCodigo.value);
  pararEspera(); // mudou o código: para de esperar a sala antiga
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
// CONECTAR NA SALA (entrar, criar ou voltar depois do F5)
// "pedido" recebe a conexão e faz o pedido certo ao servidor
// =====================================================
async function conectarNaSala(pedido) {
  setCarregando(true);
  mostrarErroInicio('');
  const sinal = new Sinalizacao(URL_WS);

  try {
    await sinal.aberto;
    const info = await pedido(sinal);
    estado.sinal = sinal;
    registrarEventos(sinal);
    aplicarEstado(info);
    montarSala(info);
    return true;
  } catch (erro) {
    sinal.fechar();
    mostrarErroInicio(erro.message);
    return false;
  } finally {
    setCarregando(false);
  }
}

function montarSala(info) {
  el.telaInicio.hidden = true;
  el.telaSala.hidden = false;
  el.textoCodigo.textContent = info.codigo;
  el.iconeSenha.hidden = !info.temSenha;
  history.replaceState(null, '', `${location.pathname}?sala=${info.codigo}`);
  atualizarTitulo();
  prepararControles();
  for (const m of info.chat) adicionarMensagem(m, false);
  observarChat();

  // Mantém o servidor acordado enquanto a sala está aberta
  clearInterval(estado.timerPing);
  estado.timerPing = setInterval(() => estado.sinal.pedir('ping').catch(() => {}), 4 * 60_000);
}

// -----------------------------------------------------
// Aplica o estado que o servidor mandou (ao entrar ou voltar)
// -----------------------------------------------------
function aplicarEstado(info) {
  estado.codigo = info.codigo;
  estado.meuId = info.meuId;
  estado.bilhete = info.bilhete;
  salvarSessao();
  if (info.meuNome) el.campoNome.value = info.meuNome;

  if (!estado.malha) {
    estado.malha = new MalhaP2P(estado.sinal, info.meuId, info.iceServers);
    registrarEventosMalha(estado.malha);
  }

  // ---------- Quem não está na lista ----------
  const presentes = new Set(info.participantes.map((p) => p.id));
  for (const id of [...estado.pessoas.keys()]) {
    if (presentes.has(id) || id === estado.meuId) continue;
    if (info.recriada) {
      // O servidor reiniciou e cada um está voltando aos poucos:
      // espera 35s antes de considerar que a pessoa saiu (a conexão de vídeo continua)
      if (!estado.voltando.has(id)) estado.voltando.set(id, setTimeout(() => removerPessoa(id), 35_000));
    } else {
      removerPessoa(id);
    }
  }

  // ---------- Quem está na sala agora ----------
  for (const p of info.participantes) {
    estado.pessoas.set(p.id, { nome: p.nome, transmitindo: p.transmitindo, ausente: p.ausente });
    if (p.id === estado.meuId) continue;
    estado.malha.par(p.id); // conexão direta com essa pessoa
    p.transmitindo ? garantirTile(p.id) : removerTile(p.id);
  }

  estado.donoId = info.donoId;
  estado.limite = info.limites?.maxPessoas ?? estado.limite;
  aplicarTrancada(info.trancada);
  renderizarPessoas();
}

// ---------- Avisos que o servidor manda ----------
function registrarEventos(sinal) {
  sinal.on('participanteEntrou', (p) => {
    const estavaVoltando = estado.voltando.has(p.id);
    if (estavaVoltando) {
      clearTimeout(estado.voltando.get(p.id));
      estado.voltando.delete(p.id);
    }
    // Saiu há menos de 1 minuto e voltou (F5, celular com a tela apagada...)? Não avisa nada no chat
    const saidaRecente = estado.saidasRecentes.get(p.nome);
    if (saidaRecente) {
      clearTimeout(saidaRecente);
      estado.saidasRecentes.delete(p.nome);
    }
    estado.pessoas.set(p.id, { nome: p.nome, transmitindo: p.transmitindo, ausente: p.ausente });
    estado.malha.par(p.id);
    if (p.transmitindo) garantirTile(p.id);
    renderizarPessoas();
    if (!estavaVoltando && !saidaRecente) adicionarMensagemSistema(`${p.nome} entrou`);
  });

  sinal.on('participanteSaiu', ({ id, motivo }) => {
    const nome = estado.pessoas.get(id)?.nome;
    removerPessoa(id);
    // Removido pelo dono: o servidor já manda o aviso certo ("foi removido(a)")
    if (!nome || motivo === 'removido') return;
    // Espera 1 minuto antes de escrever "saiu": se a pessoa voltar antes, o chat nem fica sabendo
    clearTimeout(estado.saidasRecentes.get(nome));
    estado.saidasRecentes.set(
      nome,
      setTimeout(() => {
        estado.saidasRecentes.delete(nome);
        adicionarMensagemSistema(`${nome} saiu`);
      }, 60_000)
    );
  });

  // A conexão de alguém caiu (ex: celular com a tela apagada): mostra "(voltando...)" em vez de sumir
  sinal.on('ausente', ({ id, ausente }) => {
    const pessoa = estado.pessoas.get(id);
    if (!pessoa) return;
    pessoa.ausente = ausente;
    renderizarPessoas();
  });

  sinal.on('transmissao', ({ participanteId, ativo }) => {
    const pessoa = estado.pessoas.get(participanteId);
    if (pessoa) pessoa.transmitindo = ativo;
    if (participanteId !== estado.meuId) ativo ? garantirTile(participanteId) : removerTile(participanteId);
    renderizarPessoas();
  });

  sinal.on('chat', (m) => adicionarMensagem(m, true));
  sinal.on('aviso', ({ texto }) => adicionarMensagemSistema(texto));

  // ---------- Dono e sala trancada ----------
  sinal.on('dono', ({ id }) => {
    estado.donoId = id;
    renderizarPessoas();
    if (id === estado.meuId) mostrarAviso('Agora você é o dono da sala: pode trancar a sala e remover pessoas.');
    else adicionarMensagemSistema(`${nomeDe(id)} agora é o dono da sala`);
  });
  sinal.on('sala', ({ trancada }) => {
    aplicarTrancada(trancada);
    adicionarMensagemSistema(trancada ? 'A sala foi trancada: ninguém novo entra' : 'A sala foi destrancada');
  });
  sinal.on('bilhete', ({ bilhete }) => {
    estado.bilhete = bilhete;
    salvarSessao();
  });

  // ---------- Removido pelo dono ----------
  sinal.on('expulso', () => voltarAoInicio('Você foi removido da sala pelo dono.'));

  // ---------- Conexão com o SERVIDOR (o vídeo P2P continua funcionando) ----------
  sinal.on('reiniciando', () => {
    mostrarAviso('O servidor está sendo atualizado. Você volta pra sala sozinho em alguns segundos (as telas continuam).', true);
  });

  sinal.on('desconectado', () => {
    if (el.aviso.hidden || !el.aviso.textContent.includes('atualizado')) {
      mostrarAviso('Conexão com o servidor caiu. Reconectando... (as telas continuam funcionando)', true);
    }
  });

  sinal.on('reconectado', async () => {
    try {
      const info = await sinal.pedir('voltar', {
        bilhete: estado.bilhete,
        recarregou: false,
        transmitindo: estado.malha?.transmitindo ?? false,
      });
      if (info.reentrou) {
        // Voltou como alguém "novo": refaz as conexões de vídeo com todo mundo
        estado.malha.fechar();
        estado.malha.meuId = info.meuId;
        for (const id of [...estado.telas.keys()]) removerTile(id);
        estado.pessoas.clear();
      }
      aplicarEstado(info);
      if (info.reentrou && estado.malha.transmitindo) {
        await sinal.pedir('transmissao', { ativo: true }).catch(() => pararTransmissao());
      }
      mostrarAviso(info.recriada ? 'O servidor foi atualizado e a sala foi restaurada!' : 'Reconectado ao servidor!');
    } catch (erro) {
      voltarAoInicio(`Não foi possível voltar pra sala: ${erro.message}`);
    }
  });

  sinal.on('encerrado', ({ codigo, motivo }) => {
    if (codigo === 4002) return voltarAoInicio('Você foi removido da sala pelo dono.');
    voltarAoInicio(`${motivo || 'A conexão com a sala foi encerrada'}.`);
  });
}

// -----------------------------------------------------
// Fim da sala do meu lado (removido, sala encerrada...):
// fecha tudo e volta pra tela inicial mostrando o motivo
// -----------------------------------------------------
function voltarAoInicio(texto) {
  apagarSessao();
  try { sessionStorage.setItem(CHAVE_AVISO, texto); } catch { /* ok */ }
  if (estado.malha?.transmitindo) estado.malha.pararTransmissao();
  estado.malha?.fechar();
  estado.sinal?.fechar();
  location.href = location.pathname; // tela inicial, sem o ?sala=
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
      `Não deu pra conectar com ${nomeDe(id)}. A rede de um de vocês está bloqueando a conexão direta ` +
        '(comum em 4G e redes de faculdade/empresa). Tentar outra rede (ex: Wi-Fi de casa) costuma resolver.',
      true
    );
  });

  // A cada 2s: qualidade em uso + o que está saindo de verdade
  malha.on('envio', (dados) => {
    const nome = QUALIDADES[dados.nivel]?.nome ?? dados.nivel;
    el.infoQualidade.textContent = dados.automatico ? `🔄 Automática · agora: ${nome}` : `Qualidade: ${nome}`;
    el.infoQualidade.hidden = false;
    if (!estado.minhaTela) return;
    const { captura } = dados;
    estado.minhaTela.tecnico.textContent = dados.enviando
      ? `Enviando ${dados.largura}×${dados.altura} · ${Math.round(dados.fps)} fps` +
        (dados.limitado !== 'none' ? ` · limitado por ${dados.limitado === 'cpu' ? 'CPU' : 'internet'}` : '')
      : `Capturando ${captura.largura ?? '?'}×${captura.altura ?? '?'} · até ${Math.round(captura.fps ?? 0)} fps`;
  });

  // Automática mudou de degrau
  malha.on('nivel', ({ nivel }) => {
    el.infoQualidade.textContent = `🔄 Automática · agora: ${QUALIDADES[nivel]?.nome ?? nivel}`;
  });

  // Qualidade manual pesada demais pro PC/internet
  malha.on('limite', ({ nivel, motivo }) => {
    const quem = motivo === 'cpu' ? 'O seu PC' : 'A sua internet';
    mostrarAviso(
      `${quem} não está dando conta da qualidade ${QUALIDADES[nivel]?.nome ?? nivel}: a imagem pode travar pra quem assiste. ` +
        'Pare a transmissão e escolha "Automática" ou uma qualidade menor.'
    );
  });

  malha.on('espectadores', (ids) => {
    estado.espectadores = ids;
    atualizarInfoEspectadores();
  });
}

function removerPessoa(id) {
  clearTimeout(estado.voltando.get(id));
  estado.voltando.delete(id);
  estado.pessoas.delete(id);
  estado.streams.delete(id);
  estado.malha?.removerPar(id);
  removerTile(id);
  renderizarPessoas();
}

// =====================================================
// CONTROLES DE TRANSMISSÃO
// =====================================================
let controlesProntos = false;
function prepararControles() {
  if (controlesProntos) return;
  controlesProntos = true;

  // ---------- Codecs que este navegador consegue enviar (em "Avançado") ----------
  const nomes = { VP8: 'VP8 (compatível)', H264: 'H264 (pode usar a GPU)' };
  el.selectCodec.replaceChildren();
  for (const codec of codecsDisponiveis()) {
    const opcao = criar('option', null, nomes[codec] ?? codec);
    opcao.value = codec;
    el.selectCodec.append(opcao);
  }
  const codecSalvo = ler('codec');
  if (codecSalvo && [...el.selectCodec.options].some((o) => o.value === codecSalvo)) el.selectCodec.value = codecSalvo;

  // Chave nova: quem tinha salvo uma qualidade antes passa a começar na Automática
  const qualidadeSalva = ler('qualidade-v2');
  if (qualidadeSalva && [...el.selectQualidade.options].some((o) => o.value === qualidadeSalva)) {
    el.selectQualidade.value = qualidadeSalva;
  }
  el.avisoUltra.hidden = el.selectQualidade.value !== 'ultra';

  el.selectCodec.addEventListener('change', () => guardar('codec', el.selectCodec.value));
  el.selectQualidade.addEventListener('change', () => {
    guardar('qualidade-v2', el.selectQualidade.value);
    el.avisoUltra.hidden = el.selectQualidade.value !== 'ultra';
  });

  // ---------- Dá pra transmitir daqui? ----------
  // Celular (Android/iPhone) não tem compartilhamento de tela no navegador.
  // Em vez de mostrar controles que não funcionam, a sala entra no modo "só assistir":
  // os controles somem e fica só uma nota pequena (pessoas e chat sobem na tela).
  if (!window.isSecureContext || !navigator.mediaDevices?.getDisplayMedia) {
    el.botaoTransmitir.disabled = true;
    el.telaSala.classList.add('so-assistir');
    const nota = $('nota-so-assistir');
    nota.textContent = !window.isSecureContext
      ? '🔒 Esta página não está em HTTPS: dá pra assistir e conversar, mas não transmitir.'
      : '📱 Neste aparelho dá pra assistir e conversar. Pra transmitir a sua tela, entre pelo computador.';
    nota.hidden = false;
  }
}

el.botaoTransmitir.addEventListener('click', () => {
  if (estado.mudandoTransmissao) return;
  if (estado.malha.transmitindo) return pararTransmissao();
  // Ultra (4K/120) é pesado: pergunta antes se a pessoa tem certeza
  if (el.selectQualidade.value === 'ultra') return confirmarUltra();
  comecarTransmissao();
});

// -----------------------------------------------------
// Janela "tem certeza?" do Ultra
// O clique no botão da janela já conta como gesto do usuário,
// então o navegador deixa abrir a escolha de tela logo em seguida
// -----------------------------------------------------
const dialogoUltra = $('dialogo-ultra');
function confirmarUltra() {
  if (!dialogoUltra.showModal) return comecarTransmissao(); // navegador muito antigo: segue direto
  dialogoUltra.returnValue = '';
  dialogoUltra.showModal();
}
dialogoUltra.addEventListener('close', () => {
  if (dialogoUltra.returnValue === 'confirmar') return comecarTransmissao();
  if (dialogoUltra.returnValue === 'automatica') {
    el.selectQualidade.value = 'automatica';
    el.selectQualidade.dispatchEvent(new Event('change')); // salva a escolha e esconde o aviso
    return comecarTransmissao();
  }
  // Cancelar (ou Esc): não faz nada
});

// ---------- Começar ----------
async function comecarTransmissao() {
  const qualidade = el.selectQualidade.value;
  // Automática: captura em 1080p/30 e o encoder ajusta pra baixo quando precisar
  const q = QUALIDADES[qualidade === 'automatica' ? CAPTURA_AUTOMATICA : qualidade] ?? QUALIDADES.equilibrado;
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
  if (estado.destaque === estado.meuId) definirDestaque(null);
  estado.minhaTela?.tile.remove();
  estado.minhaTela = null;
  estado.espectadores = [];
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
  if (!transmitindo) {
    el.infoEspectadores.textContent = '';
    el.infoQualidade.hidden = true;
  }
  const eu = estado.pessoas.get(estado.meuId);
  if (eu) eu.transmitindo = transmitindo;
  renderizarPessoas();
  atualizarVazio();
}

// Quem está vendo a MINHA tela (com os nomes)
function atualizarInfoEspectadores() {
  if (!estado.malha?.transmitindo) return;
  const nomes = estado.espectadores.map(nomeDe);
  const texto =
    nomes.length === 0
      ? 'Ninguém assistindo: sem envio, sem gasto'
      : `👁 ${nomes.length} assistindo: ${nomes.join(', ')}`;
  el.infoEspectadores.textContent = texto;
  if (estado.minhaTela) estado.minhaTela.status.textContent = texto;
}

// =====================================================
// TELAS (cartões)
// =====================================================

// ---------- Tela em destaque (grande), as outras ficam menores ao lado ----------
function definirDestaque(id) {
  estado.destaque = estado.destaque === id ? null : id;
  el.grade.classList.toggle('com-destaque', !!estado.destaque);
  for (const [tid, tela] of estado.telas) atualizarBotaoDestaque(tela, tid === estado.destaque);
  if (estado.minhaTela) atualizarBotaoDestaque(estado.minhaTela, estado.destaque === estado.meuId);
}

function atualizarBotaoDestaque(tela, emDestaque) {
  tela.tile.classList.toggle('destaque', emDestaque);
  tela.botaoDestaque.textContent = emDestaque ? '📌 Soltar' : '📌';
  tela.botaoDestaque.title = emDestaque ? 'Voltar ao tamanho normal' : 'Deixar esta tela grande';
  if (emDestaque) el.grade.prepend(tela.tile);
}

function criarBotaoDestaque(id) {
  const botao = criar('button', 'botao pequeno', '📌');
  botao.title = 'Deixar esta tela grande';
  botao.addEventListener('click', () => definirDestaque(id));
  return botao;
}

// ---------- Tela de outra pessoa ----------
function garantirTile(id) {
  if (estado.telas.has(id)) return;

  const tile = criar('div', 'tile');
  const video = criar('video');
  video.autoplay = true;
  video.playsInline = true;
  video.muted = estado.mudos.has(id);
  video.volume = estado.volumes.get(id) ?? 1;
  const stream = estado.streams.get(id);
  if (stream) video.srcObject = stream;

  // ---------- Camadas por cima do vídeo ----------
  const conectando = criar('div', 'tile-pausado', 'Conectando...');
  const pausado = criar('div', 'tile-pausado clicavel', 'Tela oculta (você não está recebendo o vídeo). Clique para ver.');
  pausado.hidden = true;

  // ---------- Barra com nome e botões ----------
  const barra = criar('div', 'tile-barra');
  const nome = criar('span', 'nome-tile', nomeDe(id));
  nome.style.setProperty('--cor', corDe(id));
  const acoes = criar('div', 'acoes');

  // Som: botão liga/desliga + volume
  const botaoSom = criar('button', 'botao pequeno', video.muted ? '🔇' : '🔊');
  botaoSom.title = 'Ligar/desligar o som desta tela';
  const volume = criar('input', 'volume');
  volume.type = 'range';
  volume.min = '0';
  volume.max = '1';
  volume.step = '0.05';
  volume.value = String(video.volume);
  volume.title = 'Volume desta tela';
  const aplicarSom = () => {
    const mudo = estado.mudos.has(id);
    video.muted = mudo;
    botaoSom.textContent = mudo || video.volume === 0 ? '🔇' : '🔊';
  };
  botaoSom.addEventListener('click', () => {
    estado.mudos.has(id) ? estado.mudos.delete(id) : estado.mudos.add(id);
    aplicarSom();
  });
  volume.addEventListener('input', () => {
    video.volume = Number(volume.value);
    estado.volumes.set(id, video.volume);
    if (video.volume > 0) estado.mudos.delete(id);
    aplicarSom();
  });

  const botaoOcultar = criar('button', 'botao pequeno', 'Ocultar');
  const botaoDestaque = criarBotaoDestaque(id);
  const tela = { tile, video, conectando, botaoDestaque, oculto: false };

  // Se o navegador bloquear vídeo com som automático, começa mudo (senão nem aparece)
  tela.tocar = () => {
    video.play().catch(() => {
      estado.mudos.add(id);
      aplicarSom();
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

  acoes.append(botaoSom, volume, botaoOcultar, botaoDestaque, botaoCheia);
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
  if (estado.destaque === id) definirDestaque(null);
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
  const titulo = criar('strong', null, 'Sua tela (prévia)');
  const status = criar('span', 'info', '');
  const acoes = criar('div', 'acoes');
  const botaoDestaque = criarBotaoDestaque(estado.meuId);
  acoes.append(status, botaoDestaque);
  barra.append(titulo, acoes);
  // Ex: "Enviando 1920×1080 · 15 fps" (o que sai de verdade, não só o que foi pedido)
  const tecnico = criar('div', 'tecnico', 'Medindo...');
  tile.append(video, tecnico, barra);
  el.grade.prepend(tile);
  return { tile, status, botaoDestaque, tecnico };
}

function atualizarVazio() {
  el.vazio.hidden = el.grade.querySelector('.tile') !== null;
}

// =====================================================
// PESSOAS (com cor, dono 👑 e botão de remover pro dono)
// =====================================================
function renderizarPessoas() {
  const souDono = estado.donoId === estado.meuId;
  el.botaoTrancar.hidden = !souDono;
  el.listaPessoas.replaceChildren();

  for (const [id, pessoa] of estado.pessoas) {
    const item = criar('li');
    const esquerda = criar('span', 'nome-pessoa', pessoa.nome);
    esquerda.style.setProperty('--cor', corDe(id));
    if (id === estado.donoId) esquerda.append(criar('span', 'coroa', ' 👑'));
    if (id === estado.meuId) esquerda.append(criar('span', 'voce', ' (você)'));
    if (estado.voltando.has(id) || pessoa.ausente) esquerda.append(criar('span', 'voce', ' (voltando...)'));
    item.append(esquerda);

    const direita = criar('span', 'direita');
    if (pessoa.transmitindo) direita.append(criar('span', 'etiqueta', 'AO VIVO'));
    if (souDono && id !== estado.meuId) {
      const remover = criar('button', 'botao mini', 'Remover');
      remover.title = `Remover ${pessoa.nome} da sala`;
      confirmarComSegundoClique(remover, 'Confirmar?', () => {
        estado.sinal.pedir('expulsar', { id }).catch((erro) => mostrarAviso(erro.message));
      });
      direita.append(remover);
    }
    item.append(direita);
    el.listaPessoas.append(item);
  }
  el.contadorPessoas.textContent = `${estado.pessoas.size}/${estado.limite}`;
  atualizarInfoEspectadores();
}

// ---------- Trancar sala (só o dono) ----------
function aplicarTrancada(trancada) {
  estado.trancada = !!trancada;
  el.seloTrancada.hidden = !estado.trancada;
  el.botaoTrancar.textContent = estado.trancada ? '🔓 Destrancar' : '🔒 Trancar sala';
}

el.botaoTrancar.addEventListener('click', () => {
  estado.sinal.pedir('trancar', { trancada: !estado.trancada }).catch((erro) => mostrarAviso(erro.message));
});

// =====================================================
// CHAT (com contador de mensagens não lidas)
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

function adicionarMensagem(m, nova) {
  const item = criar('li');
  const hora = new Date(m.hora).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const autor = criar('span', 'autor', m.nome);
  autor.style.color = corDe(m.participanteId);
  item.append(autor, document.createTextNode(m.texto), criar('span', 'hora', hora));
  rolarChat(item);
  if (nova && m.participanteId !== estado.meuId) contarNaoLida();
}

function adicionarMensagemSistema(texto) {
  rolarChat(criar('li', 'hora', texto));
}

function rolarChat(item) {
  const estavaNoFim = el.listaChat.scrollHeight - el.listaChat.scrollTop - el.listaChat.clientHeight < 40;
  el.listaChat.append(item);
  if (estavaNoFim) el.listaChat.scrollTop = el.listaChat.scrollHeight;
}

// ---------- Não lidas: aba em segundo plano ou chat fora da tela ----------
function contarNaoLida() {
  if (!document.hidden && estado.chatVisivel) return;
  estado.naoLidas++;
  el.naoLidas.textContent = estado.naoLidas;
  el.naoLidas.hidden = false;
  atualizarTitulo();
}

function zerarNaoLidas() {
  if (!estado.naoLidas) return;
  estado.naoLidas = 0;
  el.naoLidas.hidden = true;
  atualizarTitulo();
}

function atualizarTitulo() {
  const base = estado.codigo ? `Sala ${estado.codigo} · Tela ao Vivo` : 'Tela ao Vivo';
  document.title = estado.naoLidas ? `(${estado.naoLidas}) ${base}` : base;
}

function observarChat() {
  if (!('IntersectionObserver' in window)) return;
  new IntersectionObserver(([entrada]) => {
    estado.chatVisivel = entrada.isIntersecting;
    if (estado.chatVisivel && !document.hidden) zerarNaoLidas();
  }).observe(el.formChat);
}

document.addEventListener('visibilitychange', () => {
  if (!document.hidden && estado.chatVisivel) zerarNaoLidas();
});
el.campoChat.addEventListener('focus', zerarNaoLidas);

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

// Sair pede um segundo clique (evita sair sem querer no meio da live)
confirmarComSegundoClique(el.botaoSair, 'Clique de novo pra sair', async () => {
  esconderAviso();
  apagarSessao();
  if (estado.malha?.transmitindo) await pararTransmissao();
  await estado.sinal?.pedir('sair').catch(() => {});
  clearInterval(estado.timerPing);
  estado.malha?.fechar();
  estado.sinal?.fechar();
  location.href = location.pathname; // volta pro início (sem o ?sala=)
});

// Fechou a aba (ou F5): avisa o servidor na hora.
// No F5, a sessão da aba continua e a pessoa volta sozinha com o bilhete.
window.addEventListener('pagehide', () => {
  if (estado.sinal?.conectado) estado.sinal.ws.send(JSON.stringify({ id: 0, metodo: 'sair', dados: {} }));
});
