# 🔴 Tela ao Vivo

Site para transmitir a tela ao vivo, com **salas e código de entrada**, pra até **8 pessoas** por sala.
O vídeo vai **direto de um navegador pro outro (P2P)**: nenhum servidor recebe o vídeo.

🌐 **Site:** https://rafael26042007-max.github.io/tela-ao-vivo/

> Quer a versão com servidor no meio (SFU/mediasoup, pra salas grandes)? Está na branch [`sfu`](../../tree/sfu).

## Funções

- **Criar sala**: código de 6 caracteres (ex: `G7JFR7`) e link de convite (`?sala=G7JFR7`)
- **Senha opcional** na sala (🔒), pedida só quando a sala tem
- **Várias pessoas transmitindo** ao mesmo tempo
- **Áudio** da aba/sistema (opcional)
- **Qualidade**: Economia, Equilibrado ou Fluido
- **Codec**: VP8 (funciona em todo navegador) ou H264 (pode usar a GPU)
- **Ocultar** a tela de alguém: quem transmite **para de enviar** o vídeo pra você
- **Tela cheia**, **som por tela**, **chat** com histórico e **lista de pessoas** com a marca "AO VIVO"
- **Contador de espectadores** pra quem transmite
- **Reconexão automática**: se a conexão com o servidor cair, o vídeo continua e você volta sozinho

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

### Economia de processamento

- Se alguém **oculta** a sua tela, você **para de codificar e enviar** pra essa pessoa
- **Uma camada só** de vídeo, com limite de FPS e bitrate
- `contentHint = "detail"`: o encoder prioriza a nitidez do texto
- O servidor não toca no vídeo

## Proteções

| Proteção | Como |
|---|---|
| Senha da sala | Guardada só como hash (scrypt + sal), comparação em tempo constante |
| Chutar códigos/senhas | 10 erros em 10 min bloqueiam o IP; e 20 senhas erradas em 10 min travam a sala |
| Criar salas em massa | 10 por minuto por IP e limite total de salas |
| Outros sites usando seu servidor | Só as origens em `ORIGENS_PERMITIDAS` podem usar a API e o WebSocket |
| Lotar a sala | Máximo de pessoas e de transmissões por sala |
| Spam no chat | 5 mensagens a cada 5 segundos |
| HTML malicioso | Tudo é exibido como texto (`textContent`) |

## Estrutura

```
server/                 # vai pro Render
├── index.js            # API de salas, WebSocket, CORS, /saude
├── salas.js            # salas, códigos, senha, repasse dos sinais P2P, reconexão
├── senha.js            # hash e conferência de senha
├── limites.js          # anti-abuso
├── certificado.js      # HTTPS autoassinado (só pra testar na rede local)
└── config.js           # configurações
web/                    # vai pro GitHub Pages (não precisa compilar)
├── index.html, style.css
├── config.js           # endereço do servidor
└── src/
    ├── app.js          # telas, botões, chat, pessoas
    ├── p2p.js          # malha WebRTC (perfect negotiation)
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

### Servidor → Render
1. Em [render.com](https://render.com): **New → Blueprint** → escolha este repositório
2. O Render lê o `render.yaml` e cria o serviço `tela-ao-vivo` no plano grátis
3. O endereço do serviço (hoje `https://tela-ao-vivo-27wj.onrender.com`) fica em `web/config.js`: se mudar, atualize lá

### Limites do plano grátis do Render
- Ele **dorme depois de 15 min sem uso** e leva **até ~1 min pra acordar**. O site mostra "Acordando o servidor..." enquanto isso.
- Enquanto alguém está numa sala, o site manda um sinal a cada 4 min pra ele não dormir.
- Quando ele dorme, as salas abertas somem (ficam só na memória).

### Quando a conexão P2P falha
Algumas redes (CGNAT pesado, rede de empresa/faculdade) bloqueiam conexão direta. O site avisa quando isso acontece.
A solução é um servidor **TURN** (configure `TURN_URL`, `TURN_USUARIO` e `TURN_SENHA` no Render).
