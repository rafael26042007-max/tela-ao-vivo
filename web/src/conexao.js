// =====================================================
// Conexão com o servidor (WebSocket)
// pedir(metodo, dados) -> Promise com a resposta
// on(evento, funcao)   -> avisos que o servidor manda sozinho
// =====================================================
export class Sinalizacao {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.proximoId = 1;
    this.pendentes = new Map();
    this.ouvintes = new Map();
    this.fechadoDeProposito = false;

    // ---------- Espera abrir ----------
    this.aberto = new Promise((resolve, reject) => {
      this.ws.addEventListener('open', resolve, { once: true });
      this.ws.addEventListener('error', () => reject(new Error('Não foi possível conectar ao servidor')), { once: true });
    });

    // ---------- Mensagens recebidas ----------
    this.ws.addEventListener('message', (e) => {
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
    this.ws.addEventListener('close', (e) => {
      for (const p of this.pendentes.values()) p.reject(new Error('Conexão perdida'));
      this.pendentes.clear();
      if (!this.fechadoDeProposito) this.emitir('desconectado', { motivo: e.reason });
    });
  }

  pedir(metodo, dados = {}) {
    return new Promise((resolve, reject) => {
      if (this.ws.readyState !== WebSocket.OPEN) return reject(new Error('Sem conexão com o servidor'));
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
    this.ws.close();
  }
}
