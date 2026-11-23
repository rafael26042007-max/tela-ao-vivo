// =====================================================
// Login com Discord (OAuth2, "authorization code") + sessão
//
// Caminho de quem entra:
//   1. Site manda a pessoa pra  GET /auth/discord/entrar?volta=<site>&aceite=<versão>
//   2. Servidor guarda um "state" (anti-falsificação) e manda pro Discord
//   3. Discord pergunta "Autorizar Tela ao Vivo?" e devolve pra /auth/discord/retorno?code&state
//   4. Servidor confere o state, troca o code pelo token (usando o SEGREDO do app),
//      lê SÓ o perfil básico (escopo "identify", sem e-mail) e JOGA O TOKEN FORA
//   5. Cria/atualiza a conta no banco e volta pro site com uma sessão no "#"
//      (o que vem depois do # não é enviado pra servidor nenhum, nem fica nos logs)
//
// A sessão é assinada com o SEGREDO do servidor (ninguém consegue falsificar),
// vale 30 dias, e para de valer na hora se a conta for apagada.
// =====================================================
const crypto = require('crypto');
const config = require('./config');
const banco = require('./banco');

const DIAS_SESSAO = 30;
const MINUTOS_STATE = 10;
const COOKIE_STATE = 'tav_state';

// state -> { volta, aceite, criado }  (só na memória, some em 10 min)
const pendentes = new Map();
setInterval(() => {
  const limite = Date.now() - MINUTOS_STATE * 60_000;
  for (const [state, p] of pendentes) if (p.criado < limite) pendentes.delete(state);
}, 60_000).unref();

// -----------------------------------------------------
// Está ligado? (precisa do banco E das credenciais do app do Discord)
// -----------------------------------------------------
function loginLigado() {
  return banco.bancoLigado() && Boolean(config.discordClientId && config.discordClientSecret);
}

// Endereço deste servidor visto de fora (o Discord exige o MESMO redirect cadastrado)
function urlRetorno(req) {
  if (config.urlPublica) return `${config.urlPublica}/auth/discord/retorno`;
  const protocolo = config.confiarProxy ? String(req.headers['x-forwarded-proto'] ?? 'https').split(',')[0] : 'http';
  return `${protocolo}://${req.headers.host}/auth/discord/retorno`;
}

// Só volta pra sites da lista (senão viraria um "redirecionador aberto" pra golpes)
function voltaPermitida(volta, req) {
  try {
    const url = new URL(volta);
    if (url.host === req.headers.host) return url.toString();
    return config.origensPermitidas.includes(url.origin) ? url.toString() : null;
  } catch {
    return null;
  }
}

// =====================================================
// 1) /auth/discord/entrar
// =====================================================
function iniciarLogin(req, res, url) {
  const volta = voltaPermitida(url.searchParams.get('volta') ?? '', req);
  if (!volta) return responderTexto(res, 400, 'Endereço de volta não permitido.');
  if (!loginLigado()) return voltarComErro(res, volta, 'O login com Discord ainda não está disponível.');

  const state = crypto.randomBytes(24).toString('base64url');
  // aceite = versão da política que a pessoa marcou no site (só vale se for a atual)
  const aceite = url.searchParams.get('aceite') === config.versaoTermos ? config.versaoTermos : null;
  pendentes.set(state, { volta, aceite, criado: Date.now() });

  const destino = new URL(`${config.discordAutorizar}`);
  destino.search = new URLSearchParams({
    client_id: config.discordClientId,
    response_type: 'code',
    redirect_uri: urlRetorno(req),
    scope: 'identify', // só o perfil básico: SEM e-mail, servidores ou amigos (LGPD: necessidade)
    state,
  }).toString();

  res.writeHead(302, {
    Location: destino.toString(),
    // O mesmo state vai num cookie: o retorno só vale NESTE navegador (impede login forjado)
    'Set-Cookie': `${COOKIE_STATE}=${state}; Path=/auth/discord; Max-Age=${MINUTOS_STATE * 60}; HttpOnly; SameSite=Lax${
      config.confiarProxy ? '; Secure' : ''
    }`,
    'Cache-Control': 'no-store',
  });
  res.end();
}

// =====================================================
// 2) /auth/discord/retorno
// =====================================================
async function concluirLogin(req, res, url) {
  const state = url.searchParams.get('state') ?? '';
  const pendente = pendentes.get(state);
  pendentes.delete(state); // cada state vale uma vez só
  const limparCookie = `${COOKIE_STATE}=; Path=/auth/discord; Max-Age=0; HttpOnly; SameSite=Lax`;

  if (!pendente) return responderTexto(res, 400, 'Login expirado. Volte pro site e tente de novo.', limparCookie);
  const { volta, aceite } = pendente;
  if (lerCookie(req, COOKIE_STATE) !== state) {
    return voltarComErro(res, volta, 'Não deu pra confirmar o login neste navegador. Tente de novo.', limparCookie);
  }
  // A pessoa clicou em "Cancelar" no Discord
  if (url.searchParams.get('error')) return voltarComErro(res, volta, 'Login cancelado.', limparCookie);

  try {
    const perfil = await lerPerfilDiscord(url.searchParams.get('code') ?? '', urlRetorno(req));

    // Conta nova só com o aceite da política (consentimento: LGPD art. 7º, I)
    const existe = await banco.contaPorDiscord(perfil.id);
    if (!existe && !aceite) {
      return voltarComErro(res, volta, 'Pra criar a conta é preciso aceitar a Política de Privacidade.', limparCookie);
    }
    const usuario = await banco.entrarComDiscord({
      discordId: perfil.id,
      nome: perfil.global_name || perfil.username,
      avatar: perfil.avatar,
      termosVersao: aceite ?? config.versaoTermos,
    });
    const sessao = criarSessao(usuario.id);
    res.writeHead(302, { Location: `${volta.split('#')[0]}#sessao=${sessao}`, 'Set-Cookie': limparCookie, 'Cache-Control': 'no-store' });
    res.end();
  } catch (erro) {
    console.error('Login Discord:', erro.message);
    voltarComErro(res, volta, 'O Discord não respondeu direito. Tente de novo daqui a pouco.', limparCookie);
  }
}

// Troca o code pelo token, lê o perfil e descarta o token (nunca é guardado)
async function lerPerfilDiscord(code, redirectUri) {
  if (!code) throw new Error('sem code');
  const respostaToken = await fetch(`${config.discordApi}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: config.discordClientId,
      client_secret: config.discordClientSecret,
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!respostaToken.ok) throw new Error(`token: ${respostaToken.status}`);
  const { access_token: token } = await respostaToken.json();

  const respostaPerfil = await fetch(`${config.discordApi}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  });
  if (!respostaPerfil.ok) throw new Error(`perfil: ${respostaPerfil.status}`);
  const perfil = await respostaPerfil.json();
  if (!/^[0-9]{5,25}$/.test(String(perfil.id))) throw new Error('perfil inválido');
  return perfil; // o token morre aqui (variável local)
}

// =====================================================
// Sessão assinada:  base64url({ u, exp }) . hmac
// =====================================================
const chaveSessao = () => crypto.createHash('sha256').update(`sessao:${config.segredo}`).digest();

function criarSessao(usuarioId) {
  const corpo = Buffer.from(JSON.stringify({ u: usuarioId, exp: Date.now() + DIAS_SESSAO * 86_400_000 })).toString('base64url');
  const assinatura = crypto.createHmac('sha256', chaveSessao()).update(corpo).digest('base64url');
  return `${corpo}.${assinatura}`;
}

// Devolve o id da conta, ou null (sessão falsa, vencida, ou conta apagada)
async function usuarioDaRequisicao(req) {
  const [tipo, sessao] = String(req.headers.authorization ?? '').split(' ');
  if (tipo !== 'Bearer' || !sessao || !banco.bancoLigado()) return null;
  const [corpo, assinatura] = sessao.split('.');
  if (!corpo || !assinatura) return null;
  const esperada = crypto.createHmac('sha256', chaveSessao()).update(corpo).digest();
  const recebida = Buffer.from(assinatura, 'base64url');
  // Comparação em tempo constante (não deixa adivinhar a assinatura pelo tempo de resposta)
  if (recebida.length !== esperada.length || !crypto.timingSafeEqual(recebida, esperada)) return null;
  let dados;
  try {
    dados = JSON.parse(Buffer.from(corpo, 'base64url').toString());
  } catch {
    return null;
  }
  if (!dados?.u || !(dados.exp > Date.now())) return null;
  return (await banco.contaExiste(dados.u)) ? dados.u : null;
}

// =====================================================
// Utilitários
// =====================================================
function voltarComErro(res, volta, mensagem, cookie) {
  const headers = { Location: `${volta.split('#')[0]}#erroLogin=${encodeURIComponent(mensagem)}`, 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(302, headers);
  res.end();
}

function responderTexto(res, status, texto, cookie) {
  const headers = { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' };
  if (cookie) headers['Set-Cookie'] = cookie;
  res.writeHead(status, headers).end(texto);
}

function lerCookie(req, nome) {
  for (const parte of String(req.headers.cookie ?? '').split(';')) {
    const [chave, ...resto] = parte.trim().split('=');
    if (chave === nome) return resto.join('=');
  }
  return null;
}

module.exports = { loginLigado, iniciarLogin, concluirLogin, usuarioDaRequisicao, criarSessao };
