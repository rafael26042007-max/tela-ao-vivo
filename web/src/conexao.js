// =====================================================
// Conexão com o servidor de sinalização (WebSocket)
// pedir(metodo, dados) -> Promise com a resposta
// on(evento, funcao)   -> avisos que o servidor manda sozinho
// Se a conexão cair, tenta reconectar sozinha e avisa com
// 'desconectado' e 'reconectado'.
// =====================================================
export class Sinalizacao {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.proximoId = 1;
    this.pendentes = new Map();
    this.ouvintes = new Map();
    this.fechadoDeProposito = false;
    this.tentativas = 0;
    this.timerReconexao = null;

    // ---------- Primeira conexão ----------
    this.aberto = new Promise((resolve, reject) => {
      this.conectar(resolve, () => reject(new Error('Não foi possível conectar ao servidor')));
    });
  }

  // -----------------------------------------------------
  // Abre o WebSocket (usado na primeira vez e nas reconexões)
  // -----------------------------------------------------
  conectar(aoAbrir, aoFalhar) {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    let abriu = false;

    ws.addEventListener('open', () => {
      abriu = true;
      const eraReconexao = this.tentativas > 0;
      this.tentativas = 0;
      aoAbrir?.();
      if (eraReconexao) this.emitir('reconectado');
    });

    // ---------- Mensagens recebidas ----------
    ws.addEventListener('message', (e) => {
      let msg;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }

      // Resposta de um pedido
      if (msg.id) {
        const pendente = this.pendentes.get(msg.id);
        if (!pendente) return;
        this.pendentes.delete(msg.id);
        msg.ok ? pendente.resolve(msg.dados) : pendente.reject(new Error(msg.erro));
        return;
      }

      // Aviso do servidor
      if (msg.evento) this.emitir(msg.evento, msg.dados);
    });

    // ---------- Conexão fechada ----------
    ws.addEventListener('close', (e) => {
      if (this.ws !== ws) return;
      for (const p of this.pendentes.values()) p.reject(new Error('Conexão perdida'));
      this.pendentes.clear();

      if (!abriu && this.tentativas === 0) return aoFalhar?.(); // nem chegou a conectar
      if (this.fechadoDeProposito) return;
      // 4000/4001 = o servidor fechou de propósito (sala encerrada / outra aba)
      if (e.code === 4000 || e.code === 4001) return this.emitir('encerrado', { motivo: e.reason });

      if (this.tentativas === 0) this.emitir('desconectado');
      this.agendarReconexao();
    });
  }

  // Espera 1s, 2s, 4s... (no máximo 8s) entre as tentativas
  agendarReconexao() {
    clearTimeout(this.timerReconexao);
    const espera = Math.min(8000, 1000 * 2 ** this.tentativas);
    this.tentativas++;
    this.timerReconexao = setTimeout(() => {
      if (!this.fechadoDeProposito) this.conectar();
    }, espera);
  }

  get conectado() {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  pedir(metodo, dados = {}) {
    return new Promise((resolve, reject) => {
      if (!this.conectado) return reject(new Error('Sem conexão com o servidor'));
      const id = this.proximoId++;
      this.pendentes.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, metodo, dados }));
    });
  }

  on(evento, funcao) {
    if (!this.ouvintes.has(evento)) this.ouvintes.set(evento, []);
    this.ouvintes.get(evento).push(funcao);
  }

  emitir(evento, dados) {
    for (const funcao of this.ouvintes.get(evento) ?? []) {
      try {
        funcao(dados);
      } catch (erro) {
        console.error(`Erro tratando "${evento}":`, erro);
      }
    }
  }

  fechar() {
    this.fechadoDeProposito = true;
    clearTimeout(this.timerReconexao);
    this.ws?.close();
  }
}
