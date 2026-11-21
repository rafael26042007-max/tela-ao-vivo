// =====================================================
// Configurações do servidor
// Tudo pode ser trocado por variáveis de ambiente (ver .env.example)
// =====================================================
const os = require('os');

// -----------------------------------------------------
// Descobre o IP do PC na rede local (ex: 192.168.0.10)
// É esse IP que os navegadores usam pra mandar o vídeo pro servidor
// -----------------------------------------------------
function ipDaRedeLocal() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces ?? []) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return '127.0.0.1';
}

module.exports = {
  // ---------- Site (HTTP/HTTPS + WebSocket) ----------
  porta: Number(process.env.PORTA || 3000),
  // HTTPS é obrigatório pro navegador deixar compartilhar a tela
  // (exceto em localhost). Use HTTPS=false só atrás de um proxy com HTTPS.
  usarHttps: process.env.HTTPS !== 'false',
  certificadoArquivo: process.env.CERT_ARQUIVO || null,
  chaveArquivo: process.env.CHAVE_ARQUIVO || null,

  // ---------- Mídia (WebRTC) ----------
  // IP que os navegadores vão usar pra alcançar o servidor.
  // Na internet, coloque aqui o IP público da VPS.
  ipAnunciado: process.env.IP_ANUNCIADO || ipDaRedeLocal(),
  // Uma única porta (UDP e TCP) pra TODO o vídeo -> fácil liberar no firewall
  portaRtc: Number(process.env.PORTA_RTC || 40000),

  // ---------- Limites ----------
  maxSalas: Number(process.env.MAX_SALAS || 50),
  maxPessoasPorSala: Number(process.env.MAX_PESSOAS || 20),
  minutosSalaVazia: Number(process.env.MINUTOS_SALA_VAZIA || 30),

  // ---------- Codecs aceitos pelo servidor ----------
  // VP8: funciona em todo navegador, leve.
  // H264: pode usar a GPU pra codificar (menos CPU), depende do navegador.
  codecs: [
    { kind: 'audio', mimeType: 'audio/opus', clockRate: 48000, channels: 2 },
    {
      kind: 'video',
      mimeType: 'video/VP8',
      clockRate: 90000,
      parameters: { 'x-google-start-bitrate': 1000 },
    },
    {
      kind: 'video',
      mimeType: 'video/H264',
      clockRate: 90000,
      parameters: {
        'packetization-mode': 1,
        'profile-level-id': '42e01f',
        'level-asymmetry-allowed': 1,
        'x-google-start-bitrate': 1000,
      },
    },
  ],
};
