// =====================================================
// Tela ao Vivo - servidor de sinalização
// Junta: API de salas, WebSocket de sinalização e (no seu PC) o site
// No Render ele roda sozinho; o site fica no GitHub Pages.
// =====================================================
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const { WebSocketServer } = require('ws');

const config = require('./config');
const { obterCertificado } = require('./certificado');
const { criarSala, infoSala, estatisticas, tratarConexao } = require('./salas');
const limites = require('./limites');

const PASTA_WEB = path.join(__dirname, '..', 'web');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

// Cabeçalhos de segurança básicos em todas as respostas
const CABECALHOS_SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

// =====================================================
// Utilitários de requisição
// =====================================================

// IP de quem fez a requisição.
// No Render, o IP do visitante vem no começo do X-Forwarded-For.
function ipDe(req) {
  if (config.confiarProxy) {
    const primeiro = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    if (primeiro) return primeiro;
  }
  return req.socket.remoteAddress;
}

// Origem permitida? (o próprio servidor ou um site da lista, ex: GitHub Pages)
function origemPermitida(req) {
  const origem = req.headers.origin;
  if (!origem) return true; // curl, monitoramento etc.
  try {
    if (new URL(origem).host === req.headers.host) return true;
  } catch {
    return false;
  }
  return config.origensPermitidas.includes(origem.replace(/\/+$/, ''));
}

// CORS: deixa o site do GitHub Pages chamar a API deste servidor
function cabecalhosCors(req) {
  const origem = req.headers.origin;
  if (!origem || !origemPermitida(req)) return {};
  return {
    'Access-Control-Allow-Origin': origem,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '600',
    Vary: 'Origin',
  };
}

function responderJson(req, res, status, dados) {
  res.writeHead(status, {
    ...CABECALHOS_SEGURANCA,
    ...cabecalhosCors(req),
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(dados));
}

// Lê o corpo JSON da requisição (no máximo 1 KB)
function lerJson(req) {
  return new Promise((resolve, reject) => {
    let corpo = '';
    req.setEncoding('utf8');
    const aoReceber = (parte) => {
      corpo += parte;
      if (corpo.length > 1024) {
        // Para de guardar, descarta o resto e deixa a rota responder o erro
        req.off('data', aoReceber);
        req.resume();
        reject(new Error('Requisição grande demais'));
      }
    };
    req.on('data', aoReceber);
    req.on('end', () => {
      try {
        resolve(corpo ? JSON.parse(corpo) : {});
      } catch {
        reject(new Error('JSON inválido'));
      }
    });
    req.on('error', reject);
  });
}

// =====================================================
// Site (usado quando você roda no seu PC)
// =====================================================
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
    res.writeHead(200, {
      ...CABECALHOS_SEGURANCA,
      'Content-Type': TIPOS[path.extname(arquivo)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(conteudo);
  });
}

// =====================================================
// Rotas
//   GET  /saude              -> o servidor está acordado?
//   POST /api/salas          -> cria sala (senha opcional), devolve { codigo }
//   GET  /api/salas/:codigo  -> a sala existe? tem senha?
//   GET  /qualquer-coisa     -> arquivos do site
// =====================================================
async function tratarRequisicao(req, res) {
  const url = new URL(req.url, 'http://localhost');

  try {
    // ---------- Pré-requisição do CORS ----------
    if (req.method === 'OPTIONS') {
      res.writeHead(origemPermitida(req) ? 204 : 403, cabecalhosCors(req)).end();
      return;
    }

    // ---------- Saúde (o site usa pra "acordar" o servidor) ----------
    if (url.pathname === '/saude') {
      return responderJson(req, res, 200, { ok: true, ...estatisticas() });
    }

    if (url.pathname.startsWith('/api/') && !origemPermitida(req)) {
      return responderJson(req, res, 403, { erro: 'Origem não permitida' });
    }

    // ---------- Criar sala ----------
    if (url.pathname === '/api/salas' && req.method === 'POST') {
      const ip = ipDe(req);
      if (!limites.criacaoDeSalas.pode(ip)) {
        return responderJson(req, res, 429, { erro: 'Muitas salas criadas. Espere um minuto.' });
      }
      let corpo;
      try {
        corpo = await lerJson(req);
      } catch (erro) {
        return responderJson(req, res, 400, { erro: erro.message });
      }
      limites.criacaoDeSalas.registrar(ip);
      const codigo = await criarSala({ senha: corpo.senha });
      return responderJson(req, res, 201, { codigo });
    }

    // ---------- Consultar sala ----------
    const rotaSala = url.pathname.match(/^\/api\/salas\/([^/]+)$/);
    if (rotaSala && req.method === 'GET') {
      return responderJson(req, res, 200, infoSala(rotaSala[1]));
    }

    if (url.pathname.startsWith('/api/')) {
      return responderJson(req, res, 404, { erro: 'Rota não encontrada' });
    }

    // ---------- Site ----------
    if (req.method === 'GET') return servirArquivo(res, url.pathname);
    res.writeHead(405).end();
  } catch (erro) {
    console.error(erro);
    responderJson(req, res, 500, { erro: erro.message });
  }
}

// =====================================================
// Inicialização
// =====================================================
async function iniciar() {
  const servidor = config.usarHttps
    ? https.createServer(await obterCertificado(config), tratarRequisicao)
    : http.createServer(tratarRequisicao);

  // ---------- WebSocket em /ws (só de origens permitidas) ----------
  const wss = new WebSocketServer({
    server: servidor,
    path: '/ws',
    maxPayload: 64 * 1024,
    verifyClient: ({ req }) => origemPermitida(req),
  });

  wss.on('connection', (ws, req) => {
    ws.vivo = true;
    ws.on('pong', () => (ws.vivo = true));
    tratarConexao(ws, ipDe(req));
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

  // Porta ocupada (ex: rodou npm start duas vezes) -> mensagem clara
  servidor.on('error', (erro) => {
    if (erro.code === 'EADDRINUSE') {
      console.error(`\n  A porta ${config.porta} já está em uso.`);
      console.error('  Feche o outro terminal com o servidor rodando, ou use outra porta (PORTA=3001).\n');
    } else {
      console.error('Erro no servidor:', erro);
    }
    process.exit(1);
  });

  servidor.listen(config.porta, config.host, () => {
    const protocolo = config.usarHttps ? 'https' : 'http';
    console.log('');
    console.log('  Tela ao Vivo rodando!');
    console.log(`  Neste PC:      ${protocolo}://localhost:${config.porta}`);
    if (config.usarHttps) console.log(`  Na sua rede:   ${protocolo}://${config.ipLocal}:${config.porta}`);
    if (config.origensPermitidas.length) console.log(`  Sites liberados: ${config.origensPermitidas.join(', ')}`);
    console.log('');
  });
}

// Ctrl+C ou parada do Render: encerra na hora
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    console.log('\n  Encerrando o servidor...');
    process.exit(0);
  });
}

iniciar().catch((erro) => {
  console.error('Falha ao iniciar:', erro);
  process.exit(1);
});
