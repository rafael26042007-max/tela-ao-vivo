# 🔴 Tela ao Vivo

Site para transmitir a tela ao vivo, com **salas e código de entrada**.
Várias pessoas podem transmitir ao mesmo tempo, e quem transmite **envia a imagem uma vez só**: o servidor repassa pra todo mundo.

## Funções

- **Criar sala**: gera um código de 6 caracteres (ex: `G7JFR7`) e um link pra compartilhar (`/?sala=G7JFR7`)
- **Entrar com código**
- **Várias pessoas transmitindo** ao mesmo tempo, cada tela num cartão
- **Áudio** da aba/sistema (opcional)
- **Qualidade** ajustável: Economia, Equilibrado ou Fluido
- **Codec**: VP8 (funciona em todo navegador) ou H264 (pode usar a GPU)
- **Ocultar** a tela de alguém (para de receber o vídeo e não gasta internet)
- **Tela cheia** (botão ou duplo clique)
- **Chat** da sala, com histórico pra quem entra depois
- **Lista de pessoas**, com a marca "AO VIVO"
- **Contador de espectadores** pra quem transmite

## Por que gasta pouco processamento

| Onde | O que foi feito |
|---|---|
| Servidor | É um **SFU** (mediasoup): só repassa pacotes, **nunca decodifica nem recodifica** vídeo |
| Quem transmite | Codifica **uma vez só** (sem simulcast), não importa quantos assistam |
| Quem transmite | Se **ninguém está assistindo**, o envio é **pausado** automaticamente e o navegador para de codificar |
| Quem transmite | `contentHint = "detail"`: o encoder prioriza nitidez do texto em vez de fluidez |
| Quem transmite | FPS e bitrate limitados (tela parada quase não gera dados) |
| Quem assiste | "Ocultar" pausa o recebimento: não gasta internet nem CPU decodificando |
| Áudio | Opus com DTX: silêncio quase não gasta banda |

## Como funciona

```
 Transmissor A ──(1 envio)──┐
                            ├──► [ servidor SFU ] ──► Espectador 1
 Transmissor B ──(1 envio)──┘                   ──► Espectador 2
                                                ──► ...
```

```
server/
├── index.js        # site + API de salas + WebSocket
├── salas.js        # salas, códigos, participantes e sinalização
├── midia.js        # mediasoup (worker, router, transportes)
├── certificado.js  # HTTPS autoassinado automático
└── config.js       # configurações (portas, limites, codecs)
web/
├── index.html
├── style.css
└── src/
    ├── app.js      # telas, botões, chat, lista de pessoas
    ├── midia.js    # mediasoup-client: transmitir e assistir
    └── conexao.js  # WebSocket com pedido/resposta
```

## Rodando

Precisa de **Node.js 20+** no Linux (o mediasoup baixa um binário pronto; se não achar, compila e aí precisa de `python3`, `make` e `g++`).

```bash
npm install
npm start
```

Abra o endereço que aparece no terminal:

- **Neste PC:** `https://localhost:3000`
- **Outros PCs da rede:** `https://SEU-IP:3000`

> O certificado é autoassinado, então o navegador mostra um aviso na primeira vez.
> Clique em **Avançado → Continuar**. O HTTPS é obrigatório: sem ele, o navegador não deixa compartilhar a tela.

### Portas

| Porta | Protocolo | Pra quê |
|---|---|---|
| 3000 | TCP | Site + WebSocket |
| 40000 | **UDP** e TCP | Vídeo e áudio (WebRTC) |

Se o firewall estiver ativo (ex: `ufw`):

```bash
sudo ufw allow 3000/tcp
sudo ufw allow 40000
```

## Colocando na internet (VPS)

1. Libere as portas `3000/tcp` e `40000` (UDP + TCP) no firewall da VPS
2. Rode com o IP público:
   ```bash
   IP_ANUNCIADO=SEU.IP.PUBLICO npm start
   ```
3. (Recomendado) Use um domínio com certificado de verdade (Let's Encrypt) via `CERT_ARQUIVO` e `CHAVE_ARQUIVO`, pra não aparecer o aviso.

Veja todas as opções em [`.env.example`](.env.example).

## Desenvolvimento

```bash
npm run dev   # recompila o site e reinicia o servidor quando você salva
```
