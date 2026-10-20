// Simulação pura (sem three.js e sem DOM): usada pelo navegador E pelo servidor Node.
// Contém: constantes, "mundo" da fase (caixas, martelos, bumpers, plataformas móveis...), física do corredor e IA dos bots.
// Tudo aqui usa objetos simples {x,y,z} para rodar igual nos dois lados.

export const CFG = {
  racers: 16, qualifySlots: 8, roundTime: 120, countdown: 3,
  speed: 9.6, accelGround: 80, accelAir: 20, gravity: -30, jump: 13,            // mais rápido e mais ágil (valores nossos)
  diveSpeed: 17, diveUp: 4.5, diveLock: 0.65, diveRecover: 0.3,
  hw: 0.4, height: 1.6, fallY: -15, seaY: -9.5,
  hammerKnock: 7.5, hammerUp: 6.5, stunTime: 0.7, bumperPush: 15, bumperUp: 6,
  moverSpeed: 2.8, iceGrip: 0.14,
};

export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const defaultSpawn = i => ({ x: (i % 4 - 1.5) * 3, y: 0.05, z: 3 - Math.floor(i / 4) * 2.2 });

// ------------------------------------------------------------------ mundo
export function createWorld() {
  return {
    boxes: [], nodes: [], checkpoints: [], spinners: [], bumpers: [], movers: [], itemSpots: [], traps: [], trapSeq: 0,
    finishZ: 0, finishY: -0.5, conveyorZone: null, lanes: false, mt: 0, roundTime: 120,
    spawnFn: defaultSpawn, serverTiles: false, onEvent: null,
  };
}
export function clearWorld(w) {
  w.boxes.length = w.nodes.length = w.checkpoints.length = w.spinners.length = w.bumpers.length = w.movers.length = 0;
  w.itemSpots.length = 0; w.traps.length = 0; w.trapSeq = 0;
  w.finishZ = 0; w.finishY = -0.5; w.conveyorZone = null; w.mt = 0;
}

// registros de geometria (o cliente adiciona malhas por cima destes objetos)
export function recBox(w, x0, x1, y0, y1, z0, z1, extra = {}) {
  const b = { min: { x: x0, y: y0, z: z0 }, max: { x: x1, y: y1, z: z1 }, ...extra };
  b.home = { min: { ...b.min }, max: { ...b.max } };
  w.boxes.push(b); return b;
}
export function recSpinner(w, cx, cy, cz, L, speed) { const s = { cx, cy, cz, L, speed, ang: 0 }; w.spinners.push(s); return s; }
export function recBumper(w, x, z, topY = 0) { const b = { x, z, r: 1.2, y: topY, squash: 0 }; w.bumpers.push(b); return b; }
export function recCheckpoint(w, x, y, z, respawnY = y + 0.2) { const c = { z, pos: { x, y: respawnY, z }, floorY: y }; w.checkpoints.push(c); return c; }
export function recNode(w, x, z, y = 0) { w.nodes.push({ x, z, y }); }
export function registerMover(w, box, aArr, bArr, size, speed, phase) {
  const a = vec(...aArr), b = vec(...bArr);
  const m = { box, a, b, len: Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), size: vec(...size), phase, speed, cur: { ...a } };
  w.movers.push(m); return m;
}

// API "headless" (sem malhas): o servidor constrói as fases com ela. O cliente tem uma API equivalente com malhas.
export function makeHeadlessAPI(w) {
  const box = (x0, x1, y0, y1, z0, z1, theme, extra) => recBox(w, x0, x1, y0, y1, z0, z1, extra);
  const platform = (cx, topY, z0, z1, width, theme, extra) => recBox(w, cx - width / 2, cx + width / 2, topY - 1, topY, z0, z1, extra);
  const A = {
    vec, world: w, platform, box,
    mover({ a, b, size, speed = CFG.moverSpeed, phase = 0 }) {
      const [sx, sy, sz] = size;
      const bx = recBox(w, a[0] - sx / 2, a[0] + sx / 2, a[1] - sy / 2, a[1] + sy / 2, a[2] - sz / 2, a[2] + sz / 2, { mover: true });
      registerMover(w, bx, a, b, size, speed, phase); return bx;
    },
    spinner: (cx, cy, cz, L, speed) => recSpinner(w, cx, cy, cz, L, speed),
    bumper: (x, z, topY) => recBumper(w, x, z, topY),
    trampoline: (cx, z0, z1, width, topY, bounce = 21) => recBox(w, cx - width / 2, cx + width / 2, topY - 1, topY, z0, z1, { bounce, invisible: true }),
    checkpoint: (x, y, z, width, d, respawnY) => recCheckpoint(w, x, y, z, respawnY),
    finish: (x, y, z, width) => { w.finishZ = z; },
    node: (x, z, y) => recNode(w, x, z, y),
    strip() {}, conveyorZone(z) { w.conveyorZone = z; }, setFinishY(y) { w.finishY = y; },
    startPlatform(theme = 'grass', width = 16) { platform(0, 0, -12, 6, width, theme); recNode(w, 0, -8, 0); },
  };
  return A;
}

export function applyLevelToWorld(w, level) {
  w.lanes = !!level.lanes; w.roundTime = level.time || 120; w.spawnFn = level.spawn || defaultSpawn;
}

// ------------------------------------------------------------------ plataformas, martelos, tiles
export function setDead(b, dead) {
  b.dead = dead;
  if (dead) { b.min.x = b.max.x = 0; b.min.y = b.max.y = -1e5; b.min.z = b.max.z = 0; }
  else { Object.assign(b.min, b.home.min); Object.assign(b.max, b.home.max); }
}
export function reviveAll(w) { for (const b of w.boxes) if (b.fall || b.toggle) { setDead(b, false); b.fallT = undefined; b.shake = 0; b.blink = false; } }
export function resetWorldClock(w) { w.mt = 0; w.traps.length = 0; for (const sp of w.itemSpots) sp.cool = 0; for (const s of w.spinners) s.ang = 0; reviveAll(w); updateWorld(w, 0, []); }

function updateDynamics(w, dt) {
  for (const b of w.boxes) {
    if (b.fall && !w.serverTiles) {
      if (b.dead) { b.reviveT -= dt; if (b.reviveT <= 0) { setDead(b, false); b.fallT = undefined; b.shake = 0; } }
      else if (b.fallT !== undefined) {
        b.fallT -= dt; b.shake = Math.sin(w.mt * 70) * 0.04;
        if (b.fallT <= 0) { setDead(b, true); b.reviveT = 4.5; }
      }
    } else if (b.fall && w.serverTiles) {
      // modo cliente online: o servidor decide quais pisos caíram (applyDead); aqui só o tremor local
      b.shake = (b.fallT !== undefined && !b.dead) ? Math.sin(w.mt * 70) * 0.04 : 0;
    }
    if (b.toggle) {
      const u = (w.mt + b.toggle.phase) % b.toggle.period, solid = u < b.toggle.on;
      if (solid && b.dead) setDead(b, false); else if (!solid && !b.dead) setDead(b, true);
      b.blink = !b.dead && u > b.toggle.on - 0.8 && ((w.mt * 12) | 0) % 2 !== 0;
    }
  }
}

// avança o relógio do mundo: martelos (ângulo = velocidade × tempo), plataformas móveis (carregam quem está em cima), pisos que caem/piscam
export function updateWorld(w, dt, racers) {
  w.mt += dt;
  for (const s of w.spinners) s.ang = s.speed * w.mt;
  updateDynamics(w, dt);
  for (const m of w.movers) {
    const ox = m.cur.x, oy = m.cur.y, oz = m.cur.z;
    const u = ((w.mt * (m.speed || CFG.moverSpeed) + m.phase) % (2 * m.len)) / m.len, k = u > 1 ? 2 - u : u;
    m.cur.x = m.a.x + (m.b.x - m.a.x) * k; m.cur.y = m.a.y + (m.b.y - m.a.y) * k; m.cur.z = m.a.z + (m.b.z - m.a.z) * k;
    const hx = m.size.x / 2, hy = m.size.y / 2, hz = m.size.z / 2;
    m.box.min.x = m.cur.x - hx; m.box.min.y = m.cur.y - hy; m.box.min.z = m.cur.z - hz;
    m.box.max.x = m.cur.x + hx; m.box.max.y = m.cur.y + hy; m.box.max.z = m.cur.z + hz;
    if (dt > 0) for (const r of racers) if (r.ground === m.box && r.grounded) { r.pos.x += m.cur.x - ox; r.pos.y += m.cur.y - oy; r.pos.z += m.cur.z - oz; }
  }
}

// o servidor usa isto para humanos: se um humano está em pé num piso que cai, dispara o timer do piso
export function triggerFallUnder(w, r) {
  for (const b of w.boxes) {
    if (!b.fall || b.dead || b.fallT !== undefined) continue;
    if (r.pos.x > b.min.x - 0.2 && r.pos.x < b.max.x + 0.2 && r.pos.z > b.min.z - 0.2 && r.pos.z < b.max.z + 0.2 && Math.abs(r.pos.y - b.max.y) < 0.35) b.fallT = 0.5;
  }
}
export function deadTileIndices(w) { const out = []; w.boxes.forEach((b, i) => { if (b.fall && b.dead) out.push(i); }); return out; }
export function applyDead(w, list) {
  const set = new Set(list);
  w.boxes.forEach((b, i) => { if (b.fall) { const want = set.has(i); if (want !== !!b.dead) { setDead(b, want); if (!want) b.fallT = undefined; } } });
}

// ------------------------------------------------------------------ corredores
export function createRacer(i) {
  return {
    i, pos: vec(), vel: vec(), yaw: Math.PI,
    grounded: false, wasG: false, ground: null,
    stun: 0, invul: 0, dive: 0, recover: 0, stepT: 0, splashed: false,
    cp: null, finished: false, rank: 0, qualified: false, eliminated: false, victory: false,
    node: 0, skill: 0.72 + Math.random() * 0.26, startDelay: Math.random() * 0.5, wobble: Math.random() * 9,
    slowT: 0, strafeUntil: 0, strafeDir: 1,
    item: null, itemCool: 0, useAt: 0, slow: 0, boost: 0, shield: 0,
  };
}
export function spawnRacer(r, p) {
  r.pos.x = p.x; r.pos.y = p.y; r.pos.z = p.z; r.vel.x = r.vel.y = r.vel.z = 0; r.yaw = Math.PI;
  r.stun = r.invul = r.dive = r.recover = 0; r.cp = null; r.node = 0; r.splashed = false; r.slowT = 0; r.strafeUntil = 0;
  r.item = null; r.itemCool = 0; r.useAt = 0; r.slow = r.boost = r.shield = 0;
  r.finished = r.qualified = r.eliminated = false; r.rank = 0; r.ground = null; r.victory = false; r.grounded = false;
}

const emit = (w, name, e, extra) => { if (w.onEvent) w.onEvent(name, e, extra); };

function overlaps(e, b) {
  return e.pos.x + CFG.hw > b.min.x && e.pos.x - CFG.hw < b.max.x &&
         e.pos.z + CFG.hw > b.min.z && e.pos.z - CFG.hw < b.max.z &&
         e.pos.y + CFG.height > b.min.y && e.pos.y < b.max.y;
}
function moveAxis(w, e, axis, d) {
  e.pos[axis] += d;
  for (const b of w.boxes) {
    if (!overlaps(e, b)) continue;
    if (axis === 'y') {
      if (e.vel.y <= 0) {
        e.pos.y = b.max.y; e.grounded = true; e.ground = b;
        e.vel.y = b.bounce ? b.bounce : 0;
        if (b.bounce) { e.grounded = false; b.squash = 0.35; emit(w, 'spring', e); }
      } else { e.pos.y = b.min.y - CFG.height; e.vel.y = 0; }
    } else if (b.max.y - e.pos.y < 0.35 && e.vel.y <= 0.01) {
      e.pos.y = b.max.y;
    } else {
      const left = e.pos[axis] < (b.min[axis] + b.max[axis]) / 2;   // empurra para o lado onde está o centro do corredor
      e.pos[axis] = left ? b.min[axis] - CFG.hw : b.max[axis] + CFG.hw;
      if (left ? e.vel[axis] > 0 : e.vel[axis] < 0) e.vel[axis] = 0;
    }
  }
}
export function segDist(px, pz, ax, az, bx, bz) {
  const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let t = l2 ? ((px - ax) * dx + (pz - az) * dz) / l2 : 0; t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}
function hit(w, e, dx, dz, force, up, kind) {
  const l = Math.hypot(dx, dz) || 1;
  e.vel.x = dx / l * force; e.vel.z = dz / l * force; e.vel.y = up;
  e.stun = CFG.stunTime; e.invul = CFG.stunTime + 0.5; e.dive = 0; e.grounded = false;
  emit(w, 'hit', e, kind);
}

// input = { wx, wz, jump, dive }
export function stepRacer(w, e, dt, inp) {
  const canControl = e.stun <= 0 && e.dive <= 0 && e.recover <= 0;
  if (e.stun > 0) e.stun -= dt;
  if (e.invul > 0) e.invul -= dt;
  if (e.recover > 0) e.recover -= dt;
  if (e.dive > 0) { e.dive -= dt; if (e.dive <= 0) e.recover = CFG.diveRecover; }
  if (e.slow > 0) e.slow -= dt;
  if (e.boost > 0) e.boost -= dt;
  if (e.shield > 0) e.shield -= dt;
  const spd = CFG.speed * (e.boost > 0 ? ITEM_CFG.turboMul : 1) * (e.slow > 0 ? ITEM_CFG.slowMul : 1);
  if (canControl) {
    const onIce = e.grounded && e.ground && e.ground.ice;
    const a = (e.grounded ? CFG.accelGround * (onIce ? CFG.iceGrip : 1) : CFG.accelAir) * dt;
    e.vel.x += Math.max(-a, Math.min(a, inp.wx * spd - e.vel.x));
    e.vel.z += Math.max(-a, Math.min(a, inp.wz * spd - e.vel.z));
    if (inp.jump && e.grounded) { e.vel.y = CFG.jump; e.grounded = false; emit(w, 'jump', e); }
    if (inp.dive) {
      const l = Math.hypot(inp.wx, inp.wz);
      const fx = l > 0.1 ? inp.wx / l : Math.sin(e.yaw), fz = l > 0.1 ? inp.wz / l : Math.cos(e.yaw);
      e.vel.x = fx * CFG.diveSpeed; e.vel.z = fz * CFG.diveSpeed;
      e.vel.y = Math.max(e.vel.y, CFG.diveUp); e.dive = CFG.diveLock; e.grounded = false;
      emit(w, 'dive', e);
    }
  } else if (e.grounded) { const f = Math.max(0, 1 - (e.ground && e.ground.ice ? 0.4 : 4) * dt); e.vel.x *= f; e.vel.z *= f; }
  e.vel.y += CFG.gravity * dt;
  const vyBefore = e.vel.y;
  e.wasG = e.grounded; e.grounded = false; e.ground = null;
  moveAxis(w, e, 'x', e.vel.x * dt);
  moveAxis(w, e, 'z', e.vel.z * dt);
  moveAxis(w, e, 'y', e.vel.y * dt);
  if (e.grounded && !e.wasG && vyBefore < -7) emit(w, 'land', e);
  if (e.grounded && e.ground && e.ground.fall && e.ground.fallT === undefined) e.ground.fallT = 0.5;   // piso que cai: 0,5 s depois de pisado
  if (e.grounded && e.ground && e.ground.conv) { e.pos.x += e.ground.conv.x * dt; e.pos.z += e.ground.conv.z * dt; }
  if (e.grounded && Math.hypot(e.vel.x, e.vel.z) > 3 && e.stun <= 0) {
    e.stepT -= dt; if (e.stepT <= 0) { e.stepT = 0.375; emit(w, 'step', e); }   // 2 passos por ciclo de corrida de 0,75 s
  }
  for (const s of w.spinners) {
    if (e.pos.y > s.cy + 0.4 || e.pos.y + CFG.height < s.cy - 0.4) continue;   // barra baixa: dá para pular por cima
    const ax = s.cx + Math.cos(s.ang) * s.L, az = s.cz + Math.sin(s.ang) * s.L;
    const bx = s.cx - Math.cos(s.ang) * s.L, bz = s.cz - Math.sin(s.ang) * s.L;
    if (segDist(e.pos.x, e.pos.z, ax, az, bx, bz) < 0.7 + CFG.hw && e.invul <= 0) {
      const dir = Math.sign(s.speed);
      hit(w, e, -Math.sin(s.ang) * dir, Math.cos(s.ang) * dir, CFG.hammerKnock, CFG.hammerUp, 'hammer');
    }
  }
  for (const b of w.bumpers) {
    const dx = e.pos.x - b.x, dz = e.pos.z - b.z;
    if (Math.hypot(dx, dz) < b.r + CFG.hw && e.pos.y < b.y + 1.5 && e.pos.y + CFG.height > b.y && e.invul <= 0) { hit(w, e, dx, dz, CFG.bumperPush, CFG.bumperUp, 'bump'); b.squash = 0.25; }
  }
  for (const c of w.checkpoints) if (e.pos.z < c.z && (!e.cp || c.z < e.cp.z) && e.pos.y > c.floorY - 3) e.cp = c;
  if (!e.splashed && e.pos.y < CFG.seaY) { e.splashed = true; emit(w, 'splash', e); }
  if (e.pos.y < CFG.fallY) {
    const p = e.cp ? e.cp.pos : (s => ({ x: s.x, y: s.y + 0.2, z: s.z }))(w.spawnFn(e.i));
    e.pos.x = p.x; e.pos.y = p.y; e.pos.z = p.z; e.vel.x = e.vel.y = e.vel.z = 0;
    e.stun = e.dive = e.recover = 0; e.node = e.cp ? e.node : 0; e.splashed = false;
  }
  if (Math.hypot(e.vel.x, e.vel.z) > 0.8 && e.stun <= 0) e.yaw = Math.atan2(e.vel.x, e.vel.z);
}

// ------------------------------------------------------------------ poderes
// Todos os valores abaixo são NOSSOS (design de jogo), balanceados para ninguém ganhar vantagem grande:
// o sorteio favorece quem está atrás, os poderes ofensivos exigem alvo à frente e o escudo bloqueia um golpe.
export const ITEMS = ['tongue', 'jump', 'boot', 'slime', 'turbo', 'shield', 'banana', 'thunder'];
export const ITEM_CFG = {
  slowT: 3.5, slowMul: 0.5, turboT: 2.4, turboMul: 1.45, shieldT: 6, jumpV: 19, thunderR: 12, thunderStun: 0.9, bananaLife: 30, bananaStun: 1.0,
  tongueRange: 30, bootRange: 15, slimeRange: 28, pickupR: 1.8, respawn: 15, spacing: 40, useCool: 1.2,
};
// pesos por posição (p = 0 líder ... 1 último): quem está atrás recebe mais poderes de ataque/avanço; o líder, defesa e armadilhas
const WEIGHTS = {
  tongue: p => 0.15 + 1.6 * p, boot: p => 0.35 + 1.1 * p, slime: () => 1.0, turbo: p => 0.4 + 1.1 * p,
  jump: p => 0.8 + 0.4 * p, shield: p => 1.5 - 1.1 * p, banana: p => 1.7 - 1.5 * p, thunder: p => 0.5 + 0.7 * p,
};
const floorTopAt = (w, x, z, y) => {
  let best = null;
  for (const b of w.boxes) {
    if (b.mover || b.dead || x < b.min.x || x > b.max.x || z < b.min.z || z > b.max.z) continue;
    if (b.max.y > y - 1.6 && b.max.y < y + 1.2 && (best === null || b.max.y > best)) best = b.max.y;
  }
  return best;
};
// distribui linhas de caixas ao longo do caminho (largura toda), para todos terem chance de pegar
export function finalizeWorld(w) {
  w.itemSpots.length = 0; const n = w.nodes;
  if (n.length < 2) return;
  let total = 0; const seg = [];
  for (let i = 1; i < n.length; i++) { const l = Math.hypot(n[i].x - n[i - 1].x, n[i].z - n[i - 1].z); seg.push(l); total += l; }
  const first = Math.min(34, total * 0.3), last = total - Math.min(30, total * 0.2);
  const spacing = Math.max(18, Math.min(ITEM_CFG.spacing, total / 6));      // fases curtas ganham mais linhas
  for (let s = first; s <= last; s += spacing) {
    let acc = 0, i = 0; while (i < seg.length - 1 && acc + seg[i] < s) { acc += seg[i]; i++; }
    const f = seg[i] ? (s - acc) / seg[i] : 0, x = n[i].x + (n[i + 1].x - n[i].x) * f, z = n[i].z + (n[i + 1].z - n[i].z) * f, y = n[i].y + (n[i + 1].y - n[i].y) * f;
    for (const off of [-3.2, 0, 3.2]) {
      const top = floorTopAt(w, x + off, z, y);
      if (top !== null) w.itemSpots.push({ x: x + off, y: top + 1.25, z, cool: 0 });
    }
  }
}
function rollItem(racers, r) {
  const live = racers.filter(q => !q.finished).sort((a, b) => a.pos.z - b.pos.z), idx = live.indexOf(r);
  const p = live.length > 1 && idx >= 0 ? idx / (live.length - 1) : 0.5;
  const ws = ITEMS.map(k => WEIGHTS[k](p)); let t = Math.random() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ITEMS.length; i++) { t -= ws[i]; if (t <= 0) return ITEMS[i]; }
  return ITEMS[0];
}
export const fxBits = r => (r.slow > 0 ? 1 : 0) | (r.boost > 0 ? 2 : 0) | (r.shield > 0 ? 4 : 0) | (r.item ? 8 : 0);
export const tickBuffs = (r, dt) => { if (r.slow > 0) r.slow -= dt; if (r.boost > 0) r.boost -= dt; if (r.shield > 0) r.shield -= dt; if (r.itemCool > 0) r.itemCool -= dt; };
export function applyFx(r, fx) {
  switch (fx.kind) {
    case 'slow': r.slow = Math.max(r.slow, fx.t); break;
    case 'boost': r.boost = fx.t; break;
    case 'shield': r.shield = fx.t; break;
    case 'stun': r.stun = Math.max(r.stun, fx.t); r.dive = 0; r.vel.x *= 0.3; r.vel.z *= 0.3; break;
    case 'launch': r.vel.x = fx.vx; r.vel.y = fx.vy; r.vel.z = fx.vz; r.stun = 0.9; r.invul = 1.0; r.dive = 0; r.grounded = false; r.ground = null; break;
    case 'jump': r.vel.y = fx.vy; r.grounded = false; r.ground = null; break;
    case 'tp': r.pos.x = fx.x; r.pos.y = fx.y; r.pos.z = fx.z; r.ground = null; break;
  }
}
// pega caixas (quem chega primeiro leva); hooks.ev(evento) avisa a interface
export function updateItems(w, racers, dt, now, ev) {
  w.itemSpots.forEach((sp, k) => {
    if (sp.cool > 0) { sp.cool -= dt; return; }
    let who = null, bd = 1e9;
    for (const r of racers) {
      if (r.item || r.finished || r.itemCool > 0) continue;
      const d = Math.hypot(r.pos.x - sp.x, r.pos.z - sp.z);
      if (d < ITEM_CFG.pickupR && r.pos.y < sp.y + 1.2 && r.pos.y + CFG.height > sp.y - 1.0 && d < bd) { bd = d; who = r; }
    }
    if (who) { who.item = rollItem(racers, who); who.useAt = now + 0.7 + Math.random() * 2.2; sp.cool = ITEM_CFG.respawn; ev({ k: 'pickup', i: who.i, s: k, item: who.item }); }
  });
  for (const r of racers) if (r.itemCool > 0) r.itemCool -= dt;
}
const ahead = (racers, u, maxD, maxLat) => {
  let best = null, bd = 1e9;
  for (const r of racers) {
    if (r === u || r.finished) continue;
    const dz = u.pos.z - r.pos.z; if (dz < 1 || dz > maxD) continue;
    const dx = r.pos.x - u.pos.x; if (Math.abs(dx) > maxLat || Math.abs(r.pos.y - u.pos.y) > 7) continue;
    const d = Math.hypot(dz, dx); if (d < bd) { bd = d; best = r; }
  }
  return best;
};
// usa o item guardado. hooks = { apply(alvo, fx), ev(evento) }. Devolve true se gastou o item.
export function useItem(w, racers, u, hooks) {
  const it = u.item; if (!it || u.finished) return false;
  const { apply, ev } = hooks;
  const hit = (t, fx) => {            // efeitos negativos: o escudo bloqueia
    if (t.shield > 0) { t.shield = 0; ev({ k: 'shieldpop', i: t.i }); return false; }
    apply(t, fx); return true;
  };
  let ok = true;
  switch (it) {
    case 'tongue': {
      const t = ahead(racers, u, ITEM_CFG.tongueRange, 9); if (!t) { ok = false; break; }
      const a = { ...u.pos }, b = { ...t.pos };
      const blocked = !hit(t, { kind: 'tp', x: a.x, y: a.y + 0.1, z: a.z });
      if (!blocked) apply(u, { kind: 'tp', x: b.x, y: b.y + 0.1, z: b.z });
      ev({ k: 'tongue', a: u.i, b: t.i, ax: a.x, ay: a.y, az: a.z, bx: b.x, by: b.y, bz: b.z, blocked });
      break;
    }
    case 'jump': apply(u, { kind: 'jump', vy: ITEM_CFG.jumpV }); ev({ k: 'megajump', i: u.i }); break;
    case 'boot': {
      const t = ahead(racers, u, ITEM_CFG.bootRange, 7); if (!t) { ok = false; break; }
      const side = Math.sign(t.pos.x) || (Math.random() < 0.5 ? -1 : 1);
      const done = hit(t, { kind: 'launch', vx: side * 13, vy: 9, vz: -3 });
      ev({ k: 'boot', a: u.i, b: t.i, blocked: !done });
      break;
    }
    case 'slime': {
      const t = ahead(racers, u, ITEM_CFG.slimeRange, 8); if (!t) { ok = false; break; }
      const done = hit(t, { kind: 'slow', t: ITEM_CFG.slowT });
      ev({ k: 'slime', a: u.i, b: t.i, blocked: !done });
      break;
    }
    case 'turbo': apply(u, { kind: 'boost', t: ITEM_CFG.turboT }); ev({ k: 'turbo', i: u.i }); break;
    case 'shield': apply(u, { kind: 'shield', t: ITEM_CFG.shieldT }); ev({ k: 'shield', i: u.i }); break;
    case 'banana': {
      const tr = { id: ++w.trapSeq, x: u.pos.x, y: u.pos.y, z: u.pos.z + 2.0, owner: u.i, life: ITEM_CFG.bananaLife, age: 0 };
      w.traps.push(tr); if (w.traps.length > 8) w.traps.shift();
      ev({ k: 'banana', i: u.i, id: tr.id, x: tr.x, y: tr.y, z: tr.z });
      break;
    }
    case 'thunder': {
      for (const r of racers) {
        if (r === u || r.finished) continue;
        if (Math.hypot(r.pos.x - u.pos.x, r.pos.z - u.pos.z) < ITEM_CFG.thunderR && Math.abs(r.pos.y - u.pos.y) < 8) hit(r, { kind: 'stun', t: ITEM_CFG.thunderStun });
      }
      ev({ k: 'thunder', i: u.i, x: u.pos.x, y: u.pos.y, z: u.pos.z });
      break;
    }
  }
  if (!ok) { ev({ k: 'fail', i: u.i }); return false; }
  u.item = null; u.itemCool = ITEM_CFG.useCool;
  return true;
}
// armadilhas (casca de banana): quem pisa escorrega
export function updateTraps(w, racers, dt, hooks) {
  for (let k = w.traps.length - 1; k >= 0; k--) {
    const t = w.traps[k]; t.age += dt; t.life -= dt;
    let gone = t.life <= 0;
    if (!gone) for (const r of racers) {
      if (r.finished || (r.i === t.owner && t.age < 1.5)) continue;
      if (Math.hypot(r.pos.x - t.x, r.pos.z - t.z) < 1.15 && Math.abs(r.pos.y - t.y) < 1.4) {
        if (r.shield > 0) { r.shield = 0; hooks.ev({ k: 'shieldpop', i: r.i }); }
        else { hooks.apply(r, { kind: 'launch', vx: r.vel.x * 0.5, vy: 7, vz: r.vel.z * 0.5 }); }
        hooks.ev({ k: 'bananahit', i: r.i, id: t.id }); gone = true; break;
      }
    }
    if (gone) w.traps.splice(k, 1);
  }
}
// IA dos bots para usar poderes
export function botUseItem(w, racers, b, now, hooks) {
  if (!b.item || b.itemCool > 0 || b.finished || now < b.useAt) return;
  let go = true;
  if (b.item === 'banana') go = racers.some(r => r !== b && !r.finished && r.pos.z > b.pos.z && r.pos.z - b.pos.z < 28 && Math.abs(r.pos.x - b.pos.x) < 9);
  if (b.item === 'thunder') go = racers.filter(r => r !== b && !r.finished && Math.hypot(r.pos.x - b.pos.x, r.pos.z - b.pos.z) < ITEM_CFG.thunderR).length >= 2;
  if (b.item === 'jump') go = b.grounded;
  if (!go || !useItem(w, racers, b, hooks)) b.useAt = now + 0.6;
}

// ------------------------------------------------------------------ bots
// now = relógio em segundos (wobble/desvio), racing = a corrida já começou para este bot
export function botInput(w, b, now, racing = true) {
  const nodes = w.nodes, boxes = w.boxes;
  if (!nodes.length) return [0, 0, false, false];
  let n;
  if (w.lanes) {
    // a fase real tem várias trilhas de IA paralelas: segue a mais próxima lateralmente entre os waypoints logo à frente
    let best = null, bs = 1e9;
    for (const q of nodes) {
      const ahead = b.pos.z - q.z;
      if (ahead < 2.5 || ahead > 16) continue;
      const sc = Math.abs(q.x - b.pos.x) + 0.35 * ahead + Math.abs(q.y - b.pos.y) * 0.5;
      if (sc < bs) { bs = sc; best = q; }
    }
    n = best || nodes[nodes.length - 1];
    if (!best) { const g = nodes[nodes.length - 1]; n = { x: g.x, y: g.y, z: Math.min(g.z, w.finishZ - 4) }; }
  } else {
    n = nodes[Math.min(b.node, nodes.length - 1)];
    if (Math.hypot(n.x - b.pos.x, n.z - b.pos.z) < 1.8 && b.node < nodes.length - 1) b.node++;
  }
  const wob = Math.sin(now / 0.7 + b.wobble) * 0.25;
  let dx = n.x - b.pos.x + wob, dz = n.z - b.pos.z;
  const l = Math.hypot(dx, dz) || 1; dx /= l; dz /= l;
  const vl = Math.hypot(b.vel.x, b.vel.z);
  // desvio de obstáculo: se tenta andar mas está parado, dá um passo lateral para o lado que tem chão
  const hasGround = (x, z) => boxes.some(q => x > q.min.x && x < q.max.x && z > q.min.z && z < q.max.z && q.max.y > b.pos.y - 0.6 && q.max.y < b.pos.y + 0.4);
  b.slowT = racing && b.grounded && vl < 1.0 && b.stun <= 0 ? (b.slowT || 0) + 1 : 0;
  if (b.slowT > 25 && now > (b.strafeUntil || 0)) {
    const lx = -dz, lz = dx;
    const gl = hasGround(b.pos.x + lx * 1.5, b.pos.z + lz * 1.5), gr = hasGround(b.pos.x - lx * 1.5, b.pos.z - lz * 1.5);
    b.strafeDir = gl && !gr ? 1 : gr && !gl ? -1 : (Math.random() < 0.5 ? -1 : 1);
    b.strafeUntil = now + 0.6; b.slowT = 0;
  }
  if (now < (b.strafeUntil || 0)) { const px2 = -dz * b.strafeDir, pz2 = dx * b.strafeDir; dx = dx * 0.5 + px2; dz = dz * 0.5 + pz2; const l2 = Math.hypot(dx, dz) || 1; dx /= l2; dz /= l2; }
  const mx = vl > 2 ? b.vel.x / vl : dx, mz = vl > 2 ? b.vel.z / vl : dz;   // sonda na direção real do movimento
  const look = 0.55 + vl * 0.11;                      // olha mais longe quanto mais rápido
  const px = b.pos.x + mx * look, pz = b.pos.z + mz * look;
  let ground = false;
  for (const bx of boxes) if (px > bx.min.x && px < bx.max.x && pz > bx.min.z && pz < bx.max.z && bx.max.y > b.pos.y - 0.6 && bx.max.y < b.pos.y + 0.4) { ground = true; break; }
  const risen = n.y > b.pos.y + 0.8 && l < 5;
  // degrau/parede à frente: mais alto que um degrau mas baixo o bastante para pular
  const wallAhead = boxes.some(q => px > q.min.x - 0.3 && px < q.max.x + 0.3 && pz > q.min.z - 0.3 && pz < q.max.z + 0.3 && q.min.y < b.pos.y + 1.0 && q.max.y > b.pos.y + 0.4 && q.max.y < b.pos.y + 1.9);
  // martelos: pula por cima um pouco antes do eixo (um pulo cobre a zona de varredura); ~1 em 10 erra
  let dodge = false;
  w.spinners.forEach((sp2, si) => {
    if (Math.abs(b.pos.y - (sp2.cy - 0.7)) > 1) return;
    const dx2 = b.pos.x - sp2.cx, dz2 = b.pos.z - sp2.cz, rr = Math.hypot(dx2, dz2);
    if (rr > sp2.L + 0.9 && rr < sp2.L + 2.4 && (b.vel.x * -dx2 + b.vel.z * -dz2) > 0 && (b.i * 7 + si * 13) % 10 !== 0) dodge = true;
  });
  const jump = b.grounded && (!ground || risen || wallAhead || dodge) && Math.random() < 0.6 + 0.4 * b.skill;
  const sp = b.ground && b.ground.conv ? Math.min(1, b.skill + 0.2) : b.skill;
  return [dx * sp, dz * sp, jump, false];
}

// escolhe o índice de waypoint para um bot "adotado" no meio do caminho (nós sequenciais)
export function nearestNodeAhead(w, r) {
  let best = 0, bd = 1e9;
  w.nodes.forEach((q, k) => { if (q.z <= r.pos.z + 3) { const d = Math.hypot(q.x - r.pos.x, q.z - r.pos.z); if (d < bd) { bd = d; best = k; } } });
  return best;
}
