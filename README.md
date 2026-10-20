# Poke Run (multiplayer, só para amigos)

Corrida de obstáculos no navegador, até 16 jogadores por sala. Cada pessoa escolhe um bichinho e clica **PLAY**;
vagas vazias são preenchidas por bots, e quem entra depois (inclusive com a corrida em andamento) toma o lugar de um bot.
Ao fim de cada rodada aparece a tabela de resultados e a próxima fase começa sozinha.

## Rodar no seu PC
```
start.bat            (usa o Node 24 de D:\REA_tools se existir; precisa de Node >= 18)
```
ou `npm install` + `node server.js`, e abra http://localhost:8765. Para testar com amigos na mesma rede, abra `http://SEU-IP:8765`.

Variáveis opcionais: `PORT` (padrão 8765) · `LOBBY_SECONDS` (espera do lobby, padrão 10) · `RESULTS_SECONDS` (tabela, padrão 9) · `MAX_ROOMS` (padrão 30).

## Controles
WASD mover · Espaço pular · Shift/E mergulhar · arrastar o mouse (ou Q/Z) gira a câmera · M volta ao menu · **F** usa o poder · **V** liga/desliga efeitos (bloom).

## Poderes
Caixas coloridas "?" aparecem a cada ~40 m (3 por linha, respawn 15 s). Quem encosta primeiro leva; o sorteio favorece quem está atrás. Poderes ofensivos precisam de alguém à frente.
Língua (troca de lugar com quem está à frente) · Mega pulo · Bota (chuta quem está à frente) · Slime (deixa lento) · Turbo · Escudo (bloqueia 1 golpe) · Banana (armadilha) · Trovão (atordoa quem está perto).
O servidor é dono do inventário e dos efeitos; use `?lowfx` na URL para desligar o bloom.
Depois que você termina, vira espectador: ◀ ▶ (ou A/D, ou clique nas laterais) trocam o alvo.
**Practice (offline)** deixa jogar qualquer uma das 12 fases sozinho (R reinicia, N/B trocam de fase).

## Como funciona (resumo)
- `server.js`: serve os arquivos e as salas por WebSocket (`/ws`). Roda os bots, o relógio da rodada, os pisos que caem e a ordem de chegada.
- `shared/sim.js` + `shared/levels.js`: física, bots e as 12 fases. **O mesmo código roda no navegador e no servidor.**
- `main.js`: cliente (gráficos three.js, entrada, áudio, telas). Cada jogador simula o próprio boneco e envia a posição ~20x/s;
  o servidor devolve um "snapshot" de todos ~20x/s e o navegador interpola.
- Sem contas nem anti-cheat: é para jogar entre amigos.

## Publicar no Railway
1. Crie uma conta em https://railway.com (pode entrar com o GitHub).
2. **Suba o código** de um destes jeitos:
   - **Via GitHub (recomendado):** crie um repositório **privado** no GitHub, rode neste diretório
     `git remote add origin https://github.com/SEU-USUARIO/SEU-REPO.git` e `git push -u origin master`.
     No Railway: *New Project → Deploy from GitHub repo* → escolha o repositório.
   - **Via CLI (sem GitHub):** `npm i -g @railway/cli`, depois `railway login`, `railway init` e `railway up` neste diretório.
3. O Railway detecta Node sozinho (`package.json`) e usa `railway.json` (comando `node server.js`, health check `/health`). Não precisa configurar variáveis.
4. No serviço, abra *Settings → Networking → Generate Domain*. Esse endereço (`https://...up.railway.app`) é o link do jogo — mande para os amigos.
   O WebSocket usa o mesmo endereço (`wss://`) automaticamente.
5. Atualizar o jogo: `git push` (ou `railway up`) e o Railway republica.

Custo: o plano gratuito/trial do Railway tem créditos limitados; um servidor desse tamanho usa pouca CPU/memória, mas fica ligado 24 h. Se quiser economizar, pause o serviço quando não estiver jogando.

## Avisos importantes
- Os personagens (Pokémon) e as texturas/malhas/sons extraídos do Stumble Guys são material protegido. Por isso:
  **mantenha o repositório privado** e compartilhe o link só com amigos. Não divulgue publicamente.
- `evidence/` e `tools/` (engenharia reversa) ficam fora do repositório (`.gitignore`); a documentação está em `EVIDENCIA.md`.

## Salas pagas (valendo prêmio) — pagamento SIMULADO
Tela inicial: **Play free** ou **Play for prize**. Na sala paga entrar é grátis; com pelo menos 2 jogadores o lobby trava e o preço do pacote escolhido
(Starter US$25 / Elite US$50 / Bronze US$100) é **dividido entre todos**. Quando todos pagam, a corrida começa **sem bots**; o 1º a cruzar a linha leva o pacote.
Quem não paga a tempo é removido e os pagamentos são devolvidos (o preço é recalculado). Sem 2 jogadores em 90 s a sala cancela.
Variáveis: `PAID_MIN`, `PAID_WAIT`, `PAID_START`, `PAY_WINDOW`, `PAYMENT_MODE` (só `sim` por enquanto). O histórico (PAY / REFUND / WINNER / SUSPECT) vai para os logs do servidor.
Antitrapaça nas salas pagas: orçamento de avanço por segundo, tempo mínimo de corrida e posição de chegada vinda só de atualizações validadas.
Pendente: pagamento real em Solana (USDC/SOL), compra do pacote no Collector Crypt e envio ao vencedor.
