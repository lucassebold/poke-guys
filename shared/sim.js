// Simulação pura (sem three.js e sem DOM): usada pelo navegador E pelo servidor Node.
// Contém: constantes, "mundo" da fase (caixas, martelos, bumpers, plataformas móveis...), física do corredor e IA dos bots.
// Tudo aqui usa objetos simples {x,y,z} para rodar igual nos dois lados.

export const CFG = {
  racers: 16, qualifySlots: 8, roundTime: 120, countdown: 3,
  speed: 7, accelGround: 45, accelAir: 12, gravity: -28, jump: 11,
  diveSpeed: 13, diveUp: 4, diveLock: 0.9, diveRecover: 0.5,
  hw: 0.4, height: 1.6, fallY: -15, seaY: -9.5,
  hammerKnock: 6.5, hammerUp: 5.5, stunTime: 0.9, bumperPush: 13, bumperUp: 5,
  moverSpeed: 2.0,
};

export const vec = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const defaultSpawn = i => ({ x: (i % 4 - 1.5) * 3, y: 0.05, z: 3 - Math.floor(i / 4) * 2.2 });

// ------------------------------------------------------------------ mundo
export function createWorld() {
  return {
    boxes: [], nodes: [], checkpoints: [], spinners: [], bumpers: [], movers: [],
    finishZ: 0, finishY: -0.5, conveyorZone: null, lanes: false, mt: 0, roundTime: 120,
    spawnFn: defaultSpawn, serverTiles: false, onEvent: null,
  };
}
export function clearWorld(w) {
  w.boxes.length = w.nodes.length = w.checkpoints.length = w.spinners.length = w.bumpers.length = w.movers.length = 0;
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
export function resetWorldClock(w) { w.mt = 0; for (const s of w.spinners) s.ang = 0; reviveAll(w); updateWorld(w, 0, []); }

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
  };
}
export function spawnRacer(r, p) {
  r.pos.x = p.x; r.pos.y = p.y; r.pos.z = p.z; r.vel.x = r.vel.y = r.vel.z = 0; r.yaw = Math.PI;
  r.stun = r.invul = r.dive = r.recover = 0; r.cp = null; r.node = 0; r.splashed = false; r.slowT = 0; r.strafeUntil = 0;
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
  if (canControl) {
    const onIce = e.grounded && e.ground && e.ground.ice;
    const a = (e.grounded ? CFG.accelGround * (onIce ? 0.09 : 1) : CFG.accelAir) * dt;
    e.vel.x += Math.max(-a, Math.min(a, inp.wx * CFG.speed - e.vel.x));
    e.vel.z += Math.max(-a, Math.min(a, inp.wz * CFG.speed - e.vel.z));
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
  const px = b.pos.x + mx * 1.0, pz = b.pos.z + mz * 1.0;
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
