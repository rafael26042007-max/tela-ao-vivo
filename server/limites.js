// =====================================================
// Limitador simples por chave (ex: IP)
// Conta tentativas numa janela de tempo e bloqueia quem passa do limite.
// =====================================================
class Limitador {
  constructor({ maximo, janelaMs }) {
    this.maximo = maximo;
    this.janelaMs = janelaMs;
    this.registros = new Map(); // chave -> [horários]
    // Limpa a memória de tempos em tempos
    setInterval(() => this.limpar(), janelaMs).unref();
  }

  recentes(chave) {
    const agora = Date.now();
    const lista = (this.registros.get(chave) || []).filter((t) => agora - t < this.janelaMs);
    this.registros.set(chave, lista);
    return lista;
  }

  // true = ainda pode
  pode(chave) {
    return this.recentes(chave).length < this.maximo;
  }

  registrar(chave) {
    this.recentes(chave).push(Date.now());
  }

  limpar() {
    const agora = Date.now();
    for (const [chave, lista] of this.registros) {
      if (lista.every((t) => agora - t >= this.janelaMs)) this.registros.delete(chave);
    }
  }
}

// ---------- Limitadores usados no app ----------
module.exports = {
  // Criar sala: 10 por minuto por IP
  criacaoDeSalas: new Limitador({ maximo: 10, janelaMs: 60_000 }),
  // Senha errada numa sala (contando todo mundo): 20 a cada 10 minutos por sala
  senhaPorSala: new Limitador({ maximo: 20, janelaMs: 10 * 60_000 }),
  // Login com Discord: 10 por minuto por IP
  login: new Limitador({ maximo: 10, janelaMs: 60_000 }),
  // Feedback: 3 a cada 10 minutos por IP (evita encher o seu canal do Discord)
  feedback: new Limitador({ maximo: 3, janelaMs: 10 * 60_000 }),
};
