// Modelos procedurais (formas simples feitas à mão) de 16 Pokémon. Nenhum modelo/arte oficial é usado.
// Convenção: pés em y=0, altura ~1,6, frente = +z.
import * as THREE from 'three';

const mat = (c, rough = 0.55) => new THREE.MeshStandardMaterial({ color: c, roughness: rough });
function sph(g, r, c, x, y, z, sx = 1, sy = 1, sz = 1) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), mat(c)); m.position.set(x, y, z); m.scale.set(sx, sy, sz); g.add(m); return m;
}
function cone(g, r, h, c, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.ConeGeometry(r, h, 14), mat(c)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
}
function cyl(g, rt, rb, h, c, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 14), mat(c)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
}
function box(g, w, h, d, c, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(c)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
}
function tor(g, R, r, c, x, y, z, rx = 0, ry = 0, rz = 0) {
  const m = new THREE.Mesh(new THREE.TorusGeometry(R, r, 8, 24), mat(c)); m.position.set(x, y, z); m.rotation.set(rx, ry, rz); g.add(m); return m;
}
// olhos com brilho: dois pontos escuros + highlight branco
function eyes(g, y, z, dx = 0.17, r = 0.065, color = 0x111111) {
  for (const s of [-1, 1]) {
    sph(g, r, color, dx * s, y, z);
    sph(g, r * 0.4, 0xffffff, dx * s + 0.02, y + r * 0.45, z + r * 0.75);
  }
}
// Pés e braços ficam em pivôs (quadril/ombro) para a animação balançá-los (ver anim.js).
const rigOf = g => g.userData.rig || (g.userData.rig = { legs: [], arms: [] });
const feet = (g, c, x = 0.2, z = 0.08, r = 0.14) => {
  for (const s of [-1, 1]) {
    const pv = new THREE.Group(); pv.position.set(x * s, r * 0.9 + 0.3, z);
    sph(pv, r, c, 0, -0.3, 0, 1, 0.7, 1.4); g.add(pv); rigOf(g).legs.push({ pivot: pv, side: s });
  }
};
const arms = (g, c, y = 0.75, x = 0.42, z = 0.1) => {
  for (const s of [-1, 1]) {
    const pv = new THREE.Group(); pv.position.set(x * s, y + 0.18, z);
    sph(pv, 0.1, c, 0, -0.18, 0, 1, 1.4, 1); g.add(pv); rigOf(g).arms.push({ pivot: pv, side: s });
  }
};
const BUILDERS = {
  pikachu(g) {
    const Y = 0xffd92f, B = 0x6b3f1d, R = 0xe5382b;
    sph(g, 0.42, Y, 0, 0.62, 0, 1, 1.15, 0.9);            // corpo
    sph(g, 0.4, Y, 0, 1.2, 0.04, 1.12, 1, 1);             // cabeça
    for (const s of [-1, 1]) {
      const ear = new THREE.Group(); ear.position.set(0.24 * s, 1.5, 0); ear.rotation.z = -0.38 * s;
      cone(ear, 0.13, 0.72, Y, 0, 0.36, 0);                           // orelha
      cone(ear, 0.052, 0.27, 0x1a1a1a, 0, 0.585, 0);                  // ponta preta (mesma inclinação da orelha)
      g.add(ear);
      sph(g, 0.1, R, 0.31 * s, 1.1, 0.27, 1, 1, 0.6);                 // bochechas
    }
    eyes(g, 1.27, 0.36); sph(g, 0.03, 0x222222, 0, 1.17, 0.4);
    box(g, 0.14, 0.03, 0.02, 0x7a2a1a, 0, 1.07, 0.38);                   // boca
    box(g, 0.34, 0.05, 0.1, B, 0, 0.78, -0.37); box(g, 0.34, 0.05, 0.1, B, 0, 0.6, -0.38); // listras costas
    // rabo em raio
    box(g, 0.1, 0.4, 0.07, B, 0, 0.5, -0.5, 0.3);
    box(g, 0.1, 0.5, 0.07, Y, 0, 0.85, -0.62, 0.3, 0, 0.5);
    box(g, 0.1, 0.5, 0.07, Y, 0.14, 1.2, -0.7, 0.3, 0, -0.5);
    box(g, 0.34, 0.1, 0.07, Y, 0.1, 1.45, -0.72, 0.3, 0, 0);
    feet(g, Y); arms(g, Y, 0.75);
  },
  charmander(g) {
    const O = 0xf2822f, C = 0xfbd88a;
    sph(g, 0.42, O, 0, 0.62, 0, 1, 1.15, 0.95); sph(g, 0.3, C, 0, 0.58, 0.2, 0.9, 1.2, 0.5);
    sph(g, 0.4, O, 0, 1.2, 0.04, 1.05, 0.95, 1);
    for (const s of [-1, 1]) sph(g, 0.1, O, 0.27 * s, 1.02, 0.18, 1, 0.8, 1); // bochechas
    eyes(g, 1.25, 0.36, 0.17, 0.08, 0x1d6f8f);
    cone(g, 0.12, 0.55, O, 0, 0.4, -0.55, -1.2); // rabo
    cone(g, 0.15, 0.4, 0xff5a1a, 0, 0.78, -0.82, -0.3); cone(g, 0.08, 0.28, 0xffd23f, 0, 0.8, -0.83, -0.3); // chama
    feet(g, O); arms(g, O, 0.75);
  },
  bulbasaur(g) {
    const T = 0x62b7a5, G = 0x4aa84a;
    sph(g, 0.5, T, 0, 0.55, 0, 1.1, 0.95, 1.05);
    sph(g, 0.34, T, 0, 1.0, 0.25, 1.1, 0.9, 1);
    for (const s of [-1, 1]) cone(g, 0.1, 0.22, T, 0.24 * s, 1.28, 0.22, 0, 0, -0.5 * s);
    eyes(g, 1.04, 0.52, 0.18, 0.075, 0xcc2222);
    sph(g, 0.34, G, 0, 1.12, -0.25, 1, 1, 1); cone(g, 0.2, 0.34, G, 0, 1.5, -0.25); // bulbo
    for (const [x, y, z] of [[0.3, 0.8, 0.28], [-0.35, 0.6, 0.2], [0.1, 0.9, -0.25]]) sph(g, 0.07, 0x2f8a6f, x, y, z, 1, 1, 0.5);
    feet(g, T, 0.28, 0.2, 0.15);
  },
  squirtle(g) {
    const B = 0x74c3e6, S = 0xb5792e, C = 0xf6e29a;
    sph(g, 0.42, B, 0, 0.6, 0, 1, 1.1, 0.95); sph(g, 0.3, C, 0, 0.55, 0.22, 0.9, 1.1, 0.5);
    sph(g, 0.4, B, 0, 1.18, 0.05, 1.05, 0.95, 1);
    eyes(g, 1.22, 0.36, 0.17, 0.085, 0x7a2a1a);
    sph(g, 0.4, S, 0, 0.72, -0.32, 1.05, 1.1, 0.5);                       // casco
    box(g, 0.7, 0.07, 0.08, 0xf6e29a, 0, 0.72, -0.5); box(g, 0.07, 0.7, 0.08, 0xf6e29a, 0, 0.72, -0.52);
    tor(g, 0.14, 0.05, B, 0, 0.35, -0.5, 0, 0, 0); // rabo enrolado
    feet(g, B); arms(g, B, 0.75);
  },
  jigglypuff(g) {
    const P = 0xf8b8d0;
    sph(g, 0.58, P, 0, 0.7, 0, 1, 1, 1);
    for (const s of [-1, 1]) cone(g, 0.15, 0.3, P, 0.32 * s, 1.3, -0.05, 0, 0, -0.5 * s);
    sph(g, 0.14, P, 0, 1.28, 0.42, 1, 1.2, 0.8); tor(g, 0.1, 0.035, P, 0, 1.35, 0.5);   // topete
    for (const s of [-1, 1]) { sph(g, 0.16, 0xffffff, 0.2 * s, 0.85, 0.5, 1, 1.15, 0.5); sph(g, 0.115, 0x2aa8c0, 0.2 * s, 0.85, 0.54, 1, 1.1, 0.6); sph(g, 0.05, 0xffffff, 0.22 * s, 0.9, 0.6); }
    sph(g, 0.06, 0xd9708f, 0, 0.58, 0.55, 1.4, 0.8, 0.5);
    feet(g, P, 0.28, 0.1, 0.13);
  },
  psyduck(g) {
    const Y = 0xf5d43a, C = 0xf6e7b0;
    sph(g, 0.44, Y, 0, 0.62, 0, 1, 1.1, 0.95); sph(g, 0.3, C, 0, 0.55, 0.22, 0.9, 1, 0.5);
    sph(g, 0.4, Y, 0, 1.2, 0.05, 1.05, 0.95, 1);
    sph(g, 0.2, C, 0, 1.12, 0.38, 1.4, 0.8, 1);                                        // bico
    for (const s of [-1, 1]) sph(g, 0.03, 0x8a6a2a, 0.07 * s, 1.17, 0.54);
    eyes(g, 1.3, 0.35, 0.16, 0.05);
    for (const s of [-1, 0, 1]) cyl(g, 0.012, 0.012, 0.22, 0x222222, 0.04 * s, 1.68, 0.05, 0, 0, 0.3 * s);
    feet(g, C, 0.2, 0.1, 0.15); arms(g, Y, 0.75);
  },
  eevee(g) {
    const B = 0xb97a3e, C = 0xf3dfb5;
    sph(g, 0.4, B, 0, 0.58, 0, 1, 1.05, 0.95);
    sph(g, 0.38, B, 0, 1.12, 0.06, 1.1, 0.95, 1);
    tor(g, 0.34, 0.12, C, 0, 0.88, 0.08, Math.PI / 2 - 0.2);                           // gola de pelo
    for (const s of [-1, 1]) { cone(g, 0.14, 0.6, B, 0.28 * s, 1.62, 0, 0, 0, -0.3 * s); cone(g, 0.1, 0.3, 0xf3dfb5, 0.28 * s, 1.5, 0.04, 0, 0, -0.3 * s); }
    eyes(g, 1.15, 0.36, 0.17, 0.075); sph(g, 0.03, 0x222222, 0, 1.06, 0.41);
    sph(g, 0.22, B, 0, 0.6, -0.5, 0.8, 1.2, 1.4); sph(g, 0.14, C, 0, 0.62, -0.72, 0.8, 1, 1);  // rabo
    feet(g, B); arms(g, B, 0.7);
  },
  snorlax(g) {
    const D = 0x2f5f6b, C = 0xf1e4c4;
    sph(g, 0.62, D, 0, 0.72, 0, 1.15, 1, 1);
    sph(g, 0.46, C, 0, 0.7, 0.3, 1.1, 1, 0.6);
    sph(g, 0.42, D, 0, 1.38, 0.08, 1.15, 0.85, 1);
    sph(g, 0.3, C, 0, 1.28, 0.28, 1.1, 0.8, 0.8);
    for (const s of [-1, 1]) { cone(g, 0.12, 0.2, D, 0.3 * s, 1.72, 0, 0, 0, -0.4 * s); box(g, 0.14, 0.03, 0.03, 0x111111, 0.17 * s, 1.4, 0.4); }
    box(g, 0.16, 0.03, 0.03, 0x7a2a1a, 0, 1.18, 0.5);
    for (const s of [-1, 1]) cone(g, 0.04, 0.08, 0xffffff, 0.08 * s, 1.2, 0.49, Math.PI);
    feet(g, C, 0.32, 0.2, 0.18); arms(g, D, 0.8, 0.62, 0.15);
  },
  meowth(g) {
    const C = 0xf2e0b0, Br = 0x8c5a2b;
    sph(g, 0.38, C, 0, 0.6, 0, 1, 1.1, 0.9);
    sph(g, 0.38, C, 0, 1.15, 0.05, 1.15, 0.95, 1);
    for (const s of [-1, 1]) { cone(g, 0.13, 0.4, C, 0.3 * s, 1.55, 0, 0, 0, -0.2 * s); cone(g, 0.09, 0.2, Br, 0.31 * s, 1.52, 0.03, 0, 0, -0.2 * s); }
    cyl(g, 0.1, 0.1, 0.03, 0xf0c020, 0, 1.43, 0.3, Math.PI / 2 - 0.5);                 // moeda
    eyes(g, 1.18, 0.37, 0.18, 0.07, 0x222222); sph(g, 0.04, 0xcc3333, 0, 1.08, 0.43);
    for (const s of [-1, 1]) for (const k of [0, 1]) box(g, 0.3, 0.012, 0.012, 0x222222, 0.36 * s, 1.07 - 0.05 * k, 0.38, 0, 0, 0.15 * s * (k ? -1 : 1));
    cyl(g, 0.05, 0.05, 0.5, C, 0, 0.7, -0.45, -0.5); tor(g, 0.12, 0.04, C, 0, 1.0, -0.62, 0, Math.PI / 2, 0);
    feet(g, Br, 0.2, 0.1, 0.12); arms(g, C, 0.72);
  },
  gengar(g) {
    const P = 0x5b3f8f;
    sph(g, 0.5, P, 0, 0.8, 0, 1.15, 1.1, 1);
    for (const s of [-1, 1]) { cone(g, 0.12, 0.5, P, 0.38 * s, 1.6, 0, 0, 0, -0.35 * s); cone(g, 0.1, 0.3, P, 0.4 * s, 0.9, -0.4, 0.6, 0, -1.2 * s); }
    for (const [x, y] of [[0, 1.5], [0.2, 1.45], [-0.2, 1.45]]) cone(g, 0.07, 0.25, P, x, y, -0.3, -0.4);
    for (const s of [-1, 1]) { sph(g, 0.1, 0xffffff, 0.22 * s, 1.05, 0.45, 1, 0.8, 0.5); sph(g, 0.06, 0xd92222, 0.22 * s, 1.05, 0.5); }
    sph(g, 0.3, 0xffffff, 0, 0.78, 0.38, 1.1, 0.3, 0.35); box(g, 0.5, 0.02, 0.03, 0x440000, 0, 0.8, 0.5);
    feet(g, P, 0.24, 0.1, 0.14); arms(g, P, 0.8, 0.55, 0.1);
  },
  togepi(g) {
    const C = 0xf7efd0;
    sph(g, 0.5, C, 0, 0.75, 0, 1, 1.25, 1);
    for (const [x, y, z, c] of [[0.3, 1.0, 0.35, 0xe5382b], [-0.25, 0.6, 0.4, 0x3b6fd6], [0.1, 0.35, 0.45, 0xe5382b], [-0.3, 1.1, 0.3, 0x3b6fd6], [0.35, 0.55, 0.3, 0x3b6fd6], [0, 1.3, 0.2, 0xe5382b]]) cone(g, 0.11, 0.2, c, x, y, z, 0.5, 0, 0);
    eyes(g, 0.95, 0.46, 0.15, 0.06);
    sph(g, 0.1, 0xe5382b, 0, 0.8, 0.5, 1.2, 0.6, 0.5);
    feet(g, 0xe5382b, 0.15, 0.1, 0.11);
  },
  piplup(g) {
    const B = 0x3b7fd6, W = 0xf4f4f4;
    sph(g, 0.42, B, 0, 0.6, 0, 1, 1.1, 0.95); sph(g, 0.3, W, 0, 0.56, 0.2, 0.9, 1.1, 0.5);
    sph(g, 0.4, B, 0, 1.2, 0.05, 1.1, 0.95, 1);
    cone(g, 0.11, 0.3, 0xf5c83a, 0, 1.12, 0.45, Math.PI / 2);                          // bico
    eyes(g, 1.28, 0.34, 0.16, 0.06, 0x111111);
    for (const s of [-1, 1]) sph(g, 0.12, 0x2a4fa8, 0.45 * s, 0.7, 0.05, 0.5, 1.5, 1);
    feet(g, 0xf5c83a, 0.18, 0.12, 0.13);
  },
  oddish(g) {
    const B = 0x4a63c8, G = 0x4aa84a;
    sph(g, 0.5, B, 0, 0.62, 0, 1.1, 1, 1);
    for (let i = 0; i < 5; i++) { const a = i / 5 * Math.PI * 2; cone(g, 0.1, 0.5, G, Math.cos(a) * 0.14, 1.45, Math.sin(a) * 0.14, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5); }
    for (const s of [-1, 1]) { sph(g, 0.1, 0xffffff, 0.2 * s, 0.85, 0.44, 1, 1, 0.5); sph(g, 0.06, 0xd92222, 0.2 * s, 0.85, 0.5); }
    sph(g, 0.05, 0x222244, 0, 0.62, 0.5, 1.6, 0.6, 0.5);
    feet(g, 0xe8c8a0, 0.2, 0.15, 0.11);
  },
  cubone(g) {
    const Br = 0xb97a3e, S = 0xf3ead2;
    sph(g, 0.4, Br, 0, 0.58, 0, 1, 1.1, 0.95);
    sph(g, 0.34, Br, 0, 1.1, 0.04, 1.05, 0.95, 1);
    sph(g, 0.42, S, 0, 1.28, 0.02, 1.1, 0.95, 1.05);                                   // capacete de crânio
    for (const s of [-1, 1]) { sph(g, 0.1, 0x111111, 0.18 * s, 1.18, 0.38, 1, 1.2, 0.5); cone(g, 0.06, 0.18, S, 0.3 * s, 1.62, 0, 0, 0, -0.4 * s); }
    sph(g, 0.06, 0x111111, 0, 1.0, 0.36, 1.4, 0.8, 0.5);
    cyl(g, 0.05, 0.05, 0.7, S, 0.5, 0.7, 0.2, 0, 0, 0.5); sph(g, 0.09, S, 0.67, 1.0, 0.2); // osso
    cone(g, 0.06, 0.35, Br, 0, 0.35, -0.5, -1);
    feet(g, Br, 0.2, 0.1, 0.12);
  },
  poliwag(g) {
    const B = 0x3d6fc9, W = 0xf4f4f4;
    sph(g, 0.52, B, 0, 0.62, 0, 1.1, 1.05, 1);
    sph(g, 0.4, W, 0, 0.6, 0.3, 1, 1, 0.55);
    tor(g, 0.16, 0.025, 0x222244, 0, 0.6, 0.57, 0, 0, 0); tor(g, 0.08, 0.025, 0x222244, 0, 0.6, 0.6, 0, 0, 0);
    for (const s of [-1, 1]) { sph(g, 0.1, 0xffffff, 0.22 * s, 1.0, 0.38, 1, 1, 0.5); sph(g, 0.055, 0x111111, 0.22 * s, 1.0, 0.44); }
    cone(g, 0.12, 0.45, B, 0, 0.35, -0.55, -1.2);
    feet(g, B, 0.22, 0.1, 0.12);
  },
};

export const ROSTER = [
  ['pikachu', 'Pikachu'], ['charmander', 'Charmander'], ['bulbasaur', 'Bulbasaur'], ['squirtle', 'Squirtle'],
  ['jigglypuff', 'Jigglypuff'], ['psyduck', 'Psyduck'], ['eevee', 'Eevee'], ['snorlax', 'Snorlax'],
  ['meowth', 'Meowth'], ['gengar', 'Gengar'], ['togepi', 'Togepi'], ['piplup', 'Piplup'],
  ['oddish', 'Oddish'], ['cubone', 'Cubone'], ['poliwag', 'Poliwag'], ['eevee', 'Eevee 2'],
];

export function buildPokemon(key) {
  const g = new THREE.Group();
  g.userData.rig = { legs: [], arms: [] };
  BUILDERS[key](g);
  g.traverse(c => { if (c.isMesh) c.castShadow = true; });
  return g;
}

export function nameSprite(text, highlight = false) {
  const cv = document.createElement('canvas'); cv.width = 256; cv.height = 64;
  const x = cv.getContext('2d');
  x.font = 'bold 34px system-ui, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.lineWidth = 7; x.strokeStyle = 'rgba(20,30,70,0.9)'; x.strokeText(text, 128, 34);
  x.fillStyle = highlight ? '#ffe135' : '#ffffff'; x.fillText(text, 128, 34);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, transparent: true }));
  sp.scale.set(2.2, 0.55, 1); sp.renderOrder = 10; return sp;
}
