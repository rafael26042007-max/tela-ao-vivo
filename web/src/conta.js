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
let aoMudarConta = () => {}; // o app atualiza a tela (Ultra, sala fixa, nome travado)
let versaoTermos = null;
let conta = null; // { nome, foto, salaFixa } de quem está logado
let desligada = false; // página sem os elementos da conta (não mexe em nada)

// ---------- Pro resto do site ----------
// (confere também se a sessão ainda existe: outra aba pode ter saído da conta)
export const temConta = () => conta !== null && !!ler(CHAVE_SESSAO);
export const contaAtual = () => conta;
// A sessão vai junto ao entrar/voltar numa sala: é assim que o servidor sabe dos benefícios
export const sessaoAtual = () => (conta ? ler(CHAVE_SESSAO) : null);

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
  // Falta algum elemento (ex: HTML de outra versão)? Fica sem conta, mas não trava o site
  const necessarios = ['bloco-conta', 'botao-entrar-discord', 'dialogo-login', 'form-login', 'check-aceite', 'status-login',
    'botao-minha-conta', 'dialogo-conta', 'campo-nome-conta', 'salvar-nome-conta', 'campo-sala-fixa', 'salvar-sala-fixa',
    'baixar-dados', 'apagar-conta', 'botao-sair-conta', 'status-conta', 'conta-conectado', 'conta-desconectado', 'nome-conta', 'foto-conta'];
  const faltando = necessarios.filter((id) => !$(id));
  if (faltando.length) {
    console.warn('Conta desligada: faltam elementos na página', faltando);
    desligada = true;
    return;
  }
  api = opcoes.api;
  aoMudarNome = opcoes.aoMudarNome;
  aoMudarConta = opcoes.aoMudarConta ?? (() => {});
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
    $('campo-sala-fixa').value = conta?.salaFixa ?? '';
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

  // Benefício: escolher a sala fixa (6 letras/números; vazio = tirar)
  $('salvar-sala-fixa').addEventListener('click', async () => {
    try {
      conta = await chamar('/api/conta/sala-fixa', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ codigo: $('campo-sala-fixa').value.trim() }),
      });
      $('campo-sala-fixa').value = conta.salaFixa ?? '';
      mostrarConectado();
      status(conta.salaFixa ? `Pronto: a sua sala fixa é ${conta.salaFixa}.` : 'Sala fixa removida.');
    } catch (erro) {
      status(erro.message, true);
    }
  });
  $('campo-sala-fixa').addEventListener('input', (e) => {
    e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
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

  // -----------------------------------------------------
  // Outra aba entrou ou saiu da conta: esta aba acompanha na hora.
  // O evento 'storage' só chega nas OUTRAS abas do mesmo site.
  // (Sem isso: saiu numa aba, a outra continuava achando que tinha conta,
  //  mostrava o Ultra liberado e o servidor tratava como convidado.)
  // -----------------------------------------------------
  window.addEventListener('storage', (e) => {
    if (e.key !== CHAVE_SESSAO) return;
    if (!e.newValue) {
      conta = null;
      mostrarDesconectado();
    } else if (ultimaSaude) {
      mostrarConta(ultimaSaude); // entrou em outra aba: busca a conta aqui também
    }
  });
}

// -----------------------------------------------------
// Chamado depois do /saude: mostra o bloco da conta se o login estiver disponível
// -----------------------------------------------------
let ultimaSaude = null;

export async function mostrarConta(saude) {
  if (desligada) return;
  ultimaSaude = saude;
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
  aoMudarConta(conta);
  $('conta-desconectado').hidden = true;
  $('conta-conectado').hidden = false;
  $('nome-conta').textContent = conta.nome;
  const foto = $('foto-conta');
  foto.hidden = !conta.foto;
  if (conta.foto) foto.src = conta.foto;
}

function mostrarDesconectado() {
  aoMudarConta(null);
  $('conta-desconectado').hidden = false;
  $('conta-conectado').hidden = true;
}

function status(texto, erro = false) {
  $('status-conta').textContent = texto;
  $('status-conta').className = erro ? 'info erro' : 'info';
}
