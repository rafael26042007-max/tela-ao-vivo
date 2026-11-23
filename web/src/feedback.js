// =====================================================
// Feedback: janela "O que você achou?"
//
// O site NÃO fala com o Discord direto: manda pro nosso servidor
// (POST /api/feedback), que confere, limita e repassa.
// Assim o endereço do webhook nunca aparece aqui (nem no F12).
// =====================================================

const $ = (id) => document.getElementById(id);

// Versão do site (o ?v= que a publicação coloca nos arquivos)
const VERSAO = new URL(import.meta.url).searchParams.get('v') || 'local';

// -----------------------------------------------------
// Liga os botões e a janela.
//   api(caminho) -> endereço completo do servidor
//   nomeAtual()  -> nome que a pessoa digitou (pra já vir preenchido)
//   onde()       -> 'inicio' ou 'sala'
// -----------------------------------------------------
export function prepararFeedback({ api, nomeAtual, onde }) {
  const dialogo = $('dialogo-feedback');
  const form = $('form-feedback');
  const texto = $('texto-feedback');
  const nome = $('nome-feedback');
  const status = $('status-feedback');
  const botaoEnviar = $('enviar-feedback');

  // ---------- Abrir ----------
  const abrir = () => {
    form.reset();
    status.textContent = '';
    status.className = 'info';
    botaoEnviar.disabled = false;
    nome.value = nomeAtual() || '';
    dialogo.showModal();
    texto.focus();
  };
  document.querySelectorAll('.botao-feedback').forEach((b) => b.addEventListener('click', abrir));

  // ---------- Enviar ----------
  form.addEventListener('submit', async (evento) => {
    // "Cancelar" fecha normalmente (method="dialog")
    if (evento.submitter?.value !== 'enviar') return;
    evento.preventDefault();

    const nota = form.querySelector('input[name="nota"]:checked')?.value ?? null;
    if (!nota && !texto.value.trim()) {
      mostrar('Escolha uma nota ou escreva alguma coisa.', true);
      return;
    }

    botaoEnviar.disabled = true;
    mostrar('Enviando...');
    try {
      const resposta = await fetch(api('/api/feedback'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nota, texto: texto.value, nome: nome.value, onde: onde(), versao: VERSAO }),
        signal: AbortSignal.timeout(15_000),
      });
      const dados = await resposta.json().catch(() => ({}));
      if (!resposta.ok) throw new Error(dados.erro || 'Não deu pra enviar agora.');
      mostrar('Valeu! Recebi o seu feedback. 💙');
      setTimeout(() => dialogo.open && dialogo.close(), 1500);
    } catch (erro) {
      mostrar(erro.name === 'TimeoutError' ? 'O servidor demorou pra responder. Tente de novo.' : erro.message, true);
      botaoEnviar.disabled = false;
    }
  });

  function mostrar(mensagem, ehErro = false) {
    status.textContent = mensagem;
    status.className = ehErro ? 'info erro' : 'info';
  }
}

// -----------------------------------------------------
// Mostra os botões (só quando o servidor diz que o feedback está ligado)
// -----------------------------------------------------
export function mostrarBotoesFeedback(ligado) {
  document.querySelectorAll('.botao-feedback').forEach((b) => (b.hidden = !ligado));
}
