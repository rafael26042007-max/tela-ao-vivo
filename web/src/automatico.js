// =====================================================
// Qualidade Automática: decide quando subir ou descer um degrau
//
// A cada 2 segundos, quem transmite mede o envio (getStats do WebRTC):
//   - o próprio navegador diz se está limitado pela CPU ou pela internet
//     (qualityLimitationReason = 'cpu' | 'bandwidth' | 'none')
//   - quem assiste informa a perda de pacotes e o tempo de ida e volta
// Este arquivo só decide (função pura): fácil de testar.
// =====================================================

// Degraus da Automática, do mais leve pro mais pesado
export const ESCADA = ['minima', 'economia', 'equilibrado', 'fluido'];

// Começa no meio e ajusta
export const NIVEL_INICIAL = 'equilibrado';

// Quantas amostras (de 2s) seguidas pra decidir
const RUINS_PRA_DESCER = 3; // ~6s com problema -> desce rápido (evita travar)
const BOAS_PRA_SUBIR = 10; // ~20s tudo bem -> sobe devagar (evita ficar indo e voltando)

// -----------------------------------------------------
// Uma amostra está "ruim" se a CPU/internet está no limite,
// se está perdendo mais de 5% dos pacotes ou com atraso alto
// -----------------------------------------------------
export function amostraRuim(amostra) {
  return (
    amostra.limitado === 'cpu' ||
    amostra.limitado === 'bandwidth' ||
    (amostra.perda ?? 0) > 0.05 ||
    (amostra.rtt ?? 0) > 0.5
  );
}

// -----------------------------------------------------
// Recebe o nível atual e as amostras desde a última mudança.
// Devolve o novo nível (ou o mesmo, se não precisa mudar).
// -----------------------------------------------------
export function decidirNivel(nivel, amostras) {
  const i = ESCADA.indexOf(nivel);
  if (i === -1) return NIVEL_INICIAL;

  const ultimas = (n) => amostras.slice(-n);

  if (amostras.length >= RUINS_PRA_DESCER && ultimas(RUINS_PRA_DESCER).every(amostraRuim) && i > 0) {
    return ESCADA[i - 1];
  }
  if (
    amostras.length >= BOAS_PRA_SUBIR &&
    ultimas(BOAS_PRA_SUBIR).every((a) => !amostraRuim(a)) &&
    i < ESCADA.length - 1
  ) {
    return ESCADA[i + 1];
  }
  return nivel;
}
