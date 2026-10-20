// Ambiente do mundo: céu, mar, nuvens, ilhas, palmeiras e grama.
// Do jogo (extraído): gradiente do céu `blueGradient` + camada de nuvens `skybox_clouds` (shader Stumble/Environment/SkyboxShader),
// textura de água `TEX_HSWater_A_000_Ti`, malhas de palmeira/ilha `Level12Palm*` / `Island*` e suas texturas.
// Nossos (design): como o céu é composto no shader, o mar animado, as nuvens 3D de esferas, a grama procedural.
import * as THREE from 'three';

export const SEA_Y = -10;

// ---------- sky dome ----------
export function createSky(tex) {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uGrad: { value: tex.blueGradient }, uClouds: { value: tex.skybox_clouds }, uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0.45, 0.55, 0.35) }, uTint: { value: new THREE.Vector3(1, 1, 1) }, uHaze: { value: new THREE.Vector3(0.78, 0.93, 1.0) } },
    vertexShader: `varying vec3 vDir; void main(){ vDir = position; vec4 p = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * p; }`,
    fragmentShader: `
      uniform sampler2D uGrad, uClouds; uniform float uTime; uniform vec3 uSun, uTint, uHaze; varying vec3 vDir;
      void main(){
        vec3 d = normalize(vDir);
        float h = clamp(d.y, 0.0, 1.0);
        // the game's gradient is symmetric: light at the middle (horizon), deeper at the ends (zenith)
        vec3 col = texture2D(uGrad, vec2(0.5, 0.5 + 0.5 * pow(h, 0.6))).rgb;
        col *= uTint;
        col = mix(col, uHaze, pow(1.0 - h, 3.2) * 0.85);
        col = mix(col, uHaze, smoothstep(0.0, 0.2, -d.y));
        if (d.y > 0.0) {
          vec2 uv = d.xz / (d.y + 0.28);
          float a1 = texture2D(uClouds, uv * 0.20 + vec2(uTime * 0.0045, 0.0)).a;
          float a2 = texture2D(uClouds, uv * 0.11 + vec2(-uTime * 0.003, 0.37)).a;
          float a3 = texture2D(uClouds, uv * 0.31 + vec2(0.21, uTime * 0.006)).a;
          float c = clamp(max(a1 * 0.95, max(a2 * 0.8, a3 * 0.5)), 0.0, 1.0);
          col = mix(col, mix(vec3(1.0), uHaze, 0.28), c * smoothstep(0.01, 0.30, d.y) * 0.9);
        }
        float s = max(dot(d, normalize(uSun)), 0.0);
        col += vec3(1.0, 0.93, 0.75) * (pow(s, 900.0) * 3.0 + pow(s, 14.0) * 0.18);
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(420, 32, 20), mat);
  mesh.renderOrder = -10; mesh.frustumCulled = false;
  return { mesh, update(camera, time) { mesh.position.copy(camera.position); mat.uniforms.uTime.value = time; } };
}

// ---------- sea ----------
export function createSea(tex) {
  const w1 = tex.TEX_HSWater_A_000_Ti.clone(); w1.needsUpdate = true; w1.repeat.set(70, 70);
  const w2 = tex.Mat_waterTextureDark.clone(); w2.needsUpdate = true; w2.repeat.set(95, 95);
  const base = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshPhongMaterial({ map: w1, color: 0x66c8ff, shininess: 120, specular: 0xbfeaff, emissive: 0x0a3a66, emissiveIntensity: 0.55 }));
  base.rotation.x = -Math.PI / 2; base.position.y = SEA_Y; base.receiveShadow = true;
  const over = new THREE.Mesh(new THREE.PlaneGeometry(1400, 1400),
    new THREE.MeshBasicMaterial({ map: w2, transparent: true, opacity: 0.38, depthWrite: false, color: 0x4aa8ff }));
  over.rotation.x = -Math.PI / 2; over.position.y = SEA_Y + 0.04;
  const g = new THREE.Group(); g.add(base, over);
  return {
    group: g, base, over,
    update(time, cx, cz) {
      g.position.x = cx; g.position.z = cz;
      // the texture is anchored to the world: counter-offset by position so the pattern does not "follow" the camera
      const k1 = 70 / 1400, k2 = 95 / 1400;
      w1.offset.set(time * 0.012 + cx * k1, -time * 0.008 - cz * k1);
      w2.offset.set(-time * 0.009 + cx * k2, time * 0.013 - cz * k2);
    },
  };
}

// ---------- 3D clouds (fluffy spheres) ----------
export function createClouds(group, zMin, zMax, count = 26) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, emissive: 0x5a7fa8, emissiveIntensity: 0.55 });
  const clouds = [];
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < count; i++) {
    const c = new THREE.Group(), n = 5 + Math.floor(Math.random() * 5), sz = rnd(5, 11);
    for (let k = 0; k < n; k++) {
      const s = new THREE.Mesh(new THREE.SphereGeometry(1, 14, 10), mat);
      const r = sz * rnd(0.45, 0.9);
      s.scale.set(r, r * rnd(0.55, 0.8), r * rnd(0.8, 1.0)); s.position.set((k - n / 2) * sz * 0.55 + rnd(-1, 1), rnd(-0.5, 1.2) * sz * 0.2, rnd(-1.5, 1.5));
      c.add(s);
    }
    const side = Math.random() < 0.5 ? -1 : 1;
    c.position.set(side * rnd(58, 190), rnd(-8, 30), rnd(Math.min(zMin, zMax) - 60, Math.max(zMin, zMax) + 60));
    c.userData.speed = rnd(0.4, 1.4);
    group.add(c); clouds.push(c);
  }
  return dt => { for (const c of clouds) { c.position.x += c.userData.speed * dt * (c.position.x > 0 ? 1 : -1) * 0.5; if (Math.abs(c.position.x) > 210) c.position.x = Math.sign(c.position.x) * 58; } };
}

// ---------- islands with palm trees ----------
function meshWith(geo, texture, color = 0xffffff) {
  const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: texture, color, roughness: 0.9 }));
  m.castShadow = m.receiveShadow = true; return m;
}
export function createIslands(group, geos, tex, zMin, zMax, count = 12) {
  const rnd = (a, b) => a + Math.random() * (b - a);
  for (let i = 0; i < count; i++) {
    const isl = new THREE.Group();
    const g = geos[i % 2 ? 'Island1' : 'Island2'];
    const body = meshWith(g, tex.TEX_Sand_A_000_Ti, 0xffe9b0);
    const s = rnd(0.7, 1.6); body.scale.set(s, s * 1.2, s);
    isl.add(body);
    // grassy top disc to give color (the island mesh is only a sandy mound)
    const top = new THREE.Mesh(new THREE.CylinderGeometry(7 * s, 9 * s, 0.5, 18), new THREE.MeshStandardMaterial({ color: 0x5fcf55, roughness: 0.95 }));
    top.position.y = 1.45 * s * 1.2; top.scale.set(1.0, 1, 0.9); top.receiveShadow = true; isl.add(top);
    const palms = 2 + Math.floor(Math.random() * 4);
    for (let p = 0; p < palms; p++) {
      const pm = meshWith(geos[p % 2 ? 'Level12Palm1' : 'Level12Palm2'], tex.Level12Palm);
      const a = rnd(0, Math.PI * 2), r = rnd(0, 6 * s), sc = rnd(1.8, 3.0);
      pm.scale.setScalar(sc); pm.position.set(Math.cos(a) * r, 1.6 * s * 1.2, Math.sin(a) * r); pm.rotation.y = rnd(0, 6.28);
      isl.add(pm);
    }
    const side = Math.random() < 0.5 ? -1 : 1;
    isl.position.set(side * rnd(26, 150), SEA_Y - 0.3, rnd(Math.min(zMin, zMax) - 80, Math.max(zMin, zMax) + 80));
    isl.rotation.y = rnd(0, 6.28);
    group.add(isl);
  }
}

// ---------- procedural grass texture ----------
export function grassTexture() {
  const S = 256, cv = document.createElement('canvas'); cv.width = cv.height = S;
  const x = cv.getContext('2d');
  x.fillStyle = '#4fc24a'; x.fillRect(0, 0, S, S);
  for (let i = 0; i < 4200; i++) {   // blade strokes
    const px = Math.random() * S, py = Math.random() * S, l = 4 + Math.random() * 9, sh = Math.random();
    x.strokeStyle = sh < 0.5 ? `rgba(32,${120 + Math.random() * 40 | 0},38,0.35)` : `rgba(${120 + Math.random() * 40 | 0},${215 + Math.random() * 30 | 0},${80 + Math.random() * 30 | 0},0.30)`;
    x.lineWidth = 1 + Math.random(); x.beginPath(); x.moveTo(px, py); x.lineTo(px + (Math.random() - 0.5) * 4, py - l); x.stroke();
  }
  for (let i = 0; i < 40; i++) {     // flower dots
    x.fillStyle = ['#fff6a0', '#ffffff', '#ffb0d0'][i % 3]; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, 1.2 + Math.random(), 0, 7); x.fill();
  }
  // mowing stripes (golf style) — half of the tile slightly lighter
  x.fillStyle = 'rgba(255,255,255,0.07)'; x.fillRect(0, 0, S / 2, S);
  const t = new THREE.CanvasTexture(cv); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

// ---------- instanced wind-swept grass blades ----------
export const grassUniforms = { uTime: { value: 0 } };
let bladeGeo = null, bladeMat = null;
function blade() {
  if (!bladeGeo) {
    bladeGeo = new THREE.ConeGeometry(0.028, 0.2, 3, 1); bladeGeo.translate(0, 0.1, 0);
    bladeMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    bladeMat.onBeforeCompile = sh => {
      sh.uniforms.uTime = grassUniforms.uTime;
      sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
        `#include <begin_vertex>
         float sw = sin(uTime * 2.4 + instanceMatrix[3].x * 0.9 + instanceMatrix[3].z * 0.7);
         transformed.x += sw * 0.09 * position.y * 2.0; transformed.z += sw * 0.05 * position.y * 2.0;`);
    };
  }
  return { geo: bladeGeo, mat: bladeMat };
}
export function addGrass(group, rect, y, avoid, budget) {
  const [x0, x1, z0, z1] = rect, area = (x1 - x0) * (z1 - z0);
  const n = Math.min(Math.floor(area * 11), budget.left);
  if (n <= 0) return;
  const { geo, mat } = blade();
  const im = new THREE.InstancedMesh(geo, mat, n), m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  let k = 0;
  for (let i = 0; i < n * 2 && k < n; i++) {
    const px = x0 + Math.random() * (x1 - x0), pz = z0 + Math.random() * (z1 - z0);
    if (avoid.some(a => px > a[0] && px < a[1] && pz > a[2] && pz < a[3])) continue;
    e.set((Math.random() - 0.5) * 0.4, Math.random() * 6.28, (Math.random() - 0.5) * 0.4); q.setFromEuler(e);
    const s = 0.7 + Math.random() * 0.9;
    m.compose(new THREE.Vector3(px, y, pz), q, new THREE.Vector3(s, s * (0.8 + Math.random() * 0.6), s));
    im.setMatrixAt(k, m);
    c.setHSL(0.27 + Math.random() * 0.06, 0.6 + Math.random() * 0.2, 0.3 + Math.random() * 0.22); im.setColorAt(k, c); k++;
  }
  im.count = k; budget.left -= k; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
  group.add(im);
}
