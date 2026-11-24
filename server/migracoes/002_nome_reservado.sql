-- =====================================================
-- 002 - Nome reservado
-- Quem entra sem conta com o nome de uma conta vira "Nome (convidado)".
-- Esse índice deixa a busca por nome (sem diferenciar maiúscula) rápida.
-- =====================================================
CREATE INDEX usuarios_nome_minusculo ON usuarios (lower(nome));
