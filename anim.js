// Animação procedural dos corredores.
// A MÁQUINA DE ESTADOS vem do jogo (StumblerController.controller, lido com UnityPy): estados, parâmetros e limiares
// (velocity 0.5 / 1.0). Ver EVIDENCIA.md seção H. As POSES, a dinâmica e o "juice" (molas, inclinação, amassar/esticar) são nossos.
//
// O que torna o movimento fluido:
//  - ciclo de corrida guiado pela VELOCIDADE (passos mais rápidos e mais largos quanto mais corre) e amplitude que sobe/desce suavemente;
//  - todos os canais de pose passam por filtros exponenciais (sem "estalo" ao trocar de estado);
//  - quique do corpo, torção do tronco, pé que levanta do chão, braços que abrem;
//  - inclina para frente ao acelerar e INCLINA NAS CURVAS (banking);
//  - molas: amassa ao pousar, estica ao pular; cabeça e rabo balançam com atraso (follow-through).
import * as THREE from 'three';

// Duração (s) e velocidade de reprodução de cada clip — valores lidos nos AnimationClips / estados do controller.
const CLIP = {
  Idle: { len: 2.0, speed: 1 },
  Run: { len: 0.75, speed: 1 },
  Jump: { len: 1.767, speed: 1.5 },
  Fall: { len: 1.0, speed: 1 },
  Slide: { len: 1.333, speed: 1 },         // "Slide" = mergulho
  SlideExit: { len: 0.833, speed: 1 },
  SlideExitToRun: { len: 0.5, speed: 1 },
  Ragdoll: { len: 1.333, speed: 1.5 },
  GetUp: { len: 0.5, speed: 1 },
  Victory: { len: 1.2, speed: 1 },
};

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrap = a => Math.atan2(Math.sin(a), Math.cos(a));
const damp = (cur, tgt, rate, dt) => cur + (tgt - cur) * (1 - Math.exp(-rate * dt));   // aproximação exponencial independente do frame rate
const smooth = k => k * k * (3 - 2 * k);
class Spring {   // mola amortecida: x segue o alvo com sobra (overshoot) e assenta
  constructor(k, c) { this.x = 0; this.v = 0; this.k = k; this.c = c; }
  step(target, dt) { const n = Math.max(1, Math.ceil(dt / 0.008)), h = dt / n; for (let i = 0; i < n; i++) { this.v += (this.k * (target - this.x) - this.c * this.v) * h; this.x += this.v * h; } }
}

export class Animator {
  constructor(rig, pivot, body) {
    this.rig = rig; this.pivot = pivot; this.body = body;
    this.state = 'Idle'; this.t = 0; this.blendDur = 0;
    this.cur = this.rest();
    this.run = 0; this.amp = 0;                         // fase do ciclo de corrida (0..1) e amplitude suave (0 = parado)
    this.sq = new Spring(260, 15);                      // amassar (+) / esticar (-)
    this.headP = new Spring(170, 13); this.headR = new Spring(170, 13);
    this.tailY = new Spring(90, 7); this.tailP = new Spring(110, 8);
    this.lastYaw = null; this.yawRate = 0; this.lastSpeed = 0; this.accel = 0; this.wasGrounded = true; this.lastVy = 0;
    for (const l of rig.legs) l.baseY = l.pivot.position.y;
    this.setupSecondary();
  }
  rest() { return { pitch: 0, sy: 1, bob: 0, twist: 0, roll: 0, flare: 0, legs: [0, 0], arms: [0, 0], lift: [0, 0] }; }

  // Agrupa as partes de cima (cabeça, orelhas, bulbos) e de trás (rabos, cascos) em pivôs próprios, para balançarem com atraso.
  setupSecondary() {
    this.head = this.tail = null;
    const body = this.body, skip = new Set([...this.rig.legs.map(l => l.pivot), ...this.rig.arms.map(a => a.pivot)]);
    body.updateMatrixWorld(true);
    const inv = body.matrixWorld.clone().invert(), headParts = [], tailParts = [];
    for (const c of [...body.children]) {
      if (skip.has(c)) continue;
      const box = new THREE.Box3().setFromObject(c), ctr = box.getCenter(new THREE.Vector3()).applyMatrix4(inv);
      if (ctr.y > 0.98) headParts.push(c); else if (ctr.z < -0.38) tailParts.push(c);
    }
    const mk = (parts, px, py, pz) => {
      if (!parts.length) return null;
      const g = new THREE.Group(); g.position.set(px, py, pz); body.add(g);
      for (const c of parts) { c.position.x -= px; c.position.y -= py; c.position.z -= pz; g.add(c); }
      return g;
    };
    this.head = mk(headParts, 0, 0.95, 0.02);
    this.tail = mk(tailParts, 0, 0.55, -0.34);
  }

  // Condições = as do controller (Idle/Run/Fall/Jump/Slide/SlideExit/SlideExitToRun/Ragdoll/GetUp).
  next(p) {
    const s = this.state, v = p.velocity;
    if (p.victory && s !== 'Victory' && !p.stunned) return ['Victory', 0.12];
    if (s === 'Victory') return p.victory ? null : ['Idle', 0.15];
    if (p.stunned && s !== 'Ragdoll') return ['Ragdoll', 0.1];
    switch (s) {
      case 'Idle':
        if (v > 0.5 && p.grounded && !p.sliding) return ['Run', 0.15];
        if (!p.grounded && p.falling) return ['Fall', 0.05];
        if (p.jumping) return ['Jump', 0];
        if (p.sliding) return ['Slide', 0];
        break;
      case 'Fall':
        if (p.grounded && v < 0.5 && !p.sliding) return ['Idle', 0.15];
        if (p.sliding) return ['Slide', 0];
        if (p.jumping && !p.falling) return ['Jump', 0];
        if (p.grounded && v > 0.5 && !p.sliding) return ['Run', 0.15];
        break;
      case 'Run':
        if (v < 0.5 && p.grounded && !p.sliding) return ['Idle', 0.15];
        if (!p.grounded && p.falling) return ['Fall', 0.05];
        if (p.jumping) return ['Jump', 0];
        if (p.sliding) return ['Slide', 0];
        break;
      case 'Jump':
        if (p.falling) return ['Fall', 0.1];
        if (p.grounded && v < 0.5) return ['Idle', 0];
        if (p.grounded && v > 0.5) return ['Run', 0];
        if (p.sliding) return ['Slide', 0];
        break;
      case 'Slide':
        if (!p.sliding && v < 1.0) return ['SlideExit', 0];
        if (!p.sliding && v > 1.0) return ['SlideExitToRun', 0];
        break;
      case 'SlideExit':
        if (!p.sliding && v < 1.0) return ['Idle', 0.25];
        if (!p.sliding && v > 0.5) return ['Run', 0.25];
        break;
      case 'SlideExitToRun':
        if (!p.sliding && v > 1.0) return ['Run', 0.25];
        break;
      case 'Ragdoll':
        if (!p.stunned) return ['GetUp', 0.15];
        break;
      case 'GetUp':
        if (this.t >= CLIP.GetUp.len) return ['Idle', 0.15];
        break;
    }
    return null;
  }

  // Pose-alvo do estado atual (os canais são filtrados depois). v = velocidade horizontal, vy = velocidade vertical.
  target(ph, v, vy) {
    const P = this.rest(), s = this.state, a = this.amp, ca = Math.min(1, a);
    switch (s) {
      case 'Idle': {
        const w = Math.sin(TAU * ph), w2 = Math.sin(TAU * ph * 2 + 1);
        P.sy = 1 + 0.018 * w; P.arms = [0.14 * w, -0.14 * w]; P.roll = 0.018 * w2; P.twist = 0.04 * w2; P.flare = 0.1 + 0.03 * w; break;
      }
      case 'Run': {
        const wv = Math.sin(TAU * this.run), c = Math.cos(TAU * this.run);
        const swing = 0.4 + 0.52 * ca, armS = 0.28 + 0.42 * ca;
        P.legs = [swing * wv, -swing * wv];
        P.lift = [0.1 * ca * Math.max(0, c), 0.1 * ca * Math.max(0, -c)];                 // o pé levanta quando a perna vem para frente
        P.arms = [-armS * wv, armS * wv];
        P.flare = 0.14 + 0.16 * ca;
        P.pitch = 0.04 + 0.15 * Math.min(1.3, a) + clamp(this.accel * 0.0035, -0.07, 0.12);
        P.bob = 0.085 * ca * Math.abs(wv) - 0.03 * ca;                                    // dois quiques por ciclo
        P.twist = 0.13 * ca * wv; P.roll = 0.045 * ca * wv; break;
      }
      case 'Jump': {
        const up = clamp(vy / 13, 0, 1);
        P.arms = [-2.5 - 0.3 * up, -2.5 - 0.3 * up]; P.legs = [-0.7 + 0.2 * (1 - up), 0.35]; P.pitch = -0.08 - 0.06 * up; P.flare = 0.35; P.lift = [0.04, 0.02]; break;
      }
      case 'Fall': {
        const w = Math.sin(TAU * 2 * ph), dn = clamp(-vy / 18, 0, 1);
        P.arms = [-1.2 - 0.5 * dn + 0.35 * w, -1.2 - 0.5 * dn - 0.35 * w]; P.legs = [0.45 * w + 0.15 * dn, -0.45 * w + 0.15 * dn]; P.pitch = 0.12 + 0.08 * dn; P.flare = 0.45; break;
      }
      case 'Slide': P.pitch = 1.4; P.arms = [-2.9, -2.9]; P.legs = [0.25, 0.25]; P.flare = 0.1; break;
      case 'SlideExit': { const k = smooth(Math.min(1, ph)); P.pitch = 1.4 * (1 - k); P.arms = [-2.9 * (1 - k), -2.9 * (1 - k)]; P.legs = [0.25 * (1 - k), 0.25 * (1 - k)]; break; }
      case 'SlideExitToRun': { const k = Math.min(1, ph); P.pitch = 0.7 * (1 - k); P.arms = [-1.0 * (1 - k), -1.0 * (1 - k)]; break; }
      case 'Ragdoll': {
        const w = Math.sin(TAU * 2 * ph);
        P.pitch = TAU * ph; P.arms = [-1.6 + 0.6 * w, -1.6 - 0.6 * w]; P.legs = [0.8 * w, -0.8 * w]; P.flare = 0.5; break;
      }
      case 'GetUp': { const k = Math.min(1, ph); P.pitch = 0.6 * (1 - k); P.arms = [-0.5 * (1 - k), -0.5 * (1 - k)]; break; }
      case 'Victory': {
        const w = Math.sin(TAU * ph);
        P.arms = [-2.7 + 0.45 * w, -2.7 - 0.45 * w]; P.legs = [0.18 * w, -0.18 * w]; P.bob = 0.2 * Math.abs(Math.sin(TAU * ph)); P.sy = 1 + 0.04 * w; P.twist = 0.15 * w; P.flare = 0.4; break;
      }
    }
    return P;
  }

  // r: Racer (pos, vel, yaw, grounded, dive, stun, victory)
  update(r, dt) {
    dt = Math.min(Math.max(dt, 0), 0.05);
    const speed = Math.hypot(r.vel.x, r.vel.z), vy = r.vel.y;
    const p = {
      velocity: speed, grounded: r.grounded, sliding: r.dive > 0, stunned: r.stun > 0,
      jumping: !r.grounded && r.vel.y > 0 && r.dive <= 0 && r.stun <= 0, falling: !r.grounded && r.vel.y <= 0, victory: !!r.victory,
    };
    const nx = this.next(p), C = this.cur;
    if (nx && nx[0] !== this.state) {
      if (this.state === 'Ragdoll') C.pitch = wrap(C.pitch);           // sai do giro pelo caminho curto (sem desenrolar várias voltas)
      this.state = nx[0]; this.t = 0; this.blendDur = nx[1];
    }
    this.t += dt;
    const c = CLIP[this.state], clipT = this.t * c.speed;
    const ph = c.len ? (['Idle', 'Run', 'Jump', 'Fall', 'Slide', 'Ragdoll', 'Victory'].includes(this.state) ? (clipT / c.len) % 1 : Math.min(1, clipT / c.len)) : 0;

    if (dt > 0) {
      // dinâmica do corpo: taxa de curva, aceleração, pouso/decolagem
      const yaw = r.yaw === undefined ? 0 : r.yaw;
      if (this.lastYaw !== null) this.yawRate = damp(this.yawRate, clamp(wrap(yaw - this.lastYaw) / dt, -9, 9), 12, dt);
      this.lastYaw = yaw;
      this.accel = damp(this.accel, clamp((speed - this.lastSpeed) / dt, -60, 60), 10, dt); this.lastSpeed = speed;
      if (r.grounded && !this.wasGrounded && this.lastVy < -3) this.sq.v += clamp(-this.lastVy * 0.8, 0, 10);   // pousa: amassa
      if (!r.grounded && this.wasGrounded && vy > 4) this.sq.v -= 5;                                              // decola: estica
      this.wasGrounded = r.grounded; this.lastVy = vy;
      // ciclo de corrida guiado pela velocidade
      const runTarget = this.state === 'Run' ? clamp(speed / 9.6, 0.25, 1.45) : 0;
      this.amp = damp(this.amp, runTarget, runTarget > this.amp ? 10 : 7, dt);
      if (this.state === 'Run') this.run = (this.run + dt * (1.15 + 0.125 * speed)) % 1;
    }

    const T = this.target(ph, speed, vy), st = this.state;
    const fast = st === 'Ragdoll' ? 40 : 30, slow = (st === 'Jump' || st === 'Fall' || st === 'Slide' || st === 'SlideExit' || st === 'Victory') ? 18 : fast;
    for (let i = 0; i < 2; i++) { C.legs[i] = damp(C.legs[i], T.legs[i], slow, dt); C.arms[i] = damp(C.arms[i], T.arms[i], slow, dt); C.lift[i] = damp(C.lift[i], T.lift[i], 30, dt); }
    C.pitch = damp(C.pitch, T.pitch, st === 'Ragdoll' ? 60 : 13, dt);
    C.sy = damp(C.sy, T.sy, 14, dt); C.bob = damp(C.bob, T.bob, 28, dt);
    C.twist = damp(C.twist, T.twist, 20, dt); C.roll = damp(C.roll, T.roll, 20, dt); C.flare = damp(C.flare, T.flare, 14, dt);

    // molas: amassar/esticar, cabeça e rabo com atraso
    const airT = r.grounded ? 0 : (vy > 0 ? -0.1 * clamp(vy / 13, 0, 1) : -0.05 * clamp(-vy / 18, 0, 1));
    if (dt > 0) {
      this.sq.step(st === 'Slide' ? -0.12 : airT, dt);
      this.headP.step(clamp(-this.accel * 0.006 - vy * 0.011, -0.3, 0.3), dt);
      this.headR.step(clamp(-this.yawRate * 0.05, -0.3, 0.3), dt);
      this.tailY.step(clamp(this.yawRate * 0.07 + Math.sin(TAU * this.run * 2) * 0.25 * Math.min(1, this.amp), -0.5, 0.5), dt);
      this.tailP.step(0.18 * Math.min(1, this.amp) - 0.12 * clamp(vy / 13, -1, 1), dt);
    }
    this.apply();
  }

  apply() {
    const C = this.cur, s = clamp(this.sq.x, -0.35, 0.6);
    for (const l of this.rig.legs) { const i = l.side < 0 ? 0 : 1; l.pivot.rotation.x = C.legs[i]; l.pivot.position.y = l.baseY + C.lift[i]; }
    for (const a of this.rig.arms) { const i = a.side < 0 ? 0 : 1; a.pivot.rotation.x = C.arms[i]; a.pivot.rotation.z = a.side * C.flare; }
    const lie = Math.abs(Math.sin(C.pitch)), bank = clamp(-this.yawRate * 0.035, -0.3, 0.3);
    this.pivot.rotation.x = C.pitch; this.pivot.rotation.y = C.twist; this.pivot.rotation.z = C.roll + bank;
    this.pivot.position.y = 0.75 - 0.22 * lie + C.bob;   // deitado fica mais rente ao chão; bob = quique da corrida / pulinho da vitória
    this.body.scale.set(1 + 0.3 * s, C.sy * (1 - 0.5 * s), 1 + 0.3 * s);   // conserva o volume: amassa = mais largo e mais baixo
    if (this.head) { this.head.rotation.x = this.headP.x; this.head.rotation.z = this.headR.x; }
    if (this.tail) { this.tail.rotation.y = this.tailY.x; this.tail.rotation.x = this.tailP.x; }
  }
}
