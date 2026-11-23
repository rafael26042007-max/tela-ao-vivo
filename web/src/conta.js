// =====================================================
// Conta (opcional): Entrar com Discord + Minha conta
//
// O login acontece todo no servidor (o segredo do app do Discord nunca chega aqui).
// Na volta, o servidor manda a sessão no "#sessao=..." do endereço: ela fica
// guardada neste navegador e vai no cabeçalho Authorization das chamadas da conta.
// =====================================================

const $ = (id) => document.getElementById(id);
const CHAVE_SESSAO = 'tela-ao-vivo-conta';
const CHAVE_ACEITE = 'tela-ao-vivo-aceite'; // versão da política já aceita neste navegador

let api = null;
let aoMudarNome = () => {};
let versaoTermos = null;
let conta = null; // { nome, foto } de quem está logado

const ler = (chave) => { try { return localStorage.getItem(chave); } catch { return null; } };
const guardar = (chave, valor) => { try { valor === null ? localStorage.removeItem(chave) : localStorage.setItem(chave, valor); } catch { /* ok */ } };

// -----------------------------------------------------
// Volta do Discord: pega a sessão (ou o erro) do "#" e limpa o endereço
// -----------------------------------------------------
function lerRetornoDoLogin() {
  const hash = new URLSearchParams(location.hash.slice(1));
  const sessao = hash.get('sessao');
  const erro = hash.get('erroLogin');
  if (!sessao && !erro) return null;
  history.replaceState(null, '', location.pathname + location.search); // tira a sessão da barra de endereço
  if (sessao) guardar(CHAVE_SESSAO, sessao);
  return erro;
}

async function chamar(caminho, opcoes = {}) {
  const sessao = ler(CHAVE_SESSAO);
  const resposta = await fetch(api(caminho), {
    ...opcoes,
    headers: { ...(opcoes.headers ?? {}), Authorization: `Bearer ${sessao}` },
    cache: 'no-store',
  });
  const dados = await resposta.json().catch(() => ({}));
  if (resposta.status === 401) {
    sair(); // sessão vencida ou conta apagada
    throw new Error(dados.erro || 'Entre com o Discord de novo.');
  }
  if (!resposta.ok) throw new Error(dados.erro || 'Não deu certo. Tente de novo.');
  return dados;
}

// -----------------------------------------------------
// Prepara tudo (uma vez, quando a página abre)
//   api(caminho)   -> endereço completo do servidor
//   aoMudarNome(n) -> o app preenche o campo "Seu nome" com o nome da conta
//   mostrarErro(t) -> mostra um aviso na tela inicial
// -----------------------------------------------------
export function prepararConta(opcoes) {
  api = opcoes.api;
  aoMudarNome = opcoes.aoMudarNome;
  const erro = lerRetornoDoLogin();
  if (erro) opcoes.mostrarErro(erro);

  // ---------- Entrar ----------
  $('botao-entrar-discord').addEventListener('click', () => {
    // Já aceitou esta versão da política neste navegador? Vai direto
    if (ler(CHAVE_ACEITE) === versaoTermos) return irProDiscord();
    $('check-aceite').checked = false;
    $('status-login').textContent = '';
    $('dialogo-login').showModal();
  });
  $('form-login').addEventListener('submit', (evento) => {
    if (evento.submitter?.value !== 'continuar') return;
    evento.preventDefault();
    if (!$('check-aceite').checked) {
      $('status-login').textContent = 'Pra criar a conta, marque que leu e concorda com a Política de Privacidade.';
      return;
    }
    guardar(CHAVE_ACEITE, versaoTermos);
    irProDiscord();
  });

  // ---------- Minha conta ----------
  $('botao-minha-conta').addEventListener('click', () => {
    $('campo-nome-conta').value = conta?.nome ?? '';
    status('');
    $('apagar-conta').textContent = 'Apagar minha conta';
    delete $('apagar-conta').dataset.confirmando;
    $('dialogo-conta').showModal();
  });

  // Corrigir o nome (LGPD: correção)
  $('salvar-nome-conta').addEventListener('click', async () => {
    try {
      conta = await chamar('/api/conta/nome', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nome: $('campo-nome-conta').value }),
      });
      mostrarConectado();
      aoMudarNome(conta.nome);
      status('Nome salvo.');
    } catch (erro) {
      status(erro.message, true);
    }
  });

  // Baixar meus dados (LGPD: acesso e portabilidade)
  $('baixar-dados').addEventListener('click', async () => {
    try {
      const dados = await chamar('/api/conta/dados');
      const arquivo = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
      const link = Object.assign(document.createElement('a'), {
        href: URL.createObjectURL(arquivo),
        download: 'meus-dados-tela-ao-vivo.json',
      });
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
      status('Pronto: o arquivo foi baixado.');
    } catch (erro) {
      status(erro.message, true);
    }
  });

  // Apagar a conta (LGPD: eliminação). Dois cliques: o primeiro só pede confirmação
  $('apagar-conta').addEventListener('click', async () => {
    const botao = $('apagar-conta');
    if (!botao.dataset.confirmando) {
      botao.dataset.confirmando = '1';
      botao.textContent = 'Clique de novo pra apagar tudo';
      return;
    }
    try {
      await chamar('/api/conta/apagar', { method: 'POST' });
      sair();
      $('dialogo-conta').close();
      opcoes.mostrarErro('Sua conta foi apagada, junto com tudo ligado a ela.');
    } catch (erro) {
      status(erro.message, true);
    }
  });

  // Sair (só esquece a sessão neste navegador)
  $('botao-sair-conta').addEventListener('click', sair);
}

// -----------------------------------------------------
// Chamado depois do /saude: mostra o bloco da conta se o login estiver disponível
// -----------------------------------------------------
export async function mostrarConta(saude) {
  versaoTermos = saude.termos ?? null;
  $('bloco-conta').hidden = !saude.login;
  if (!saude.login) return;
  if (!ler(CHAVE_SESSAO)) return mostrarDesconectado();
  try {
    conta = await chamar('/api/conta');
    mostrarConectado();
    aoMudarNome(conta.nome);
  } catch {
    mostrarDesconectado();
  }
}

function irProDiscord() {
  const volta = location.href.split('#')[0];
  location.href = api(`/auth/discord/entrar?volta=${encodeURIComponent(volta)}&aceite=${encodeURIComponent(versaoTermos ?? '')}`);
}

function sair() {
  guardar(CHAVE_SESSAO, null);
  conta = null;
  mostrarDesconectado();
}

function mostrarConectado() {
  $('conta-desconectado').hidden = true;
  $('conta-conectado').hidden = false;
  $('nome-conta').textContent = conta.nome;
  const foto = $('foto-conta');
  foto.hidden = !conta.foto;
  if (conta.foto) foto.src = conta.foto;
}

function mostrarDesconectado() {
  $('conta-desconectado').hidden = false;
  $('conta-conectado').hidden = true;
}

function status(texto, erro = false) {
  $('status-conta').textContent = texto;
  $('status-conta').className = erro ? 'info erro' : 'info';
}
