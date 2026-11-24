# 🔴 Tela ao Vivo

Site para transmitir a tela (e a câmera) ao vivo, com **salas e código de entrada**, pra até **12 pessoas** por sala
(quem cria escolhe o limite). O vídeo vai **direto de um navegador pro outro (P2P)**: nenhum servidor recebe o vídeo,
e nada é gravado. Grátis, sem instalar nada, e a conta é **opcional**.

🌐 **Site:** https://rafael26042007-max.github.io/tela-ao-vivo/

> Quer a versão com servidor no meio (SFU/mediasoup, pra salas grandes)? Está na branch [`sfu`](../../tree/sfu).

## Funções

**Salas**
- **Criar sala**: código de 6 caracteres (ex: `G7JFR7`) e link de convite (`?sala=G7JFR7`) com prévia bonita no Discord/WhatsApp
- **Senha opcional** (🔑): fica escondida em "🔒 Proteger com senha"; sem senha, qualquer um com o código entra
- **Limite de pessoas** escolhido por quem cria a sala (de 2 a 12; padrão 8)
- **Sala cheia?** Quem tenta entrar fica **esperando uma vaga** e entra sozinho quando alguém sair
- **Dono da sala** (👑, quem criou): pode **trancar** a sala (ninguém novo entra) e **remover** pessoas. Se o dono sair, quem está há mais tempo vira dono
- **Nomes repetidos** ganham número ("Ana", "Ana 2") e **cada pessoa tem uma cor**

**Transmitir e assistir**
- **Várias pessoas transmitindo** ao mesmo tempo; dá pra **transmitir e assistir com o mesmo usuário**
- **Qualidade Automática** (padrão): sobe e desce sozinha conforme o PC e a internet de quem transmite aguentam
- Ou escolha na mão: **Mínima, Economia, Equilibrado, Fluido** ou **Ultra (4K, até 120 fps)**, que pede confirmação antes.
  A escolha é num painel que mostra a resolução, o FPS e pra que serve cada uma
- A prévia mostra **o que está saindo de verdade** (ex: "Enviando 1920×1080 · 15 fps · limitado por internet")
- **Áudio** da aba/sistema (opcional); codec em "Avançado"
- **📌 Tela em destaque**: uma tela grande e as outras numa coluna ao lado
- **Volume por tela**, **tela cheia** (com a barra de volume e Ocultar junto) e **Ocultar** (quem transmite para de
  enviar o vídeo pra você)
- Com **3 ou 4 telas num monitor grande**, a grade fica em 2 colunas pra cada tela aparecer maior
- **Quem está assistindo**: quem transmite vê os nomes ("👁 2 assistindo: Ana, Beto")
- **📷 Câmera** pra todo mundo, **inclusive no celular** (que não consegue transmitir a tela). Separada da tela:
  dá pra transmitir as duas ao mesmo tempo. Leve de propósito (360p, 15 fps, ~500 kbps por pessoa), sem som
  (a voz fica com a chamada de vocês)

**Chat e conforto**
- **Chat** com histórico e **contador de não lidas** (no título da aba também)
- **Enter** no nome já entra/cria a sala; **Sair** pede confirmação
- **F5 não tira ninguém da sala**: a pessoa volta sozinha, sem digitar nada
- **Servidor atualizou/reiniciou?** As salas são **recriadas sozinhas** (mesmo código, senha e dono) e o vídeo nem para
- **💬 Feedback**: botão na tela inicial e na sala; a opinião chega num canal do Discord (ver "Feedback" em Publicando)

**Conta (opcional)**
- **Entrar com Discord**: sem senha nova, e o Discord só entrega o perfil básico (**sem e-mail**)
- Antes de criar a conta, a pessoa **aceita a Política de Privacidade** (fica guardado quando e qual versão)
- **Minha conta**: corrigir o nome, **baixar meus dados** (arquivo JSON) e **apagar a conta** na hora
- Sem conta, tudo continua funcionando igual
- **Benefícios de quem tem conta:**
  - **Sala fixa**: escolha um código de 6 letras/números (ex: `RAFAEL`) em "Minha conta"; ninguém mais pega ele. O dono
    da conta sempre entra como dono 👑 dessa sala, de qualquer PC
  - **✔ e foto do Discord** na lista de pessoas. O nome é o da conta (travado)
  - **Nome reservado**: quem entra sem conta com o nome de uma conta aparece como "Rafael (convidado)", sem ✔
  - **Ultra (4K, até 120 fps)** só com conta (ver "4K só com conta" abaixo)

**Privacidade (LGPD)**
- Página [Privacidade](https://rafael26042007-max.github.io/tela-ao-vivo/privacidade.html) em português claro:
  o que é tratado com e sem conta, pra quê, onde fica, por quanto tempo e como apagar
- Banco de dados no **Brasil** (Neon, São Paulo), guardando só o mínimo

## Como funciona

```
 GitHub Pages ──► entrega o site (HTML, CSS, JS), sempre no ar
 Render       ──► servidor de sinalização: salas, códigos, senha, chat
                  e as mensagens pros navegadores se "acharem"
 Navegadores  ──► o vídeo vai DIRETO de um pro outro (WebRTC P2P)
 Neon         ──► banco das contas opcionais (São Paulo)        ┐ opcionais: sem eles,
 Discord      ──► login das contas e canal do feedback           ┘ o site funciona igual

      Ana ◄────────► Beto
       ▲  ╲        ╱  ▲
       │    ╲    ╱    │      cada par de pessoas tem uma conexão direta
       ▼    ╱    ╲    ▼
     Carla ◄────────► Davi
```

| Peça | Onde | O que gasta |
|---|---|---|
| Site | GitHub Pages | Nada |
| Sinalização | Render (grátis) | Quase nada: só mensagens de texto |
| Vídeo e câmera | Direto entre os PCs | A internet e a CPU de quem transmite |
| Contas | Neon (grátis, 1 GB) | Quase nada: algumas linhas por conta |
| Login e feedback | Discord | Nada |

**Importante:** em P2P, quem transmite manda **uma cópia pra cada pessoa** (com 8 na sala, são 7 cópias).
Por isso o **bitrate se ajusta sozinho**: até 3 espectadores cada um recebe a qualidade escolhida; com mais gente,
cada cópia fica mais leve, e o upload total fica parecido com o de 3 espectadores (mínimo de 300 kbps por pessoa).

### Qualidades

| Qualidade | Resolução | FPS | Bitrate por pessoa | Pra quê |
|---|---|---|---|---|
| 🔄 **Automática** (padrão) | até 1080p | até 30 | varia | Ajusta sozinha pra não travar |
| Mínima | 480p | 10 | 300 kbps | Internet ou PC bem fracos |
| Economia | 720p | 10 | 600 kbps | Internet fraca |
| Equilibrado | 1080p | 15 | 1,2 Mbps | Telas com texto, sites, código |
| Fluido | 1080p | 30 | 2,5 Mbps | Jogos e vídeos |
| Ultra | 4K | até 120 | 20 Mbps | Tela 4K 120 Hz, PC forte, 1 ou 2 pessoas assistindo |

**Como a Automática decide** (`web/src/automatico.js`): a cada 2 segundos, quem transmite lê as estatísticas do
WebRTC (`getStats`) de cada cópia que envia:

- **CPU no limite** (`qualityLimitationReason = "cpu"`), **internet no limite** (a banda disponível,
  `availableOutgoingBitrate`, não chega a 80% do que está sendo enviado), **perda de pacotes acima de 5%** ou
  **atraso acima de 500 ms** → depois de ~6 s assim, **desce** um degrau (Fluido → Equilibrado → Economia → Mínima)
- **Tudo bem por ~20 s** → **sobe** um degrau (devagar, pra não ficar indo e voltando)
- **Cada pessoa tem o seu degrau**: a CPU é do PC de quem transmite, então ela vale como um **teto** pra
  todos; já a internet é medida **por pessoa**. Se só a Ana tem internet ruim, só a cópia da Ana desce (a tela
  mostra "Ana em Mínima (internet lenta)") e o resto continua na qualidade boa
- Quem perde a conexão (internet caiu, aba travou) para de contar como "assistindo" em poucos segundos e
  devolve a parte do bitrate pros outros
- Se a janela compartilhada muda de tamanho, a redução de resolução é recalculada
- Ela captura em 1080p/30 e só muda os limites do encoder (`setParameters`: bitrate, FPS e
  `scaleResolutionDownBy`), então **ninguém precisa escolher a tela de novo** e quem assiste não perde a imagem

> Por que não usar só o `qualityLimitationReason = "bandwidth"`? O Chrome também reporta "bandwidth" quando o
> limite é o **nosso** teto de bitrate (ele reduz a resolução pra caber). Por isso a internet é medida pela banda disponível.

Nas qualidades manuais, o site **avisa** quando o PC ou a internet não estão dando conta ("a imagem pode travar").

### 4K só com conta (3 camadas)

No P2P quem transmite controla o próprio navegador, então um bloqueio só no site dá pra burlar pelo F12. Por isso:

1. **Site**: sem conta, a opção Ultra fica bloqueada ("só com conta")
2. **Servidor (SDP)**: as descrições de conexão que chegam pra quem **não tem conta** ganham `b=AS:3000` no vídeo.
   O próprio Chrome de quem transmite obedece o teto de ~3 Mbps (cabe o Fluido; o Ultra precisa de ~20 Mbps)
3. **Fiscal**: quem **assiste** (com o site normal) mede o vídeo que chega. Acima de 1080p ou 40 fps vindo de alguém
   sem conta, avisa o servidor, que pede pra baixar pra Fluido. Se continuar depois de 15s e **2 pessoas** confirmarem
   (ou a única que assiste), a transmissão é encerrada e fica bloqueada por 5 minutos

Só vale quando o login está configurado (sem login, ninguém tem conta, então ninguém é limitado).
Burlar tudo exigiria modificar o site de quem transmite **e** o de quem assiste.

### Economia de processamento

- Se alguém **oculta** a sua tela, você **para de codificar e enviar** pra essa pessoa
- **Uma camada só** de vídeo, com limite de FPS e bitrate
- `contentHint`: "detail" (nitidez do texto) nas qualidades de texto, "motion" (fluidez) no Fluido e no Ultra
- O servidor não toca no vídeo

## Proteções

| Proteção | Como |
|---|---|
| Senha da sala | Guardada só como hash (scrypt + sal), comparação em tempo constante |
| Chutar a senha de uma sala | 20 senhas erradas em 10 min travam a sala por um tempo (errar o código não bloqueia ninguém) |
| Criar salas em massa | 10 por minuto por IP e limite total de salas |
| Outros sites usando seu servidor | Só as origens em `ORIGENS_PERMITIDAS` podem usar a API e o WebSocket |
| Lotar a sala | Máximo de pessoas e de transmissões por sala |
| Spam no chat | 5 mensagens a cada 5 segundos |
| HTML malicioso | Tudo é exibido como texto (`textContent`) |
| Bilhete falsificado | O bilhete de volta é criptografado (AES-256-GCM) com a chave `SEGREDO`: não dá pra ler nem alterar |
| Pessoa removida voltando | Quem o dono removeu não consegue voltar com o bilhete |
| Spam no feedback | 3 a cada 10 min por IP, até 1000 caracteres, sem `@everyone`; o webhook fica só no servidor |
| Login forjado | `state` aleatório guardado no servidor **e** num cookie do navegador; cada um vale uma vez só |
| Login como redirecionador de golpe | O login só devolve a pessoa pra sites de `ORIGENS_PERMITIDAS` |
| Benefício sem conta | Os benefícios dependem da **sessão assinada**, nunca do nome digitado; 4K protegido em 3 camadas |
| Sessão falsificada | Assinada (HMAC-SHA256 com `SEGREDO`), comparação em tempo constante, vale 30 dias, morre se a conta for apagada |
| Vazamento de dados | Não guardamos e-mail, senha, IP nem o token do Discord; banco com SSL `verify-full` e channel binding |
| Segredos | Webhook, `DATABASE_URL` e `DISCORD_CLIENT_SECRET` só nas variáveis do Render, nunca no site ou no GitHub |

## Como a sala sobrevive ao F5 e às atualizações

Ao entrar, cada pessoa recebe um **bilhete**: um comprovante criptografado com o código da sala, o nome,
se é dono e a senha (em hash). Só o servidor consegue ler ou criar bilhetes (chave `SEGREDO`, gerada pelo Render).

- **F5:** o bilhete fica guardado na aba (`sessionStorage`) e a pessoa volta sozinha
- **Internet caiu:** o navegador reconecta e mostra o bilhete; o vídeo P2P continua enquanto isso
- **Servidor reiniciou** (atualização no Render): as salas somem da memória, mas o primeiro que voltar
  **recria a sala** com o bilhete, e os outros entram nela. As conexões de vídeo continuam as mesmas.

O Render também só reinicia o servidor quando `server/` ou `package.json` mudam (`buildFilter` no `render.yaml`).

## Estrutura

```
server/                 # vai pro Render
├── index.js            # API de salas, WebSocket, CORS, /saude
├── salas.js            # salas, códigos, dono, repasse dos sinais P2P, volta pra sala
├── bilhete.js          # bilhete criptografado (F5 e recriar sala depois de reinício)
├── turn.js             # servidores STUN/TURN (Cloudflare, Open Relay ou manual)
├── senha.js            # hash e conferência de senha
├── limites.js          # anti-abuso
├── feedback.js         # confere o feedback e repassa pro webhook do Discord
├── banco.js            # PostgreSQL (contas opcionais): conta, exportar, apagar, limpar inativas
├── login.js            # login com Discord (OAuth2) e sessão assinada
├── migracoes/          # estrutura do banco em SQL, aplicada sozinha ao iniciar
│   ├── 001_contas.sql  # usuarios, salas_fixas, preferencias (só o mínimo)
│   └── 002_nome_reservado.sql
├── certificado.js      # HTTPS autoassinado (só pra testar na rede local)
└── config.js           # configurações
web/                    # vai pro GitHub Pages (não precisa compilar)
├── index.html, style.css
├── privacidade.html    # política de privacidade (LGPD)
├── previa.png          # imagem da prévia do link (gerada por scripts/gerar-previa.py)
├── config.js           # endereço do servidor
└── src/
    ├── app.js          # telas, botões, chat, pessoas
    ├── p2p.js          # malha WebRTC (perfect negotiation), qualidades e medição do envio
    ├── automatico.js   # decide quando a qualidade Automática sobe ou desce
    ├── feedback.js     # janela "O que você achou?"
    ├── conta.js        # "Entrar com Discord" e "Minha conta" (corrigir, baixar, apagar)
    ├── seletor-qualidade.js  # botão "Qualidade ▾" + painel com cada opção explicada
    └── conexao.js      # WebSocket com reconexão automática
render.yaml             # configuração do Render
.github/workflows/pages.yml  # publica web/ no GitHub Pages (empacotar → publicar)
```

---

## Rodando no seu PC

Precisa do **Node.js 20+** (`node -v`).

```bash
npm install
npm start
```

Abra **http://localhost:3000**. No seu PC, o mesmo servidor entrega o site e faz a sinalização.

> Pra testar com **outros PCs da sua rede**, transmitir exige HTTPS. Rode com `HTTPS=true`
> (no PowerShell: `$env:HTTPS="true"; npm start`) e abra o endereço `https://SEU-IP:3000`
> que aparece no terminal (aceite o aviso do certificado).

Modo desenvolvimento (reinicia o servidor ao salvar): `npm run dev`

O feedback, o banco e o login são **opcionais**: sem as variáveis (tabela abaixo), eles só ficam escondidos.
Pra testar as contas no seu PC, rode um PostgreSQL e use `DATABASE_URL=postgres://usuario@localhost:5432/banco`
(conexões com `localhost` não usam SSL).

---

## Publicando

### Site → GitHub Pages
1. No repositório: **Settings → Pages → Source: GitHub Actions**
2. Todo push na `main` que mexer em `web/` publica sozinho (aba **Actions**)
3. Na publicação, o `__VERSAO__` dos endereços (ex: `app.js?v=__VERSAO__`) vira o número do commit.
   Assim o navegador nunca mistura um HTML novo com um JS antigo guardado em cache

### Servidor → Render
1. Em [render.com](https://render.com): **New → Blueprint** → escolha este repositório
2. O Render lê o `render.yaml` e cria o serviço `tela-ao-vivo` no plano grátis
3. O endereço do serviço (hoje `https://tela-ao-vivo-27wj.onrender.com`) fica em `web/config.js`: se mudar, atualize lá

### Limites do plano grátis do Render
- Ele **dorme depois de 15 min sem uso** e leva **até ~1 min pra acordar**. O site mostra "Acordando o servidor..." enquanto isso.
- Enquanto alguém está numa sala, o site manda um sinal a cada 4 min pra ele não dormir.
- Quando ele dorme ou reinicia, as salas saem da memória, mas quem estava nelas **recria a sala sozinho** com o
  bilhete (ver "Como a sala sobrevive ao F5"). Salas vazias somem de verdade depois de 30 min.

### Variáveis do Render (Environment)

| Variável | Pra quê | Como |
|---|---|---|
| `SEGREDO` | Chave dos bilhetes e das sessões | O Render gera sozinho (`render.yaml`) |
| `ORIGENS_PERMITIDAS` | Sites que podem usar o servidor | `render.yaml` (o GitHub Pages) |
| `CONFIAR_PROXY` | IP real do visitante atrás do Render | `render.yaml` (`true`) |
| `MAX_PESSOAS`, `MAX_TRANSMISSOES` | Limite padrão de pessoas e de telas por sala | `render.yaml` (8 e 4) |
| `MAX_LIMITE_PESSOAS` | Maior limite que o dono pode escolher | Opcional (padrão 12) |
| `FEEDBACK_WEBHOOK` | Feedback no Discord | 🔒 Painel do Render (ver abaixo) |
| `DATABASE_URL` | Banco das contas | 🔒 Painel do Render (ver abaixo) |
| `MESES_INATIVIDADE` | Apagar contas sem uso | Opcional (padrão 12) |
| `KBPS_SEM_CONTA` | Teto de banda por pessoa de quem transmite sem conta | Opcional (padrão 3000) |
| `DISCORD_CLIENT_ID` | App do login | `render.yaml` (público) |
| `DISCORD_CLIENT_SECRET` | Senha do app do login | 🔒 Painel do Render (ver abaixo) |
| `CLOUDFLARE_TURN_ID` / `_TOKEN`, `METERED_CHAVE`, `TURN_*` | TURN | Opcional (ver o fim) |

🔒 = segredo: **só no painel do Render**, nunca no site, no `render.yaml` nem no GitHub.

### Feedback → Discord
1. No Discord, crie um canal (de preferência **privado, só seu**) e deixe a notificação em "Todas as mensagens"
2. Configurações do canal → **Integrações → Webhooks → Novo webhook → Copiar URL do webhook**
3. No Render (**Environment**), adicione `FEEDBACK_WEBHOOK` com essa URL

Sem a variável, o botão de feedback simplesmente não aparece. **Nunca coloque a URL no site** (ela funciona como
a senha do canal): o site manda pro servidor, que confere, limita (3 a cada 10 min por IP, até 1000 caracteres)
e repassa. Ninguém consegue usar `@everyone` pelo feedback.

### Banco de dados → Neon (contas opcionais)
O site funciona sem banco. Com ele (e com o login abaixo), passam a existir as contas.
1. Em [neon.com](https://neon.com), crie um projeto **na região São Paulo (`aws-sa-east-1`)**: os dados ficam no Brasil
2. Em **Connect**, **desligue "Connection pooling"** (o endereço não pode ter `-pooler`: a trava que impede dois
   servidores de criarem as tabelas ao mesmo tempo não funciona com pooling) e copie a **connection string**
3. No Render (**Environment**), adicione `DATABASE_URL` com ela. **Nunca coloque no site nem no GitHub**

Ao iniciar, o servidor cria as tabelas sozinho (`server/migracoes/`). Se o banco cair, o site continua, só sem contas.
O `sslmode` é forçado pra `verify-full` no código (criptografa **e** confere o certificado do Neon) e o channel
binding fica ligado. Confira em `/saude`: `"contas": true`.

**LGPD** (detalhes em `web/privacidade.html`):
- Guarda só o mínimo: número do perfil do Discord, nome, código da foto, sala fixa, preferências e o aceite da política.
  **Sem e-mail, senha, IP, token, chat, vídeo ou áudio**
- Cada direito do titular tem uma função em `server/banco.js`: `meusDados` (acesso/portabilidade), `corrigirNome`,
  `apagarConta` (apaga tudo em cascata)
- Conta sem uso por 12 meses é apagada sozinha (`MESES_INATIVIDADE`)
- Mudou o texto da política? Mude a versão no HTML **e** em `versaoTermos` (`server/config.js`)

### Login com Discord (contas opcionais)
Precisa do banco (acima) e de um app no [Discord Developer Portal](https://discord.com/developers/applications):
1. App **Tela ao Vivo** → **OAuth2** → **Redirects**: `https://tela-ao-vivo-27wj.onrender.com/auth/discord/retorno`
2. No Render (**Environment**): `DISCORD_CLIENT_ID` (público, já está no `render.yaml`) e `DISCORD_CLIENT_SECRET`
   (**Redefinir segredo** no Discord; nunca no site nem no GitHub)
3. Confira em `/saude`: `"login": true`. Aí aparece **"Entrar com Discord (opcional)"** embaixo do campo do nome

Como funciona (`server/login.js`): o site manda a pessoa pro servidor, que manda pro Discord pedindo **só o escopo
`identify`** (sem e-mail). Na volta, o servidor confere o `state` (memória + cookie, contra login forjado), troca o
código pelo token, lê o perfil e **joga o token fora**. Conta nova só é criada com o **aceite da política**. A sessão
é assinada com o `SEGREDO`, vale 30 dias e para de valer na hora se a conta for apagada. Em "Minha conta" a pessoa
corrige o nome, **baixa os dados** (JSON) e **apaga a conta**.

### Quando a conexão P2P falha (TURN)
Algumas redes (4G com CGNAT, rede de empresa/faculdade) bloqueiam conexão direta. O site avisa quando isso acontece.
A solução é um servidor **TURN**, que retransmite o vídeo só pra quem não conseguiu conectar direto.
Configure **uma** das opções no Render (**Environment**) e o servidor passa as credenciais pros navegadores sozinho:

| Opção | Grátis por mês | Variáveis |
|---|---|---|
| **Cloudflare** (recomendado) | 1.000 GB | `CLOUDFLARE_TURN_ID` e `CLOUDFLARE_TURN_TOKEN` (painel da Cloudflare → Realtime → TURN Server) |
| **Open Relay** (Metered) | 20 GB | `METERED_CHAVE` |
| Qualquer outro TURN | — | `TURN_URL`, `TURN_USUARIO` e `TURN_SENHA` |
