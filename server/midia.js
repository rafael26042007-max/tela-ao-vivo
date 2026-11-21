// =====================================================
// Mídia: o SFU (mediasoup)
// O servidor NÃO decodifica nem recodifica vídeo, só repassa os pacotes.
// Por isso a CPU do servidor fica baixa, mesmo com várias telas.
// =====================================================
const mediasoup = require('mediasoup');
const config = require('./config');

let worker = null;
let webRtcServer = null;

// -----------------------------------------------------
// Sobe o worker (processo em C++ que move os pacotes)
// e o WebRtcServer (escuta numa porta só, UDP + TCP)
// -----------------------------------------------------
async function iniciarMidia() {
  worker = await mediasoup.createWorker({ logLevel: 'warn' });

  worker.on('died', (erro) => {
    console.error('O worker do mediasoup parou. Encerrando o servidor.', erro);
    process.exit(1);
  });

  webRtcServer = await worker.createWebRtcServer({
    listenInfos: [
      { protocol: 'udp', ip: '0.0.0.0', announcedAddress: config.ipAnunciado, port: config.portaRtc },
      { protocol: 'tcp', ip: '0.0.0.0', announcedAddress: config.ipAnunciado, port: config.portaRtc },
    ],
  });
}

// -----------------------------------------------------
// Cada sala tem o seu router (é ele que liga produtores a consumidores)
// -----------------------------------------------------
function criarRouter() {
  return worker.createRouter({ mediaCodecs: config.codecs });
}

// -----------------------------------------------------
// Transporte = "cano" WebRTC entre um navegador e o servidor
// Cada pessoa tem 1 de envio (se transmitir) e 1 de recebimento
// -----------------------------------------------------
function criarTransporte(router) {
  return router.createWebRtcTransport({
    webRtcServer,
    enableUdp: true,
    enableTcp: true, // fallback quando a rede bloqueia UDP
    preferUdp: true,
    initialAvailableOutgoingBitrate: 1_000_000,
  });
}

module.exports = { iniciarMidia, criarRouter, criarTransporte };
