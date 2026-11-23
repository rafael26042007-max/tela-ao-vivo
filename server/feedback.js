// =====================================================
// Feedback: o que as pessoas acham do Tela ao Vivo
//
// O site manda { nota, texto, nome, onde, versao } pra POST /api/feedback.
// Aqui a gente confere, limpa e repassa pra um canal do Discord (webhook).
//
// Por que Discord e não um arquivo? No plano grátis do Render, os arquivos
// somem quando o servidor reinicia. No Discord fica guardado e avisa no celular.
//
// O endereço do webhook fica SÓ aqui no servidor (FEEDBACK_WEBHOOK).
// Se ficasse no site, qualquer um pegaria pelo F12 e postaria no seu canal.
// =====================================================
const config = require('./config');

const NOTAS = { 1: '😞 Ruim', 2: '😐 Mais ou menos', 3: '🙂 Bom', 4: '😍 Ótimo' };
const CORES = { 1: 0xef4444, 2: 0xf59e0b, 3: 0x22c55e, 4: 0x3b82f6 };
const MAX_TEXTO = 1000;
const MAX_NOME = 30;

// -----------------------------------------------------
// Está ligado? (o site só mostra o botão se estiver)
// -----------------------------------------------------
function feedbackLigado() {
  return Boolean(config.feedbackWebhook);
}

// -----------------------------------------------------
// Confere e limpa o que veio do site.
// Devolve { erro } ou { dados }.
// -----------------------------------------------------
function validarFeedback(corpo) {
  const nota = Number(corpo?.nota);
  const notaValida = NOTAS[nota] ? nota : null;
  const texto = limpar(corpo?.texto).slice(0, MAX_TEXTO);
  const nome = limpar(corpo?.nome).replace(/\s+/g, ' ').slice(0, MAX_NOME);
  const onde = corpo?.onde === 'sala' ? 'sala' : 'tela inicial';
  const versao = /^[\w.-]{1,20}$/.test(String(corpo?.versao ?? '')) ? corpo.versao : '?';

  if (!notaValida && !texto) return { erro: 'Escolha uma nota ou escreva alguma coisa.' };
  return { dados: { nota: notaValida, texto, nome, onde, versao } };
}

// Tira caracteres de controle (menos quebra de linha) e espaços nas pontas
function limpar(valor) {
  return String(valor ?? '')
    .replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '')
    .trim();
}

// -----------------------------------------------------
// Descobre aparelho e navegador pelo User-Agent (ajuda a achar bugs)
// -----------------------------------------------------
function descreverAparelho(userAgent = '') {
  const ua = String(userAgent);
  const aparelho = /Android|iPhone|iPad|Mobile/i.test(ua) ? 'Celular' : 'PC';
  const sistema = /Windows/i.test(ua) ? 'Windows' : /Android/i.test(ua) ? 'Android' : /iPhone|iPad|Mac OS/i.test(ua)
    ? 'Apple' : /Linux/i.test(ua) ? 'Linux' : '?';
  const navegador = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '?';
  return `${aparelho} · ${sistema} · ${navegador}`;
}

// -----------------------------------------------------
// Manda pro Discord como um "embed" (cartão colorido pela nota)
// -----------------------------------------------------
async function enviarFeedback(dados, userAgent) {
  const { nota, texto, nome, onde, versao } = dados;
  const mensagem = {
    username: 'Tela ao Vivo · Feedback',
    // Ninguém consegue usar @everyone ou @alguém pelo feedback
    allowed_mentions: { parse: [] },
    embeds: [
      {
        title: nota ? NOTAS[nota] : 'Feedback',
        description: texto || '_(só a nota, sem texto)_',
        color: CORES[nota] ?? 0x9aa1ad,
        fields: [
          { name: 'Quem', value: nome || 'Anônimo', inline: true },
          { name: 'Onde', value: onde, inline: true },
          { name: 'Aparelho', value: descreverAparelho(userAgent), inline: true },
        ],
        footer: { text: `versão ${versao}` },
        timestamp: new Date().toISOString(),
      },
    ],
  };

  const resposta = await fetch(config.feedbackWebhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(mensagem),
    signal: AbortSignal.timeout(8000),
  });
  if (!resposta.ok) throw new Error(`Discord respondeu ${resposta.status}`);
}

module.exports = { feedbackLigado, validarFeedback, enviarFeedback, descreverAparelho, MAX_TEXTO };
