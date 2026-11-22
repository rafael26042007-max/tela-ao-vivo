// =====================================================
// Configurações do servidor de sinalização
// Tudo pode ser trocado por variáveis de ambiente (ver .env.example)
// =====================================================
const os = require('os');

// -----------------------------------------------------
// IP do PC na rede local (só usado nas mensagens do terminal)
// Ignora adaptadores virtuais (WSL, VirtualBox, Docker...)
// -----------------------------------------------------
const VIRTUAIS = /vethernet|virtualbox|vmware|wsl|docker|hyper-v|loopback|tailscale|zerotier|^br-|^veth/i;

function ipDaRedeLocal() {
  const candidatos = [];
  for (const [nome, interfaces] of Object.entries(os.networkInterfaces())) {
    for (const iface of interfaces ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      candidatos.push({ ip: iface.address, virtual: VIRTUAIS.test(nome) });
    }
  }
  const privado = (ip) => /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip);
  const escolhido =
    candidatos.find((c) => !c.virtual && privado(c.ip)) ?? candidatos.find((c) => !c.virtual) ?? candidatos[0];
  return escolhido?.ip ?? '127.0.0.1';
}

// Lista separada por vírgula -> array sem espaços
const lista = (texto) =>
  String(texto ?? '')
    .split(',')
    .map((s) => s.trim().replace(/\/+$/, ''))
    .filter(Boolean);

module.exports = {
  // ---------- Rede ----------
  // O Render define a variável PORT sozinho
  porta: Number(process.env.PORT || process.env.PORTA || 3000),
  host: process.env.HOST || '0.0.0.0',
  ipLocal: ipDaRedeLocal(),

  // HTTPS próprio só pra testar na rede local (outros PCs precisam de HTTPS
  // pra transmitir). No Render, o HTTPS já vem pronto: deixe desligado.
  usarHttps: process.env.HTTPS === 'true',
  certificadoArquivo: process.env.CERT_ARQUIVO || null,
  chaveArquivo: process.env.CHAVE_ARQUIVO || null,

  // true = tem um proxy na frente (Render) -> IP real vem no X-Forwarded-For
  confiarProxy: process.env.CONFIAR_PROXY === 'true',

  // Sites que podem usar este servidor (ex: o GitHub Pages).
  // O próprio endereço do servidor é sempre permitido.
  origensPermitidas: lista(process.env.ORIGENS_PERMITIDAS),

  // ---------- Limites ----------
  maxSalas: Number(process.env.MAX_SALAS || 100),
  // Em P2P cada transmissor envia uma cópia pra cada pessoa (o bitrate se ajusta sozinho)
  maxPessoasPorSala: Number(process.env.MAX_PESSOAS || 8),
  maxTransmissoesPorSala: Number(process.env.MAX_TRANSMISSOES || 4),
  minutosSalaVazia: Number(process.env.MINUTOS_SALA_VAZIA || 30),
  // Tempo pra voltar se a conexão com o servidor cair (o vídeo P2P continua).
  // 90s: no celular, apagar a tela ou trocar de app derruba a conexão por um tempo.
  segundosParaReconectar: Number(process.env.SEGUNDOS_RECONECTAR || 90),
  tamanhoMaxSenha: 64,

  // ---------- Bilhetes (voltar pra sala depois de F5 ou reinício) ----------
  // No Render, SEGREDO é gerado sozinho (render.yaml) e fica salvo.
  // Sem SEGREDO, uma chave nova é criada a cada início (bilhetes antigos param de valer).
  segredo: process.env.SEGREDO || require('crypto').randomBytes(32).toString('hex'),
  temSegredoFixo: !!process.env.SEGREDO,

  // ---------- Servidores ICE enviados pros navegadores ----------
  // STUN: descobre o IP público (grátis).
  iceServersBase: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }],

  // TURN: retransmite o vídeo quando a rede bloqueia a conexão direta.
  // Opção 1 (recomendada): Cloudflare, 1.000 GB grátis por mês
  cloudflareTurnId: process.env.CLOUDFLARE_TURN_ID || null,
  cloudflareTurnToken: process.env.CLOUDFLARE_TURN_TOKEN || null,
  // Opção 2: Open Relay (Metered), 20 GB grátis por mês
  meteredChave: process.env.METERED_CHAVE || null,
  // Opção 3: qualquer servidor TURN com usuário e senha fixos
  turnManual: process.env.TURN_URL
    ? { urls: lista(process.env.TURN_URL), username: process.env.TURN_USUARIO, credential: process.env.TURN_SENHA }
    : null,
};
