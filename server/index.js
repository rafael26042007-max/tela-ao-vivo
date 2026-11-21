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
const limites = require('./limites');

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
// Cabeçalhos de segurança básicos em todas as respostas
const CABECALHOS_SEGURANCA = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'X-Frame-Options': 'DENY',
};

function responderJson(res, status, dados) {
  res.writeHead(status, {
    ...CABECALHOS_SEGURANCA,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(JSON.stringify(dados));
}

// IP de quem fez a requisição.
// Atrás de um proxy, pega o último IP do X-Forwarded-For (o que o NOSSO proxy anotou;
// os anteriores podem ter sido inventados pelo visitante).
function ipDe(req) {
  if (config.confiarProxy) {
    const lista = String(req.headers['x-forwarded-for'] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
    if (lista.length) return lista[lista.length - 1];
  }
  return req.socket.remoteAddress;
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
    });
    res.end(conteudo);
  });
}

// -----------------------------------------------------
// Rotas
//   POST /api/salas          -> cria sala (senha opcional), devolve { codigo }
//   GET  /api/salas/:codigo  -> diz se a sala existe
//   GET  /qualquer-coisa     -> arquivos do site
// -----------------------------------------------------
async function tratarRequisicao(req, res) {
  const url = new URL(req.url, 'http://localhost');

  try {
    if (url.pathname === '/api/salas' && req.method === 'POST') {
      const ip = ipDe(req);
      if (!limites.criacaoDeSalas.pode(ip)) {
        return responderJson(res, 429, { erro: 'Muitas salas criadas. Espere um minuto.' });
      }
      let corpo;
      try {
        corpo = await lerJson(req);
      } catch (erro) {
        return responderJson(res, 400, { erro: erro.message });
      }
      limites.criacaoDeSalas.registrar(ip);
      const codigo = await criarSala({ senha: corpo.senha });
      return responderJson(res, 201, { codigo });
    }

    const rotaSala = url.pathname.match(/^\/api\/salas\/([^/]+)$/);
    if (rotaSala && req.method === 'GET') {
      // Mesmo limitador do "entrar": impede ficar chutando códigos por aqui
      const ip = ipDe(req);
      if (!limites.tentativasErradas.pode(ip)) {
        return responderJson(res, 429, { erro: 'Muitas tentativas erradas. Espere alguns minutos.' });
      }
      const info = infoSala(rotaSala[1]);
      if (!info.existe) limites.tentativasErradas.registrar(ip);
      return responderJson(res, 200, info);
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
    if (config.confiarProxy) {
      console.log('  Modo proxy:    acesse pelo domínio configurado no Caddy');
    } else {
      console.log(`  Na sua rede:   ${protocolo}://${config.ipAnunciado}:${config.porta}`);
    }
    console.log(`  Vídeo (WebRTC): porta ${config.portaRtc} UDP/TCP`);
    console.log('');
  });
}

// Ctrl+C ou "systemctl stop": encerra na hora
for (const sinal of ['SIGINT', 'SIGTERM']) {
  process.on(sinal, () => {
    console.log('\n  Encerrando o servidor...');
    process.exit(0);
  });
}

iniciar().catch((erro) => {
  // A porta do vídeo (40000) ocupada cai aqui
  if (/EADDRINUSE|address already in use/i.test(erro.message)) {
    console.error(`\n  A porta ${config.portaRtc} (vídeo) já está em uso. Outro servidor está rodando?\n`);
    process.exit(1);
  }
  console.error('Falha ao iniciar:', erro);
  process.exit(1);
});
