// Fases (compartilhado: o navegador constrói com malhas, o servidor constrói só a geometria/física).
// Cada fase = { name, env, time, lanes, spawn, build(A) }. A = API de construção (platform, box, mover, spinner, bumper, trampoline,
// checkpoint, finish, node, strip, startPlatform, setFinishY, conveyorZone, vec, world).
// Fases 1 e 2 vêm do jogo base; "Moving" é reconstruída de dados reais (data.level7). As outras 10 são desenhos nossos.
const rng = seed => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const helpers = A => ({
  line: (x, z0, z1, step = 6, y = 0) => { for (let z = z0; z >= z1; z -= step) A.node(x, z, y); },
  finishAt: (x, y, z, w) => { A.finish(x, y, z, w); A.setFinishY(y - 0.6); },
});
const defaultSpawn = i => ({ x: (i % 4 - 1.5) * 3, y: 0.05, z: 3 - Math.floor(i / 4) * 2.2 });

export function makeLevels(data) {
  // ------------------------------------------------------------------ 1. Practice Course (nossa)
  const course = {
    name: 'Practice Course',
    build(A) {
      const V = A.vec, node = A.node;
      A.platform(0, 0, -12, 6, 16, 'grass');
      A.strip(0, 0.03, -2, 16, 1.4, 'TEX_CheckerColoured_A_000_Ti', 14, 1.5);
      node(0, -8);
      for (let i = 0; i < 7; i++) {          // 7 pedras: uma 8ª sobreporia o checkpoint 1
        const z = -16 - i * 5.4, x = i % 2 ? 1.2 : -1.2;
        A.platform(x, 0, z - 1.6, z + 1.6, 3.6, 'stone');
        node(x, z);
      }
      A.platform(0, 0, -62, -50, 16, 'grass'); A.checkpoint(0, 0, -56); node(0, -56);
      A.platform(0, 0, -100, -65, 12, 'metal', { conv: V(0, 0, -3.2) });
      A.conveyorZone([-105, -60]);
      A.spinner(0, 0.7, -78, 4.8, 1.2);
      A.spinner(0, 0.7, -90, 4.8, -1.4);
      node(0, -66); node(0, -100);
      A.platform(0, 0, -115, -102.5, 16, 'grass'); A.checkpoint(0, 0, -109); node(0, -109);
      A.platform(0, 0, -147, -117.5, 18, 'grass');
      [[-4, -125], [4, -130], [0, -135], [-5, -140], [5, -143]].forEach(([x, z]) => A.bumper(x, z));
      node(0, -121); node(0, -132); node(0, -146);
      A.trampoline(0, -152, -149, 4, 0, 20); node(0, -150.5);
      A.platform(0, 4, -166, -154, 16, 'grass'); node(0, -160, 4);
      A.checkpoint(0, 4, -160);
      A.platform(0, 4, -193, -168.5, 18, 'purple');
      A.spinner(0, 4.7, -180, 7.5, 1.4);
      A.spinner(0, 4.7, -187, 7.5, -1.7);
      node(0, -170, 4); node(0, -192, 4);
      A.platform(0, 4, -215, -195.5, 18, 'gold');
      node(0, -210, 4);
      A.finish(0, 4, -205, 18); A.setFinishY(3.5);
    },
  };

  // ------------------------------------------------------------------ 2. Moving: reconstruída de "level7_moving" (dados reais em data.level7)
  //   REAL: posição/tamanho dos 39 BoxStaticColliders alinhados, extremos A/B das MovingPlatforms, checkpoints, chegada, martelo, waypoints de IA.
  //   NOSSO: velocidade das plataformas, braço/velocidade do martelo, texturas. Os 23 colisores girados (cantos diagonais) foram omitidos.
  const moving = {
    name: 'Moving (rebuilt from level7_moving)', lanes: true,
    spawn: i => ({ x: (i % 4 - 1.5) * 0.9, y: 0.55, z: 3 - Math.floor(i / 4) * 2.2 }),
    build(A) {
      const J = data.level7, Z0 = -34;
      const X = x => -x, Z = z => -(z - Z0);   // gira 180° em Y para a fase correr para -Z como as nossas
      for (const b of J.boxes) {
        const [sx, sy, sz] = b.s, cx = X(b.c[0]), cy = b.c[1], cz = Z(b.c[2]);
        const top = cy + sy / 2, area = sx * sz;
        const th = sy < 0.9 && area > 6 ? 'floor7' : top > 3 && area > 6 ? 'goal7' : 'wall7';   // classificação por tamanho (nossa); cores reais
        A.box(cx - sx / 2, cx + sx / 2, cy - sy / 2, cy + sy / 2, cz - sz / 2, cz + sz / 2, th);
      }
      J.moving.forEach((m, i) => {
        A.mover({ a: [X(m.a[0]), m.a[1], Z(m.a[2])], b: [X(m.b[0]), m.b[1], Z(m.b[2])], size: m.s, phase: i * 0.9, theme: 'mover7' });
      });
      const hs = [];
      for (const h of J.hammers) if (!hs.some(o => Math.hypot(o[0] - h[0], o[2] - h[2]) < 1)) hs.push(h);
      hs.forEach(h => A.spinner(X(h[0]), h[1], Z(h[2]), 3.2, 1.6));
      const spawns = J.spawn.map(p => ({ x: X(p[0]), y: p[1], z: Z(p[2]) }));
      J.checkpoints.forEach(c => {
        const cz = Z(c.pos[2]), sp = spawns.reduce((m, s) => Math.abs(s.z - cz) < Math.abs(m.z - cz) ? s : m);
        const cp = A.checkpoint(X(c.pos[0]), c.pos[1] + 0.1, cz, c.s[0], c.s[2], sp.y + 0.3);
        cp.pos.x = sp.x;
      });
      A.world.checkpoints.sort((p, q) => q.z - p.z);
      const g = J.goal[0]; A.finish(X(g[0]), g[1] - 0.3, Z(g[2]), 9); A.setFinishY(g[1] - 1.2);
      // waypoints de IA reais; empurramos cada um para o centro até haver piso firme (estático) em volta, para os bots manterem distância das bordas
      const statics = A.world.boxes.filter(b => !A.world.movers.some(m => m.box === b));
      const floorAt = (x, z, y) => statics.some(b => x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z && b.max.y > y - 2.2 && b.max.y < y + 0.6);
      J.waypoints.map(p => ({ x: X(p[0]), y: p[1], z: Z(p[2]) })).sort((p, q) => q.z - p.z).forEach(p => {
        let x = p.x; const dir = x > 0 ? -1 : 1;
        for (let k = 0; k < 20 && !(floorAt(x, p.z, p.y) && floorAt(x - 0.9, p.z, p.y) && floorAt(x + 0.9, p.z, p.y)); k++) x += dir * 0.4;
        A.node(Math.abs(x) > Math.abs(p.x) ? p.x : x, p.z, p.y);
      });
    },
  };

  // ------------------------------------------------------------------ 3. Hammer Alley
  const hammerAlley = {
    name: 'Hammer Alley', time: 150,
    env: { tint: [1.12, 0.92, 0.8], fog: 0xffd7b0, sea: 0xb890ff, sunColor: 0xffc890, sun: [-45, 26, 34] },
    build(A) {
      const { line, finishAt } = helpers(A), V = A.vec;
      A.startPlatform('stone');
      A.platform(0, 0, -44, -14, 9, 'stone');
      A.spinner(0, 0.7, -23, 4.4, 1.5); A.spinner(0, 0.7, -33, 4.4, -1.8);
      A.platform(0, 0, -62, -47, 16, 'grass'); A.checkpoint(0, 0, -54);
      A.platform(0, 0, -122, -65, 8, 'gold');
      [-75, -85, -95, -105, -115].forEach((z, i) => A.spinner(0, 0.7, z, 3.9, (i % 2 ? -1 : 1) * (1.6 + i * 0.2)));
      A.platform(0, 0, -140, -125, 16, 'grass'); A.checkpoint(0, 0, -132);
      A.platform(0, 0, -222, -143, 7, 'stone');
      [-153, -167, -181, -195].forEach((z, i) => { A.spinner(-1.7, 0.7, z, 2.3, i % 2 ? -2.2 : 2.2); A.spinner(1.7, 0.7, z, 2.3, i % 2 ? 2.2 : -2.2); });
      A.spinner(0, 0.7, -211, 4.3, 2.6);
      A.platform(0, 0, -240, -225, 16, 'grass'); A.checkpoint(0, 0, -232);
      A.platform(0, 0, -270, -243, 16, 'gold'); finishAt(0, 0, -256, 16);
      line(0, -8, -262, 6);
    },
  };

  // ------------------------------------------------------------------ 4. Bumper Garden
  const bumperGarden = {
    name: 'Bumper Garden', time: 180,
    env: { tint: [1, 1.02, 1], fog: 0xc8f0e0, sea: 0x5fe0c8 },
    build(A) {
      const { line, finishAt } = helpers(A), V = A.vec;
      const R = rng(11);
      A.startPlatform('grass');
      A.platform(0, 0, -92, -14, 34, 'grass');
      const rails = (z0, z1, hw) => [-1, 1].forEach(sx => A.box(sx * hw - 0.25, sx * hw + 0.25, 0, 1.3, z0, z1, 'wall7'));
      rails(-92, -14, 16.75);
      for (let z = -26; z > -90; z -= 7) { const n = 3; for (let k = 0; k < n; k++) A.bumper(-14 + (k + R() * 0.8) * (28 / n), z + R() * 3); }
      A.platform(0, 0, -110, -95, 20, 'stone'); A.checkpoint(0, 0, -102, 20);
      A.platform(0, 0, -186, -113, 28, 'grass');
      rails(-186, -113, 13.75);
      for (let z = -124; z > -184; z -= 6.5) { const n = 4; for (let k = 0; k < n; k++) A.bumper(-11 + (k + R() * 0.8) * (22 / n), z + R() * 3); }
      A.spinner(-8, 0.7, -140, 3.2, 1.5); A.spinner(8, 0.7, -160, 3.2, -1.6);
      A.platform(0, 0, -204, -189, 20, 'stone'); A.checkpoint(0, 0, -196, 20);
      const isl = [[0, -211], [-4, -223.5], [4, -236], [-4, -248.5], [0, -261]];
      isl.forEach(([x, z], i) => { A.platform(x, 0, z - 4.5, z + 4.5, 9, i % 2 ? 'candy' : 'stone'); });
      A.platform(0, 0, -285, -269, 16, 'gold'); finishAt(0, 0, -277, 16);
      line(0, -8, -88, 7); A.node(0, -102); line(0, -116, -184, 7); A.node(0, -196);
      isl.forEach(([x, z]) => A.node(x, z)); A.node(0, -278);
    },
  };

  // ------------------------------------------------------------------ 5. Ice Rink
  const iceRink = {
    name: 'Ice Rink',
    env: { tint: [0.82, 1.0, 1.12], fog: 0xe0f6ff, sea: 0x7fe6ff, sunColor: 0xe6f2ff, sun: [24, 60, 16] },
    build(A) {
      const { line, finishAt } = helpers(A), V = A.vec;
      A.startPlatform('ice');
      A.platform(0, 0, -72, -14, 14, 'ice', { ice: true });
      [[-3, -26], [3, -34], [0, -42], [-4, -50], [4, -58], [0, -66]].forEach(([x, z]) => A.box(x - 1.1, x + 1.1, 0, 1.4, z - 1.1, z + 1.1, 'stone'));
      [[0, -20], [2.5, -26], [-2.5, -34], [3.5, -42], [0.5, -50], [-1.5, -58], [3.5, -66]].forEach(([x, z]) => A.node(x, z));
      A.platform(0, 0, -90, -75, 16, 'stone'); A.checkpoint(0, 0, -82); A.node(0, -82);
      A.platform(0, 0, -176, -93, 5.5, 'ice', { ice: true });
      [-110, -126, -142, -158].forEach((z, i) => A.mover({ a: [-4.2, 0.6, z], b: [4.2, 0.6, z], size: [2, 1.2, 1.1], speed: 4.2 + i * 0.5, phase: i * 3, theme: 'stone' }));
      line(0, -96, -174, 6);
      A.platform(0, 0, -194, -179, 16, 'stone'); A.checkpoint(0, 0, -186); A.node(0, -186);
      A.platform(0, 0, -268, -197, 20, 'ice', { ice: true });
      [[-5, -212], [5, -222], [0, -232], [-6, -242], [6, -250], [0, -258]].forEach(([x, z]) => A.box(x - 1.2, x + 1.2, 0, 1.5, z - 1.2, z + 1.2, 'stone'));
      [[0, -204], [3, -212], [-3, -222], [3, -232], [-3, -242], [3, -250], [-2, -258], [0, -266]].forEach(([x, z]) => A.node(x, z));
      A.platform(0, 0, -296, -271, 16, 'stone'); finishAt(0, 0, -284, 16); A.node(0, -284);
    },
  };

  // ------------------------------------------------------------------ 6. Falling Tiles
  const fallingTiles = {
    name: 'Falling Tiles', time: 150,
    env: { tint: [1.08, 0.96, 0.82], fog: 0xffe2b8, sea: 0x66e0c0, sunColor: 0xffd7a0, sun: [-30, 40, 26] },
    build(A) {
      const { line, finishAt } = helpers(A), V = A.vec;
      const R = rng(7), S = 3.0, G = 0.25, P = S + G;
      A.startPlatform('sand');
      const tile = (x, z, k) => A.platform(x, 0, z - S / 2, z + S / 2, S, (k % 2) ? 'tileA' : 'tileB', { fall: true, pillars: false });
      for (let j = 0; j < 10; j++) for (let i = 0; i < 5; i++) tile((i - 2) * P, -15 - j * P, i + j);
      line(0, -15, -15 - 9 * P, 6);
      A.platform(0, 0, -62, -48, 16, 'sand'); A.checkpoint(0, 0, -55); A.node(0, -55);
      for (let j = 0; j < 16; j++) for (let i = 0; i < 3; i++) tile((i - 1) * P, -67 - j * P, i + j);
      line(0, -67, -67 - 15 * P, 6);
      A.platform(0, 0, -128, -114, 16, 'sand'); A.checkpoint(0, 0, -121); A.node(0, -121);
      let pc = 3;
      for (let j = 0; j < 18; j++) {
        pc = Math.max(0, Math.min(6, pc + Math.floor(R() * 3) - 1));
        for (let i = 0; i < 7; i++) if (i === pc || R() < 0.62) tile((i - 3) * P, -133 - j * P, i + j);
        A.node((pc - 3) * P, -133 - j * P);
      }
      A.platform(0, 0, -205, -190, 16, 'sand'); A.checkpoint(0, 0, -197); A.node(0, -197);
      for (let j = 0; j < 14; j++) { const x = (j % 2 ? 1 : -1) * 1.6; tile(x, -210 - j * P, j); tile(x + (x > 0 ? -P : P), -210 - j * P, j + 1); A.node(0, -210 - j * P); }
      A.platform(0, 0, -270, -250, 16, 'tileB'); finishAt(0, 0, -260, 16); A.node(0, -262);
    },
  };

  // ------------------------------------------------------------------ 7. Trampoline Towers
  const towers = {
    name: 'Trampoline Towers',
    env: { tint: [0.95, 1.05, 1.15], fog: 0xd2ecff, sea: 0x66c8ff },
    build(A) {
      const { line, finishAt } = helpers(A), V = A.vec;
      A.startPlatform('grass');
      A.trampoline(0, -16, -12, 6, 0, 21); A.node(0, -14);
      const tops = [6, 12, 18, 24, 30], nears = [-18, -36, -54, -72, -90];
      tops.forEach((y, k) => {
        const near = nears[k], far = near - 12;
        A.platform(0, y, far, near, 10, k % 2 ? 'purple' : 'stone');
        A.node(0, near - 6, y);
        if (k < 4) { A.trampoline(0, far - 4, far, 6, y, 21); A.checkpoint(0, y, near - 6, 8); A.node(0, far - 2, y); }
        else { A.platform(0, y, far - 14, far, 12, 'gold'); finishAt(0, y, far - 6, 12); A.node(0, far - 6, y); }
      });
    },
  };

  // ------------------------------------------------------------------ 8. Conveyor Chaos
  const conveyors = {
    name: 'Conveyor Chaos', time: 150,
    env: { tint: [0.92, 0.98, 1.08], fog: 0xd4e0ee, sea: 0x74b8ec },
    build(A) {
      const { line, finishAt } = helpers(A), V = A.vec;
      A.startPlatform('metal');
      const belt = (z0, z1, w, cx, cz) => A.platform(0, 0, z0, z1, w, 'metal', { conv: V(cx, 0, cz) });
      belt(-30, -14, 12, 0, -4); belt(-48, -33, 12, 3, 0); belt(-66, -51, 12, -3, 0); belt(-86, -69, 12, 0, -5);
      A.spinner(0, 0.7, -77, 4.8, 1.8);
      line(0, -18, -84, 6);
      A.platform(0, 0, -102, -89, 16, 'stone'); A.checkpoint(0, 0, -95); A.node(0, -95);
      belt(-136, -105, 16, 0, -3);
      [-114, -121, -128].forEach((z, i) => A.mover({ a: [-7, 0.7, z], b: [7, 0.7, z], size: [3, 1.4, 1.2], speed: 3.6 + i * 0.6, phase: i * 5, theme: 'wall7' }));
      line(0, -108, -134, 6);
      A.platform(0, 0, -154, -139, 16, 'stone'); A.checkpoint(0, 0, -146); A.node(0, -146);
      [[-172, -157, -5], [-190, -175, -6], [-208, -193, -5], [-226, -211, -6]].forEach(([z0, z1, c]) => { belt(z0, z1, 7, 0, c); A.node(0, (z0 + z1) / 2); });
      A.platform(0, 0, -260, -230, 16, 'gold'); finishAt(0, 0, -245, 16); A.node(0, -246);
    },
  };

  // ------------------------------------------------------------------ 9. Sweeper Bridge
  const sweeper = {
    name: 'Sweeper Bridge',
    env: { tint: [0.62, 0.58, 1.0], fog: 0x6a5aa8, sea: 0x5a72d8, sunColor: 0xc8b8ff, sun: [-30, 34, -40] },
    build(A) {
      const { line, finishAt } = helpers(A), V = A.vec;
      A.startPlatform('night');
      const beam = (z0, z1, sw) => {
        A.platform(0, 0, z0, z1, 3.4, 'night', { pillars: false });
        sw.forEach(([z, sp, ph]) => A.mover({ a: [-3.2, 0.55, z], b: [3.2, 0.55, z], size: [3.6, 1.1, 0.9], speed: sp, phase: ph, theme: 'candy' }));
      };
      beam(-60, -14, [[-26, 3.4, 0], [-38, 3.8, 4], [-50, 4.2, 2]]);
      A.platform(0, 0, -78, -63, 12, 'night'); A.checkpoint(0, 0, -70, 12);
      beam(-136, -81, [[-91, 4.2, 0], [-101, 4.6, 3], [-111, 5, 6], [-121, 5.4, 1], [-130, 5.8, 5]]);
      A.platform(0, 0, -154, -139, 12, 'night'); A.checkpoint(0, 0, -146, 12);
      beam(-234, -157, [[-167, 5, 0], [-177, 5.6, 4], [-187, 6.2, 1], [-197, 6.8, 6], [-207, 7.2, 2], [-217, 7.6, 5], [-227, 8, 3]]);
      A.platform(0, 0, -262, -237, 14, 'gold'); finishAt(0, 0, -250, 14);
      line(0, -8, -258, 5);
    },
  };

  // ------------------------------------------------------------------ 10. Sky Hop
  const skyHop = {
    name: 'Sky Hop',
    env: { tint: [1.15, 0.85, 0.95], fog: 0xffc8d8, sea: 0xff9ac8, sunColor: 0xffb0c0, sun: [-50, 22, 20] },
    build(A) {
      const { line, finishAt } = helpers(A), V = A.vec;
      A.startPlatform('candy');
      const N = 22, DZ = 7.2; let pz = -16;
      for (let i = 0; i < N; i++) {
        const z = pz - i * DZ, x = 3.0 * Math.sin(i * 0.95), y = 1.0 * Math.sin(i * 0.55), kind = i % 4;
        if (i % 7 === 6) { A.platform(x, y, z - 4, z + 4, 9, 'stone'); A.checkpoint(x, y, z, 9); A.node(x, z, y); continue; }
        const size = 5.2;
        if (kind === 0) { A.platform(x, y, z - size / 2, z + size / 2, size, 'candy'); A.node(x, z, y); }
        else if (kind === 1) { A.mover({ a: [x - 2.0, y - 0.5, z], b: [x + 2.0, y - 0.5, z], size: [size, 1, size], speed: 1.5, phase: i * 1.7, theme: 'night' }); A.node(x, z, y); }
        else if (kind === 2) { A.platform(x, y, z - size / 2, z + size / 2, size, 'tileA', { toggle: { period: 4.4, on: 3.3, phase: i * 0.9 }, pillars: false }); A.node(x, z, y); }
        else { A.mover({ a: [x, y - 1.0, z], b: [x, y + 0.2, z], size: [size, 1, size], speed: 1.1, phase: i * 1.1, theme: 'mover7' }); A.node(x, z, y); }
      }
      const zf = pz - N * DZ;
      A.platform(0, 0, zf - 14, zf + 2, 14, 'gold'); finishAt(0, 0, zf - 6, 14); A.node(0, zf - 6);
    },
  };

  // ------------------------------------------------------------------ 11. Stairway to Sky
  const stairway = {
    name: 'Stairway to Sky', time: 140,
    env: { tint: [1.0, 1.02, 1.15], fog: 0xd8e8ff, sea: 0x66b0ff },
    build(A) {
      const { line, finishAt } = helpers(A), V = A.vec;
      A.startPlatform('stone');
      const steps = 26, depth = 6.2; let z = -14;
      for (let k = 0; k < steps; k++) {
        const y = (k + 1) * 0.95, z0 = z - depth, z1 = z, cz = (z0 + z1) / 2;
        A.platform(0, y, z0, z1, 11, k % 3 === 2 ? 'purple' : 'stone', { pillars: k % 4 === 0 });
        A.node(0, cz, y);
        if (k % 5 === 4) A.checkpoint(0, y, cz, 11);
        else if (k % 5 === 1) A.mover({ a: [-5.2, y + 0.6, cz], b: [5.2, y + 0.6, cz], size: [3, 1.2, 1.1], speed: 3.8, phase: k * 2, theme: 'candy' });
        else if (k % 5 === 3) A.spinner(0, y + 0.7, cz, 4.6, (k % 2 ? 1 : -1) * 1.7);
        z = z0 - 0.4;
      }
      const yTop = steps * 0.95 + 0.95;
      A.platform(0, yTop, z - 18, z, 14, 'gold'); finishAt(0, yTop, z - 9, 14); A.node(0, z - 9, yTop);
    },
  };

  // ------------------------------------------------------------------ 12. Grand Finale (a bit of everything)
  const finale = {
    name: 'Grand Finale', time: 200,
    env: { tint: [1.05, 0.95, 1.1], fog: 0xe8d4ff, sea: 0xa890ff, sunColor: 0xffe0c0, sun: [20, 34, 40] },
    build(A) {
      const { line, finishAt } = helpers(A), V = A.vec;
      const S = 3.0, P = 3.25;
      A.startPlatform('purple');
      A.platform(0, 0, -50, -14, 9, 'gold');                                                 // 1) hammers
      A.spinner(0, 0.7, -24, 4.3, 1.8); A.spinner(0, 0.7, -34, 4.3, -2.0); A.spinner(0, 0.7, -44, 4.3, 2.2);
      A.platform(0, 0, -68, -53, 16, 'grass'); A.checkpoint(0, 0, -60);
      A.platform(0, 0, -112, -71, 22, 'grass');                                              // 2) bumpers
      [[-6, -80], [6, -84], [0, -90], [-7, -97], [7, -100], [0, -106], [-3, -76], [4, -94]].forEach(([x, z]) => A.bumper(x, z));
      A.trampoline(0, -116, -112, 6, 0, 21);                                                 // 3) trampoline up to a tower
      A.platform(0, 6, -132, -120, 12, 'stone'); A.checkpoint(0, 6, -126, 12);
      for (let i = 0; i < 6; i++) {                                                          // 4) moving platforms
        A.mover({ a: [-3.0, 6, -137 - i * 7.4], b: [3.0, 6, -137 - i * 7.4], size: [5.2, 1, 5.2], speed: 1.5, phase: i * 2.1, theme: 'mover7' });
      }
      A.platform(0, 6, -193, -179, 14, 'stone'); A.checkpoint(0, 6, -186, 14);
      A.platform(0, 6, -231, -196, 11, 'metal', { conv: V(0, 0, -4) });                     // 5) conveyor + spinners
      A.spinner(0, 6.7, -207, 4.4, 1.8); A.spinner(0, 6.7, -219, 4.4, -2);
      A.platform(0, 6, -249, -234, 16, 'stone'); A.checkpoint(0, 6, -241);
      for (let j = 0; j < 8; j++) for (let i = 0; i < 4; i++) A.platform((i - 1.5) * P, 6, -252 - j * P - S / 2, -252 - j * P + S / 2, S, (i + j) % 2 ? 'tileA' : 'tileB', { fall: true, pillars: false });   // 6) falling tiles
      A.platform(0, 6, -293, -279, 3.4, 'night', { pillars: false });                        // 7) sweeper beam
      A.mover({ a: [-3.2, 6.55, -286], b: [3.2, 6.55, -286], size: [3.6, 1.1, 0.9], speed: 4.6, phase: 0, theme: 'candy' });
      A.platform(0, 6, -323, -296, 16, 'gold'); finishAt(0, 6, -309, 16);
      line(0, -8, -66, 6); line(0, -76, -108, 6); A.node(0, -114); A.node(0, -126, 6); line(0, -137, -174, 7.4, 6); A.node(0, -186, 6);
      line(0, -199, -229, 6, 6); A.node(0, -241, 6); line(0, -255, -275, 6.5, 6); A.node(0, -286, 6); A.node(0, -309, 6);
    },
  };

  // ---- escala: personagem mais rápido => pistas mais longas. Tudo que fica além da largada (z < -12) é esticado em K.
  const K = 1.45, TK = 1.3;
  const sz = z => (z >= -12 ? z : -12 + (z + 12) * K);
  const scaleAPI = A => ({
    ...A,
    platform: (cx, topY, z0, z1, w, th, ex) => A.platform(cx, topY, sz(z0), sz(z1), w, th, ex),
    box: (x0, x1, y0, y1, z0, z1, th, ex) => A.box(x0, x1, y0, y1, sz(z0), sz(z1), th, ex),
    mover: o => A.mover({ ...o, a: [o.a[0], o.a[1], sz(o.a[2])], b: [o.b[0], o.b[1], sz(o.b[2])], speed: (o.speed || 2) * 1.25 }),
    spinner: (cx, cy, cz, L, sp) => A.spinner(cx, cy, sz(cz), L, sp * 1.2),
    bumper: (x, z, y) => A.bumper(x, sz(z), y),
    trampoline: (cx, z0, z1, w, y, b2) => A.trampoline(cx, sz(z0), sz(z1), w, y, b2),
    checkpoint: (x, y, z, w, d, ry) => A.checkpoint(x, y, sz(z), w, d, ry),
    finish: (x, y, z, w) => A.finish(x, y, sz(z), w),
    node: (x, z, y) => A.node(x, sz(z), y),
    strip: (cx, y, cz, w, d, t, rx, ry, tint) => A.strip(cx, y, sz(cz), w, d, t, rx, ry, tint),
    conveyorZone: z => A.conveyorZone(z && [sz(z[0]), sz(z[1])]),
  });
  return [course, moving, hammerAlley, bumperGarden, iceRink, fallingTiles, towers, conveyors, sweeper, skyHop, stairway, finale]
    .map(l => ({ spawn: defaultSpawn, ...l, time: Math.ceil((l.time || 120) * TK), build: A => l.build(scaleAPI(A)) }));
}
