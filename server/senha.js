// =====================================================
// Senha da sala
// Nunca guardamos a senha em si, só um "hash" (scrypt + sal aleatório).
// =====================================================
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const TAMANHO = 32;

async function gerarHash(senha) {
  const sal = crypto.randomBytes(16);
  const hash = await scrypt(senha, sal, TAMANHO);
  return { sal, hash };
}

async function conferir(senha, guardado) {
  const hash = await scrypt(String(senha ?? ''), guardado.sal, TAMANHO);
  // timingSafeEqual: compara sem "vazar" pelo tempo quantos caracteres batem
  return crypto.timingSafeEqual(hash, guardado.hash);
}

module.exports = { gerarHash, conferir };
