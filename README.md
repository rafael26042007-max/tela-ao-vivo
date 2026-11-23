# 🔴 Tela ao Vivo

Site para transmitir a tela ao vivo, com **salas e código de entrada**, pra até **12 pessoas** por sala (quem cria escolhe o limite).
O vídeo vai **direto de um navegador pro outro (P2P)**: nenhum servidor recebe o vídeo.

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
- Ou escolha na mão: **Mínima, Economia, Equilibrado, Fluido** ou **Ultra (4K, até 120 fps)**, que pede confirmação antes
- A prévia mostra **o que está saindo de verdade** (ex: "Enviando 1920×1080 · 15 fps · limitado por internet")
- **Áudio** da aba/sistema (opcional); codec em "Avançado"
- **📌 Tela em destaque**: uma tela grande e as outras numa coluna ao lado
- **Volume por tela**, **tela cheia** e **Ocultar** (quem transmite para de enviar o vídeo pra você)
- **Quem está assistindo**: quem transmite vê os nomes ("👁 2 assistindo: Ana, Beto")

**Chat e conforto**
- **Chat** com histórico e **contador de não lidas** (no título da aba também)
- **Enter** no nome já entra/cria a sala; **Sair** pede confirmação
- **F5 não tira ninguém da sala**: a pessoa volta sozinha, sem digitar nada
- **Servidor atualizou/reiniciou?** As salas são **recriadas sozinhas** (mesmo código, senha e dono) e o vídeo nem para

## Como funciona

```
 GitHub Pages ──► entrega o site (HTML, CSS, JS), sempre no ar
 Render       ──► servidor de sinalização: salas, códigos, senha, chat
                  e as mensagens pros navegadores se "acharem"
 Navegadores  ──► o vídeo vai DIRETO de um pro outro (WebRTC P2P)

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
| Vídeo | Direto entre os PCs | A internet e a CPU de quem transmite |

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
├── certificado.js      # HTTPS autoassinado (só pra testar na rede local)
└── config.js           # configurações
web/                    # vai pro GitHub Pages (não precisa compilar)
├── index.html, style.css
├── previa.png          # imagem da prévia do link (gerada por scripts/gerar-previa.py)
├── config.js           # endereço do servidor
└── src/
    ├── app.js          # telas, botões, chat, pessoas
    ├── p2p.js          # malha WebRTC (perfect negotiation), qualidades e medição do envio
    ├── automatico.js   # decide quando a qualidade Automática sobe ou desce
    └── conexao.js      # WebSocket com reconexão automática
render.yaml             # configuração do Render
.github/workflows/pages.yml  # publica web/ no GitHub Pages
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
- Quando ele dorme, as salas abertas somem (ficam só na memória).

### Quando a conexão P2P falha (TURN)
Algumas redes (4G com CGNAT, rede de empresa/faculdade) bloqueiam conexão direta. O site avisa quando isso acontece.
A solução é um servidor **TURN**, que retransmite o vídeo só pra quem não conseguiu conectar direto.
Configure **uma** das opções no Render (**Environment**) e o servidor passa as credenciais pros navegadores sozinho:

| Opção | Grátis por mês | Variáveis |
|---|---|---|
| **Cloudflare** (recomendado) | 1.000 GB | `CLOUDFLARE_TURN_ID` e `CLOUDFLARE_TURN_TOKEN` (painel da Cloudflare → Realtime → TURN Server) |
| **Open Relay** (Metered) | 20 GB | `METERED_CHAVE` |
| Qualquer outro TURN | — | `TURN_URL`, `TURN_USUARIO` e `TURN_SENHA` |
