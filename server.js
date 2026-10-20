// Servidor: serve o jogo (arquivos estáticos) e gerencia as salas multiplayer por WebSocket em /ws.
//
// Modelo (o mais simples possível):
//  - cada jogador simula o PRÓPRIO boneco no navegador e envia a posição ~20x/s ("s");
//  - o servidor roda os BOTS (mesma física de shared/sim.js), o relógio da rodada, os pisos que caem e a ordem de chegada;
//  - a cada ~50 ms o servidor manda um "snap" com todos os corredores; os navegadores interpolam.
//
// Cliente -> servidor:  {t:'join', name, pk} · {t:'s', p:[x,y,z,yaw,vx,vy,vz,flags]} · {t:'fin'} · {t:'ping'}
// Servidor -> cliente:  lobby · round · slot · snap · fin · end · full · pong
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
const SPECIES = ['Pikachu', 'Charmander', 'Bulbasaur', 'Squirtle', 'Jigglypuff', 'Psyduck', 'Eevee', 'Snorlax', 'Meowth', 'Gengar', 'Togepi', 'Piplup', 'Oddish', 'Cubone', 'Poliwag', 'Eevee 2'];   // mesma ordem de ROSTER em pokemon.js
const level7 = JSON.parse(fs.readFileSync(path.join(ROOT, 'levels/level7_moving.json'), 'utf8'));
const LEVELS = makeLevels({ level7 });
const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

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
  constructor() {
    this.id = ++roomSeq; this.slots = Array(SLOTS).fill(null); this.clients = new Set();
    this.recent = []; this.levelIndex = this.pickLevel(); this.phase = 'lobby'; this.lobbyLeft = LOBBY_SECONDS; this.sendAcc = 0;
    this.finishedCount = 0; this.endTimer = 0; this.raceT = 0; this.leftT = 0; this.cd = 0; this.nextLevel = null; this.resultsLeft = 0;
    this.evq = []; this.ibKey = ''; this.trKey = '';
    this.hooks = { apply: (r, fx) => { if (r.human) send(r.human, { t: 'fx', fx }); applyFx(r, fx); }, ev: e => this.evq.push(e) };
    this.buildWorld(); this.last = Date.now(); this.tickN = 0; this.deadKey = '';
    this.timer = setInterval(() => this.tick(), 1000 / 60);
    log(`room ${this.id} created (${LEVELS[this.levelIndex].name})`);
  }
  pickLevel() {
    // online: fora as fases curtas (treino, Moving, Trampoline Towers, Conveyor Chaos); as maratonas (índice >= 12) valem em dobro
    const SHORT = [0, 1, 6, 7];
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
      if (this.phase === 'lobby') this.slots[c.slot] = null;
      else { r.name = SPECIES[r.pk % SPECIES.length]; r.node = nearestNodeAhead(this.world, r); r.vel.x = r.vel.z = 0; this.broadcast({ t: 'slot', i: r.i, name: r.name, pk: r.pk, bot: true }); }
    }
    log(`room ${this.id}: ${c.name} left (${this.humans()} humans)`);
    if (this.humans() === 0) this.destroy(); else if (this.phase === 'lobby') this.sendLobby();
  }
  destroy() { clearInterval(this.timer); rooms.delete(this.id); log(`room ${this.id} closed`); }

  sendLobby() { for (const c of this.clients) send(c, { t: 'lobby', level: this.levelIndex, left: Math.max(0, this.lobbyLeft), you: c.slot, slots: this.slotsInfo() }); }
  sendRound(c) {
    const left = this.phase === 'race' ? Math.max(0, this.leftT) : this.roundTime;
    send(c, { t: 'round', phase: this.phase, level: this.levelIndex, name: this.level.name, you: c.slot, slots: this.slotsInfo(), cd: Math.max(0, this.cd || 0), left,
      mt: this.world.mt, roundTime: this.roundTime, dead: deadTileIndices(this.world), fc: this.finishedCount || 0, ib: this.coolSpots() });
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
    for (let i = 0; i < SLOTS; i++) {
      let r = this.slots[i];
      if (!r || !r.human) { r = createRacer(i); r.human = null; const pk = free.length ? free.pop() : rand(SPECIES.length); r.pk = pk; r.name = SPECIES[pk]; this.slots[i] = r; }
      spawnRacer(r, this.world.spawnFn(i)); r.finTime = null; r.rep = 1; r.itemSent = null;
    }
    this.evq.length = 0; this.ibKey = ''; this.trKey = '';
    this.phase = 'countdown'; this.cd = CFG.countdown; this.finishedCount = 0; this.endTimer = 0; this.raceT = 0; this.leftT = this.roundTime; this.deadKey = '';
    for (const c of this.clients) this.sendRound(c);
    log(`room ${this.id}: round "${this.level.name}" with ${this.humans()} humans + ${SLOTS - this.humans()} bots`);
  }
  finish(r) {
    if (r.finished) return;
    r.finished = true; r.rank = ++this.finishedCount; r.finTime = this.raceT;
    r.qualified = r.rank <= CFG.qualifySlots; r.eliminated = !r.qualified; r.victory = r.qualified;
    this.broadcast({ t: 'fin', i: r.i, rank: r.rank, q: r.qualified ? 1 : 0, tm: r2(this.raceT) });
    if (this.finishedCount >= CFG.qualifySlots && !this.endTimer) this.endTimer = 3;
  }
  endMsg(late) {
    const rows = this.slots.filter(Boolean).sort((a, b) => (b.finished - a.finished) || (a.finished ? a.rank - b.rank : a.pos.z - b.pos.z))
      .map(r => ({ i: r.i, name: r.name, pk: r.pk, bot: !r.human, rank: r.finished ? r.rank : 0, tm: r.finished ? r2(r.finTime) : null }));
    return { t: 'end', rows, next: { name: LEVELS[this.nextLevel].name, in: Math.max(0, Math.ceil(this.resultsLeft)) }, late: !!late };
  }
  endRound() {
    this.phase = 'results'; this.resultsLeft = RESULTS_SECONDS; this.nextLevel = this.pickLevel();
    this.broadcast(this.endMsg(false));
    log(`room ${this.id}: round over (${this.finishedCount} finished); next "${LEVELS[this.nextLevel].name}"`);
  }

  onState(c, p) {
    const r = this.slots[c.slot]; if (!r || r.human !== c || !Array.isArray(p) || p.length < 8) return;
    if (this.phase === 'results' || p.slice(0, 7).some(v => !Number.isFinite(v)) || Math.abs(p[0]) > 2000 || Math.abs(p[2]) > 2000) return;
    r.pos.x = p[0]; r.pos.y = p[1]; r.pos.z = p[2]; r.yaw = p[3]; r.vel.x = p[4]; r.vel.y = p[5]; r.vel.z = p[6]; r.rep = p[7] | 0;
    r.grounded = !!(r.rep & 1);
  }
  onFin(c, p) {
    const r = this.slots[c.slot];
    if (this.phase !== 'race' || !r || r.human !== c || r.finished) return;
    if (Array.isArray(p) && p.length >= 3 && p.every(Number.isFinite)) { r.pos.x = p[0]; r.pos.y = p[1]; r.pos.z = p[2]; }
    if (r.pos.z < this.world.finishZ + 2.5 && r.pos.y > this.world.finishY - 2) this.finish(r);
  }

  tick() {
    const now = Date.now(); const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.tickN++;
    const w = this.world, bots = this.slots.filter(r => r && !r.human), humans = this.slots.filter(r => r && r.human);
    if (this.phase === 'lobby') {
      updateWorld(w, dt, []); for (const h of humans) if (h.grounded) triggerFallUnder(w, h);
      this.lobbyLeft -= dt;
      if (this.tickN % 60 === 0) this.sendLobby();
      if (this.humans() >= SLOTS || this.lobbyLeft <= 0) this.startRound();
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
      if (this.resultsLeft <= 0) this.startRound();
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
  for (const rm of rooms.values()) if (rm.humans() < SLOTS && (!best || rm.humans() > best.humans())) best = rm;
  if (best) return best;
  if (rooms.size >= MAX_ROOMS) return null;
  const rm = new Room(); rooms.set(rm.id, rm); return rm;
}

// ------------------------------------------------------------------ WebSocket
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });
server.on('upgrade', (req, socket, head) => {
  if (req.url.split('?')[0] !== '/ws') { socket.destroy(); return; }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
});
wss.on('connection', ws => {
  const c = { ws, id: ++clientSeq, name: '', pk: 0, room: null, slot: -1 };
  ws.isAlive = true; ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', data => {
    let m; try { m = JSON.parse(data.toString()); } catch { return; }
    if (m.t === 'join' && !c.room) {
      c.name = cleanName(m.name); c.pk = Math.max(0, Math.min(SPECIES.length - 1, m.pk | 0));
      const room = findRoom();
      if (!room || !room.addHuman(c)) { send(c, { t: 'full' }); ws.close(); }
    } else if (m.t === 's' && c.room) c.room.onState(c, m.p);
    else if (m.t === 'fin' && c.room) c.room.onFin(c, m.p);
    else if (m.t === 'use' && c.room) c.room.onUse(c);
    else if (m.t === 'ping') send(c, { t: 'pong' });
  });
  ws.on('close', () => { if (c.room) c.room.removeHuman(c); });
  ws.on('error', () => {});
});
setInterval(() => { for (const ws of wss.clients) { if (!ws.isAlive) { ws.terminate(); continue; } ws.isAlive = false; ws.ping(); } }, 25000);

server.listen(PORT, '0.0.0.0', () => log(`poke-run server on http://localhost:${PORT}  (lobby ${LOBBY_SECONDS}s, results ${RESULTS_SECONDS}s)`));
