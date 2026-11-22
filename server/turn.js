// =====================================================
// Servidores ICE (STUN + TURN) que os navegadores usam pra se conectar
//
// TURN é o "plano B": quando a rede de alguém bloqueia a conexão direta
// (4G com CGNAT, rede de faculdade/empresa), o vídeo passa por ele.
// As credenciais do TURN são temporárias, então o servidor gera e guarda
// por um tempo, em vez de deixar a senha fixa no site.
// =====================================================
const config = require('./config');

const VALIDADE_MS = 12 * 60 * 60 * 1000; // credenciais valem 24h; renova a cada 12h
let cache = null; // { iceServers, ate }

// Porta 53 é bloqueada pelos navegadores: só atrasaria a conexão
function semPorta53(servidores) {
  return servidores
    .map((s) => ({ ...s, urls: [].concat(s.urls).filter((u) => !/:53(\?|$)/.test(u)) }))
    .filter((s) => s.urls.length);
}

// -----------------------------------------------------
// Opção 1: Cloudflare (1.000 GB grátis por mês)
// -----------------------------------------------------
async function doCloudflare() {
  const url = `https://rtc.live.cloudflare.com/v1/turn/keys/${config.cloudflareTurnId}/credentials/generate-ice-servers`;
  const resposta = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.cloudflareTurnToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ttl: 86400 }),
    signal: AbortSignal.timeout(8000),
  });
  if (!resposta.ok) throw new Error(`Cloudflare respondeu ${resposta.status}`);
  const dados = await resposta.json();
  return [].concat(dados.iceServers);
}

// -----------------------------------------------------
// Opção 2: Open Relay / Metered (20 GB grátis por mês)
// -----------------------------------------------------
async function doMetered() {
  const url = `https://openrelayproject.metered.ca/api/v1/turn/credentials?apiKey=${encodeURIComponent(config.meteredChave)}`;
  const resposta = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!resposta.ok) throw new Error(`Metered respondeu ${resposta.status}`);
  return [].concat(await resposta.json());
}

// -----------------------------------------------------
// Lista final: STUN do Google + TURN configurado (se houver)
// Se o TURN falhar, segue só com STUN (a maioria das redes funciona assim)
// -----------------------------------------------------
async function obterIceServers() {
  if (cache && cache.ate > Date.now()) return cache.iceServers;

  let turn = [];
  try {
    if (config.cloudflareTurnId && config.cloudflareTurnToken) turn = await doCloudflare();
    else if (config.meteredChave) turn = await doMetered();
    else if (config.turnManual) turn = [config.turnManual];
  } catch (erro) {
    console.warn('TURN indisponível, usando só STUN:', erro.message);
    return config.iceServersBase; // não guarda: tenta de novo na próxima
  }

  const iceServers = semPorta53([...config.iceServersBase, ...turn]);
  cache = { iceServers, ate: Date.now() + VALIDADE_MS };
  return iceServers;
}

function temTurn() {
  return !!((config.cloudflareTurnId && config.cloudflareTurnToken) || config.meteredChave || config.turnManual);
}

module.exports = { obterIceServers, temTurn };
