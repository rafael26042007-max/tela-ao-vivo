// =====================================================
// Endereço do servidor de sinalização
// - No seu PC (npm start): deixe vazio -> usa o mesmo endereço do site
// - No GitHub Pages: aponta pro servidor no Render
// =====================================================
window.TELA_AO_VIVO = {
  servidor: location.hostname.endsWith('github.io') ? 'https://tela-ao-vivo-27wj.onrender.com' : '',
};
