// =====================================================
// Malha P2P: uma conexão WebRTC direta com cada pessoa da sala
// O vídeo vai direto de um navegador pro outro (não passa pelo servidor).
//
// Usa o padrão "perfect negotiation": os dois lados podem iniciar a
// negociação; se colidirem, o lado "educado" (polido) cede.
// =====================================================
import { decidirNivel, amostraRuim, NIVEL_INICIAL, ESCADA } from './automatico.js?v=__VERSAO__';

// -----------------------------------------------------
// Qualidades (quanto menor, menos CPU e menos internet)
// Lembre: em P2P você envia UMA cópia pra cada pessoa que assiste
// -----------------------------------------------------
// movimento: true = prioriza fluidez (jogo/vídeo); senão prioriza nitidez (texto)
// Câmera: leve de propósito (ela é o "rosto", a tela é o conteúdo)
export const CAMERA = { largura: 640, altura: 360, fps: 15, bitrate: 500_000 };

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
      // Caiu ou voltou: muda quem conta como "assistindo" (e a divisão do bitrate)
      this.atualizarEspectadores();
      if (estado === 'failed') {
        if (!par.tentouReiniciar) {
          par.tentouReiniciar = true;
          pc.restartIce(); // tenta de novo uma vez
        } else {
          this.emitir('falhaConexao', { id });
        }
      }
    };

    // Se eu já estou transmitindo (tela e/ou câmera), essa pessoa nova também recebe
    if (this.transmissao) this.adicionarTransmissao(par);
    if (this.camera) this.adicionarCamera(par);
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
    // Automática: cada pessoa tem o SEU degrau (internet ruim de um não derruba os outros)
    par.auto = { nivel: this.transmissao.nivel, amostras: [], ignorar: 5 };
    const q = QUALIDADES[this.nivelDoPar(par)];

    for (const track of stream.getTracks()) {
      const existente = par.transceptores[track.kind];

      if (existente) {
        // Reaproveita o canal da transmissão anterior (não cria um novo a cada vez)
        existente.direction = 'sendonly';
        existente.sender.replaceTrack(track).catch(() => {});
        existente.sender.setStreams?.(stream);
        if (track.kind === 'video') {
          preferirCodec(existente, codec);
          this.limitarVideo(par);
        }
        continue;
      }

      const opcoes = { direction: 'sendonly', streams: [stream] };
      // Uma camada só, com limite de bitrate e fps -> menos CPU e internet
      if (track.kind === 'video') {
        opcoes.sendEncodings = [
          { maxBitrate: this.bitrateDoPar(par), maxFramerate: q.fps, scaleResolutionDownBy: this.reducaoDoPar(par) },
        ];
      }
      const transceptor = par.pc.addTransceiver(track, opcoes);
      if (track.kind === 'video') preferirCodec(transceptor, codec);
      par.transceptores[track.kind] = transceptor;
    }
    this.aplicarOculto(par);
  }

  // Quem está recebendo a minha tela: não ocultou E a conexão não caiu
  // (antes, quem perdia a internet continuava contando e "roubando" bitrate dos outros)
  paresVendo() {
    const caiu = ['disconnected', 'failed', 'closed'];
    return [...this.pares.values()].filter((p) => !p.ocultoPeloOutro && !caiu.includes(p.pc.connectionState));
  }

  quantosVendo() {
    return this.paresVendo().length;
  }

  // Degrau da cópia de UMA pessoa:
  //   manual     -> o escolhido, igual pra todos
  //   automática -> o menor entre o teto do PC (CPU) e o da internet daquela pessoa
  nivelDoPar(par) {
    const t = this.transmissao;
    if (!t) return 'equilibrado';
    if (!t.automatico || !par.auto) return t.nivel;
    return ESCADA[Math.min(ESCADA.indexOf(t.nivel), ESCADA.indexOf(par.auto.nivel))];
  }

  bitrateDoPar(par) {
    return bitratePorPessoa(QUALIDADES[this.nivelDoPar(par)].bitrate, this.quantosVendo());
  }

  // Quanto reduzir a resolução capturada pra chegar na do degrau (1 = sem reduzir)
  // Usa a altura que está sendo capturada AGORA (a janela pode mudar de tamanho)
  reducaoDoPar(par) {
    return Math.max(1, (this.transmissao?.alturaCaptura || 1080) / QUALIDADES[this.nivelDoPar(par)].altura);
  }

  async limitarVideo(par) {
    const sender = par.transceptores.video?.sender;
    if (!sender || !this.transmissao) return;
    try {
      const parametros = sender.getParameters();
      if (!parametros.encodings?.length) return;
      parametros.encodings[0].maxBitrate = this.bitrateDoPar(par);
      parametros.encodings[0].maxFramerate = QUALIDADES[this.nivelDoPar(par)].fps;
      parametros.encodings[0].scaleResolutionDownBy = this.reducaoDoPar(par);
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
    if (!desejado && par.auto) par.auto.amostras = []; // ocultou: as medições antigas não valem mais
    if (desejado && transceptor.sender.track !== desejado && par.auto) par.auto.ignorar = 2;
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

  // =====================================================
  // CÂMERA (separada da tela: canal próprio em cada conexão)
  // Qualidade fixa e leve, sem a Automática: 360p, 15 fps, 500 kbps por pessoa.
  // Funciona no celular (que não consegue transmitir a tela).
  // =====================================================
  // O stream da câmera é SEMPRE o mesmo objeto (só a trilha dentro dele muda).
  // Motivo: quem recebe identifica a câmera pelo id do stream, e o Chrome de quem recebe
  // às vezes repete o evento com o stream ANTIGO ao religar. Com o id fixo, não confunde.
  get streamCamera() {
    this._streamCamera ??= new MediaStream();
    return this._streamCamera;
  }

  ligarCamera(trilha) {
    const stream = this.streamCamera;
    stream.getTracks().forEach((t) => stream.removeTrack(t));
    stream.addTrack(trilha);
    this.camera = stream;
    for (const par of this.pares.values()) this.adicionarCamera(par);
  }

  adicionarCamera(par) {
    const track = this.camera?.getVideoTracks()[0];
    if (!track) return;
    const existente = par.transceptorCamera;
    if (existente) {
      // Reaproveita o canal da vez anterior (não cria um novo a cada liga/desliga)
      existente.direction = 'sendonly';
      existente.sender.replaceTrack(track).catch(() => {});
      return;
    }
    par.transceptorCamera = par.pc.addTransceiver(track, {
      direction: 'sendonly',
      streams: [this.camera], // quem recebe usa o id desse stream pra saber que é a câmera
      sendEncodings: [{ maxBitrate: CAMERA.bitrate, maxFramerate: CAMERA.fps }],
    });
  }

  desligarCamera() {
    if (!this.camera) return;
    for (const par of this.pares.values()) {
      const t = par.transceptorCamera;
      if (!t) continue;
      t.sender.replaceTrack(null).catch(() => {});
      if (par.pc.signalingState !== 'closed') t.direction = 'inactive';
    }
    this.camera.getTracks().forEach((t) => {
      t.stop();
      this.camera.removeTrack(t);
    });
    this.camera = null;
  }

  get cameraLigada() {
    return !!this.camera;
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
      this.paresVendo().map((p) => p.id)
    );
  }

  aplicarLimitesATodos() {
    for (const par of this.pares.values()) {
      this.limitarVideo(par);
    }
  }

  // =====================================================
  // Medição do envio (a cada 2s) e qualidade Automática
  // =====================================================
  iniciarMedicao() {
    clearInterval(this.timerMedicao);
    this.timerMedicao = setInterval(() => this.medirETalvezAjustar().catch(() => {}), 2000);
  }

  // Lê as estatísticas de cada cópia que estou enviando.
  // Devolve:
  //   geral  -> o "pior caso" juntando todas (pra mostrar na tela e pro aviso da manual)
  //   porPar -> a amostra de CADA pessoa (pra Automática ajustar cada uma separada)
  //
  // Cuidado: o Chrome diz qualityLimitationReason = 'bandwidth' também quando o limite
  // é o NOSSO teto de bitrate (ele reduz a resolução pra caber). Por isso, "internet no
  // limite" só conta quando a banda disponível medida pelo WebRTC
  // (availableOutgoingBitrate) é menor que o que estamos tentando enviar.
  async medirEnvio() {
    const geral = { limitado: 'none', perda: 0, rtt: 0, fps: 0, largura: 0, altura: 0, enviando: 0 };
    const porPar = new Map();

    for (const par of this.pares.values()) {
      const transceptor = par.transceptores.video;
      if (!transceptor?.sender.track || par.pc.connectionState !== 'connected') continue;

      const stats = await transceptor.sender.getStats();
      const dele = { limitado: 'none', perda: 0, rtt: 0 };
      let motivoChrome = 'none';
      let bandaDisponivel = null;
      stats.forEach((r) => {
        if (r.type === 'outbound-rtp') {
          geral.enviando++;
          motivoChrome = r.qualityLimitationReason || 'none';
          geral.fps = Math.max(geral.fps, r.framesPerSecond || 0);
          geral.largura = Math.max(geral.largura, r.frameWidth || 0);
          geral.altura = Math.max(geral.altura, r.frameHeight || 0);
        }
        if (r.type === 'remote-inbound-rtp') {
          dele.perda = r.fractionLost || 0;
          dele.rtt = r.roundTripTime || 0;
        }
        if (r.type === 'candidate-pair' && r.nominated && r.state === 'succeeded' && r.availableOutgoingBitrate) {
          bandaDisponivel = r.availableOutgoingBitrate;
        }
      });

      // CPU: o Chrome é confiável aqui (e é do MEU PC, vale pra todas as cópias)
      if (motivoChrome === 'cpu') geral.limitado = 'cpu';
      // Internet: a banda até ESSA pessoa não chega a 80% do que queremos mandar pra ela
      const alvo = this.bitrateDoPar(par);
      const semBanda = bandaDisponivel !== null ? bandaDisponivel < alvo * 0.8 : motivoChrome === 'bandwidth';
      if (semBanda) dele.limitado = 'bandwidth';

      porPar.set(par, dele);
      if (dele.limitado === 'bandwidth' && geral.limitado === 'none') geral.limitado = 'bandwidth';
      geral.perda = Math.max(geral.perda, dele.perda);
      geral.rtt = Math.max(geral.rtt, dele.rtt);
    }
    return { geral, porPar };
  }

  async medirETalvezAjustar() {
    const t = this.transmissao;
    if (!t) return;
    const { geral: amostra, porPar } = await this.medirEnvio();
    if (this.transmissao !== t) return; // parou enquanto media

    // A janela compartilhada mudou de tamanho? Recalcula a redução de todo mundo
    // (antes ficava a altura do começo: janela encolheu -> imagem saía menor que devia)
    const captura = t.stream.getVideoTracks()[0]?.getSettings() ?? {};
    if (captura.height && captura.height !== t.alturaCaptura) {
      t.alturaCaptura = captura.height;
      this.aplicarLimitesATodos();
    }

    this.emitir('envio', {
      ...amostra,
      nivel: t.nivel,
      automatico: t.automatico,
      niveis: this.niveisPorPessoa(),
      captura: { largura: captura.width, altura: captura.height, fps: captura.frameRate },
    });

    // Ninguém recebendo, ou ainda aquecendo: não decide nada
    if (!amostra.enviando) return void (t.amostras = []);

    if (t.automatico) {
      // 1) Teto do MEU PC: só a CPU conta aqui (vale pra todas as cópias)
      if (t.ignorarAmostras > 0) t.ignorarAmostras--;
      else {
        t.amostras.push({ limitado: amostra.limitado === 'cpu' ? 'cpu' : 'none' });
        if (t.amostras.length > 20) t.amostras.shift();
        const novo = decidirNivel(t.nivel, t.amostras);
        if (novo !== t.nivel) this.mudarNivel(novo);
      }

      // 2) Internet de CADA pessoa: ajusta só a cópia dela
      for (const [par, dele] of porPar) {
        const a = par.auto;
        if (!a) continue;
        if (a.ignorar > 0) { a.ignorar--; continue; }
        a.amostras.push(dele);
        if (a.amostras.length > 20) a.amostras.shift();
        let novo = decidirNivel(a.nivel, a.amostras);
        // Não sobe acima do teto do PC (subiria pra um degrau que o PC não aguenta)
        if (ESCADA.indexOf(novo) > ESCADA.indexOf(t.nivel)) novo = t.nivel;
        if (novo !== a.nivel) {
          a.nivel = novo;
          a.amostras = [];
          a.ignorar = 2; // espera estabilizar antes de decidir de novo
          this.limitarVideo(par);
          this.emitir('nivel', { nivel: t.nivel, automatico: true, niveis: this.niveisPorPessoa() });
        }
      }
      return;
    }

    if (t.ignorarAmostras > 0) return void t.ignorarAmostras--;
    t.amostras.push(amostra);
    if (t.amostras.length > 20) t.amostras.shift();

    // Manual: avisa (no máximo 1 vez por minuto) se o PC/internet não está dando conta
    const ruins = t.amostras.slice(-3);
    if (ruins.length === 3 && ruins.every(amostraRuim) && Date.now() - t.ultimoAvisoLimite > 60_000) {
      t.ultimoAvisoLimite = Date.now();
      this.emitir('limite', { nivel: t.nivel, motivo: amostra.limitado });
    }
  }

  // O que estou RECEBENDO de cada pessoa (maior vídeo: tela ou câmera).
  // Usado pelo fiscal do "4K só com conta" (ver app.js)
  async medirRecebido() {
    const resultado = new Map();
    for (const par of this.pares.values()) {
      if (par.pc.connectionState !== 'connected') continue;
      const stats = await par.pc.getStats();
      let altura = 0;
      let fps = 0;
      stats.forEach((r) => {
        if (r.type === 'inbound-rtp' && r.kind === 'video') {
          altura = Math.max(altura, r.frameHeight || 0);
          fps = Math.max(fps, r.framesPerSecond || 0);
        }
      });
      if (altura) resultado.set(par.id, { altura, fps });
    }
    return resultado;
  }

  // Degrau de cada pessoa que está vendo: [{ id, nivel }]
  niveisPorPessoa() {
    return this.paresVendo().map((par) => ({ id: par.id, nivel: this.nivelDoPar(par) }));
  }

  // Muda o teto geral (na Automática, o teto do PC)
  mudarNivel(nivel) {
    const t = this.transmissao;
    if (!t || !QUALIDADES[nivel]) return;
    t.nivel = nivel;
    t.amostras = [];
    t.ignorarAmostras = 2; // espera estabilizar antes de decidir de novo
    this.aplicarLimitesATodos();
    this.emitir('nivel', { nivel, automatico: t.automatico, niveis: this.niveisPorPessoa() });
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
