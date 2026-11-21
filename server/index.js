// =====================================================
// Tela ao Vivo - servidor principal
// Junta: site (arquivos de web/), API de salas e WebSocket de sinalização
// =====================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');

const config = require('./config');
const { obterCertificado } = require('./certificado');
const { iniciarMidia } = require('./midia');
const { criarSala, infoSala, tratarConexao } = require('./salas');

const PASTA_WEB = path.join(__dirname, '..', 'web');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.map': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// -----------------------------------------------------
// Respostas HTTP
// -----------------------------------------------------
function responderJson(res, status, dados) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(dados));
}

function servirArquivo(res, urlPath) {
  const relativo = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '');
  const arquivo = path.resolve(PASTA_WEB, relativo);

  // Impede sair da pasta web/ (ex: /../server/config.js)
  if (!arquivo.startsWith(PASTA_WEB + path.sep)) {
    res.writeHead(403).end('Proibido');
    return;
  }

  fs.readFile(arquivo, (erro, conteudo) => {
    if (erro) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Não encontrado');
      return;
    }
    res.writeHead(200, { 'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream' });
    res.end(conteudo);
  });
}

// -----------------------------------------------------
// Anti-abuso simples: no máximo 10 salas criadas por minuto por IP
// -----------------------------------------------------
const criacoesPorIp = new Map();
function podeCriarSala(ip) {
  const agora = Date.now();
  const recentes = (criacoesPorIp.get(ip) || []).filter((t) => agora - t < 60_000);
  if (recentes.length >= 10) return false;
  recentes.push(agora);
  criacoesPorIp.set(ip, recentes);
  return true;
}
setInterval(() => criacoesPorIp.clear(), 10 * 60_000).unref();

// -----------------------------------------------------
// Rotas
//   POST /api/salas          -> cria sala, devolve { codigo }
//   GET  /api/salas/:codigo  -> diz se a sala existe
//   GET  /qualquer-coisa     -> arquivos do site
// -----------------------------------------------------
async function tratarRequisicao(req, res) {
  const url = new URL(req.url, 'http://localhost');

  try {
    if (url.pathname === '/api/salas' && req.method === 'POST') {
      if (!podeCriarSala(req.socket.remoteAddress)) {
        return responderJson(res, 429, { erro: 'Muitas salas criadas. Espere um minuto.' });
      }
      const codigo = await criarSala();
      return responderJson(res, 201, { codigo });
    }

    const rotaSala = url.pathname.match(/^\/api\/salas\/([^/]+)$/);
    if (rotaSala && req.method === 'GET') {
      return responderJson(res, 200, infoSala(rotaSala[1]));
    }

    if (url.pathname.startsWith('/api/')) {
      return responderJson(res, 404, { erro: 'Rota não encontrada' });
    }

    if (req.method === 'GET') return servirArquivo(res, url.pathname);
    res.writeHead(405).end();
  } catch (erro) {
    console.error(erro);
    responderJson(res, 503, { erro: erro.message });
  }
}

// -----------------------------------------------------
// Inicialização
// -----------------------------------------------------
async function iniciar() {
  if (!fs.existsSync(path.join(PASTA_WEB, 'dist', 'app.js'))) {
    console.error('O site ainda não foi compilado. Rode: npm run build');
    process.exit(1);
  }

  await iniciarMidia();

  const servidor = config.usarHttps
    ? https.createServer(await obterCertificado(config), tratarRequisicao)
    : http.createServer(tratarRequisicao);

  // ---------- WebSocket em /ws ----------
  const wss = new WebSocketServer({ server: servidor, path: '/ws', maxPayload: 64 * 1024 });
  wss.on('connection', (ws) => {
    ws.vivo = true;
    ws.on('pong', () => (ws.vivo = true));
    tratarConexao(ws);
  });

  // Derruba conexões "fantasmas" (internet caiu sem fechar a aba)
  setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.vivo) {
        ws.terminate();
        continue;
      }
      ws.vivo = false;
      ws.ping();
    }
  }, 30_000).unref();

  servidor.listen(config.porta, () => {
    const protocolo = config.usarHttps ? 'https' : 'http';
    console.log('');
    console.log('  Tela ao Vivo rodando!');
    console.log(`  Neste PC:      ${protocolo}://localhost:${config.porta}`);
    console.log(`  Na sua rede:   ${protocolo}://${config.ipAnunciado}:${config.porta}`);
    console.log(`  Vídeo (WebRTC): porta ${config.portaRtc} UDP/TCP`);
    console.log('');
  });
}

iniciar().catch((erro) => {
  console.error('Falha ao iniciar:', erro);
  process.exit(1);
});
