-- =====================================================
-- 001 - Contas (opcionais) do Tela ao Vivo
--
-- Regra da LGPD seguida aqui: guardar SÓ o necessário pra conta funcionar
-- (art. 6º, III - princípio da necessidade).
--
-- NÃO é guardado em lugar nenhum:
--   - e-mail (o login com Discord pede só o escopo "identify", sem e-mail)
--   - senha (quem cuida do login é o Discord)
--   - token do Discord (usado só durante o login e descartado)
--   - IP, localização, histórico de salas, chat, vídeo ou áudio
--
-- Apagar a conta apaga TUDO dela (ON DELETE CASCADE nas outras tabelas).
-- =====================================================

-- ---------- Contas ----------
CREATE TABLE usuarios (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- Identifica a conta no login com Discord (número público do perfil)
  discord_id        text NOT NULL UNIQUE CHECK (discord_id ~ '^[0-9]{5,25}$'),
  -- Nome mostrado nas salas (vem do Discord; a pessoa pode corrigir)
  nome              text NOT NULL CHECK (char_length(nome) BETWEEN 1 AND 32),
  -- Só o CÓDIGO da foto do perfil do Discord (a imagem fica no Discord, não aqui)
  avatar            text CHECK (avatar IS NULL OR avatar ~ '^(a_)?[0-9a-f]{32}$'),
  -- Prova de que a pessoa aceitou a política de privacidade, e qual versão
  termos_versao     text NOT NULL,
  termos_aceitos_em timestamptz NOT NULL DEFAULT now(),
  criado_em         timestamptz NOT NULL DEFAULT now(),
  -- Usado pra apagar contas abandonadas (ver limparInativos em banco.js)
  ultimo_acesso     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX usuarios_ultimo_acesso ON usuarios (ultimo_acesso);

-- ---------- Sala fixa (benefício de conta: mesmo código sempre) ----------
CREATE TABLE salas_fixas (
  codigo    text PRIMARY KEY CHECK (codigo ~ '^[A-Z0-9]{4,12}$'),
  -- Uma sala fixa por conta; apagou a conta, a sala some junto
  dono_id   uuid NOT NULL UNIQUE REFERENCES usuarios (id) ON DELETE CASCADE,
  criada_em timestamptz NOT NULL DEFAULT now()
);

-- ---------- Preferências (lembrar em qualquer PC) ----------
CREATE TABLE preferencias (
  usuario_id    uuid PRIMARY KEY REFERENCES usuarios (id) ON DELETE CASCADE,
  qualidade     text CHECK (qualidade IN ('automatica', 'minima', 'economia', 'equilibrado', 'fluido', 'ultra')),
  codec         text CHECK (char_length(codec) <= 40),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
