// =====================================================
// Malha P2P: uma conexão WebRTC direta com cada pessoa da sala
// O vídeo vai direto de um navegador pro outro (não passa pelo servidor).
//
// Usa o padrão "perfect negotiation": os dois lados podem iniciar a
// negociação; se colidirem, o lado "educado" (polido) cede.
// =====================================================

// -----------------------------------------------------
// Qualidades (quanto menor, menos CPU e menos internet)
// Lembre: em P2P você envia UMA cópia pra cada pessoa que assiste
// -----------------------------------------------------
export const QUALIDADES = {
  economia: { largura: 1280, altura: 720, fps: 10, bitrate: 600_000 },
  equilibrado: { largura: 1920, altura: 1080, fps: 15, bitrate: 1_200_000 },
  fluido: { largura: 1920, altura: 1080, fps: 30, bitrate: 2_500_000 },
};

// Codecs de vídeo que este navegador consegue enviar (VP8 / H264)
export function codecsDisponiveis() {
  const codecs = window.RTCRtpSender?.getCapabilities?.('video')?.codecs ?? [];
  const nomes = codecs.map((c) => c.mimeType.split('/')[1].toUpperCase());
  return ['VP8', 'H264'].filter((n) => nomes.includes(n));
}

// Coloca o codec escolhido em primeiro lugar na negociação
function preferirCodec(transceptor, codec) {
  const capacidades = window.RTCRtpReceiver?.getCapabilities?.('video');
  if (!capacidades || !transceptor.setCodecPreferences) return;
  const escolhidos = capacidades.codecs.filter((c) => c.mimeType.toLowerCase() === `video/${codec}`.toLowerCase());
  if (!escolhidos.length) return;
  const resto = capacidades.codecs.filter((c) => !escolhidos.includes(c));
  try {
    transceptor.setCodecPreferences([...escolhidos, ...resto]);
  } catch (erro) {
    console.warn('[p2p] não deu pra escolher o codec', erro);
  }
}

export class MalhaP2P {
  constructor(sinal, meuId, iceServers) {
    this.sinal = sinal;
    this.meuId = meuId;
    this.iceServers = iceServers;
    this.pares = new Map(); // participanteId -> par (conexão com aquela pessoa)
    this.transmissao = null; // { stream, qualidade, codec } quando EU transmito
    this.ouvintes = new Map();

    // Mensagens de conexão que outra pessoa mandou pra mim
    this.sinal.on('sinal', ({ de, dados }) => {
      this.receberSinal(de, dados).catch((erro) => console.warn('[p2p] erro no sinal de', de, erro));
    });
  }

  // ---------- Eventos ----------
  on(evento, funcao) {
    if (!this.ouvintes.has(evento)) this.ouvintes.set(evento, []);
    this.ouvintes.get(evento).push(funcao);
  }

  emitir(evento, dados) {
    for (const funcao of this.ouvintes.get(evento) ?? []) funcao(dados);
  }

  enviar(para, dados) {
    this.sinal.pedir('sinal', { para, dados }).catch(() => {});
  }

  // =====================================================
  // Conexão com uma pessoa
  // =====================================================
  par(id) {
    return this.pares.get(id) ?? this.criarPar(id);
  }

  criarPar(id) {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const par = {
      id,
      pc,
      polido: this.meuId > id, // quem cede numa colisão (decidido pelo id)
      fazendoOferta: false,
      ignorarOferta: false,
      transceptores: {}, // { video, audio } que EU uso pra enviar pra essa pessoa
      ocultoPeloOutro: false, // a pessoa clicou "Ocultar" na minha tela
      tentouReiniciar: false,
    };
    this.pares.set(id, par);

    // ---------- Precisa (re)negociar: manda uma oferta ----------
    pc.onnegotiationneeded = async () => {
      try {
        par.fazendoOferta = true;
        await pc.setLocalDescription();
        this.enviar(id, { descricao: pc.localDescription });
      } catch (erro) {
        console.warn('[p2p] erro ao criar oferta', erro);
      } finally {
        par.fazendoOferta = false;
      }
    };

    // ---------- Caminhos possíveis até a outra pessoa (ICE) ----------
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) this.enviar(id, { candidato: candidate });
    };

    // ---------- Chegou vídeo/áudio da outra pessoa ----------
    pc.ontrack = ({ track, streams }) => {
      this.emitir('midiaRemota', { id, stream: streams[0] ?? new MediaStream([track]) });
    };

    // ---------- Estado da conexão ----------
    pc.onconnectionstatechange = () => {
      const estado = pc.connectionState;
      this.emitir('estadoConexao', { id, estado });
      if (estado === 'connected') par.tentouReiniciar = false;
      if (estado === 'failed') {
        if (!par.tentouReiniciar) {
          par.tentouReiniciar = true;
          pc.restartIce(); // tenta de novo uma vez
        } else {
          this.emitir('falhaConexao', { id });
        }
      }
    };

    // Se eu já estou transmitindo, essa pessoa nova também recebe
    if (this.transmissao) this.adicionarTransmissao(par);
    this.atualizarEspectadores();
    return par;
  }

  // -----------------------------------------------------
  // Recebe oferta/resposta/candidato/aviso de outra pessoa
  // -----------------------------------------------------
  async receberSinal(de, dados) {
    const par = this.par(de);
    const pc = par.pc;

    if (dados.descricao) {
      const descricao = dados.descricao;
      const colisao = descricao.type === 'offer' && (par.fazendoOferta || pc.signalingState !== 'stable');
      par.ignorarOferta = !par.polido && colisao;
      if (par.ignorarOferta) return; // o outro lado vai ceder

      await pc.setRemoteDescription(descricao);
      if (descricao.type === 'offer') {
        await pc.setLocalDescription();
        this.enviar(de, { descricao: pc.localDescription });
      }
      return;
    }

    if (dados.candidato) {
      try {
        await pc.addIceCandidate(dados.candidato);
      } catch (erro) {
        if (!par.ignorarOferta) throw erro;
      }
      return;
    }

    // A pessoa ocultou/mostrou a MINHA tela
    if ('oculto' in dados) {
      par.ocultoPeloOutro = !!dados.oculto;
      await this.aplicarOculto(par);
      this.atualizarEspectadores();
    }
  }

  removerPar(id) {
    const par = this.pares.get(id);
    if (!par) return;
    par.pc.close();
    this.pares.delete(id);
    this.atualizarEspectadores();
  }

  // =====================================================
  // Transmitir a MINHA tela pra todo mundo
  // =====================================================
  transmitir(stream, { qualidade, codec }) {
    const video = stream.getVideoTracks()[0];
    if (video) video.contentHint = 'detail'; // tela tem texto -> prioriza nitidez
    this.transmissao = { stream, qualidade, codec };
    for (const par of this.pares.values()) {
      par.ocultoPeloOutro = false; // transmissão nova: todo mundo começa vendo
      this.adicionarTransmissao(par);
    }
    this.atualizarEspectadores();
  }

  adicionarTransmissao(par) {
    const { stream, qualidade, codec } = this.transmissao;
    const q = QUALIDADES[qualidade] ?? QUALIDADES.equilibrado;

    for (const track of stream.getTracks()) {
      const existente = par.transceptores[track.kind];

      if (existente) {
        // Reaproveita o canal da transmissão anterior (não cria um novo a cada vez)
        existente.direction = 'sendonly';
        existente.sender.replaceTrack(track).catch(() => {});
        existente.sender.setStreams?.(stream);
        if (track.kind === 'video') {
          preferirCodec(existente, codec);
          this.limitarVideo(existente.sender, q);
        }
        continue;
      }

      const opcoes = { direction: 'sendonly', streams: [stream] };
      // Uma camada só, com limite de bitrate e fps -> menos CPU e internet
      if (track.kind === 'video') opcoes.sendEncodings = [{ maxBitrate: q.bitrate, maxFramerate: q.fps }];
      const transceptor = par.pc.addTransceiver(track, opcoes);
      if (track.kind === 'video') preferirCodec(transceptor, codec);
      par.transceptores[track.kind] = transceptor;
    }
    this.aplicarOculto(par);
  }

  async limitarVideo(sender, q) {
    try {
      const parametros = sender.getParameters();
      if (!parametros.encodings?.length) return;
      parametros.encodings[0].maxBitrate = q.bitrate;
      parametros.encodings[0].maxFramerate = q.fps;
      await sender.setParameters(parametros);
    } catch {
      // ainda não negociou: o limite é aplicado na próxima vez
    }
  }

  // Ocultado = para de enviar vídeo pra essa pessoa (o navegador não codifica pra ela)
  async aplicarOculto(par) {
    const transceptor = par.transceptores.video;
    const track = this.transmissao?.stream.getVideoTracks()[0];
    if (!transceptor || !track) return;
    const desejado = par.ocultoPeloOutro ? null : track;
    if (transceptor.sender.track !== desejado) await transceptor.sender.replaceTrack(desejado).catch(() => {});
  }

  pararTransmissao() {
    if (!this.transmissao) return;
    for (const par of this.pares.values()) {
      for (const transceptor of Object.values(par.transceptores)) {
        transceptor.sender.replaceTrack(null).catch(() => {});
        if (par.pc.signalingState !== 'closed') transceptor.direction = 'inactive';
      }
    }
    this.transmissao.stream.getTracks().forEach((t) => t.stop());
    this.transmissao = null;
  }

  get transmitindo() {
    return !!this.transmissao;
  }

  // Quantas pessoas estão vendo a MINHA tela
  atualizarEspectadores() {
    if (!this.transmissao) return;
    const vendo = [...this.pares.values()].filter((p) => !p.ocultoPeloOutro).length;
    this.emitir('espectadores', vendo);
  }

  // =====================================================
  // Assistir: ocultar/mostrar a tela de alguém
  // (avisa quem transmite pra parar de mandar o vídeo pra mim)
  // =====================================================
  ocultar(id, oculto) {
    this.enviar(id, { oculto });
  }

  fechar() {
    for (const id of [...this.pares.keys()]) this.removerPar(id);
  }
}
