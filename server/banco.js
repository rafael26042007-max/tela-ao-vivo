// =====================================================
// Banco de dados (PostgreSQL no Neon, região São Paulo)
//
// Opcional: sem DATABASE_URL, o site funciona igual (só não tem contas).
//
// LGPD: este arquivo concentra tudo que mexe em dado pessoal, e cada direito
// do titular (art. 18) tem a sua função:
//   - acessar / portabilidade -> meusDados()     (JSON com tudo da pessoa)
//   - corrigir                -> corrigirNome()
//   - eliminar                -> apagarConta()   (apaga TUDO, em cascata)
//   - retenção mínima         -> limparInativos() (conta abandonada é apagada)
// =====================================================
const fs = require('fs');
const path = require('path');
const config = require('./config');

const PASTA_MIGRACOES = path.join(__dirname, 'migracoes');

let pool = null;

// -----------------------------------------------------
// Conectar (e criar/atualizar as tabelas)
// -----------------------------------------------------
async function conectarBanco(url = config.databaseUrl) {
  if (!url) return false;
  const { Pool } = require('pg'); // só carrega se for usar
  const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
  // sslmode=verify-full: criptografa E confere o certificado do Neon.
  // (A string do Neon vem com sslmode=require, que na próxima versão do pg passa a
  // só criptografar, sem conferir quem está do outro lado. Fixando aqui, não enfraquece.)
  if (!local) {
    const endereco = new URL(url);
    endereco.searchParams.set('sslmode', 'verify-full');
    url = endereco.toString();
  }
  pool = new Pool({
    connectionString: url,
    max: 3, // plano grátis: poucas conexões bastam
    idleTimeoutMillis: 30_000,
    // Neon exige conexão criptografada (segurança: LGPD art. 46)
    ssl: local ? false : { rejectUnauthorized: true },
    // O "channel_binding=require" da string do Neon é ignorado pelo pg: liga aqui.
    // Amarra o login do banco à conexão criptografada (protege contra intermediário falso)
    enableChannelBinding: !local,
  });
  pool.on('error', (erro) => console.error('Banco:', erro.message));
  try {
    await migrar();
  } catch (erro) {
    await fecharBanco(); // não fica "meio ligado": ou funciona, ou é como se não tivesse banco
    throw erro;
  }
  return true;
}

const bancoLigado = () => pool !== null;

async function fecharBanco() {
  await pool?.end();
  pool = null;
}

// -----------------------------------------------------
// Migrações: roda os arquivos .sql de server/migracoes em ordem, uma vez cada.
// A trava (advisory lock) impede dois servidores de migrar ao mesmo tempo.
// -----------------------------------------------------
async function migrar() {
  const cliente = await pool.connect();
  try {
    await cliente.query('SELECT pg_advisory_lock(424242)');
    await cliente.query(`CREATE TABLE IF NOT EXISTS migracoes (
      nome text PRIMARY KEY, aplicada_em timestamptz NOT NULL DEFAULT now())`);
    const { rows } = await cliente.query('SELECT nome FROM migracoes');
    const feitas = new Set(rows.map((r) => r.nome));

    const arquivos = fs.readdirSync(PASTA_MIGRACOES).filter((a) => a.endsWith('.sql')).sort();
    for (const arquivo of arquivos) {
      if (feitas.has(arquivo)) continue;
      const sql = fs.readFileSync(path.join(PASTA_MIGRACOES, arquivo), 'utf8');
      await cliente.query('BEGIN');
      try {
        await cliente.query(sql);
        await cliente.query('INSERT INTO migracoes (nome) VALUES ($1)', [arquivo]);
        await cliente.query('COMMIT');
        console.log(`  Banco: migração ${arquivo} aplicada`);
      } catch (erro) {
        await cliente.query('ROLLBACK');
        throw new Error(`Migração ${arquivo} falhou: ${erro.message}`);
      }
    }
  } finally {
    await cliente.query('SELECT pg_advisory_unlock(424242)').catch(() => {});
    cliente.release();
  }
}

// =====================================================
// CONTAS
// =====================================================

// Login com Discord: cria a conta na primeira vez, atualiza nome/foto nas outras.
// termosVersao: versão da política que a pessoa aceitou ao criar a conta.
async function entrarComDiscord({ discordId, nome, avatar = null, termosVersao }) {
  const { rows } = await pool.query(
    `INSERT INTO usuarios (discord_id, nome, avatar, termos_versao)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (discord_id) DO UPDATE
       SET avatar = EXCLUDED.avatar, ultimo_acesso = now()
     RETURNING id, nome, avatar, termos_versao, criado_em`,
    [String(discordId), limparNome(nome), avatar, termosVersao]
  );
  return rows[0];
}

// A conta desse perfil do Discord já existe? (conta nova precisa do aceite da política)
async function contaPorDiscord(discordId) {
  const { rows } = await pool.query('SELECT id FROM usuarios WHERE discord_id = $1', [String(discordId)]);
  return rows[0]?.id ?? null;
}

// A conta ainda existe? (sessão de conta apagada para de valer na hora)
async function contaExiste(usuarioId) {
  if (!/^[0-9a-f-]{36}$/.test(String(usuarioId))) return false;
  const { rowCount } = await pool.query('SELECT 1 FROM usuarios WHERE id = $1', [usuarioId]);
  return rowCount === 1;
}

// Resumo da conta pro site (nome e foto)
async function resumoConta(usuarioId) {
  const { rows } = await pool.query('SELECT nome, discord_id, avatar FROM usuarios WHERE id = $1', [usuarioId]);
  const u = rows[0];
  if (!u) return null;
  // A foto fica no Discord: aqui só se monta o endereço dela a partir do código
  const foto = u.avatar ? `https://cdn.discordapp.com/avatars/${u.discord_id}/${u.avatar}.png?size=64` : null;
  return { nome: u.nome, foto };
}

// Marca que a pessoa usou a conta (adia a limpeza de contas inativas)
async function registrarAcesso(usuarioId) {
  await pool.query('UPDATE usuarios SET ultimo_acesso = now() WHERE id = $1', [usuarioId]);
}

// Direito de CORREÇÃO (art. 18, III)
async function corrigirNome(usuarioId, nome) {
  const { rowCount } = await pool.query('UPDATE usuarios SET nome = $2 WHERE id = $1', [usuarioId, limparNome(nome)]);
  return rowCount === 1;
}

// Direito de ACESSO e PORTABILIDADE (art. 18, II e V):
// tudo que existe sobre a pessoa, num formato que dá pra baixar e ler
async function meusDados(usuarioId) {
  const usuario = await pool.query(
    `SELECT id, discord_id, nome, avatar, termos_versao, termos_aceitos_em, criado_em, ultimo_acesso
       FROM usuarios WHERE id = $1`,
    [usuarioId]
  );
  if (!usuario.rowCount) return null;
  const sala = await pool.query('SELECT codigo, criada_em FROM salas_fixas WHERE dono_id = $1', [usuarioId]);
  const prefs = await pool.query('SELECT qualidade, codec, atualizado_em FROM preferencias WHERE usuario_id = $1', [
    usuarioId,
  ]);
  return {
    exportado_em: new Date().toISOString(),
    conta: usuario.rows[0],
    sala_fixa: sala.rows[0] ?? null,
    preferencias: prefs.rows[0] ?? null,
    observacao:
      'Isso é tudo que o Tela ao Vivo guarda sobre você. Vídeo, áudio, chat e salas não são gravados.',
  };
}

// Direito de ELIMINAÇÃO (art. 18, VI): apaga a conta e tudo ligado a ela
async function apagarConta(usuarioId) {
  const { rowCount } = await pool.query('DELETE FROM usuarios WHERE id = $1', [usuarioId]);
  return rowCount === 1;
}

// Retenção: conta sem uso há X meses é apagada (não guardar dado sem necessidade)
async function limparInativos(meses = config.mesesInatividade) {
  const { rowCount } = await pool.query(
    "DELETE FROM usuarios WHERE ultimo_acesso < now() - make_interval(months => $1)",
    [meses]
  );
  if (rowCount) console.log(`  Banco: ${rowCount} conta(s) inativa(s) há ${meses} meses apagada(s)`);
  return rowCount;
}

// Roda a limpeza agora e depois uma vez por dia
function agendarLimpeza() {
  const rodar = () => limparInativos().catch((e) => console.error('Limpeza de contas:', e.message));
  rodar();
  setInterval(rodar, 24 * 60 * 60_000).unref();
}

function limparNome(nome) {
  const limpo = String(nome ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 32);
  return limpo || 'Sem nome';
}

module.exports = {
  conectarBanco,
  fecharBanco,
  bancoLigado,
  agendarLimpeza,
  entrarComDiscord,
  contaPorDiscord,
  contaExiste,
  resumoConta,
  registrarAcesso,
  corrigirNome,
  meusDados,
  apagarConta,
  limparInativos,
  // usado só nos testes
  _pool: () => pool,
};
