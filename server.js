// Servidor: serve o jogo (arquivos estáticos) e gerencia as salas multiplayer por WebSocket em /ws.
//
// Modelo (o mais simples possível):
//  - cada jogador simula o PRÓPRIO boneco no navegador e envia a posição ~20x/s ("s");
//  - o servidor roda os BOTS (mesma física de shared/sim.js), o relógio da rodada, os pisos que caem e a ordem de chegada;
//  - a cada ~50 ms o servidor manda um "snap" com todos os corredores; os navegadores interpolam.
//
// Cliente -> servidor:  {t:'join', name, pk[, paid, pack]} · {t:'s', p:[x,y,z,yaw,vx,vy,vz,flags]} · {t:'fin'} · {t:'use'} · {t:'pay', pay} (sim) · {t:'payreq', wallet} · {t:'paytx', tx} (solana) · {t:'ping'}
// Servidor -> cliente:  lobby · round · slot · gone · snap · fin · end · full · refund · kicked · cancel · closed · paytx · payfail · prize · pong
//
// Salas PAGAS (valendo prêmio): entrar é grátis; com >= PAID_MIN jogadores o lobby trava, o preço do pacote é dividido entre todos (fase 'pay');
// quando todos pagam, a corrida começa SEM bots; o 1º a cruzar a linha leva o pacote. Se alguém não pagar a tempo (ou sair), os pagamentos são
// devolvidos e o lobby reabre sem essa pessoa (o preço muda porque muda a divisão). Nesta versão o pagamento é SIMULADO (PAYMENT_MODE=sim).
// flags: 1 no chão · 2 mergulhando · 4 atordoado · 8 vitória · 16 terminou · 32 classificado · 64 eliminado
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { CFG, createWorld, makeHeadlessAPI, applyLevelToWorld, createRacer, spawnRacer, stepRacer, botInput,
  updateWorld, resetWorldClock, triggerFallUnder, deadTileIndices, nearestNodeAhead,
  finalizeWorld, updateItems, updateTraps, botUseItem, useItem, applyFx, fxBits, tickBuffs } from './shared/sim.js';
import { makeLevels } from './shared/levels.js';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PORT = +process.env.PORT || 8765;
const LOBBY_SECONDS = +process.env.LOBBY_SECONDS || 10;
const RESULTS_SECONDS = +process.env.RESULTS_SECONDS || 9;
const MAX_ROOMS = +process.env.MAX_ROOMS || 30;
const SLOTS = CFG.racers;                       // 16
const PAID_MIN = +process.env.PAID_MIN || 2;          // mínimo de jogadores reais na sala paga
const PAID_WAIT = +process.env.PAID_WAIT || 90;       // espera por PAID_MIN jogadores antes de cancelar a sala
const PAID_START = +process.env.PAID_START || 20;     // com PAID_MIN jogadores: tempo para entrarem mais (preço cai) antes de travar
const PAY_WINDOW = +process.env.PAY_WINDOW || 60;     // tempo para todos pagarem depois de travar
const PAID_GRACE = 10, PAID_RESULTS = 15, MAX_AVG_SPEED = 26;   // fim da corrida após o 1º, tempo na tela de resultado, teto de velocidade média (antitrapaça)
const PAYMENT_MODE = String(process.env.PAYMENT_MODE || 'sim').trim().replace(/^["']+|["']+$/g, '').trim().toLowerCase();
const PACKS = [{ code: 'pokemon_25', usd: 25, label: 'Starter Pack' }, { code: 'pokemon_50', usd: 50, label: 'Elite Pack' }, { code: 'pokemon_100', usd: 100, label: 'Bronze Pack' }];
const shareFor = (pack, n) => Math.ceil(pack.usd * 100 / n) / 100;   // preço do pacote dividido entre os n jogadores (arredonda para cima)
const payOk = m => PAYMENT_MODE === 'sim' && typeof m.pay === 'string' && m.pay.startsWith('SIM:');   // TODO: verificar pagamento real (Solana)
const SPECIES = ['Pikachu', 'Charmander', 'Bulbasaur', 'Squirtle', 'Jigglypuff', 'Psyduck', 'Eevee', 'Snorlax', 'Meowth', 'Gengar', 'Togepi', 'Piplup', 'Oddish', 'Cubone', 'Poliwag', 'Eevee 2'];   // mesma ordem de ROSTER em pokemon.js
const level7 = JSON.parse(fs.readFileSync(path.join(ROOT, 'levels/level7_moving.json'), 'utf8'));
const LEVELS = makeLevels({ level7 });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);
// pagamento real (USDC na Solana) só quando PAYMENT_MODE=solana; padrão: simulado
let SOL = null;
if (PAYMENT_MODE === 'solana') { SOL = await import('./solana.js'); const si = await SOL.init(); log(`SOLANA ${si.network} | house ${si.house} | SOL ${si.sol} USDC ${si.usdc} | gacha ${si.gacha}`); }
const friendlyErr = e => { const m = String(e && e.message || e); return /insufficient|0x1\b/i.test(m) ? 'Not enough USDC in your wallet' : /AccountNotFound|could not find account|InvalidAccountData|0xbc4/i.test(m) ? 'Your wallet has no USDC account yet' : /blockhash|expired/i.test(m) ? 'The payment expired, try again' : m.slice(0, 120); };

// ------------------------------------------------------------------ arquivos estáticos
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.wav': 'audio/wav', '.obj': 'text/plain; charset=utf-8', '.ico': 'image/x-icon' };
const GZ = new Set(['.html', '.js', '.json', '.obj', '.wav']);
const gzCache = new Map();
const PUBLIC_DIRS = ['assets/', 'shared/', 'levels/', 'addons/'];
const PUBLIC_ROOT = new Set(['index.html', 'main.js', 'net.js', 'anim.js', 'env.js', 'pokemon.js', 'fx.js', 'OBJLoader.js', 'three.module.js']);
function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '');
  if (rel === '') rel = 'index.html';
  if (rel === 'health') { res.writeHead(200); return res.end('ok'); }
  if (rel === 'favicon.ico') { res.writeHead(204); return res.end(); }
  if (rel === 'paid/config') { res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }); return res.end(JSON.stringify({ mode: PAYMENT_MODE, network: SOL ? SOL.info().network : null, min: PAID_MIN, wait: PAID_WAIT, start: PAID_START, payWindow: PAY_WINDOW, packs: PACKS })); }
  if (rel.includes('..') || !(PUBLIC_ROOT.has(rel) || PUBLIC_DIRS.some(d => rel.startsWith(d)))) { res.writeHead(404); return res.end('not found'); }
  const file = path.join(ROOT, rel), ext = path.extname(file).toLowerCase();
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
    const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': rel.startsWith('assets/') ? 'public, max-age=86400' : 'no-cache' };
    const wantGz = GZ.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
    if (wantGz) {
      const key = file + ':' + st.mtimeMs; let buf = gzCache.get(key);
      if (!buf) { buf = zlib.gzipSync(fs.readFileSync(file), { level: 6 }); gzCache.set(key, buf); }
      headers['Content-Encoding'] = 'gzip'; headers['Content-Length'] = buf.length; res.writeHead(200, headers); return res.end(buf);
    }
    headers['Content-Length'] = st.size; res.writeHead(200, headers); fs.createReadStream(file).pipe(res);
  });
}
const server = http.createServer(serveStatic);

// ------------------------------------------------------------------ salas
const rooms = new Map();
let roomSeq = 0, clientSeq = 0;
const cleanName = s => String(s || '').replace(/[^\p{L}\p{N} _.!?-]/gu, '').trim().slice(0, 14) || 'Player';
const send = (c, o) => { if (c.ws.readyState === 1) c.ws.send(JSON.stringify(o)); };
const r2 = v => Math.round(v * 100) / 100;
const rand = n => Math.floor(Math.random() * n);

class Room {
  constructor(pack = null) {
    this.pack = pack; this.paid = !!pack; this.waitLeft = PAID_WAIT; this.startLeft = PAID_START; this.payLeft = 0; this.share = 0; this.winner = null; this.dead = false;
    this.id = ++roomSeq; this.slots = Array(SLOTS).fill(null); this.clients = new Set();
    this.recent = []; this.levelIndex = this.pickLevel(); this.phase = 'lobby'; this.lobbyLeft = LOBBY_SECONDS; this.sendAcc = 0;
    this.finishedCount = 0; this.endTimer = 0; this.raceT = 0; this.leftT = 0; this.cd = 0; this.nextLevel = null; this.resultsLeft = 0;
    this.evq = []; this.ibKey = ''; this.trKey = '';
    this.hooks = { apply: (r, fx) => { if (r.human) send(r.human, { t: 'fx', fx }); if (fx.kind === 'tp') r.adv = (r.adv ?? 0) + 45; applyFx(r, fx); }, ev: e => this.evq.push(e) };
    this.buildWorld(); this.last = Date.now(); this.tickN = 0; this.deadKey = '';
    this.timer = setInterval(() => this.tick(), 1000 / 60);
    log(`room ${this.id} created (${LEVELS[this.levelIndex].name})${this.paid ? ' PAID ' + this.pack.code : ''}`);
  }
  pickLevel() {
    // online: fora as fases curtas que não foram esticadas (Moving, Trampoline Towers, Sky Hop); as maratonas (índice >= 12) valem em dobro
    const SHORT = [1, 6, 9];
    const opts = LEVELS.flatMap((_, i) => SHORT.includes(i) ? [] : i >= 12 ? [i, i] : [i]).filter(i => !this.recent.includes(i));
    const i = opts[rand(opts.length)]; this.recent.push(i); if (this.recent.length > 5) this.recent.shift(); return i;
  }
  buildWorld() {
    const lv = LEVELS[this.levelIndex], w = createWorld(); applyLevelToWorld(w, lv); lv.build(makeHeadlessAPI(w)); finalizeWorld(w); resetWorldClock(w);
    this.world = w; this.level = lv; this.roundTime = w.roundTime;
  }
  humans() { return this.slots.filter(r => r && r.human).length; }
  slotsInfo() { return this.slots.filter(Boolean).map(r => ({ i: r.i, name: r.name, pk: r.pk, bot: !r.human, fin: r.finished ? 1 : 0, rank: r.rank, q: r.qualified ? 1 : 0 })); }
  broadcast(o, except) { for (const c of this.clients) if (c !== except) send(c, o); }

  // escolhe o slot para um humano: vaga livre, ou um bot (o mais atrasado, se a corrida já começou)
  takeSlot() {
    const i = this.slots.findIndex(r => !r); if (i >= 0) return i;
    let best = -1;
    this.slots.forEach((r, k) => { if (r && !r.human && !(this.phase === 'race' && r.finished)) { if (best < 0 || r.pos.z > this.slots[best].pos.z) best = k; } });
    return best;
  }
  addHuman(c) {
    const i = this.takeSlot(); if (i < 0) return false;
    const r = createRacer(i); r.human = c; r.name = c.name; r.pk = c.pk; r.rep = 1; r.finTime = null;
    spawnRacer(r, this.world.spawnFn(i)); this.slots[i] = r; c.slot = i; c.room = this; this.clients.add(c);
    log(`room ${this.id}: ${c.name} joined slot ${i} (${this.humans()} humans, ${this.phase})`);
    if (this.phase === 'lobby') this.sendLobby();
    else {
      this.broadcast({ t: 'slot', i, name: r.name, pk: r.pk, bot: false }, c);
      if (this.phase === 'results') send(c, this.endMsg(true)); else this.sendRound(c);
    }
    return true;
  }
  removeHuman(c) {
    const r = this.slots[c.slot]; this.clients.delete(c);
    if (r && r.human === c) {
      r.human = null;
      if (this.phase === 'lobby' || this.phase === 'pay') this.slots[c.slot] = null;
      else if (this.paid) { this.slots[c.slot] = null; this.broadcast({ t: 'gone', i: c.slot }); log(`room ${this.id}: ${c.name} left the paid race (forfeit)`); }
      else { r.name = SPECIES[r.pk % SPECIES.length]; r.node = nearestNodeAhead(this.world, r); r.vel.x = r.vel.z = 0; this.broadcast({ t: 'slot', i: r.i, name: r.name, pk: r.pk, bot: true }); }
    }
    log(`room ${this.id}: ${c.name} left (${this.humans()} humans)`);
    if (this.paid && this.phase === 'pay' && c.paid) this.refundClient(c, 'You left the lobby');
    if (this.humans() === 0) this.destroy();
    else if (this.paid && this.phase === 'pay') this.relock(`${c.name} left`);
    else if (this.phase === 'lobby') this.sendLobby();
    else if (this.paid && this.phase === 'race' && this.winner && this.slots.every(x => !x || !x.human || x.finished)) this.endTimer = 0.5;
  }
  destroy() { if (this.dead) return; this.dead = true; clearInterval(this.timer); rooms.delete(this.id); log(`room ${this.id} closed`); }

  // ---- sala paga: travar lobby, cobrar, devolver
  lockPay() {
    const n = this.humans(); this.phase = 'pay'; this.share = shareFor(this.pack, n); this.payLeft = PAY_WINDOW;
    for (const c of this.clients) { c.paid = false; c.payExp = null; c.submitting = false; }
    log(`room ${this.id}: LOCK ${n} players, ${this.pack.code} $${this.pack.usd} -> $${this.share} each`);
    this.sendLobby();
  }
  onPay(c, m) {   // pagamento SIMULADO
    if (!this.paid || PAYMENT_MODE !== 'sim' || this.phase !== 'pay' || c.paid || !payOk(m)) return;
    c.paid = true; c.payRef = String(m.pay).slice(0, 64); c.amount = this.share;
    log(`PAY room ${this.id}: ${c.name} paid $${this.share} (${PAYMENT_MODE}) ref ${c.payRef}`);
    this.afterPay();
  }
  afterPay() { if ([...this.clients].every(x => x.paid)) { log(`room ${this.id}: all paid, starting`); this.startRound(); } else this.sendLobby(); }
  onPayReq(c, m) {   // SOLANA: monta a transação para o jogador assinar
    if (!this.paid || PAYMENT_MODE !== 'solana' || this.phase !== 'pay' || c.paid || c.submitting || !/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(m.wallet || ''))) return;
    c.wallet = String(m.wallet); const share = this.share;
    SOL.buildPayTx(c.wallet, share, `PR:${this.id}:${c.id}`).then(b => {
      if (this.dead || this.phase !== 'pay' || this.share !== share) return;
      c.payExp = { message: b.message, blockhash: b.blockhash, lastValidBlockHeight: b.lastValidBlockHeight, payer: c.wallet, share };
      send(c, { t: 'paytx', tx: b.tx, amount: share });
    }).catch(e => { log(`room ${this.id}: payreq failed for ${c.name}: ${e.message}`); send(c, { t: 'payfail', reason: friendlyErr(e) }); });
  }
  onPayTx(c, m) {   // SOLANA: recebe a transação assinada, confere e envia
    if (!this.paid || PAYMENT_MODE !== 'solana' || this.phase !== 'pay' || c.paid || c.submitting || !c.payExp || typeof m.tx !== 'string' || m.tx.length > 4000) return;
    c.submitting = true; const exp = c.payExp;
    SOL.submitPayTx(m.tx, exp).then(sig => {
      c.submitting = false; c.payExp = null;
      if (this.dead || this.phase !== 'pay' || c.room !== this || this.share !== exp.share) {   // o dinheiro já saiu, mas a sala mudou: devolve
        log(`room ${this.id}: LATE PAY from ${c.name} ${exp.payer} $${exp.share} sig ${sig} - refunding`); c.amount = exp.share; this.refundClient(c, 'The lobby changed while you were paying', exp.payer); return;
      }
      c.paid = true; c.payRef = sig; c.amount = exp.share;
      log(`PAY room ${this.id}: ${c.name} ${exp.payer} paid $${exp.share} (solana) sig ${sig}`);
      this.afterPay();
    }).catch(e => { c.submitting = false; c.payExp = null; log(`room ${this.id}: pay failed for ${c.name}: ${e.message}`); send(c, { t: 'payfail', reason: friendlyErr(e) }); });
  }
  refundClient(c, reason, wallet) {   // devolve o que o jogador pagou (simulado: só registra)
    const amount = c.amount, to = wallet || c.wallet; c.paid = false;
    if (PAYMENT_MODE === 'solana' && to) {
      SOL.refund(to, amount, `PR-refund:${this.id}:${c.id}`).then(sig => { log(`REFUND room ${this.id}: ${c.name} $${amount} -> ${to} sig ${sig} - ${reason}`); send(c, { t: 'refund', amount, reason, sig }); })
        .catch(e => log(`REFUND FAILED room ${this.id}: ${c.name} ${to} $${amount} - ${e.message}  (devolver manualmente!)`));
    } else { send(c, { t: 'refund', amount, reason }); log(`REFUND room ${this.id}: ${c.name} $${amount} (${PAYMENT_MODE}) - ${reason}`); }
  }
  relock(reason) {   // devolve o que já foi pago e reabre o lobby (o preço precisa ser recalculado)
    for (const c of this.clients) { c.payExp = null; if (c.paid) this.refundClient(c, reason); }
    this.phase = 'lobby'; this.startLeft = Math.min(PAID_START, 10); this.waitLeft = PAID_WAIT; this.payLeft = 0;
    this.sendLobby();
  }
  payTimeout() {
    for (const c of [...this.clients]) if (!c.paid) {
      log(`room ${this.id}: ${c.name} did not pay in time - removed`);
      this.slots[c.slot] = null; this.clients.delete(c); c.room = null; send(c, { t: 'kicked', reason: 'You did not pay in time' }); setTimeout(() => { try { c.ws.close(); } catch { /* ignore */ } }, 300);
    }
    if (this.humans() === 0) this.destroy(); else this.relock('Someone did not pay in time');
  }
  awardPrize() {
    const w = this.winner, pack = this.pack;
    if (PAYMENT_MODE !== 'solana' || !w || !w.wallet) { log(`PRIZE room ${this.id}: manual delivery needed (${PAYMENT_MODE}) winner ${w && w.name} pack ${pack.code}`); return; }
    this.prizePending = true; this.broadcast({ t: 'prize', status: 'buying', pack, winner: w.i });
    log(`PRIZE room ${this.id}: buying ${pack.code} for ${w.name} ${w.wallet}`);
    SOL.buyPack(pack.code, pack.usd, w.wallet).then(r => {
      log(`PRIZE OK room ${this.id}: ${w.name} got "${r.name}" (${r.rarity}, insured $${r.insured}) nft ${r.nft} delivered=${r.delivered} memo ${r.memo}`);
      this.broadcast({ t: 'prize', status: 'done', winner: w.i, name: r.name, rarity: r.rarity, insured: r.insured, image: r.image, nft: r.nft, delivered: r.delivered });
    }).catch(e => {
      log(`PRIZE FAILED room ${this.id}: winner ${w.name} ${w.wallet} pack ${pack.code} - ${e.message}  (entregar manualmente!)`);
      this.broadcast({ t: 'prize', status: 'failed', winner: w.i });
    }).finally(() => { this.prizePending = false; this.resultsLeft = Math.max(this.resultsLeft, 12); });
  }
  cancelPaid() {
    log(`room ${this.id}: cancelled (not enough players)`);
    this.broadcast({ t: 'cancel', reason: 'Not enough players joined' });
    for (const c of [...this.clients]) { c.room = null; setTimeout(() => { try { c.ws.close(); } catch { /* ignore */ } }, 300); }
    this.destroy();
  }
  closePaid() {
    this.broadcast({ t: 'closed' });
    for (const c of [...this.clients]) { c.room = null; setTimeout(() => { try { c.ws.close(); } catch { /* ignore */ } }, 300); }
    this.destroy();
  }

  sendLobby() {
    const n = this.humans();
    for (const c of this.clients) {
      const m = { t: 'lobby', level: this.levelIndex, left: Math.max(0, this.lobbyLeft), you: c.slot, slots: this.slotsInfo() };
      if (this.paid) {
        const stage = this.phase === 'pay' ? 'pay' : n >= PAID_MIN ? 'lock' : 'wait';
        m.paid = { stage, mode: PAYMENT_MODE, pack: this.pack, min: PAID_MIN, n, est: n >= PAID_MIN ? shareFor(this.pack, n) : null, share: this.share, paidCount: [...this.clients].filter(x => x.paid).length, youPaid: !!c.paid };
        m.left = Math.max(0, stage === 'pay' ? this.payLeft : stage === 'lock' ? this.startLeft : this.waitLeft);
      }
      send(c, m);
    }
  }
  sendRound(c) {
    const left = this.phase === 'race' ? Math.max(0, this.leftT) : this.roundTime;
    send(c, { t: 'round', phase: this.phase, level: this.levelIndex, name: this.level.name, you: c.slot, slots: this.slotsInfo(), cd: Math.max(0, this.cd || 0), left,
      mt: this.world.mt, roundTime: this.roundTime, dead: deadTileIndices(this.world), fc: this.finishedCount || 0, ib: this.coolSpots(), paid: this.paid ? { pack: this.pack, share: this.share, n: this.starters } : undefined });
  }

  coolSpots() { const o = []; this.world.itemSpots.forEach((sp, k) => { if (sp.cool > 0) o.push(k); }); return o; }
  onUse(c) {
    const r = this.slots[c.slot];
    if (this.phase !== 'race' || !r || r.human !== c || r.finished || !r.item) return;
    useItem(this.world, this.slots.filter(Boolean), r, this.hooks);
  }

  startRound() {
    if (this.phase === 'results' && this.nextLevel != null) this.levelIndex = this.nextLevel;
    this.nextLevel = null; this.buildWorld();
    const used = new Set(this.slots.filter(r => r && r.human).map(r => r.pk));
    const free = SPECIES.map((_, k) => k).filter(k => !used.has(k)); for (let k = free.length - 1; k > 0; k--) { const j = rand(k + 1); [free[k], free[j]] = [free[j], free[k]]; }
    if (this.paid) { this.starters = this.humans(); this.winner = null; for (const h of this.slots) if (h && h.human) { h.adv = 120; h.lastStateT = 0; h.sus = 0; h.wallet = h.human.wallet || ''; h.payRef = h.human.payRef; } }
    for (let i = 0; i < SLOTS; i++) {
      let r = this.slots[i];
      if (this.paid && (!r || !r.human)) { this.slots[i] = null; continue; }
      if (!r || !r.human) { r = createRacer(i); r.human = null; const pk = free.length ? free.pop() : rand(SPECIES.length); r.pk = pk; r.name = SPECIES[pk]; this.slots[i] = r; }
      spawnRacer(r, this.world.spawnFn(i)); r.finTime = null; r.rep = 1; r.itemSent = null;
    }
    this.evq.length = 0; this.ibKey = ''; this.trKey = '';
    this.phase = 'countdown'; this.cd = CFG.countdown; this.finishedCount = 0; this.endTimer = 0; this.raceT = 0; this.leftT = this.roundTime; this.deadKey = '';
    for (const c of this.clients) this.sendRound(c);
    log(`room ${this.id}: round "${this.level.name}" with ${this.humans()} humans + ${this.paid ? 0 : SLOTS - this.humans()} bots${this.paid ? ' (PAID, no bots)' : ''}`);
  }
  finish(r) {
    if (r.finished) return;
    r.finished = true; r.rank = ++this.finishedCount; r.finTime = this.raceT;
    if (this.paid) { r.qualified = true; r.eliminated = false; r.victory = r.rank === 1; }
    else { r.qualified = r.rank <= CFG.qualifySlots; r.eliminated = !r.qualified; r.victory = r.qualified; }
    this.broadcast({ t: 'fin', i: r.i, rank: r.rank, q: r.qualified ? 1 : 0, tm: r2(this.raceT) });
    if (this.paid) {
      if (r.rank === 1) { this.winner = r; this.endTimer = PAID_GRACE; log(`room ${this.id}: WINNER ${r.name} in ${r2(this.raceT)}s`); }
      if (this.slots.every(x => !x || !x.human || x.finished)) this.endTimer = 0.5;
    } else if (this.finishedCount >= CFG.qualifySlots && !this.endTimer) this.endTimer = 3;
  }
  endMsg(late) {
    const rows = this.slots.filter(Boolean).sort((a, b) => (b.finished - a.finished) || (a.finished ? a.rank - b.rank : a.pos.z - b.pos.z))
      .map(r => ({ i: r.i, name: r.name, pk: r.pk, bot: !r.human, rank: r.finished ? r.rank : 0, tm: r.finished ? r2(r.finTime) : null }));
    if (this.paid) return { t: 'end', rows, next: null, late: !!late, paid: { winner: this.winner ? { i: this.winner.i, name: this.winner.name } : null, pack: this.pack, share: this.share, n: this.starters, left: Math.max(0, Math.ceil(this.resultsLeft)) } };
    return { t: 'end', rows, next: { name: LEVELS[this.nextLevel].name, in: Math.max(0, Math.ceil(this.resultsLeft)) }, late: !!late };
  }
  endRound() {
    this.phase = 'results'; this.resultsLeft = this.paid ? PAID_RESULTS : RESULTS_SECONDS; this.nextLevel = this.paid ? null : this.pickLevel();
    if (this.paid) {
      const w = this.winner;
      if (w) log(`PAID RESULT room ${this.id}: winner "${w.name}" (ref ${w.human ? w.human.payRef : '-'}) gets ${this.pack.code} - pool ${this.starters} x $${this.share}`);
      else { log(`PAID RESULT room ${this.id}: nobody finished - REFUND all`); for (const c of this.clients) this.refundClient(c, 'Nobody finished the race'); }
      if (w) this.awardPrize();
    }
    this.broadcast(this.endMsg(false));
    log(`room ${this.id}: round over (${this.finishedCount} finished)${this.paid ? '' : `; next "${LEVELS[this.nextLevel].name}"`}`);
  }

  onState(c, p) {
    const r = this.slots[c.slot]; if (!r || r.human !== c || !Array.isArray(p) || p.length < 8) return;
    if (this.phase === 'results' || p.slice(0, 7).some(v => !Number.isFinite(v)) || Math.abs(p[0]) > 2000 || Math.abs(p[2]) > 2000) return;
    if (this.paid && this.phase === 'race') {   // antitrapaça: quanto o jogador pode AVANÇAR é limitado pelo tempo (60 m/s) + créditos de troca de lugar
      const nowMs = Date.now(), dtS = r.lastStateT ? Math.min(2, (nowMs - r.lastStateT) / 1000) : 0; r.lastStateT = nowMs;
      r.adv = Math.min(120, (r.adv ?? 120) + dtS * 60);
      const dz = r.pos.z - p[2];
      if (dz > 0) {
        if (dz > r.adv) { r.sus = (r.sus || 0) + 1; if (r.sus === 1 || r.sus % 50 === 0) log(`room ${this.id}: SUSPECT ${c.name} jumped ${dz.toFixed(0)}m with budget ${r.adv.toFixed(0)}m (x${r.sus})`); return; }
        r.adv -= dz;
      }
    }
    r.pos.x = p[0]; r.pos.y = p[1]; r.pos.z = p[2]; r.yaw = p[3]; r.vel.x = p[4]; r.vel.y = p[5]; r.vel.z = p[6]; r.rep = p[7] | 0;
    r.grounded = !!(r.rep & 1);
  }
  onFin(c, p) {
    const r = this.slots[c.slot];
    if (this.phase !== 'race' || !r || r.human !== c || r.finished) return;
    if (!this.paid && Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite)) { r.pos.x = p[0]; r.pos.y = p[1]; r.pos.z = p[2]; }
    if (this.paid && this.raceT < Math.abs(this.world.finishZ) / MAX_AVG_SPEED) { log(`room ${this.id}: SUSPECT ${c.name} finish too fast (${r2(this.raceT)}s)`); return; }
    if (r.pos.z < this.world.finishZ + (this.paid ? 12 : 2.5) && r.pos.y > this.world.finishY - 2) this.finish(r);
  }

  tick() {
    const now = Date.now(); const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.tickN++;
    const w = this.world, bots = this.slots.filter(r => r && !r.human), humans = this.slots.filter(r => r && r.human);
    if (this.phase === 'lobby' || this.phase === 'pay') {
      updateWorld(w, dt, []); for (const h of humans) if (h.grounded) triggerFallUnder(w, h);
      if (this.tickN % 60 === 0) this.sendLobby();
      if (!this.paid) { this.lobbyLeft -= dt; if (this.humans() >= SLOTS || this.lobbyLeft <= 0) this.startRound(); }
      else if (this.phase === 'pay') { this.payLeft -= dt; if (this.payLeft <= 0) this.payTimeout(); }
      else {
        const n = this.humans();
        if (n >= PAID_MIN) this.startLeft -= dt; else { this.startLeft = PAID_START; this.waitLeft -= dt; }
        if (n >= SLOTS || (n >= PAID_MIN && this.startLeft <= 0)) this.lockPay();
        else if (n < PAID_MIN && this.waitLeft <= 0) this.cancelPaid();
      }
    } else if (this.phase === 'countdown' || this.phase === 'race') {
      updateWorld(w, dt, bots); for (const h of humans) if (h.grounded) triggerFallUnder(w, h);
      if (this.phase === 'countdown') { this.cd -= dt; if (this.cd <= 0) this.phase = 'race'; }
      else {
        this.raceT += dt; this.leftT -= dt;
        if (this.endTimer > 0) { this.endTimer -= dt; if (this.endTimer <= 0) this.endRound(); }
        if (this.phase === 'race' && this.leftT <= 0) this.endRound();
      }
      const racing = this.phase === 'race', ns = now / 1000, all = this.slots.filter(Boolean);
      if (racing) { updateItems(w, all, dt, ns, this.hooks.ev); updateTraps(w, all, dt, this.hooks); for (const r of bots) botUseItem(w, all, r, ns, this.hooks); for (const h of humans) { tickBuffs(h, dt); if (h.item !== h.itemSent) { send(h.human, { t: 'inv', item: h.item }); h.itemSent = h.item; } } }
      for (const r of bots) {
        let inp = { wx: 0, wz: 0, jump: false, dive: false };
        if (racing && !r.finished && this.raceT > r.startDelay) { const b = botInput(w, r, ns, true); inp = { wx: b[0], wz: b[1], jump: b[2], dive: b[3] }; }
        stepRacer(w, r, dt / 2, inp); stepRacer(w, r, dt / 2, inp);
        if (racing && !r.finished && r.pos.z < w.finishZ && r.pos.y > w.finishY) this.finish(r);
      }
    } else if (this.phase === 'results') {
      updateWorld(w, dt, []); this.resultsLeft -= dt;
      if (this.resultsLeft <= 0) { if (this.paid) { if (!this.prizePending) this.closePaid(); } else this.startRound(); }
    }
    this.sendAcc += dt;
    if (this.sendAcc >= 0.05) { this.sendAcc = 0; this.snapshot(); }
  }
  snapshot() {
    const w = this.world, list = [];
    for (const r of this.slots) {
      if (!r) continue;
      const fl = r.human ? (r.rep & 15) : ((r.grounded ? 1 : 0) | (r.dive > 0 ? 2 : 0) | (r.stun > 0 ? 4 : 0));
      list.push([r.i, r2(r.pos.x), r2(r.pos.y), r2(r.pos.z), r2(r.yaw), r2(r.vel.x), r2(r.vel.y), r2(r.vel.z), fl | (r.victory ? 8 : 0) | (r.finished ? 16 : 0) | (r.qualified ? 32 : 0) | (r.eliminated ? 64 : 0), fxBits(r)]);
    }
    const dead = deadTileIndices(w), key = dead.join(',');
    const m = { t: 'snap', ph: this.phase, mt: r2(w.mt), r: list, fc: this.finishedCount || 0 };
    if (this.phase === 'race') m.left = r2(Math.max(0, this.leftT));
    if (this.phase === 'countdown') m.cd = r2(Math.max(0, this.cd));
    if (key !== this.deadKey || this.tickN % 100 === 0) { m.dead = dead; this.deadKey = key; }
    const ib = this.coolSpots(), ibk = ib.join(','); if (ibk !== this.ibKey || this.tickN % 100 === 0) { m.ib = ib; this.ibKey = ibk; }
    const trk = w.traps.map(t => t.id).join(','); if (trk !== this.trKey || this.tickN % 100 === 0) { m.tr = w.traps.map(t => [t.id, r2(t.x), r2(t.y), r2(t.z)]); this.trKey = trk; }
    if (this.evq.length) { m.ev = this.evq.splice(0, 30); }
    const s = JSON.stringify(m);
    for (const c of this.clients) if (c.ws.readyState === 1) c.ws.send(s);
  }
}

function findRoom() {
  let best = null;
  for (const rm of rooms.values()) if (!rm.paid && rm.humans() < SLOTS && (!best || rm.humans() > best.humans())) best = rm;
  if (best) return best;
  if (rooms.size >= MAX_ROOMS) return null;
  const rm = new Room(); rooms.set(rm.id, rm); return rm;
}

function findPaidRoom(pack) {
  let best = null;
  for (const rm of rooms.values()) if (rm.paid && rm.pack.code === pack.code && rm.phase === 'lobby' && rm.humans() < SLOTS && (!best || rm.humans() > best.humans())) best = rm;
  if (best) return best;
  if (rooms.size >= MAX_ROOMS) return null;
  const rm = new Room(pack); rooms.set(rm.id, rm); return rm;
}

// ------------------------------------------------------------------ WebSocket
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', (req, socket, head) => {
  if (req.url.split('?')[0] !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  const c = { ws, id: ++clientSeq, name: '', pk: 0, room: null, slot: -1, paid: false, payRef: '', amount: 0, wallet: '', submitting: false, payExp: null };
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.t === 'join' && !c.room) {
      c.name = cleanName(m.name); c.pk = Math.max(0, Math.min(SPECIES.length - 1, m.pk | 0));
      const pack = m.paid ? (PACKS.find(p => p.code === m.pack) || PACKS[0]) : null;
      const room = pack ? findPaidRoom(pack) : findRoom();
      if (!room || !room.addHuman(c)) { send(c, { t: 'full' }); ws.close(); }
    } else if (m.t === 's' && c.room) c.room.onState(c, m.p);
    else if (m.t === 'fin' && c.room) c.room.onFin(c, m.p);
    else if (m.t === 'use' && c.room) c.room.onUse(c);
    else if (m.t === 'pay' && c.room) c.room.onPay(c, m);
    else if (m.t === 'payreq' && c.room) c.room.onPayReq(c, m);
    else if (m.t === 'paytx' && c.room) c.room.onPayTx(c, m);
    else if (m.t === 'ping') send(c, { t: 'pong' });
  });
  ws.on('close', () => { if (c.room) c.room.removeHuman(c); });
  ws.on('error', () => {});
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 25000);

server.listen(PORT, '0.0.0.0', () => log(`poke-run server on http://localhost:${PORT}  (lobby ${LOBBY_SECONDS}s, results ${RESULTS_SECONDS}s)`));
