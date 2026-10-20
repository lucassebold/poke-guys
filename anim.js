// Animação procedural dos corredores.
// A MÁQUINA DE ESTADOS vem do jogo (StumblerController.controller, lido com UnityPy): estados, parâmetros,
// limiares (velocity 0.5 / 1.0), tempos de blend e velocidades de clip. Ver EVIDENCIA.md seção H.
// As POSES são nossas (os clips do jogo são de esqueleto humanoide; os Pokémon têm outro corpo), mas os períodos
// dos ciclos e as amplitudes de perna/braço do Run vêm da decodificação dos clips Run/Idle do jogo.

// Duração (s) e velocidade de reprodução de cada clip — valores lidos nos AnimationClips / estados do controller.
const CLIP = {
  Idle: { len: 2.0, speed: 1 },
  Run: { len: 0.75, speed: 1 },            // Run.fbx: 0.75 s, loop, 60 fps
  Jump: { len: 1.767, speed: 1.5 },        // estado Jump: speed 1.5
  Fall: { len: 1.0, speed: 1 },
  Slide: { len: 1.333, speed: 1 },         // "Slide" = mergulho
  SlideExit: { len: 0.833, speed: 1 },
  SlideExitToRun: { len: 0.5, speed: 1 },
  Ragdoll: { len: 1.333, speed: 1.5 },     // estado Ragdoll: speed 1.5
  GetUp: { len: 0.5, speed: 1 },           // comprimento do clip GetUp não foi lido: valor nosso
  Victory: { len: 1.2, speed: 1 },         // o estado Victory existe no controller (trigger 'Victory'); pose/duração são nossas
};

// Amplitudes medidas no clip Run (pico a pico, graus): UpperLeg ~100, LowerArm ~46  => ±50° e ±23°.
const RUN = { leg: 0.87, arm: 0.40, lean: 0.10 };

const lerp = (a, b, k) => a + (b - a) * k;
const smooth = k => k * k * (3 - 2 * k);

export class Animator {
  constructor(rig, pivot, body) {
    this.rig = rig; this.pivot = pivot; this.body = body;
    this.state = 'Idle'; this.t = 0; this.blend = 0; this.blendDur = 0;
    this.from = this.rest(); this.cur = this.rest();
    this.jumped = false;
  }
  rest() { return { pitch: 0, sy: 1, bob: 0, legs: [0, 0], arms: [0, 0] }; }

  // Condições = as do controller (Idle/Run/Fall/Jump/Slide/SlideExit/SlideExitToRun/Ragdoll/GetUp).
  next(p) {
    const s = this.state, v = p.velocity;
    if (p.victory && s !== 'Victory' && !p.stunned) return ['Victory', 0.12];                // trigger 'Victory' (Any State -> Victory, inferido)
    if (s === 'Victory') return p.victory ? null : ['Idle', 0.15];
    if (p.stunned && s !== 'Ragdoll') return ['Ragdoll', 0.1];          // Any State -> Ragdoll (inferido; não estava no dump)
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
        if (!p.sliding && v < 1.0) return ['Idle', 0.25];              // sem exit time no controller: sai na hora, com blend 0.25 s
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

  target(ph) {
    const P = this.rest(), TAU = Math.PI * 2, s = this.state;
    switch (s) {
      case 'Idle': {
        const w = Math.sin(TAU * ph);
        P.sy = 1 + 0.015 * w; P.arms = [0.12 * w, -0.12 * w]; break;
      }
      case 'Run': {
        const w = Math.sin(TAU * ph);
        P.legs = [RUN.leg * w, -RUN.leg * w];          // pernas em oposição de fase (índice 0 = lado -1)
        P.arms = [-RUN.arm * w, RUN.arm * w];          // braços em oposição às pernas do mesmo lado
        P.pitch = RUN.lean; break;
      }
      case 'Jump': P.arms = [-2.6, -2.6]; P.legs = [-0.55, 0.3]; P.pitch = -0.05; break;
      case 'Fall': {
        const w = Math.sin(TAU * 2 * ph);
        P.arms = [-1.3 + 0.35 * w, -1.3 - 0.35 * w]; P.legs = [0.4 * w, -0.4 * w]; P.pitch = 0.1; break;
      }
      case 'Slide': P.pitch = 1.4; P.arms = [-2.9, -2.9]; P.legs = [0.25, 0.25]; break;
      case 'SlideExit': { const k = smooth(Math.min(1, ph)); P.pitch = 1.4 * (1 - k); P.arms = [-2.9 * (1 - k), -2.9 * (1 - k)]; P.legs = [0.25 * (1 - k), 0.25 * (1 - k)]; break; }
      case 'SlideExitToRun': { const k = Math.min(1, ph); P.pitch = 0.7 * (1 - k); P.arms = [-1.0 * (1 - k), -1.0 * (1 - k)]; break; }
      case 'Ragdoll': {
        const w = Math.sin(TAU * 2 * ph);
        P.pitch = TAU * ph; P.arms = [-1.6 + 0.6 * w, -1.6 - 0.6 * w]; P.legs = [0.8 * w, -0.8 * w]; break;
      }
      case 'GetUp': { const k = Math.min(1, ph); P.pitch = 0.6 * (1 - k); P.arms = [-0.5 * (1 - k), -0.5 * (1 - k)]; break; }
      case 'Victory': {
        const w = Math.sin(TAU * ph);
        P.arms = [-2.7 + 0.45 * w, -2.7 - 0.45 * w]; P.legs = [0.18 * w, -0.18 * w]; P.bob = 0.16 * Math.abs(Math.sin(TAU * ph)); P.sy = 1 + 0.03 * w; break;
      }
    }
    return P;
  }

  // r: Racer (pos, vel, grounded, dive, stun)
  update(r, dt) {
    const p = {
      velocity: Math.hypot(r.vel.x, r.vel.z), grounded: r.grounded, sliding: r.dive > 0, stunned: r.stun > 0,
      jumping: !r.grounded && r.vel.y > 0 && r.dive <= 0 && r.stun <= 0, falling: !r.grounded && r.vel.y <= 0, victory: !!r.victory,
    };
    const nx = this.next(p);
    if (nx && nx[0] !== this.state) {
      this.from = JSON.parse(JSON.stringify(this.cur));
      this.state = nx[0]; this.t = 0; this.blend = 0; this.blendDur = nx[1];
    }
    this.t += dt;
    const c = CLIP[this.state], clipT = this.t * c.speed;
    const ph = c.len ? (['Idle', 'Run', 'Jump', 'Fall', 'Slide', 'Ragdoll'].includes(this.state) ? (clipT / c.len) % 1 : Math.min(1, clipT / c.len)) : 0;
    const T = this.target(ph);
    this.blend += dt;
    const k = this.blendDur > 0 ? Math.min(1, this.blend / this.blendDur) : 1;
    const F = this.from, C = this.cur;
    C.pitch = lerp(F.pitch, T.pitch, k); C.sy = lerp(F.sy, T.sy, k); C.bob = lerp(F.bob || 0, T.bob, k);
    for (let i = 0; i < 2; i++) { C.legs[i] = lerp(F.legs[i], T.legs[i], k); C.arms[i] = lerp(F.arms[i], T.arms[i], k); }
    this.apply();
  }

  apply() {
    const C = this.cur;
    for (const l of this.rig.legs) l.pivot.rotation.x = C.legs[l.side < 0 ? 0 : 1];
    for (const a of this.rig.arms) a.pivot.rotation.x = C.arms[a.side < 0 ? 0 : 1];
    const lie = Math.abs(Math.sin(C.pitch));
    this.pivot.rotation.x = C.pitch;
    this.pivot.position.y = 0.75 - 0.22 * lie + C.bob;   // deitado fica mais rente ao chão; bob = pulinho da vitória
    this.body.scale.y = C.sy;
  }
}
