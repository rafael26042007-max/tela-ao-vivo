// =====================================================
// Modo desenvolvimento (funciona no Windows e no Linux)
// - recompila o site quando você salva algo em web/src
// - reinicia o servidor quando você salva algo em server/
// =====================================================
const { spawn } = require('child_process');
const path = require('path');
const esbuild = require('esbuild');

const raiz = path.join(__dirname, '..');

(async () => {
  // ---------- Site: compila e fica observando ----------
  const contexto = await esbuild.context({
    entryPoints: [path.join(raiz, 'web/src/app.js')],
    bundle: true,
    sourcemap: true,
    target: 'es2020',
    outfile: path.join(raiz, 'web/dist/app.js'),
    logLevel: 'info',
  });
  await contexto.rebuild();
  await contexto.watch();

  // ---------- Servidor: node --watch reinicia sozinho ----------
  const servidor = spawn(process.execPath, ['--watch-path=server', 'server/index.js'], {
    cwd: raiz,
    stdio: 'inherit',
  });

  const encerrar = () => {
    servidor.kill();
    contexto.dispose().finally(() => process.exit(0));
  };
  process.on('SIGINT', encerrar);
  process.on('SIGTERM', encerrar);
})();
