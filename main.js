// Poke Run — cliente do navegador: render (three.js), entrada, áudio, UI e rede.
// A física/bots/fases ficam em shared/ (os mesmos arquivos rodam no servidor). Texturas, malhas e sons vêm da instalação local do jogo
// (assets/, extraídos com UnityPy). Os VALORES numéricos de jogabilidade (CFG em shared/sim.js) são NOSSOS, não extraídos do binário.
import * as THREE from 'three';
import { OBJLoader } from './OBJLoader.js';
import { ROSTER, buildPokemon, nameSprite } from './pokemon.js';
import { Animator } from './anim.js';
import { createSky, createSea, createClouds, createIslands, grassTexture, addGrass, grassUniforms, SEA_Y } from './env.js';
import { CFG, vec, createWorld, clearWorld, recBox, recSpinner, recBumper, recCheckpoint, recNode, registerMover, applyLevelToWorld,
  updateWorld, resetWorldClock, applyDead, createRacer, spawnRacer, stepRacer, botInput } from './shared/sim.js';
import { makeLevels } from './shared/levels.js';
import { openSocket } from './net.js';

// ---------- carregamento de assets ----------
const T = 'assets/tex/', A_ = 'assets/audio/', M = 'assets/mesh/';
const texNames = ['TEX_JungleGrass_A_000', 'TEX_CommonConcreteTiles01_A_000_BaseColour_Ti', 'TEX_FloorTiles_Stone_A_000_Ti',
  'TEX_RocketDoomMetalfloor_A_000_Ti', 'TEX_Trampoline_A_000_Ti', 'TEX_MichelangeloFinishLine_A_000_Bs',
  'TEX_CheckerColoured_A_000_Ti', 'SwingObstacleHammer', 'Bumper1', 'TrampolineRound2',
  'skybox_clouds', 'blueGradient', 'groundTexture1', 'prototypeGround', 'texturetest3', 'wallTexture', 'Goal1', 'Level7Platform', 'Level7Cube',
  'FlagpoleTexture', 'Level12Palm', 'TEX_Sand_A_000_Ti', 'TEX_StoneWall01_A_000_Ti', 'TEX_BrickWall01_A_000_Ti', 'TEX_HSWater_A_000_Ti', 'Mat_waterTextureDark'];
const meshNames = ['MSH_SwingObstacleHammer_A_000_LOD0', 'SwingObstacleHammerAxle', 'Bumper', 'TrampolineRound', 'Level12Palm1', 'Level12Palm2', 'Island1', 'Island2'];
const sfxFiles = {
  jump: 'SG_SFX_Jump', dive: 'SG_SFX_SkySlide_Dive_Activate', land: 'SG_SFX_Landing', step: 'SG_SFX_Footstep',
  hit: 'SG_SFX_Hit', hammer: 'SG_SFX_Brawler_Weapon_Hammer_Hit', swing: 'SG_SFX_Prop_SwingBlade_Impact_01',
  bump: 'SG_SFX_Bounce_Pinball_DingImpact', spring: 'SG_SFX_LT_Springboard', splash: 'SG_SFX_WaterSplash_DunkPlop',
  count: 'SG_SFX_PropHunt_Countdown_321_v2', qualified: 'SG_SFX_Qualified', elim: 'SG_SFX_Eliminated',
  victory: 'SG_SFX_Victory', click: 'SG_SFX_Button_Click', conveyor: 'SG_SFX_RT_ConveyorBelt_01_Loop', music: 'SG_MUS_Classic_FunkyRoad_Loop',
};
const $ = id => document.getElementById(id);
const msg = $('msg'), hud = $('hud');
addEventListener('error', e => { msg.textContent = 'ERROR: ' + e.message; });
addEventListener('unhandledrejection', e => { msg.textContent = 'ERROR: ' + (e.reason && e.reason.message || e.reason); });
msg.textContent = 'Loading…';

const AC = new (window.AudioContext || window.webkitAudioContext)();
const master = AC.createGain(); master.gain.value = 0.8; master.connect(AC.destination);
const bufs = {}, tex = {}, meshGeo = {};
let LEVEL7 = null;
const texLoader = new THREE.TextureLoader(), objLoader = new OBJLoader();
const pending = new Set();
const track = (name, p) => { pending.add(name); return p.then(v => { pending.delete(name); msg.textContent = 'Loading… ' + [...pending].join(','); return v; }, e => { throw new Error(name + ': ' + (e && e.message || e)); }); };
await Promise.all([
  ...texNames.map(n => track(n, texLoader.loadAsync(T + n + '.png')).then(t => {
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; tex[n] = t;
    if (n === 'blueGradient') t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  })),
  ...meshNames.map(n => track(n, objLoader.loadAsync(M + n + '.obj')).then(o => { let g; o.traverse(c => { if (c.isMesh && !g) g = c.geometry; }); meshGeo[n] = g; })),
  track('level7', fetch('levels/level7_moving.json').then(r => r.json())).then(j => { LEVEL7 = j; }),
]);
tex.__grass = grassTexture();
// sons carregam em segundo plano (não bloqueiam a fase); play() ignora o que ainda não decodificou
Object.entries(sfxFiles).filter(([k]) => k !== 'music').forEach(([k, f]) => fetch(A_ + f + '.wav').then(r => r.arrayBuffer()).then(b => AC.decodeAudioData(b)).then(d => { bufs[k] = d; }).catch(e => console.warn('sfx', k, e)));

// ---------- cena ----------
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xc4ecff, 120, 470);
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 700);
scene.add(new THREE.HemisphereLight(0xa2b0cc, 0xb09a78, 1.35));
const sun = new THREE.DirectionalLight(0xfff0d8, 2.5);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -38, right: 38, top: 38, bottom: -38, near: 1, far: 150 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
const sunOff = new THREE.Vector3(30, 55, 22);
const sky = createSky(tex); scene.add(sky.mesh);
sky.mesh.material.uniforms.uSun.value.set(30, 55, 22);
const seaObj = createSea(tex); scene.add(seaObj.group);
const decorGroup = new THREE.Group(); scene.add(decorGroup);
let cloudUpdate = () => {};
const levelGroup = new THREE.Group(); scene.add(levelGroup);
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

// ---------- áudio ----------
function play(name, { vol = 1, rate = 1, loop = false, at = null } = {}) {
  const b = bufs[name]; if (!b || AC.state !== 'running') return null;
  let v = vol;
  if (at && player) v *= Math.max(0, 1 - Math.hypot(at.x - player.pos.x, at.y - player.pos.y, at.z - player.pos.z) / 38);
  if (v < 0.02) return null;
  const s = AC.createBufferSource(), g = AC.createGain();
  s.buffer = b; s.loop = loop; s.playbackRate.value = rate; g.gain.value = v;
  s.connect(g); g.connect(master); s.start();
  return { s, g };
}
let musicHandle = null, convHandle = null, ambientOn = false;
fetch(A_ + sfxFiles.music + '.wav').then(r => r.arrayBuffer()).then(b => AC.decodeAudioData(b)).then(d => { bufs.music = d; if (ambientOn) startAmbient(); }).catch(() => {});
function startAmbient() {
  ambientOn = true;
  if (!musicHandle) musicHandle = play('music', { vol: 0.28, loop: true });
  if (!convHandle) convHandle = play('conveyor', { vol: 0, loop: true });
}

// ---------- mundo (dados em shared/sim.js; aqui só a parte visual) ----------
const world = createWorld();
const { boxes, nodes, checkpoints, spinners, bumpers, movers } = world;
world.onEvent = (name, e, extra) => {   // eventos da simulação -> sons
  const at = e.pos;
  if (name === 'jump') play('jump', { vol: 0.8, at, rate: 0.95 + Math.random() * 0.1 });
  else if (name === 'dive') play('dive', { vol: 0.55, at });
  else if (name === 'land') play('land', { vol: 0.6, at });
  else if (name === 'step') play('step', { vol: e.local ? 0.7 : 0.35, at, rate: 0.9 + Math.random() * 0.2 });
  else if (name === 'spring') play('spring', { vol: 0.9, at });
  else if (name === 'splash') play('splash', { vol: 0.8, at });
  else if (name === 'hit') { if (extra === 'hammer') { play('hammer', { vol: 1, at }); play('hit', { vol: 0.7, at }); } else play('bump', { vol: 1, at }); }
};

let level = null, levelIndex = 0, roundTime = 120;
const THEMES = {
  grass: { top: '__grass', side: 'TEX_StoneWall01_A_000_Ti', tint: 0xffffff, sideTint: 0xd8c4b0, tile: 4, grass: true, rim: 0x7ad866 },
  stone: { top: 'TEX_StoneWall01_A_000_Ti', side: 'TEX_StoneWall01_A_000_Ti', tint: 0xf4dcc6, sideTint: 0xcdb39c, tile: 4, rim: 0xeed9b0 },
  metal: { top: 'TEX_RocketDoomMetalfloor_A_000_Ti', side: 'TEX_RocketDoomMetalfloor_A_000_Ti', tint: 0x9fb4d0, sideTint: 0x6a7c98, tile: 4, rim: 0xffd24d },
  purple: { top: 'TEX_BrickWall01_A_000_Ti', side: 'TEX_BrickWall01_A_000_Ti', tint: 0xd9b8ff, sideTint: 0x9a7cd0, tile: 4, rim: 0xe3c9ff },
  gold: { top: 'groundTexture1', side: 'wallTexture', tint: 0xffa657, sideTint: 0xc27200, tile: 4, rim: 0xffe38a },
  tramp: { top: 'TEX_Trampoline_A_000_Ti', side: 'TEX_Trampoline_A_000_Ti', tint: 0xffffff, sideTint: 0xaaaaaa, tile: 6 },
  ice: { top: 'groundTexture1', side: 'wallTexture', tint: 0xbfeaff, sideTint: 0x7fb6dc, tile: 4, rim: 0xffffff },
  sand: { top: 'TEX_Sand_A_000_Ti', side: 'TEX_StoneWall01_A_000_Ti', tint: 0xffffff, sideTint: 0xe8c9a0, tile: 4, rim: 0xffe9a8 },
  tileA: { top: 'groundTexture1', side: 'wallTexture', tint: 0xff9a3c, sideTint: 0xc26a1c, tile: 3 },
  tileB: { top: 'groundTexture1', side: 'wallTexture', tint: 0xffd23c, sideTint: 0xc29a1c, tile: 3 },
  night: { top: 'groundTexture1', side: 'wallTexture', tint: 0x9a7cff, sideTint: 0x5d48a8, tile: 4, rim: 0xd6c8ff },
  candy: { top: 'groundTexture1', side: 'texturetest3', tint: 0xff7ab8, sideTint: 0xc24a85, tile: 4, rim: 0xfff0f8 },
  floor7: { top: 'groundTexture1', side: 'wallTexture', tint: 0xe33d52, sideTint: 0xa83040, tile: 4 },
  wall7: { top: 'wallTexture', side: 'wallTexture', tint: 0x12968f, sideTint: 0x0d7a74, tile: 4, pillars: false },
  goal7: { top: 'groundTexture1', side: 'texturetest3', tint: 0xffa657, sideTint: 0xc27200, tile: 4 },
  mover7: { top: 'Level7Platform', side: 'Level7Cube', tint: 0xffffff, sideTint: 0xffffff, tile: 4, pillars: false },
};
const grassJobs = [], grassAvoid = [], flags = [];
function faceMat(name, rx, ry, color) {
  const t = tex[name].clone(); t.needsUpdate = true; t.repeat.set(Math.max(1, rx), Math.max(1, ry));
  return new THREE.MeshStandardMaterial({ map: t, color, roughness: 0.85, metalness: 0.0 });
}
function addBox(x0, x1, y0, y1, z0, z1, theme, extra = {}) {
  const b = recBox(world, x0, x1, y0, y1, z0, z1, extra);
  const w = x1 - x0, h = y1 - y0, d = z1 - z0, th = THEMES[theme], TL = th.tile || 6, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const sd = faceMat(th.side, d / TL, h / TL, th.sideTint), sw = faceMat(th.side, w / TL, h / TL, th.sideTint);
  const top = faceMat(th.top, w / TL, d / TL, th.tint), bot = faceMat(th.side, w / TL, d / TL, th.sideTint);
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [sd, sd, top, bot, sw, sw]);
  m.position.set(cx, (y0 + y1) / 2, cz);
  m.castShadow = m.receiveShadow = true; m.visible = !extra.invisible;
  levelGroup.add(m); b.mesh = m; b.homeX = cx;
  if (extra.invisible) return b;
  if (th.rim && w > 3 && d > 3) {   // friso elevado na borda
    const rm = new THREE.MeshStandardMaterial({ color: th.rim, roughness: 0.6 }), t = 0.24, hh = 0.1;
    [[w, d / 2 - t / 2, 0, 1], [w, -d / 2 + t / 2, 0, 1], [t, 0, w / 2 - t / 2, 0], [t, 0, -w / 2 + t / 2, 0]].forEach(([len, oz, ox, alongX]) => {
      const r = new THREE.Mesh(new THREE.BoxGeometry(alongX ? len : t, hh, alongX ? t : d - 2 * t), rm);
      r.position.set(cx + ox, y1 + hh / 2 - 0.01, cz + oz); r.castShadow = r.receiveShadow = true; levelGroup.add(r);
    });
  }
  if (th.pillars !== false && extra.pillars !== false && w * d > 20 && y0 > -3 && !extra.mover) {   // colunas de pedra até o mar
    const pm = faceMat('TEX_StoneWall01_A_000_Ti', 1, 4, 0xd4bda6), len = y0 - (SEA_Y - 1.2);
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
      const c = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.58, len, 12), pm);
      c.position.set(cx + sx * Math.max(0.2, w / 2 - 0.9), y0 - len / 2, cz + sz * Math.max(0.2, d / 2 - 0.9)); c.castShadow = true; levelGroup.add(c);
    }
  }
  if (th.grass && w * d > 6) grassJobs.push({ rect: [x0 + 0.15, x1 - 0.15, z0 + 0.15, z1 - 0.15], y: y1 });
  return b;
}
const platform = (cx, topY, z0, z1, w, theme, extra) => addBox(cx - w / 2, cx + w / 2, topY - 1, topY, z0, z1, theme, extra);
const flatStrip = (cx, y, cz, w, d, texName, rx, ry, tint = 0xffffff) => {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), faceMat(texName, rx, ry, tint));
  m.rotation.x = -Math.PI / 2; m.position.set(cx, y, cz); m.receiveShadow = true; levelGroup.add(m); return m;
};
function meshFrom(geoName, texName, sx, sy, sz, centerXZ = true) {
  const g = meshGeo[geoName].clone(); g.computeBoundingBox();
  const bb = g.boundingBox, c = bb.getCenter(new THREE.Vector3());
  g.translate(centerXZ ? -c.x : 0, 0, centerXZ ? -c.z : 0);
  const m = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ map: tex[texName], roughness: 0.6 }));
  m.scale.set(sx, sy, sz); m.castShadow = m.receiveShadow = true; return m;
}
function addSpinner(cx, cy, cz, L, speed) {
  const s = recSpinner(world, cx, cy, cz, L, speed);
  const grp = new THREE.Group(); grp.position.set(cx, cy, cz);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(L * 2, 0.32, 0.32), new THREE.MeshStandardMaterial({ color: 0x8a5a32, roughness: 0.7 }));
  shaft.castShadow = true; grp.add(shaft);
  for (const sd of [-1, 1]) {
    const head = meshFrom('MSH_SwingObstacleHammer_A_000_LOD0', 'SwingObstacleHammer', 1, 1, 1);
    head.geometry.computeBoundingBox(); const bb = head.geometry.boundingBox;
    head.geometry.translate(0, -(bb.min.y + bb.max.y) / 2, 0);
    head.position.x = sd * L; grp.add(head);
  }
  grp.add(meshFrom('SwingObstacleHammerAxle', 'SwingObstacleHammer', 1.6, 1.6, 1.6));
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.55, cy + 1, 14), new THREE.MeshStandardMaterial({ color: 0x555a66, roughness: 0.5, metalness: 0.4 }));
  post.position.set(cx, cy / 2 - 0.5, cz); post.castShadow = true; levelGroup.add(post);
  levelGroup.add(grp); s.mesh = grp; return s;
}
function addBumper(x, z, topY = 0) {
  const b = recBumper(world, x, z, topY);
  const m = meshFrom('Bumper', 'Bumper1', b.r / 0.27, 1.8, b.r / 0.27);
  m.position.set(x, topY, z); levelGroup.add(m); b.mesh = m; return b;
}
function addMover({ a, b, size, speed = CFG.moverSpeed, phase = 0, theme = 'mover7' }) {
  const [sx, sy, sz] = size;
  const box = addBox(a[0] - sx / 2, a[0] + sx / 2, a[1] - sy / 2, a[1] + sy / 2, a[2] - sz / 2, a[2] + sz / 2, theme, { mover: true });
  registerMover(world, box, a, b, size, speed, phase); return box;
}
function addTrampoline(cx, z0, z1, w, topY, bounce = 21) {
  const box = addBox(cx - w / 2, cx + w / 2, topY - 1, topY, z0, z1, 'tramp', { bounce, invisible: true });
  const vis = meshFrom('TrampolineRound', 'TrampolineRound2', w / 2.75, 1.6, Math.abs(z1 - z0) / 2.75);
  vis.position.set(cx, topY, (z0 + z1) / 2); levelGroup.add(vis); box.vis = vis; box.squash = 0;
  return box;
}
function addFlag(x, y, z, side) {
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 3.4, 8), new THREE.MeshStandardMaterial({ color: 0xf0e6c8, roughness: 0.5 }));
  pole.position.set(x, y + 1.7, z); pole.castShadow = true; levelGroup.add(pole);
  const ft = tex.FlagpoleTexture.clone(); ft.needsUpdate = true; ft.repeat.set(0.62, 1); ft.offset.set(0.38, 0);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.0, 6, 1), new THREE.MeshStandardMaterial({ map: ft, side: THREE.DoubleSide, roughness: 0.8 }));
  cloth.position.set(x + side * 0.85, y + 2.85, z); cloth.rotation.y = Math.PI / 2; cloth.castShadow = true; levelGroup.add(cloth);
  flags.push({ cloth, base: cloth.rotation.y, ph: Math.random() * 6 });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8), new THREE.MeshStandardMaterial({ color: 0xffd24d })); ball.position.set(x, y + 3.45, z); levelGroup.add(ball);
}
function addCheckpoint(x, y, z, w = 16, d = 1.2, respawnY = y + 0.2) {
  const c = recCheckpoint(world, x, y, z, respawnY);
  flatStrip(x, y + 0.05, z, w, d, 'TEX_CheckerColoured_A_000_Ti', w, d, 0xffe14d);
  grassAvoid.push([x - w / 2 - 0.3, x + w / 2 + 0.3, z - d / 2 - 0.3, z + d / 2 + 0.3]);
  addFlag(x - w / 2 + 0.3, y, z, 1); addFlag(x + w / 2 - 0.3, y, z, -1);
  return c;
}
function addFinish(x, y, z, w) {
  world.finishZ = z;
  flatStrip(x, y + 0.05, z, w, 2.4, 'TEX_MichelangeloFinishLine_A_000_Bs', w / 2, 1.2);
  grassAvoid.push([x - w / 2 - 0.5, x + w / 2 + 0.5, z - 1.5, z + 1.5]);
  const arch = new THREE.Group();
  const pm = faceMat('Level7Platform', 1, 3, 0xffffff);
  for (const s of [-1, 1]) { const p = new THREE.Mesh(new THREE.BoxGeometry(0.9, 7, 0.9), pm); p.position.set(x + s * w / 2, y + 3.5, z); arch.add(p); }
  const bt = tex.Goal1.clone(); bt.needsUpdate = true; bt.repeat.set(1, 0.3); bt.offset.set(0, 0.7);   // faixa vermelha "FINISH" da textura Goal1 do jogo
  const edge = new THREE.MeshStandardMaterial({ color: 0xe53b2c, roughness: 0.6 });
  const banner = new THREE.Mesh(new THREE.BoxGeometry(w + 0.9, 2.4, 0.5), [edge, edge, edge, edge, new THREE.MeshStandardMaterial({ map: bt }), new THREE.MeshStandardMaterial({ map: bt })]);
  banner.position.set(x, y + 7.4, z); arch.add(banner);
  arch.children.forEach(c => { c.castShadow = true; }); levelGroup.add(arch);
  addFlag(x - w / 2 - 1.2, y, z, 1); addFlag(x + w / 2 + 1.2, y, z, -1);
}
const API = {
  vec, world, platform, box: addBox, mover: addMover, spinner: addSpinner, bumper: addBumper, trampoline: addTrampoline, checkpoint: addCheckpoint, finish: addFinish,
  node: (x, z, y) => recNode(world, x, z, y), strip: flatStrip, conveyorZone: z => { world.conveyorZone = z; }, setFinishY: y => { world.finishY = y; },
  startPlatform(theme = 'grass', w = 16) { platform(0, 0, -12, 6, w, theme); flatStrip(0, 0.05, -2, w, 1.4, 'TEX_CheckerColoured_A_000_Ti', w - 2, 1.5); grassAvoid.push([-w / 2, w / 2, -2.8, -1.2]); recNode(world, 0, -8, 0); },
};
function finalizeLevel() {
  const budget = { left: 16000 };
  for (const j of grassJobs) addGrass(levelGroup, j.rect, j.y, grassAvoid, budget);
  decorGroup.children.slice().forEach(c => decorGroup.remove(c));
  const zs = boxes.flatMap(b => [b.min.z, b.max.z]).filter(z => z > -1e4);
  const zMin = Math.min(...zs), zMax = Math.max(...zs);
  createIslands(decorGroup, meshGeo, tex, zMin, zMax, 14);
  cloudUpdate = createClouds(decorGroup, zMin, zMax, 28);
}
function clearLevel() {
  levelGroup.children.slice().forEach(c => {
    levelGroup.remove(c);
    c.traverse(o => { if (o.geometry && !Object.values(meshGeo).includes(o.geometry)) o.geometry.dispose(); });
  });
  clearWorld(world); grassJobs.length = grassAvoid.length = flags.length = 0;
}
const LEVELS = makeLevels({ level7: LEVEL7 });
function loadLevel(i) {
  levelIndex = i; level = LEVELS[i];
  clearLevel(); applyLevelToWorld(world, level); roundTime = world.roundTime;
  level.build(API); finalizeLevel(); resetWorldClock(world);
  const E = level.env || {}, sd = E.sun || [30, 55, 22];
  sky.mesh.material.uniforms.uTint.value.set(...(E.tint || [1, 1, 1])); sky.mesh.material.uniforms.uSun.value.set(...sd); sunOff.set(...sd);
  scene.fog.color.set(E.fog ?? 0xc4ecff); sun.color.set(E.sunColor ?? 0xfff0d8);
  const hz = new THREE.Color(E.fog ?? 0xc4ecff); sky.mesh.material.uniforms.uHaze.value.set(hz.r, hz.g, hz.b);
  const sc = new THREE.Color(E.sea ?? 0x66c8ff);
  seaObj.base.material.color.copy(sc); seaObj.base.material.emissive.copy(sc).multiplyScalar(0.3); seaObj.over.material.color.copy(sc);
}

// sincroniza a parte visual com o estado da simulação (martelos, plataformas, pisos que caem/piscam, bumpers, trampolins)
function syncWorldVisuals(dt) {
  for (const s of spinners) s.mesh.rotation.y = -s.ang;
  for (const m of movers) m.box.mesh.position.set(m.cur.x, m.cur.y, m.cur.z);
  for (const b of boxes) {
    if (b.fall || b.toggle) { b.mesh.visible = !b.dead && !b.blink; if (b.fall) b.mesh.position.x = b.homeX + (b.shake || 0); }
    if (b.vis) { if (b.squash > 0) b.squash -= dt; b.vis.scale.y = 1.6 * (b.squash > 0 ? 1 - Math.sin(b.squash / 0.35 * Math.PI) * 0.45 : 1); }
  }
  for (const b of bumpers) { if (b.squash > 0) b.squash -= dt; const k = b.squash > 0 ? 1 + Math.sin(b.squash / 0.25 * Math.PI) * 0.18 : 1; b.mesh.scale.x = b.mesh.scale.z = (b.r / 0.27) * k; }
}

// ---------- corredores (estado de simulação + visual no mesmo objeto) ----------
let racers = [], player = null;
const byIdx = new Map();
function makeRacer(i, pk, name, local) {
  const r = createRacer(i);
  const [key, label] = ROSTER[pk % ROSTER.length];
  r.pk = pk; r.pokemon = label; r.label = name || label; r.local = local; r.remote = !local; r.bot = false;
  r.mesh = new THREE.Group();
  const body = buildPokemon(key);
  body.position.y = -0.75;                     // o pivô fica no centro de massa
  r.pivot = new THREE.Group(); r.pivot.position.y = 0.75; r.pivot.add(body); r.mesh.add(r.pivot); r.body = body;
  r.anim = new Animator(body.userData.rig, r.pivot, body);
  const tag = nameSprite(local ? r.label + ' (you)' : r.label, local); tag.position.y = 2.45; r.mesh.add(tag); r.tag = tag;
  scene.add(r.mesh); r.mesh.visible = false;
  return r;
}
function disposeRacer(r) {
  scene.remove(r.mesh);
  r.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : []; ms.forEach(m => { if (m.map) m.map.dispose(); m.dispose(); }); });
}
function clearRacers() { racers.forEach(disposeRacer); racers = []; byIdx.clear(); player = null; }
function addRacer(r) { racers.push(r); byIdx.set(r.i, r); if (r.local) player = r; return r; }

// ---------- estado do cliente ----------
// state: home | menu | connecting | lobby | countdown | race | end
let mode = 'offline';
let state = 'home', t = 0, finishedCount = 0, endTimer = 0, raceElapsed = 0, lobbyInfo = { left: 0, humans: 0 };
const CHOICE = { name: '', pk: 0 };
try { CHOICE.name = localStorage.getItem('sl_name') || ''; CHOICE.pk = +localStorage.getItem('sl_pk') || 0; } catch { /* ignore */ }
const keys = {};
let jumpQ = false, diveQ = false, camYaw = 0, camPitch = 0.35, msgTimer = 0, nextAt = 0, nextAction = null;
const ord = n => n + (n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th'));
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const unlock = () => { if (AC.state !== 'running') AC.resume(); };

// ---------- espectador ----------
// Evidência (EVIDENCIA.md §J): UISpectateMode, NextSpectate/PreviousSpectate, FindSpectateTarget, SpectateModeZoomMultiplier... Valores abaixo são NOSSOS.
const spec = { active: false, index: 0, lastJump: 0, dist: 9, cam: new THREE.Vector3(), focus: null };
const specEl = $('spec'), specTimeEl = $('specTime');
function specTargets() {
  const live = racers.filter(r => r !== player && !r.finished).sort((a, b) => a.pos.z - b.pos.z);   // líder primeiro
  return live.length ? live : racers.filter(r => r !== player && r.finished).sort((a, b) => a.rank - b.rank);
}
function specSwitch(dir) {
  const now = performance.now(); if (now - spec.lastJump < 250) return; spec.lastJump = now;
  const n = specTargets().length; if (!n) return;
  spec.index = ((spec.index + dir) % n + n) % n; play('click', { vol: 0.5 });
}

// ---------- tela de resultados ----------
const resultsEl = $('results');
function showResults(rows, nextName, secs) {
  const you = player ? player.i : -1;
  resultsEl.innerHTML = '<h2>Results</h2><div class="next" id="nextInfo"></div><table>' + rows.map((r, k) =>
    `<tr class="${r.rank && r.rank <= CFG.qualifySlots ? 'q' : ''}${r.i === you ? ' you' : ''}"><td>${r.rank || '–'}</td><td>${esc(r.name)}</td><td>${r.rank ? '' : 'DNF'}${r.tm != null ? r.tm.toFixed(1) + 's' : ''}</td></tr>`).join('')
    + '</table>';
  resultsEl.style.display = 'block';
  nextAt = secs; resultsEl.dataset.next = nextName;
  updateNextInfo();
}
function updateNextInfo() { const n = $('nextInfo'); if (n) n.textContent = `Next course: ${resultsEl.dataset.next} — ${Math.max(0, Math.ceil(nextAt))}s`; }
function hideResults() { resultsEl.style.display = 'none'; nextAt = 0; }

// ---------- offline (prática) ----------
function makeOfflineRacers() {
  clearRacers();
  const others = ROSTER.map((_, k) => k).filter(k => k !== CHOICE.pk);
  addRacer(makeRacer(0, CHOICE.pk, CHOICE.name || '', true));
  for (let i = 1; i < CFG.racers; i++) { const r = makeRacer(i, others[(i - 1) % others.length], '', false); r.remote = false; r.bot = true; addRacer(r); }
}
function startRoundOffline() {
  hideResults(); mode = 'offline';
  racers.forEach(r => spawnRacer(r, world.spawnFn(r.i)));
  state = 'countdown'; t = CFG.countdown; finishedCount = 0; endTimer = 0; raceElapsed = 0;
  resetWorldClock(world); world.serverTiles = false;
  camYaw = 0; msg.textContent = ''; spec.active = false; spec.index = 0; msgTimer = 0; menuEl.style.display = 'none'; $('home').style.display = 'none';
  startAmbient(); play('count', { vol: 0.9 });
}
function startOffline(levelI) {
  closeNet(); mode = 'offline';
  if (levelI != null && levelI !== levelIndex) loadLevel(levelI);
  makeOfflineRacers(); menuSel = levelIndex; startRoundOffline();
}
function finishOffline(e) {
  if (e.finished) return;
  e.finished = true; e.rank = ++finishedCount; e.finTime = raceElapsed;
  e.qualified = e.rank <= CFG.qualifySlots; e.eliminated = !e.qualified; e.victory = e.qualified;
  if (e === player) {
    msg.innerHTML = `FINISHED ${ord(e.rank)}<small>${e.qualified ? 'QUALIFIED!' : 'ELIMINATED!'}</small>`; msgTimer = 3;
    play(e.qualified ? (e.rank === 1 ? 'victory' : 'qualified') : 'elim', { vol: 0.9 });
    spec.index = 0;
  }
  if (finishedCount >= CFG.qualifySlots && !endTimer) endTimer = 3;
}
function resultRows() {
  return [...racers].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.rank - b.rank : a.pos.z - b.pos.z))
    .map(r => ({ i: r.i, name: r.label, rank: r.finished ? r.rank : 0, tm: r.finished ? r.finTime : null }));
}
function endRoundOffline() {
  state = 'end'; msgTimer = 0;
  racers.forEach(r => { if (!r.finished) r.eliminated = true; });
  msg.textContent = '';
  const nextI = (levelIndex + 1) % LEVELS.length;
  showResults(resultRows(), LEVELS[nextI].name, 9);
  nextAction = () => { loadLevel(nextI); menuSel = nextI; startRoundOffline(); };
}
function simulateOffline(dt) {
  if (state === 'countdown') { t -= dt; if (t <= 0) { state = 'race'; t = roundTime; msg.textContent = ''; } }
  else if (state === 'race') {
    t -= dt; raceElapsed += dt;
    if (endTimer > 0) { endTimer -= dt; if (endTimer <= 0) endRoundOffline(); }
    if (t <= 0 && state === 'race') endRoundOffline();
  }
  updateWorld(world, dt, racers);
  const racing = state === 'race', now = performance.now() / 1000;
  const inp = localInput(dt);
  for (const r of racers) {
    let w = { wx: 0, wz: 0, jump: false, dive: false };
    if (racing && !r.finished) {
      if (r === player) w = inp;
      else if (raceElapsed > r.startDelay) { const b = botInput(world, r, now, true); w = { wx: b[0], wz: b[1], jump: b[2], dive: b[3] }; }
    }
    if (r === player) { jumpQ = false; diveQ = false; }
    stepRacer(world, r, dt, w);
    if (racing && !r.finished && r.pos.z < world.finishZ && r.pos.y > world.finishY) finishOffline(r);
  }
}
function localInput(dt) {
  let ix = 0, iz = 0;
  if (keys.KeyW || keys.ArrowUp) iz += 1; if (keys.KeyS || keys.ArrowDown) iz -= 1;
  if (keys.KeyD || keys.ArrowRight) ix += 1; if (keys.KeyA || keys.ArrowLeft) ix -= 1;
  if (keys.KeyQ) camYaw += 1.8 * dt; if (keys.KeyZ) camYaw -= 1.8 * dt;
  const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw), rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
  let wx = fx * iz + rx * ix, wz = fz * iz + rz * ix;
  const wl = Math.hypot(wx, wz); if (wl > 1) { wx /= wl; wz /= wl; }
  return { wx, wz, jump: jumpQ, dive: diveQ };
}

// ---------- online ----------
let net = null, sendAcc = 0, myIdx = -1;
const snapBuf = [];
function wsUrl() { const q = /[?&]server=([^&]+)/.exec(location.search); if (q) return decodeURIComponent(q[1]); return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws'; }
function closeNet() { if (net) { net.close(); net = null; } snapBuf.length = 0; }
function goOnline() {
  unlock(); const nm = $('nameIn').value.trim().slice(0, 14); CHOICE.name = nm;
  try { localStorage.setItem('sl_name', nm); localStorage.setItem('sl_pk', String(CHOICE.pk)); } catch { /* ignore */ }
  $('home').style.display = 'none'; menuEl.style.display = 'none'; hideResults();
  mode = 'online'; state = 'connecting'; msg.innerHTML = 'Connecting…';
  clearRacers(); snapBuf.length = 0;
  net = openSocket(wsUrl(), {
    open() { net.send({ t: 'join', name: CHOICE.name, pk: CHOICE.pk }); },
    msg: onNetMsg,
    close() { if (mode === 'online' && state !== 'home') { msg.innerHTML = 'Disconnected<small>returning to the main screen…</small>'; setTimeout(goHome, 2200); } },
  });
  setTimeout(() => { if (state === 'connecting') { msg.innerHTML = 'Could not connect<small>returning to the main screen…</small>'; closeNet(); setTimeout(goHome, 2200); } }, 8000);
}
function buildFromSlots(slots, you) {
  clearRacers(); myIdx = you;
  for (const s of slots) {
    const r = makeRacer(s.i, s.pk, s.name, s.i === you); r.bot = !!s.bot; r.remote = s.i !== you;
    spawnRacer(r, world.spawnFn(r.i)); addRacer(r);
    if (s.fin) { r.finished = true; r.rank = s.rank; r.qualified = !!s.q; r.victory = !!s.q; }
  }
}
function onNetMsg(m) {
  if (mode !== 'online') return;
  if (m.t === 'lobby') {
    if (m.level !== levelIndex) loadLevel(m.level);
    world.serverTiles = true;
    if (state !== 'lobby' || !player) { buildFromSlots(m.slots, m.you); resetWorldClock(world); }
    else syncSlots(m.slots);
    state = 'lobby'; lobbyInfo = { left: m.left, humans: m.slots.length }; hideResults(); spec.active = false;
  } else if (m.t === 'round') {
    if (m.level !== levelIndex) loadLevel(m.level);
    world.serverTiles = true; roundTime = m.roundTime;
    buildFromSlots(m.slots, m.you); resetWorldClock(world); world.mt = m.mt || 0;
    if (m.dead) applyDead(world, m.dead);
    state = m.phase; t = m.phase === 'countdown' ? m.cd : m.left; finishedCount = m.fc || 0; endTimer = 0; raceElapsed = Math.max(0, roundTime - (m.left || roundTime));
    hideResults(); spec.active = false; spec.index = 0; msg.textContent = ''; msgTimer = 0; snapBuf.length = 0; camYaw = 0;
    startAmbient(); if (m.phase === 'countdown') play('count', { vol: 0.9 });
  } else if (m.t === 'slot') {
    replaceSlot(m);
  } else if (m.t === 'snap') {
    snapBuf.push({ rt: performance.now(), map: new Map(m.r.map(a => [a[0], a])) }); if (snapBuf.length > 8) snapBuf.shift();
    if (m.mt != null) { const err = m.mt - world.mt; if (Math.abs(err) > 0.3) world.mt = m.mt; else world.mt += err * 0.15; }
    if (m.dead) applyDead(world, m.dead);
    finishedCount = m.fc; if (m.left != null) t = m.left;
    if (m.ph === 'race' && state === 'countdown') { state = 'race'; msg.textContent = ''; }
    if (m.ph === 'countdown' && state === 'countdown' && m.cd != null) t = m.cd;
  } else if (m.t === 'fin') {
    const r = byIdx.get(m.i); if (!r) return;
    r.finished = true; r.rank = m.rank; r.qualified = !!m.q; r.eliminated = !m.q; r.victory = !!m.q; r.finTime = m.tm;
    if (r.local) {
      msg.innerHTML = `FINISHED ${ord(m.rank)}<small>${m.q ? 'QUALIFIED!' : 'ELIMINATED!'}</small>`; msgTimer = 3;
      play(m.q ? (m.rank === 1 ? 'victory' : 'qualified') : 'elim', { vol: 0.9 }); spec.index = 0;
    }
  } else if (m.t === 'end') {
    state = 'end'; msg.textContent = ''; msgTimer = 0;
    showResults(m.rows, m.next.name, m.next.in);
    nextAction = null;
  } else if (m.t === 'full') {
    msg.innerHTML = 'Server is full<small>try again in a moment</small>'; closeNet(); setTimeout(goHome, 2500);
  }
}
function syncSlots(slots) {   // lobby: alguém entrou/saiu
  const ids = new Set(slots.map(s => s.i));
  for (const r of [...racers]) if (!ids.has(r.i) && !r.local) { disposeRacer(r); racers.splice(racers.indexOf(r), 1); byIdx.delete(r.i); }
  for (const s of slots) if (!byIdx.has(s.i)) { const r = makeRacer(s.i, s.pk, s.name, false); r.bot = !!s.bot; spawnRacer(r, world.spawnFn(r.i)); addRacer(r); }
}
function replaceSlot(s) {
  const old = byIdx.get(s.i);
  const r = makeRacer(s.i, s.pk, s.name, false); r.bot = !!s.bot;
  if (old) { r.pos.x = old.pos.x; r.pos.y = old.pos.y; r.pos.z = old.pos.z; r.yaw = old.yaw; racers[racers.indexOf(old)] = r; disposeRacer(old); }
  else { spawnRacer(r, world.spawnFn(r.i)); racers.push(r); }
  byIdx.set(s.i, r);
}
function simulateOnline(dt) {
  if (state === 'countdown') t -= dt; else if (state === 'race') { t -= dt; raceElapsed += dt; }
  updateWorld(world, dt, player ? [player] : []);
  if (!player) return;
  const inp = localInput(dt);
  const can = (state === 'race' || state === 'lobby') && !player.finished;
  stepRacer(world, player, dt, can ? inp : { wx: 0, wz: 0, jump: false, dive: false });
  jumpQ = false; diveQ = false;
  if (state === 'race' && !player.finished && player.pos.z < world.finishZ && player.pos.y > world.finishY) { player.finished = true; if (net) net.send({ t: 'fin', p: [player.pos.x, player.pos.y, player.pos.z] }); }
}
function sendState(dt) {
  if (!net || !player || state === 'end' || state === 'connecting') return;
  sendAcc += dt; if (sendAcc < 0.05) return; sendAcc = 0;
  const r = v => Math.round(v * 100) / 100, p = player;
  const fl = (p.grounded ? 1 : 0) | (p.dive > 0 ? 2 : 0) | (p.stun > 0 ? 4 : 0) | (p.victory ? 8 : 0);
  net.send({ t: 's', p: [r(p.pos.x), r(p.pos.y), r(p.pos.z), r(p.yaw), r(p.vel.x), r(p.vel.y), r(p.vel.z), fl] });
}
function applyRemote() {
  if (!snapBuf.length) return;
  const target = performance.now() - 110;
  let a = snapBuf[0], b = null;
  for (let k = snapBuf.length - 1; k >= 0; k--) { if (snapBuf[k].rt <= target) { a = snapBuf[k]; b = snapBuf[k + 1] || null; break; } }
  const f = b ? Math.min(1, Math.max(0, (target - a.rt) / (b.rt - a.rt || 1))) : 0;
  for (const r of racers) {
    if (r.local) continue;
    const pa = a.map.get(r.i); if (!pa) continue; const pb = b ? b.map.get(r.i) : null, pn = pb || pa;
    const far = pb && Math.hypot(pb[1] - pa[1], pb[3] - pa[3]) > 6;
    const k = pb && !far ? f : (pb ? 1 : 0);
    r.pos.x = pa[1] + (pn[1] - pa[1]) * k; r.pos.y = pa[2] + (pn[2] - pa[2]) * k; r.pos.z = pa[3] + (pn[3] - pa[3]) * k;
    let dy = pn[4] - pa[4]; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); r.yaw = pa[4] + dy * k;
    r.vel.x = pn[5]; r.vel.y = pn[6]; r.vel.z = pn[7];
    const fl = pn[8]; r.grounded = !!(fl & 1); r.dive = fl & 2 ? 1 : 0; r.stun = fl & 4 ? 1 : 0;
    if (fl & 16) { r.finished = true; r.victory = !!(fl & 8) || r.victory; }
  }
}

// ---------- tela inicial (nome + personagem) e menu de prática ----------
const homeEl = $('home'), menuEl = $('menu');
let preview = null, menuSel = 0;
function setPreview() {
  if (preview) { scene.remove(preview.g); }
  const g = new THREE.Group(), body = buildPokemon(ROSTER[CHOICE.pk][0]); body.position.y = -0.75;
  const pivot = new THREE.Group(); pivot.position.y = 0.75; pivot.add(body); g.add(pivot);
  g.position.set(0, 0.05, -1.5); scene.add(g);
  preview = { g, anim: new Animator(body.userData.rig, pivot, body), yaw: 0.5 };
}
function buildPicker() {
  const pk = $('picker'); pk.innerHTML = '';
  ROSTER.forEach(([, label], k) => {
    const b = document.createElement('button'); b.textContent = label; b.className = k === CHOICE.pk ? 'sel' : '';
    b.onclick = () => { CHOICE.pk = k; buildPicker(); setPreview(); play('click', { vol: 0.5 }); };
    pk.appendChild(b);
  });
}
function goHome() {
  closeNet(); mode = 'offline'; state = 'home'; hideResults(); spec.active = false; clearRacers();
  menuEl.style.display = 'none'; homeEl.style.display = 'block'; msg.textContent = ''; hud.textContent = ''; $('spec').style.display = 'none'; $('specTime').style.display = 'none';
  $('nameIn').value = CHOICE.name; buildPicker(); setPreview();
  if (levelIndex !== 0) loadLevel(0);
}
function showPracticeMenu() {
  state = 'menu'; homeEl.style.display = 'none'; hideResults(); spec.active = false;
  menuEl.style.display = 'block'; hud.textContent = ''; msg.textContent = '';
  menuEl.innerHTML = '<div class="hint" style="margin-bottom:6px">Practice (offline) — choose a course</div>' +
    LEVELS.map((l, i) => `<div class="item${i === menuSel ? ' sel' : ''}" data-i="${i}"><span>${i < 9 ? i + 1 : i === 9 ? 0 : '·'}</span>${esc(l.name)}<em>${i === 1 ? 'real layout' : 'original'}</em></div>`).join('') + '<div class="hint">↑ ↓ + Enter, number keys, or click · Esc: back</div>';
  const selEl = menuEl.querySelector('.sel'); if (selEl) selEl.scrollIntoView({ block: 'nearest' });
  menuEl.querySelectorAll('.item').forEach(el => el.addEventListener('click', ev => { ev.stopPropagation(); menuSel = +el.dataset.i; unlock(); startOffline(menuSel); }));
}
$('playBtn').onclick = () => goOnline();
$('practiceBtn').onclick = () => { unlock(); showPracticeMenu(); };
$('nameIn').addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') goOnline(); });

// ---------- entrada ----------
addEventListener('keydown', e => {
  unlock();
  if (state === 'home') {
    if (document.activeElement === $('nameIn')) return;
    if (e.code === 'ArrowLeft') { CHOICE.pk = (CHOICE.pk + ROSTER.length - 1) % ROSTER.length; buildPicker(); setPreview(); }
    else if (e.code === 'ArrowRight') { CHOICE.pk = (CHOICE.pk + 1) % ROSTER.length; buildPicker(); setPreview(); }
    else if (e.code === 'Enter') goOnline();
    return;
  }
  if (state === 'menu') {
    const dig = { Digit1: 0, Digit2: 1, Digit3: 2, Digit4: 3, Digit5: 4, Digit6: 5, Digit7: 6, Digit8: 7, Digit9: 8, Digit0: 9 }[e.code];
    if (dig != null && dig < LEVELS.length) { menuSel = dig; startOffline(dig); return; }
    if (e.code === 'ArrowDown' || e.code === 'KeyS') menuSel = (menuSel + 1) % LEVELS.length;
    else if (e.code === 'ArrowUp' || e.code === 'KeyW') menuSel = (menuSel + LEVELS.length - 1) % LEVELS.length;
    else if (e.code === 'Enter' || e.code === 'Space') { startOffline(menuSel); return; }
    else if (e.code === 'Escape') { goHome(); return; }
    else return;
    showPracticeMenu(); e.preventDefault(); return;
  }
  if (e.repeat) return; keys[e.code] = true;
  if (spec.active && (e.code === 'ArrowLeft' || e.code === 'KeyA')) specSwitch(-1);
  if (spec.active && (e.code === 'ArrowRight' || e.code === 'KeyD')) specSwitch(1);
  if (e.code === 'Space') { jumpQ = true; e.preventDefault(); }
  if (e.code === 'ShiftLeft' || e.code === 'KeyE' || e.code === 'KeyF') diveQ = true;
  if (mode === 'offline') {
    if (e.code === 'KeyR') startRoundOffline();
    if (e.code === 'KeyN') { loadLevel((levelIndex + 1) % LEVELS.length); menuSel = levelIndex; startRoundOffline(); }
    if (e.code === 'KeyB') { loadLevel((levelIndex + LEVELS.length - 1) % LEVELS.length); menuSel = levelIndex; startRoundOffline(); }
  }
  if (e.code === 'KeyM' || e.code === 'Escape') { if (mode === 'online') goHome(); else { menuSel = levelIndex; showPracticeMenu(); } }
});
addEventListener('keyup', e => { keys[e.code] = false; });
let drag = false, dragMoved = false;
renderer.domElement.addEventListener('mousedown', () => { unlock(); drag = true; dragMoved = false; });
addEventListener('mouseup', e => {
  if (drag && !dragMoved && spec.active) { const fx = e.clientX / innerWidth; if (fx < 0.33) specSwitch(-1); else if (fx > 0.67) specSwitch(1); }
  drag = false;
});
addEventListener('mousemove', e => { if (drag) { if (Math.abs(e.movementX) + Math.abs(e.movementY) > 2) dragMoved = true; camYaw -= e.movementX * 0.005; camPitch = Math.max(0.05, Math.min(1.2, camPitch + e.movementY * 0.004)); } });

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  if (player && (state === 'countdown' || state === 'race' || state === 'end' || state === 'lobby')) {
    const sub = 2;
    for (let s = 0; s < sub; s++) { if (mode === 'offline') simulateOffline(dt / sub); else simulateOnline(dt / sub); }
  }
  if (mode === 'online') { sendState(dt); applyRemote(); }
  if (nextAt > 0) {
    nextAt -= dt; updateNextInfo();
    if (nextAt <= 0 && mode === 'offline' && nextAction) { const a = nextAction; nextAction = null; a(); }
  }
  render(dt);
  requestAnimationFrame(frame);
}
function render(dt = 0) {
  syncWorldVisuals(dt);
  const homeView = !player;
  for (const r of racers) {
    r.mesh.position.set(r.pos.x, r.pos.y, r.pos.z);
    r.mesh.rotation.y = r.yaw;
    r.anim.update(r, dt);
    const dist = camera.position.distanceTo(r.mesh.position), sc = Math.min(2.2, Math.max(0.45, dist / 13));
    r.tag.scale.set(2.2 * sc, 0.55 * sc, 1);
    r.mesh.visible = !(r.eliminated && !r.finished && state === 'end');
  }
  const tn = performance.now() / 1000;
  if (homeView) {
    // tela inicial: personagem escolhido girando diante da câmera
    if (preview) { preview.yaw += dt * 0.8; preview.g.rotation.y = preview.yaw; preview.anim.update({ vel: { x: 0, y: 0, z: 0 }, grounded: true, dive: 0, stun: 0, victory: false }, dt); }
    camera.position.set(0, 1.7, 4.6); camera.lookAt(0, -0.35, -1.5);
    sky.update(camera, tn); seaObj.update(tn, 0, -20); grassUniforms.uTime.value = tn; cloudUpdate(dt);
    sun.position.set(sunOff.x, 55, sunOff.z - 1.5); sun.target.position.set(0, 0, -1.5);
    for (const f of flags) f.cloth.rotation.y = f.base + Math.sin(tn * 2.2 + f.ph) * 0.18;
    renderer.render(scene, camera); return;
  }
  if (preview) { scene.remove(preview.g); preview = null; }
  if (convHandle) convHandle.g.gain.value = (world.conveyorZone && player.pos.z < world.conveyorZone[1] && player.pos.z > world.conveyorZone[0]) ? Math.max(0, 0.5 - Math.abs(player.pos.x) / 14) : 0;
  spec.active = player.finished && (state === 'race' || state === 'end' || state === 'countdown');
  let focus = player;
  if (spec.active) { const L = specTargets(); if (L.length) focus = L[((spec.index % L.length) + L.length) % L.length]; }
  spec.focus = focus;
  if (spec.active) spec.cam.lerp(focus.pos, 1 - Math.exp(-dt * 6)); else spec.cam.copy(player.pos);
  spec.dist += ((spec.active ? 7.4 : 9) - spec.dist) * (1 - Math.exp(-dt * 2.5));   // aproxima ao espectar
  const tx = spec.cam.x, ty = spec.cam.y + 1.2, tz = spec.cam.z, d = spec.dist;
  camera.position.set(tx + Math.sin(camYaw) * Math.cos(camPitch) * d, ty + Math.sin(camPitch) * d, tz + Math.cos(camYaw) * Math.cos(camPitch) * d);
  camera.lookAt(tx, ty, tz);
  sun.position.set(tx + sunOff.x, spec.cam.y + sunOff.y, tz + sunOff.z); sun.target.position.set(tx, spec.cam.y, tz);
  sky.update(camera, tn); seaObj.update(tn, tx, tz); grassUniforms.uTime.value = tn; cloudUpdate(dt);
  for (const f of flags) f.cloth.rotation.y = f.base + Math.sin(tn * 2.2 + f.ph) * 0.18;
  if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0 && state === 'race') msg.textContent = ''; }
  if (spec.active) {
    specEl.style.display = 'block';
    specEl.innerHTML = `<b>Spectating</b><span>${focus === player ? '' : esc(focus.label)}</span><small>Switch Target &nbsp;<kbd>&#9664;</kbd><kbd>&#9654;</kbd>&nbsp; or click the screen sides</small>`;
    specTimeEl.style.display = state === 'end' ? 'none' : 'block';
    specTimeEl.innerHTML = `Time left<b>${Math.max(0, Math.ceil(endTimer > 0 ? endTimer : t))}</b>`;
  } else { specEl.style.display = 'none'; specTimeEl.style.display = 'none'; }
  if (state === 'lobby') {
    lobbyInfo.left -= dt; const c = Math.max(0, Math.ceil(lobbyInfo.left));
    msg.innerHTML = `Starting in ${c}<small>${lobbyInfo.humans}/${CFG.racers} players — bots fill the empty spots</small>`;
    hud.textContent = level.name;
  } else if (state === 'countdown') {
    const c = Math.ceil(t); msg.textContent = c > 0 ? String(c) : 'GO!';
    hud.textContent = level.name;
  } else if (state === 'race' || state === 'end') {
    const order = [...racers].sort((a, b) => (b.finished - a.finished) || (a.finished ? a.rank - b.rank : a.pos.z - b.pos.z));
    hud.innerHTML = `${ord(order.indexOf(player) + 1)} / ${racers.length} &nbsp;|&nbsp; Qualified: ${Math.min(finishedCount, CFG.qualifySlots)}/${CFG.qualifySlots} &nbsp;|&nbsp; Time: ${Math.max(0, Math.ceil(t))}s &nbsp;|&nbsp; ${esc(level.name)}`;
    if (state === 'race' && msg.textContent === 'GO!') msg.textContent = '';
  }
  renderer.render(scene, camera);
}

// ---------- início ----------
loadLevel(0); goHome();
if (location.search.includes('auto')) {
  const m = /level=(\d+)/.exec(location.search); unlock(); startOffline(m ? +m[1] - 1 : 0);
}
requestAnimationFrame(frame);
window.__dbg = {
  world, get racers() { return racers; }, get player() { return player; }, keys, loadLevel, startOffline, goOnline, goHome,
  simulate: simulateOffline, render, setState(v) { state = v; },
  startRound() { makeOfflineRacers(); startRoundOffline(); },
  get state() { return state; }, get t() { return t; }, get finishedCount() { return finishedCount; }, get levelIndex() { return levelIndex; }, get levelCount() { return LEVELS.length; },
  get nodes() { return nodes; }, get movers() { return movers; }, get mode() { return mode; },
  env() { return { tint: sky.mesh.material.uniforms.uTint.value.toArray(), fog: scene.fog.color.getHexString(), sea: seaObj.base.material.color.getHexString(), lvl: level.name, hasEnv: !!level.env }; },
};
