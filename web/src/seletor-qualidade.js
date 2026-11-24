// =====================================================
// Seletor de qualidade: um botão ("Qualidade: Automática ▾") que abre um painel
// com cada opção explicada (resolução, fps e pra quê serve).
//
// A <select id="select-qualidade"> continua na página, escondida, e é a
// "fonte da verdade": todo o resto do app lê e escreve nela. Este arquivo só:
//   - escolheu no painel -> muda a select e avisa (evento 'change')
//   - o app mudou a select (valor, travou na transmissão, Ultra "só com conta")
//     -> redesenha o botão e o painel
// =====================================================

const $ = (id) => document.getElementById(id);

// Texto de cada opção no painel
const INFO = {
  automatica: { nome: 'Automática', detalhe: 'até 1080p · 30 fps', uso: 'Ajusta sozinha pra não travar (recomendado)' },
  minima: { nome: 'Mínima', detalhe: '480p · 10 fps', uso: 'Internet ou PC bem fracos' },
  economia: { nome: 'Economia', detalhe: '720p · 10 fps', uso: 'Internet fraca' },
  equilibrado: { nome: 'Equilibrado', detalhe: '1080p · 15 fps', uso: 'Texto, sites e código' },
  fluido: { nome: 'Fluido', detalhe: '1080p · 30 fps', uso: 'Jogos e vídeos' },
  ultra: { nome: 'Ultra', detalhe: '4K · até 120 fps', uso: 'Tela 4K de 120 Hz e PC forte' },
};

export function prepararSeletorQualidade(select) {
  const botao = $('botao-qualidade');
  const painel = $('painel-qualidade');
  const nome = $('nome-qualidade');
  if (!botao || !painel || !nome) return; // HTML de outra versão: fica só a select

  // ---------- Monta uma opção do painel pra cada opção da select ----------
  const opcoes = [...select.options].map((opcao) => {
    const info = INFO[opcao.value] ?? { nome: opcao.textContent, detalhe: '', uso: '' };
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'opcao-qualidade';
    item.setAttribute('role', 'option');
    item.dataset.valor = opcao.value;
    const t = (classe, texto) => Object.assign(document.createElement('span'), { className: classe, textContent: texto });
    item.append(t('nome', info.nome), t('detalhe', info.detalhe), t('uso', info.uso));
    item.addEventListener('click', () => {
      fechar(true);
      if (select.value === opcao.value) return;
      select.value = opcao.value;
      select.dispatchEvent(new Event('change')); // o app reage (salvar, aviso do Ultra...)
    });
    painel.append(item);
    return { opcao, item, info };
  });

  // ---------- Desenha o estado atual (chamado sempre que a select muda) ----------
  function desenhar() {
    const atual = opcoes.find((o) => o.opcao.value === select.value);
    nome.textContent = atual?.info.nome ?? select.value;
    botao.disabled = select.disabled;
    botao.title = select.disabled ? 'Pare a transmissão pra trocar a qualidade' : 'Escolher a qualidade da transmissão';
    if (select.disabled) fechar();
    for (const { opcao, item, info } of opcoes) {
      item.setAttribute('aria-selected', String(opcao.value === select.value));
      item.disabled = opcao.disabled;
      // Ultra sem conta: o app desativa a opção; aqui só explica o porquê
      item.querySelector('.uso').textContent = opcao.disabled ? 'Só com conta: entre com o Discord' : info.uso;
    }
  }

  // ---------- Abrir / fechar ----------
  function abrir() {
    painel.hidden = false;
    botao.setAttribute('aria-expanded', 'true');
    (opcoes.find((o) => o.opcao.value === select.value)?.item ?? opcoes[0].item).focus();
  }
  function fechar(voltarFoco = false) {
    if (painel.hidden) return;
    painel.hidden = true;
    botao.setAttribute('aria-expanded', 'false');
    if (voltarFoco) botao.focus();
  }
  botao.addEventListener('click', () => (painel.hidden ? abrir() : fechar()));

  // Clicou fora do painel: fecha
  document.addEventListener('pointerdown', (e) => {
    if (!painel.hidden && !painel.contains(e.target) && !botao.contains(e.target)) fechar();
  });

  // Teclado: Esc fecha, setas andam entre as opções (pulando as bloqueadas)
  painel.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') return void fechar(true);
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const livres = opcoes.filter((o) => !o.item.disabled).map((o) => o.item);
    const i = livres.indexOf(document.activeElement);
    livres[(i + (e.key === 'ArrowDown' ? 1 : -1) + livres.length) % livres.length]?.focus();
  });

  // ---------- O app mexe na select direto (select.value = ...): redesenha ----------
  // (atribuir .value não dispara evento nenhum, então "escuta" a própria propriedade)
  const proto = HTMLSelectElement.prototype;
  for (const prop of ['value', 'disabled']) {
    const original = Object.getOwnPropertyDescriptor(proto, prop);
    Object.defineProperty(select, prop, {
      configurable: true,
      get() {
        return original.get.call(this);
      },
      set(valor) {
        original.set.call(this, valor);
        queueMicrotask(desenhar);
      },
    });
  }
  select.addEventListener('change', desenhar);
  // Ultra liberado/bloqueado (texto e disabled das opções)
  new MutationObserver(desenhar).observe(select, { subtree: true, attributes: true, characterData: true, childList: true });
  desenhar();
}
