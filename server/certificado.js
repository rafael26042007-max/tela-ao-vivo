// =====================================================
// Certificado HTTPS
// Se você não passar um certificado próprio, gera um autoassinado
// e guarda na pasta certs/ pra reutilizar.
// =====================================================
const fs = require('fs');
const path = require('path');
const selfsigned = require('selfsigned');

const PASTA = path.join(__dirname, '..', 'certs');
const ARQ_CERT = path.join(PASTA, 'cert.pem');
const ARQ_CHAVE = path.join(PASTA, 'chave.pem');
const ARQ_INFO = path.join(PASTA, 'info.json');

async function obterCertificado(config) {
  // -----------------------------------------------------
  // 1) Certificado próprio (ex: Let's Encrypt numa VPS)
  // -----------------------------------------------------
  if (config.certificadoArquivo && config.chaveArquivo) {
    return {
      cert: fs.readFileSync(config.certificadoArquivo),
      key: fs.readFileSync(config.chaveArquivo),
    };
  }

  // -----------------------------------------------------
  // 2) Reaproveita o autoassinado, se foi feito pro mesmo IP
  // -----------------------------------------------------
  try {
    const info = JSON.parse(fs.readFileSync(ARQ_INFO, 'utf8'));
    if (info.ip === config.ipLocal && new Date(info.validoAte) > new Date()) {
      return { cert: fs.readFileSync(ARQ_CERT), key: fs.readFileSync(ARQ_CHAVE) };
    }
  } catch {
    // ainda não existe -> gera abaixo
  }

  // -----------------------------------------------------
  // 3) Gera um novo autoassinado (vale pra localhost e pro IP da rede)
  // -----------------------------------------------------
  console.log('Gerando certificado HTTPS autoassinado...');
  const validoAte = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  const pems = await selfsigned.generate([{ name: 'commonName', value: 'tela-ao-vivo' }], {
    keySize: 2048,
    algorithm: 'sha256',
    notAfterDate: validoAte,
    extensions: [
      { name: 'basicConstraints', cA: false },
      { name: 'keyUsage', digitalSignature: true, keyEncipherment: true },
      { name: 'extKeyUsage', serverAuth: true },
      {
        name: 'subjectAltName',
        altNames: [
          { type: 2, value: 'localhost' },
          { type: 7, ip: '127.0.0.1' },
          { type: 7, ip: config.ipLocal },
        ],
      },
    ],
  });

  fs.mkdirSync(PASTA, { recursive: true });
  fs.writeFileSync(ARQ_CERT, pems.cert);
  fs.writeFileSync(ARQ_CHAVE, pems.private, { mode: 0o600 });
  fs.writeFileSync(ARQ_INFO, JSON.stringify({ ip: config.ipLocal, validoAte }));
  return { cert: pems.cert, key: pems.private };
}

module.exports = { obterCertificado };
