// =====================================================
// Malha P2P: uma conexão WebRTC direta com cada pessoa da sala
// O vídeo vai direto de um navegador pro outro (não passa pelo servidor).
//
// Usa o padrão "perfect negotiation": os dois lados podem iniciar a
// negociação; se colidirem, o lado "educado" (polido) cede.
// =====================================================
import { decidirNivel, amostraRuim, NIVEL_INICIAL } from './automatico.js?v=__VERSAO__';

// -----------------------------------------------------
// Qualidades (quanto menor, menos CPU e menos internet)
// Lembre: em P2P você envia UMA cópia pra cada pessoa que assiste
// -----------------------------------------------------
// movimento: true = prioriza fluidez (jogo/vídeo); senão prioriza nitidez (texto)
export const QUALIDADES = {
  minima: { nome: 'Mínima', largura: 854, altura: 480, fps: 10, bitrate: 300_000 },
  economia: { nome: 'Economia', largura: 1280, altura: 720, fps: 10, bitrate: 600_000 },
  equilibrado: { nome: 'Equilibrado', largura: 1920, altura: 1080, fps: 15, bitrate: 1_200_000 },
  fluido: { nome: 'Fluido', largura: 1920, altura: 1080, fps: 30, bitrate: 2_500_000, movimento: true },
  // Ultra: só sai 4K/120 se a tela for 4K 120 Hz e o PC/internet aguentarem
  ultra: { nome: 'Ultra', largura: 3840, altura: 2160, fps: 120, bitrate: 20_000_000, movimento: true },
};

// Automática: captura como "Fluido" e o encoder sobe/desce entre os degraus (ver automatico.js)
export const CAPTURA_AUTOMATICA = 'fluido';

// -----------------------------------------------------
// Bitrate por pessoa (ajuste automático pra salas cheias)
// Até 3 espectadores: cada um recebe a qualidade escolhida.
// Com mais gente: divide, pra o upload total ficar parecido com o de 3.
// Ex (Equilibrado, 1,2 Mbps): 7 espectadores -> ~514 kbps cada (~3,6 Mbps no total)
// -----------------------------------------------------
const MINIMO_POR_PESSOA = 300_000;

export function bitratePorPessoa(bitrateBase, espectadores) {
  if (espectadores <= 3) return bitrateBase;
  return Math.max(MINIMO_POR_PESSOA, Math.round((bitrateBase * 3) / espectadores));
}

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
    const automatico = qualidade === 'automatica';
    const nivel = automatico ? NIVEL_INICIAL : QUALIDADES[qualidade] ? qualidade : 'equilibrado';

    // Dica pro encoder: texto -> nitidez ('detail'); jogo/vídeo -> fluidez ('motion');
    // automática -> equilibrado (o próprio controle ajusta fps e resolução)
    if (video) video.contentHint = automatico ? '' : QUALIDADES[nivel].movimento ? 'motion' : 'detail';

    this.transmissao = {
      stream,
      qualidade,
      codec,
      automatico,
      nivel, // degrau atual (na manual, é o escolhido)
      alturaCaptura: video?.getSettings().height || QUALIDADES[nivel].altura,
      amostras: [],
      ignorarAmostras: 5, // ~10s de aquecimento (o WebRTC começa medindo a banda por baixo)
      ultimoAvisoLimite: 0,
    };
    this.iniciarMedicao();
    for (const par of this.pares.values()) {
      par.ocultoPeloOutro = false; // transmissão nova: todo mundo começa vendo
      this.adicionarTransmissao(par);
    }
    this.atualizarEspectadores();
  }

  adicionarTransmissao(par) {
    const { stream, codec } = this.transmissao;
    const q = this.qualidadeAtual;

    for (const track of stream.getTracks()) {
      const existente = par.transceptores[track.kind];

      if (existente) {
        // Reaproveita o canal da transmissão anterior (não cria um novo a cada vez)
        existente.direction = 'sendonly';
        existente.sender.replaceTrack(track).catch(() => {});
        existente.sender.setStreams?.(stream);
        if (track.kind === 'video') {
          preferirCodec(existente, codec);
          this.limitarVideo(existente.sender);
        }
        continue;
      }

      const opcoes = { direction: 'sendonly', streams: [stream] };
      // Uma camada só, com limite de bitrate e fps -> menos CPU e internet
      if (track.kind === 'video') {
        opcoes.sendEncodings = [
          { maxBitrate: this.bitrateAtual(), maxFramerate: q.fps, scaleResolutionDownBy: this.reducaoAtual() },
        ];
      }
      const transceptor = par.pc.addTransceiver(track, opcoes);
      if (track.kind === 'video') preferirCodec(transceptor, codec);
      par.transceptores[track.kind] = transceptor;
    }
    this.aplicarOculto(par);
  }

  // Quantas pessoas estão recebendo a minha tela (quem ocultou não conta)
  quantosVendo() {
    return [...this.pares.values()].filter((p) => !p.ocultoPeloOutro).length;
  }

  get qualidadeAtual() {
    return QUALIDADES[this.transmissao?.nivel] ?? QUALIDADES.equilibrado;
  }

  bitrateAtual() {
    return bitratePorPessoa(this.qualidadeAtual.bitrate, this.quantosVendo());
  }

  // Quanto reduzir a resolução capturada pra chegar na do degrau (1 = sem reduzir)
  reducaoAtual() {
    return Math.max(1, (this.transmissao?.alturaCaptura || 1080) / this.qualidadeAtual.altura);
  }

  async limitarVideo(sender) {
    try {
      const parametros = sender.getParameters();
      if (!parametros.encodings?.length) return;
      parametros.encodings[0].maxBitrate = this.bitrateAtual();
      parametros.encodings[0].maxFramerate = this.qualidadeAtual.fps;
      parametros.encodings[0].scaleResolutionDownBy = this.reducaoAtual();
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
    clearInterval(this.timerMedicao);
    this.transmissao.stream.getTracks().forEach((t) => t.stop());
    this.transmissao = null;
    this.ultimoVendo = undefined; // a próxima transmissão recalcula o bitrate
  }

  get transmitindo() {
    return !!this.transmissao;
  }

  // Quantas pessoas estão vendo a MINHA tela
  // Também reajusta o bitrate de todas as cópias quando o número muda
  atualizarEspectadores() {
    if (!this.transmissao) return;
    const vendo = this.quantosVendo();
    if (vendo !== this.ultimoVendo) {
      this.ultimoVendo = vendo;
      this.aplicarLimitesATodos();
    }
    // Manda os ids de quem está vendo (o app mostra os nomes)
    this.emitir(
      'espectadores',
      [...this.pares.values()].filter((p) => !p.ocultoPeloOutro).map((p) => p.id)
    );
  }

  aplicarLimitesATodos() {
    for (const par of this.pares.values()) {
      if (par.transceptores.video) this.limitarVideo(par.transceptores.video.sender);
    }
  }

  // =====================================================
  // Medição do envio (a cada 2s) e qualidade Automática
  // =====================================================
  iniciarMedicao() {
    clearInterval(this.timerMedicao);
    this.timerMedicao = setInterval(() => this.medirETalvezAjustar().catch(() => {}), 2000);
  }

  // Lê as estatísticas de todas as cópias que estou enviando e junta o "pior caso".
  //
  // Cuidado: o Chrome diz qualityLimitationReason = 'bandwidth' também quando o limite
  // é o NOSSO teto de bitrate (ele reduz a resolução pra caber). Por isso, "internet no
  // limite" só conta quando a banda disponível medida pelo WebRTC
  // (availableOutgoingBitrate) é menor que o que estamos tentando enviar.
  async medirEnvio() {
    const amostra = { limitado: 'none', perda: 0, rtt: 0, fps: 0, largura: 0, altura: 0, enviando: 0 };
    const alvo = this.bitrateAtual();

    for (const par of this.pares.values()) {
      const transceptor = par.transceptores.video;
      if (!transceptor?.sender.track || par.pc.connectionState !== 'connected') continue;

      const stats = await transceptor.sender.getStats();
      let motivoChrome = 'none';
      let bandaDisponivel = null;
      stats.forEach((r) => {
        if (r.type === 'outbound-rtp') {
          amostra.enviando++;
          motivoChrome = r.qualityLimitationReason || 'none';
          amostra.fps = Math.max(amostra.fps, r.framesPerSecond || 0);
          amostra.largura = Math.max(amostra.largura, r.frameWidth || 0);
          amostra.altura = Math.max(amostra.altura, r.frameHeight || 0);
        }
        if (r.type === 'remote-inbound-rtp') {
          amostra.perda = Math.max(amostra.perda, r.fractionLost || 0);
          amostra.rtt = Math.max(amostra.rtt, r.roundTripTime || 0);
        }
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && r.availableOutgoingBitrate) {
          bandaDisponivel = r.availableOutgoingBitrate;
        }
      });

      // CPU: o Chrome é confiável aqui
      if (motivoChrome === 'cpu') amostra.limitado = 'cpu';
      // Internet: a banda disponível não chega a 80% do que queremos enviar
      const semBanda = bandaDisponivel !== null ? bandaDisponivel < alvo * 0.8 : motivoChrome === 'bandwidth';
      if (semBanda && amostra.limitado === 'none') amostra.limitado = 'bandwidth';
    }
    return amostra;
  }

  async medirETalvezAjustar() {
    const t = this.transmissao;
    if (!t) return;
    const amostra = await this.medirEnvio();
    if (this.transmissao !== t) return; // parou enquanto media

    const captura = t.stream.getVideoTracks()[0]?.getSettings() ?? {};
    this.emitir('envio', {
      ...amostra,
      nivel: t.nivel,
      automatico: t.automatico,
      captura: { largura: captura.width, altura: captura.height, fps: captura.frameRate },
    });

    // Ninguém recebendo, ou ainda aquecendo: não decide nada
    if (!amostra.enviando) return void (t.amostras = []);
    if (t.ignorarAmostras > 0) return void t.ignorarAmostras--;

    t.amostras.push(amostra);
    if (t.amostras.length > 20) t.amostras.shift();

    if (t.automatico) {
      const novo = decidirNivel(t.nivel, t.amostras);
      if (novo !== t.nivel) this.mudarNivel(novo);
      return;
    }

    // Manual: avisa (no máximo 1 vez por minuto) se o PC/internet não está dando conta
    const ruins = t.amostras.slice(-3);
    if (ruins.length === 3 && ruins.every(amostraRuim) && Date.now() - t.ultimoAvisoLimite > 60_000) {
      t.ultimoAvisoLimite = Date.now();
      this.emitir('limite', { nivel: t.nivel, motivo: amostra.limitado });
    }
  }

  mudarNivel(nivel) {
    const t = this.transmissao;
    if (!t || !QUALIDADES[nivel]) return;
    t.nivel = nivel;
    t.amostras = [];
    t.ignorarAmostras = 2; // espera estabilizar antes de decidir de novo
    this.aplicarLimitesATodos();
    this.emitir('nivel', { nivel, automatico: t.automatico });
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
