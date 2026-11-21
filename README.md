# 🔴 Tela ao Vivo

Site para transmitir a tela ao vivo, com **salas e código de entrada**.
Várias pessoas podem transmitir ao mesmo tempo, e quem transmite **envia a imagem uma vez só**: o servidor repassa pra todo mundo.

## Funções

- **Criar sala**: gera um código de 6 caracteres (ex: `G7JFR7`) e um link (`/?sala=G7JFR7`)
- **Senha opcional** na sala (🔒)
- **Entrar com código** (a senha só é pedida se a sala tiver)
- **Várias pessoas transmitindo** ao mesmo tempo (limite por sala configurável)
- **Áudio** da aba/sistema (opcional)
- **Qualidade** ajustável: Economia, Equilibrado ou Fluido
- **Codec**: VP8 (funciona em todo navegador) ou H264 (pode usar a GPU)
- **Ocultar** a tela de alguém (para de receber e não gasta internet)
- **Tela cheia**, **chat** com histórico, **lista de pessoas** com a marca "AO VIVO"
- **Contador de espectadores** pra quem transmite

## Por que gasta pouco processamento

| Onde | O que foi feito |
|---|---|
| Servidor | É um **SFU** (mediasoup): só repassa pacotes, **nunca decodifica nem recodifica** vídeo |
| Quem transmite | Codifica **uma vez só** (sem simulcast), não importa quantos assistam |
| Quem transmite | Se **ninguém está assistindo**, o envio é **pausado** e o navegador para de codificar |
| Quem transmite | `contentHint = "detail"`: prioriza nitidez do texto em vez de fluidez |
| Quem assiste | "Ocultar" pausa o recebimento: não gasta internet nem CPU decodificando |
| Áudio | Opus com DTX: silêncio quase não gasta banda |

## Proteções (pra deixar aberto na internet)

| Proteção | Como |
|---|---|
| Senha da sala | Guardada só como hash (scrypt + sal), comparação em tempo constante |
| Chutar códigos/senhas | 10 erros em 10 minutos bloqueiam o IP por um tempo |
| Criar salas em massa | No máximo 10 salas por minuto por IP, e limite total de salas |
| Gastar a banda do servidor | Limite de telas transmitidas ao mesmo tempo por sala e de pessoas por sala |
| Spam no chat | No máximo 5 mensagens a cada 5 segundos |
| HTML malicioso no chat/nomes | Tudo é exibido como texto (`textContent`) |

## Estrutura

```
server/
├── index.js        # site + API de salas + WebSocket
├── salas.js        # salas, códigos, participantes e sinalização
├── midia.js        # mediasoup (worker, router, transportes)
├── senha.js        # hash e conferência de senha
├── limites.js      # anti-abuso (tentativas por IP)
├── certificado.js  # HTTPS autoassinado automático
└── config.js       # configurações (portas, limites, codecs)
web/
├── index.html, style.css
└── src/            # app.js (telas), midia.js (mediasoup-client), conexao.js (WebSocket)
deploy/
├── tela-ao-vivo.service  # mantém rodando 24h (systemd)
└── Caddyfile             # HTTPS de verdade automático
scripts/dev.js            # modo desenvolvimento
```

---

## Rodando no seu PC

Precisa do **Node.js 20 ou mais novo** (LTS). Confira com `node -v`.

**Windows** (PowerShell):

```powershell
winget install OpenJS.NodeJS.LTS
# feche e abra o terminal de novo (ou reinicie a IDE)
npm install
npm start
```

**Linux**:

```bash
npm install
npm start
```

Abra **`https://localhost:3000`**. Não abra o `index.html` direto pela IDE: o site precisa do servidor Node pra funcionar.

> O certificado é autoassinado, então o navegador avisa na primeira vez: **Avançado → Continuar**.
> HTTPS é obrigatório pro navegador deixar compartilhar a tela.

Outros PCs da mesma rede usam o endereço "Na sua rede" que aparece no terminal. Libere no firewall:
a porta **3000 TCP** e a porta **40000 UDP e TCP**.

Modo desenvolvimento (recompila e reinicia sozinho ao salvar):

```bash
npm run dev
```

---

## Colocando no ar 24h (VPS)

Exemplo numa VPS Linux (Ubuntu) com IP público. Serve qualquer provedor, inclusive os gratuitos como o Oracle Cloud "Always Free".

### 1. Domínio

O Caddy precisa de um domínio (ou subdomínio) apontando pro IP da VPS pra emitir o certificado.
Dá pra usar um subdomínio gratuito de um serviço de DNS dinâmico, ex: DuckDNS.

### 2. Liberar portas

| Porta | Protocolo | Pra quê |
|---|---|---|
| 80 | TCP | Caddy (emitir o certificado) |
| 443 | TCP | Site + WebSocket (via Caddy) |
| 40000 | **UDP** e TCP | Vídeo e áudio (WebRTC) |

A porta 3000 **não** precisa ser aberta: o Node fica escondido atrás do Caddy.

> **Oracle Cloud:** libere as portas em **dois lugares**: na *Security List* da VCN (painel web)
> **e** no firewall do próprio Ubuntu (as imagens da Oracle vêm com regras de `iptables` bloqueando):
> ```bash
> sudo iptables -I INPUT 6 -p tcp -m multiport --dports 80,443,40000 -j ACCEPT
> sudo iptables -I INPUT 6 -p udp --dport 40000 -j ACCEPT
> sudo netfilter-persistent save
> ```

### 3. Instalar Node, Caddy e o projeto

```bash
# Node.js LTS (veja nodejs.org/en/download pro comando da versão atual)
# Caddy: veja caddyserver.com/docs/install (pacote apt oficial)

sudo useradd --system --home /opt/tela-ao-vivo --shell /usr/sbin/nologin tela
sudo git clone https://github.com/rafael26042007-max/tela-ao-vivo /opt/tela-ao-vivo
cd /opt/tela-ao-vivo
sudo npm install
sudo npm run build
sudo cp .env.example .env
```

Edite o `.env` (`sudo nano .env`):

```bash
HTTPS=false
CONFIAR_PROXY=true
IP_ANUNCIADO=SEU.IP.PUBLICO
```

```bash
sudo chown -R tela:tela /opt/tela-ao-vivo
```

### 4. Ligar o Caddy e o serviço

```bash
# Caddy (troque o domínio dentro do arquivo antes)
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo systemctl reload caddy

# Tela ao Vivo rodando 24h
sudo cp deploy/tela-ao-vivo.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now tela-ao-vivo
journalctl -u tela-ao-vivo -f   # ver o log
```

Pronto: `https://seu-dominio` funcionando 24h, religando sozinho se cair ou se a VPS reiniciar.

### Atualizar depois

```bash
cd /opt/tela-ao-vivo
sudo -u tela git pull
sudo -u tela npm install
sudo -u tela npm run build
sudo systemctl restart tela-ao-vivo
```

> Reiniciar o servidor apaga as salas abertas (elas ficam só na memória).

### Banda

O que o servidor mais gasta é **upload**: cada tela é repassada pra cada pessoa que está assistindo.
Ex: 1 tela a 1,5 Mbps para 10 pessoas ≈ 15 Mbps saindo do servidor.
Use `MAX_TRANSMISSOES` e `MAX_PESSOAS` no `.env` pra controlar.
