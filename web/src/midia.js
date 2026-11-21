// =====================================================
// Mídia no navegador (mediasoup-client)
// Envia a sua tela UMA vez pro servidor e recebe as telas dos outros
// =====================================================
import { Device } from 'mediasoup-client';

// -----------------------------------------------------
// Qualidades (quanto menor, menos CPU e menos internet)
// -----------------------------------------------------
export const QUALIDADES = {
  economia: { largura: 1280, altura: 720, fps: 10, bitrate: 800_000 },
  equilibrado: { largura: 1920, altura: 1080, fps: 15, bitrate: 1_500_000 },
  fluido: { largura: 1920, altura: 1080, fps: 30, bitrate: 3_000_000 },
};

export class ClienteMidia {
  constructor(sinal) {
    this.sinal = sinal;
    this.device = null;
    this.transporteEnvio = null;
    this.transporteRecebimento = null;
    this.produtores = new Map(); // id -> Producer (o que EU transmito)
    this.estadoPendente = new Map(); // avisos que chegaram antes do produtor existir
    this.aoMudarEspectadores = () => {};

    // ---------- Servidor avisa quantos estão assistindo ----------
    // 0 espectadores -> pausa o envio (o navegador para de codificar)
    this.sinal.on('controleEnvio', ({ produtorId, espectadores }) => {
      const produtor = this.produtores.get(produtorId);
      if (!produtor) {
        this.estadoPendente.set(produtorId, espectadores);
        return;
      }
      this.aplicarEspectadores(produtor, espectadores);
    });
  }

  // -----------------------------------------------------
  // Prepara o "Device" com os codecs que o servidor aceita
  // -----------------------------------------------------
  async iniciar(rtpCapabilities) {
    this.device = await Device.factory();
    await this.device.load({ routerRtpCapabilities: rtpCapabilities });
    this.transporteRecebimento = await this.criarTransporte('recebimento');
  }

  get podeTransmitir() {
    return this.device?.canProduce('video') ?? false;
  }

  // Lista os codecs de vídeo que este navegador consegue enviar
  codecsDisponiveis() {
    const nomes = this.device.rtpCapabilities.codecs
      .filter((c) => c.kind === 'video')
      .map((c) => c.mimeType.split('/')[1].toUpperCase());
    return [...new Set(nomes)].filter((n) => n === 'VP8' || n === 'H264');
  }

  // -----------------------------------------------------
  // Transportes (canos WebRTC até o servidor)
  // -----------------------------------------------------
  async criarTransporte(direcao) {
    const params = await this.sinal.pedir('criarTransporte', { direcao });
    const transporte =
      direcao === 'envio' ? this.device.createSendTransport(params) : this.device.createRecvTransport(params);

    transporte.on('connect', ({ dtlsParameters }, ok, falha) => {
      this.sinal.pedir('conectarTransporte', { transporteId: transporte.id, dtlsParameters }).then(ok).catch(falha);
    });

    if (direcao === 'envio') {
      transporte.on('produce', ({ kind, rtpParameters }, ok, falha) => {
        this.sinal
          .pedir('produzir', { transporteId: transporte.id, kind, rtpParameters })
          .then(({ id }) => ok({ id }))
          .catch(falha);
      });
    }

    transporte.on('connectionstatechange', (estado) => {
      console.log(`[transporte ${direcao}] ${estado}`);
    });
    return transporte;
  }

  // -----------------------------------------------------
  // Transmitir a tela
  // -----------------------------------------------------
  async transmitir(stream, { qualidade, codec }) {
    const q = QUALIDADES[qualidade] ?? QUALIDADES.equilibrado;
    if (!this.transporteEnvio) this.transporteEnvio = await this.criarTransporte('envio');

    // ---------- Vídeo ----------
    const video = stream.getVideoTracks()[0];
    video.contentHint = 'detail'; // tela tem texto -> prioriza nitidez, não fluidez

    const codecEscolhido = this.device.rtpCapabilities.codecs.find(
      (c) => c.mimeType.toLowerCase() === `video/${codec}`.toLowerCase()
    );

    const produtorVideo = await this.transporteEnvio.produce({
      track: video,
      codec: codecEscolhido,
      // Uma camada só (sem simulcast) -> o PC codifica só UMA vez
      encodings: [{ maxBitrate: q.bitrate, maxFramerate: q.fps }],
      codecOptions: { videoGoogleStartBitrate: 1000 },
      zeroRtpOnPause: true, // pausado = não manda nada
      stopTracks: false,
    });
    this.registrarProdutor(produtorVideo);

    // ---------- Áudio (se a pessoa marcou "compartilhar áudio") ----------
    const audio = stream.getAudioTracks()[0];
    if (audio) {
      const produtorAudio = await this.transporteEnvio.produce({
        track: audio,
        codecOptions: { opusStereo: true, opusDtx: true }, // DTX: silêncio quase não gasta banda
        zeroRtpOnPause: true,
        stopTracks: false,
      });
      this.registrarProdutor(produtorAudio);
    }

    return produtorVideo;
  }

  registrarProdutor(produtor) {
    this.produtores.set(produtor.id, produtor);
    if (this.estadoPendente.has(produtor.id)) {
      this.aplicarEspectadores(produtor, this.estadoPendente.get(produtor.id));
      this.estadoPendente.delete(produtor.id);
    }
  }

  aplicarEspectadores(produtor, espectadores) {
    if (produtor.closed) return;
    if (espectadores > 0 && produtor.paused) produtor.resume();
    if (espectadores === 0 && !produtor.paused) produtor.pause();
    if (produtor.kind === 'video') this.aoMudarEspectadores(espectadores);
  }

  async pararTransmissao() {
    for (const produtor of this.produtores.values()) {
      produtor.track?.stop();
      produtor.close();
      await this.sinal.pedir('fecharProdutor', { produtorId: produtor.id }).catch(() => {});
    }
    this.produtores.clear();
  }

  get transmitindo() {
    return this.produtores.size > 0;
  }

  // -----------------------------------------------------
  // Assistir a tela (ou ouvir o áudio) de alguém
  // -----------------------------------------------------
  async consumir(produtorId) {
    const dados = await this.sinal.pedir('consumir', {
      produtorId,
      transporteId: this.transporteRecebimento.id,
      rtpCapabilities: this.device.rtpCapabilities,
    });

    const consumidor = await this.transporteRecebimento.consume({
      id: dados.id,
      producerId: dados.produtorId,
      kind: dados.kind,
      rtpParameters: dados.rtpParameters,
    });

    await this.sinal.pedir('retomarConsumidor', { consumidorId: consumidor.id });
    return consumidor;
  }

  // Ocultar a tela de alguém = pausar (não gasta internet nem CPU decodificando)
  async pausarConsumidor(consumidor) {
    consumidor.pause();
    await this.sinal.pedir('pausarConsumidor', { consumidorId: consumidor.id });
  }

  async retomarConsumidor(consumidor) {
    consumidor.resume();
    await this.sinal.pedir('retomarConsumidor', { consumidorId: consumidor.id });
  }
}
