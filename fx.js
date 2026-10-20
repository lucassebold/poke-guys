// Efeitos visuais: partículas, anéis, raios, objetos dos poderes, vaga-lumes e pós-processamento (bloom + correção de cor).
// Tudo aqui é só visual; a lógica dos poderes está em shared/sim.js.
import * as THREE from 'three';
import { EffectComposer } from './addons/postprocessing/EffectComposer.js';
import { RenderPass } from './addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from './addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from './addons/postprocessing/ShaderPass.js';
import { OutputPass } from './addons/postprocessing/OutputPass.js';

const MAXP = 3200;
const rnd = (a = 0, b = 1) => a + Math.random() * (b - a);

const GradeShader = {
  uniforms: { tDiffuse: { value: null }, sat: { value: 1.3 }, con: { value: 1.07 }, vig: { value: 0.34 }, tint: { value: new THREE.Vector3(1.03, 1.0, 1.05) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform float sat, con, vig; uniform vec3 tint; varying vec2 vUv;
    void main(){
      vec4 c = texture2D(tDiffuse, vUv);
      float l = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
      c.rgb = mix(vec3(l), c.rgb, sat);                 // cores mais vivas
      c.rgb = (c.rgb - 0.18) * con + 0.18; c.rgb *= tint;
      float v = smoothstep(0.9, 0.25, length(vUv - 0.5) * 1.15);
      c.rgb *= mix(1.0 - vig, 1.0, v);                  // vinheta leve
      gl_FragColor = c;
    }`,
};

export function createFx(scene, camera, renderer) {
  // ---------------------------------------------------------------- pós-processamento
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.08;
  let composer = null, bloom = null, enabled = true;
  function buildComposer() {
    const w = innerWidth, h = innerHeight;
    composer = new EffectComposer(renderer); composer.setPixelRatio(Math.min(devicePixelRatio, 2)); composer.setSize(w, h);
    composer.addPass(new RenderPass(scene, camera));
    bloom = new UnrealBloomPass(new THREE.Vector2(w, h), 0.62, 0.55, 0.86); composer.addPass(bloom);
    composer.addPass(new ShaderPass(GradeShader));
    composer.addPass(new OutputPass());
  }
  buildComposer();
  const render = () => { if (enabled) composer.render(); else { renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.render(scene, camera); } };
  const resize = () => { composer.setSize(innerWidth, innerHeight); pmat.uniforms.uScale.value = innerHeight * 0.5; };
  const setQuality = on => { enabled = on; };

  // ---------------------------------------------------------------- partículas
  const pos = new Float32Array(MAXP * 3), col = new Float32Array(MAXP * 3), siz = new Float32Array(MAXP);
  const vel = new Float32Array(MAXP * 3), life = new Float32Array(MAXP), maxL = new Float32Array(MAXP), grav = new Float32Array(MAXP), drag = new Float32Array(MAXP), s0 = new Float32Array(MAXP), c0 = new Float32Array(MAXP * 3);
  let head = 0;
  const pgeo = new THREE.BufferGeometry();
  pgeo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); pgeo.setAttribute('color', new THREE.BufferAttribute(col, 3)); pgeo.setAttribute('size', new THREE.BufferAttribute(siz, 1));
  const pmat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, vertexColors: true, uniforms: { uScale: { value: innerHeight * 0.5 } },
    vertexShader: 'attribute float size; varying vec3 vC; uniform float uScale; void main(){ vC = color; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = size * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
    fragmentShader: 'varying vec3 vC; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.05, d); if (a < 0.01) discard; gl_FragColor = vec4(vC * a, a); }',
  });
  const points = new THREE.Points(pgeo, pmat); points.frustumCulled = false; points.renderOrder = 5; scene.add(points);
  const C1 = new THREE.Color(), C2 = new THREE.Color();
  // o = { color, color2, size, life, speed, up, spread, gravity, drag, glow }
  function emit(x, y, z, n, o = {}) {
    C1.set(o.color ?? 0xffffff); C2.set(o.color2 ?? (o.color ?? 0xffffff));
    for (let i = 0; i < n; i++) {
      const k = head; head = (head + 1) % MAXP;
      const a = rnd(0, 6.2832), sp = (o.speed ?? 3) * rnd(0.35, 1.1), sx = o.spread ?? 1;
      vel[k * 3] = Math.cos(a) * sp * sx; vel[k * 3 + 1] = (o.up ?? 2) * rnd(0.4, 1.2) + rnd(-0.5, 0.5); vel[k * 3 + 2] = Math.sin(a) * sp * sx;
      pos[k * 3] = x + rnd(-0.15, 0.15); pos[k * 3 + 1] = y + rnd(-0.05, 0.1); pos[k * 3 + 2] = z + rnd(-0.15, 0.15);
      const t = Math.random(), glow = o.glow ?? 1.6;
      c0[k * 3] = (C1.r + (C2.r - C1.r) * t) * glow; c0[k * 3 + 1] = (C1.g + (C2.g - C1.g) * t) * glow; c0[k * 3 + 2] = (C1.b + (C2.b - C1.b) * t) * glow;
      s0[k] = (o.size ?? 0.35) * rnd(0.6, 1.3); maxL[k] = life[k] = (o.life ?? 0.7) * rnd(0.7, 1.2); grav[k] = o.gravity ?? -4; drag[k] = o.drag ?? 1.8;
    }
  }
  // ---------------------------------------------------------------- objetos temporários (anéis, raios, projéteis...)
  const live = [];
  const addMesh = (mesh, ttl, update) => { scene.add(mesh); live.push({ mesh, t: 0, ttl, update }); return mesh; };
  const addMat = (c, op = 1) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  function ring(x, y, z, color = 0xffffff, r0 = 0.4, r1 = 3.2, ttl = 0.55) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 40), addMat(color, 0.9)); m.rotation.x = -Math.PI / 2; m.position.set(x, y + 0.08, z);
    addMesh(m, ttl, (mm, k) => { const r = r0 + (r1 - r0) * (1 - (1 - k) * (1 - k)); mm.scale.set(r, r, 1); mm.material.opacity = 0.9 * (1 - k); });
  }
  function sphereFlash(x, y, z, color, r = 2.5, ttl = 0.4) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), addMat(color, 0.55)); m.position.set(x, y, z);
    addMesh(m, ttl, (mm, k) => { const s = r * (0.3 + 0.7 * k); mm.scale.setScalar(s); mm.material.opacity = 0.55 * (1 - k); });
  }
  const up = new THREE.Vector3(0, 1, 0), tmpA = new THREE.Vector3(), tmpB = new THREE.Vector3();
  function beam(ax, ay, az, bx, by, bz, color, ttl = 0.4, width = 0.12) {
    tmpA.set(ax, ay, az); tmpB.set(bx, by, bz); const len = tmpA.distanceTo(tmpB);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true), addMat(color, 0.95));
    m.position.copy(tmpA).lerp(tmpB, 0.5); m.quaternion.setFromUnitVectors(up, tmpB.clone().sub(tmpA).normalize());
    addMesh(m, ttl, (mm, k) => { const w = width * (1 - k * 0.8); mm.scale.set(w, len, w); mm.material.opacity = 0.95 * (1 - k * k); });
    for (let i = 0; i < 14; i++) { const f = i / 13; emit(ax + (bx - ax) * f, ay + (by - ay) * f, az + (bz - az) * f, 1, { color, color2: 0xffffff, size: 0.28, life: 0.4, speed: 0.6, up: 0.5, gravity: 0 }); }
  }
  function bolt(x, y, z, color = 0xfff27a, h = 14, ttl = 0.3) {
    const pts = []; let px = x, pz = z; for (let i = 0; i <= 8; i++) { pts.push(new THREE.Vector3(px, y + h - i * (h / 8), pz)); px += rnd(-0.9, 0.9); pz += rnd(-0.9, 0.9); }
    const m = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, linewidth: 2 }));
    addMesh(m, ttl, (mm, k) => { mm.material.opacity = 1 - k; });
  }
  const mkBoot = () => {
    const g = new THREE.Group(), brown = new THREE.MeshStandardMaterial({ color: 0xb8531c, roughness: 0.5, emissive: 0x401400, emissiveIntensity: 0.6 }), white = new THREE.MeshStandardMaterial({ color: 0xfff2d0, roughness: 0.6 });
    const sole = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.18, 1.7), white); sole.position.y = -0.4; g.add(sole);
    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.1, 0.8), brown); shaft.position.set(0, 0.2, -0.35); g.add(shaft);
    const toe = new THREE.Mesh(new THREE.SphereGeometry(0.5, 14, 10), brown); toe.scale.set(0.9, 0.7, 1.1); toe.position.set(0, -0.15, 0.4); g.add(toe);
    g.scale.setScalar(1.5); return g;
  };
  // chute: bota gigante vem de trás do alvo e o acerta
  function bootKick(tx, ty, tz, side) {
    const g = mkBoot(); g.position.set(tx - side * 3.2, ty + 0.8, tz + 2); g.rotation.y = side * 1.1;
    addMesh(g, 0.55, (mm, k) => { const e = Math.min(1, k * 2.2); mm.position.set(tx - side * (3.2 - 3.0 * e), ty + 0.8 + 0.5 * Math.sin(e * 3.1), tz + 2 - 1.6 * e); mm.rotation.z = side * -0.7 * e; if (k > 0.7) mm.scale.setScalar(1.5 * (1 - (k - 0.7) / 0.3)); });
    setTimeout(() => { emit(tx, ty + 1, tz, 40, { color: 0xffe14d, color2: 0xff7a1a, size: 0.5, speed: 7, up: 5, life: 0.7 }); ring(tx, ty, tz, 0xffd24d, 0.5, 4.5, 0.5); }, 150);
  }
  function slimeShot(ax, ay, az, bx, by, bz) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.45, 14, 10), new THREE.MeshStandardMaterial({ color: 0x6dff3a, emissive: 0x28c20c, emissiveIntensity: 1.4, roughness: 0.2 }));
    addMesh(m, 0.28, (mm, k) => { mm.position.set(ax + (bx - ax) * k, ay + 1.2 + (by - ay) * k + Math.sin(k * 3.14) * 1.2, az + (bz - az) * k); mm.scale.set(1 + 0.2 * Math.sin(k * 30), 1, 1); });
    setTimeout(() => { emit(bx, by + 1, bz, 50, { color: 0x7dff3f, color2: 0x1fa800, size: 0.45, speed: 5, up: 3, life: 0.9, gravity: -8 }); ring(bx, by, bz, 0x7dff3f, 0.4, 3, 0.5); }, 260);
  }
  function tongueShot(ax, ay, az, bx, by, bz, blocked) {
    beam(ax, ay + 1.1, az, bx, by + 1.1, bz, blocked ? 0x9fd8ff : 0xff5fa8, 0.45, 0.17);
    setTimeout(() => { if (!blocked) { sphereFlash(ax, ay + 1, az, 0xff77c0, 2.2, 0.45); sphereFlash(bx, by + 1, bz, 0xff77c0, 2.2, 0.45); emit(ax, ay + 1, az, 36, { color: 0xff5fa8, color2: 0xfff0ff, size: 0.45, speed: 5, up: 3, life: 0.7 }); emit(bx, by + 1, bz, 36, { color: 0xff5fa8, color2: 0xfff0ff, size: 0.45, speed: 5, up: 3, life: 0.7 }); } }, 220);
  }
  const mkBanana = () => {
    const g = new THREE.Group(), yel = new THREE.MeshStandardMaterial({ color: 0xffe21a, emissive: 0xffa800, emissiveIntensity: 0.9, roughness: 0.4 });
    const arc = new THREE.Mesh(new THREE.TorusGeometry(0.55, 0.17, 10, 22, Math.PI * 0.95), yel); arc.rotation.set(Math.PI / 2, 0, 0.1); arc.position.y = 0.25; g.add(arc);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), new THREE.MeshStandardMaterial({ color: 0x4a2c00 })); tip.position.set(0.5, 0.25, 0.12); g.add(tip);
    return g;
  };
  const mkShield = () => new THREE.Mesh(new THREE.SphereGeometry(1.25, 20, 14), new THREE.MeshBasicMaterial({ color: 0x66d4ff, transparent: true, opacity: 0.26, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));

  // ---------------------------------------------------------------- vaga-lumes ambientes (cor e vida ao redor da câmera)
  const NA = 260, apos = new Float32Array(NA * 3), acol = new Float32Array(NA * 3), asz = new Float32Array(NA), aph = new Float32Array(NA * 3);
  const pal = [0xff4fa3, 0x4fe3ff, 0xffd84f, 0x9dff4f, 0xb07bff].map(c => new THREE.Color(c));
  for (let i = 0; i < NA; i++) { const c = pal[i % 5]; acol[i * 3] = c.r * 1.8; acol[i * 3 + 1] = c.g * 1.8; acol[i * 3 + 2] = c.b * 1.8; asz[i] = rnd(0.25, 0.6); aph[i * 3] = rnd(-60, 60); aph[i * 3 + 1] = rnd(-4, 22); aph[i * 3 + 2] = rnd(-70, 40); }
  const ageo = new THREE.BufferGeometry(); ageo.setAttribute('position', new THREE.BufferAttribute(apos, 3)); ageo.setAttribute('color', new THREE.BufferAttribute(acol, 3)); ageo.setAttribute('size', new THREE.BufferAttribute(asz, 1));
  const amb = new THREE.Points(ageo, pmat); amb.frustumCulled = false; amb.renderOrder = 4; scene.add(amb);

  // ---------------------------------------------------------------- atualização por quadro
  const shake = { v: 0 };
  function update(dt, tn, camPos) {
    for (let k = 0; k < MAXP; k++) {
      if (life[k] <= 0) { siz[k] = 0; continue; }
      life[k] -= dt; const f = Math.max(0, life[k] / maxL[k]);
      vel[k * 3] *= 1 - drag[k] * dt; vel[k * 3 + 2] *= 1 - drag[k] * dt; vel[k * 3 + 1] = vel[k * 3 + 1] * (1 - drag[k] * 0.4 * dt) + grav[k] * dt;
      pos[k * 3] += vel[k * 3] * dt; pos[k * 3 + 1] += vel[k * 3 + 1] * dt; pos[k * 3 + 2] += vel[k * 3 + 2] * dt;
      siz[k] = s0[k] * (0.25 + 0.75 * f); const cf = f * f;
      col[k * 3] = c0[k * 3] * cf; col[k * 3 + 1] = c0[k * 3 + 1] * cf; col[k * 3 + 2] = c0[k * 3 + 2] * cf;
    }
    pgeo.attributes.position.needsUpdate = pgeo.attributes.color.needsUpdate = pgeo.attributes.size.needsUpdate = true;
    for (let i = live.length - 1; i >= 0; i--) {
      const o = live[i]; o.t += dt; const k = Math.min(1, o.t / o.ttl);
      if (o.update) o.update(o.mesh, k);
      if (o.t >= o.ttl) { scene.remove(o.mesh); o.mesh.traverse(m => { if (m.geometry) m.geometry.dispose(); if (m.material && m.material.dispose) m.material.dispose(); }); live.splice(i, 1); }
    }
    for (let i = 0; i < NA; i++) {   // vaga-lumes: ficam num volume em volta da câmera e flutuam
      const x = aph[i * 3] + Math.sin(tn * 0.5 + i) * 2.5, y = aph[i * 3 + 1] + Math.sin(tn * 0.7 + i * 1.7) * 1.5, z = aph[i * 3 + 2] + Math.cos(tn * 0.4 + i) * 2.5;
      apos[i * 3] = camPos.x + x; apos[i * 3 + 1] = camPos.y - 3 + y; apos[i * 3 + 2] = camPos.z + z - 10;
    }
    ageo.attributes.position.needsUpdate = true;
    shake.v = Math.max(0, shake.v - dt * 2.2);
  }
  return { render, resize, setQuality, get enabled() { return enabled; }, emit, ring, sphereFlash, beam, bolt, bootKick, slimeShot, tongueShot, mkBanana, mkShield, update, shake, addMesh };
}
