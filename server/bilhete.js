// =====================================================
// Bilhete: comprovante criptografado de que a pessoa está numa sala
//
// O servidor entrega um bilhete pra cada pessoa ao entrar. Só o servidor
// consegue ler ou criar bilhetes (AES-256-GCM com a chave SEGREDO), então
// ninguém consegue falsificar um. Como a chave fica salva no Render, o
// bilhete continua valendo depois que o servidor reinicia. É isso que
// permite recriar a sala sozinho (mesmo código, senha e dono).
// =====================================================
const crypto = require('crypto');
const config = require('./config');

const CHAVE = crypto.createHash('sha256').update(config.segredo).digest(); // 32 bytes
const VALIDADE_MS = 12 * 60 * 60 * 1000; // 12 horas

// -----------------------------------------------------
// Cria o bilhete: { codigo, id, nome, dono, senha } -> texto
// -----------------------------------------------------
function criarBilhete(dados) {
  const iv = crypto.randomBytes(12);
  const cifra = crypto.createCipheriv('aes-256-gcm', CHAVE, iv);
  const conteudo = Buffer.from(JSON.stringify({ ...dados, expira: Date.now() + VALIDADE_MS }));
  const cifrado = Buffer.concat([cifra.update(conteudo), cifra.final()]);
  const etiqueta = cifra.getAuthTag(); // garante que ninguém alterou o bilhete
  return Buffer.concat([iv, etiqueta, cifrado]).toString('base64url');
}

// -----------------------------------------------------
// Abre o bilhete. Devolve null se for falso, alterado ou vencido.
// -----------------------------------------------------
function abrirBilhete(texto) {
  try {
    const bruto = Buffer.from(String(texto ?? ''), 'base64url');
    if (bruto.length < 29) return null;
    const decifra = crypto.createDecipheriv('aes-256-gcm', CHAVE, bruto.subarray(0, 12));
    decifra.setAuthTag(bruto.subarray(12, 28));
    const conteudo = Buffer.concat([decifra.update(bruto.subarray(28)), decifra.final()]);
    const dados = JSON.parse(conteudo.toString('utf8'));
    if (!dados.expira || dados.expira < Date.now()) return null;
    return dados;
  } catch {
    return null;
  }
}

module.exports = { criarBilhete, abrirBilhete };
