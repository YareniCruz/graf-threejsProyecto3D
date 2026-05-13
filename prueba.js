import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';
import { XRControllerModelFactory } from 'three/addons/webxr/XRControllerModelFactory.js';
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';

/** ========= CONFIG ========= */
const PLAY_SIZE = 260;
const VISUAL_SIZE = 420;
const TERRAIN_RES = 256;
const TERRAIN_MAX_H = 2.0;
const TREE_COUNT = 760;
const BASE_COUNT = 56;
const BALL_COUNT = Math.round(BASE_COUNT * 1.5);
const BUSH_COUNT = Math.round(BASE_COUNT * 1.5);
const WIN_TARGET = 5;

const PLAYER_RADIUS = 0.35;
const OBJ_TREE_R = 0.6;
const OBJ_BALL_R = 0.48;
const OBJ_BUSH_R = 0.55;

const FOG_DENSITY = 0.008;
const VR_WALK_SPEED = 5.8;
const VR_STRAFE_SPEED = 5.0;
const ARC_STEPS = 40;
const ARC_SPEED = 7.5;
const ARC_GRAVITY = 9.8;
const MAX_SLOPE_DEG = 45;

const PLAY_RADIUS = PLAY_SIZE * 0.5 - 1.0;
const VISUAL_RADIUS = VISUAL_SIZE * 0.5 - 1.0;
const OBJECT_AREA = 110;

const HDRI_LOCAL = 'assets/hdr/moonless_golf_1k.hdr';
const HDRI_FALLBACK = 'https://dl.polyhaven.org/file/ph-assets/HDRIs/hdr/1k/moonless_golf_1k.hdr';

/** ========= DOM ========= */
const hudTotal = document.getElementById('totalBalls');
const hudHit = document.getElementById('hitBalls');
const compassEl = document.getElementById('compass');
const minimap = document.getElementById('minimap');
const minimapCtx = minimap.getContext('2d');

const canvas = document.getElementById('scene');
const ambientEl = document.getElementById('ambient');

/** ========= RENDERER / SCENES / CAMERA ========= */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.xr.enabled = true;
renderer.autoClear = true;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87ceeb);
scene.fog = new THREE.FogExp2(0x9fd8ff, FOG_DENSITY);

const bgScene = new THREE.Scene();
const bgCam = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 5000);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.1, 600);
const player = new THREE.Group();
player.position.set(0, 1.6, 3);
player.add(camera);
scene.add(player);

/** ========= IBL ========= */
const pmremGen = new THREE.PMREMGenerator(renderer);
pmremGen.compileEquirectangularShader();

async function setHDRI(url) {
  const hdr = await new Promise((res, rej) => new RGBELoader().load(url, t => res(t), undefined, rej));
  const env = pmremGen.fromEquirectangular(hdr).texture;
  scene.environment = env;
  hdr.dispose();
  pmremGen.dispose();
}

setHDRI(HDRI_LOCAL).catch(() => setHDRI(HDRI_FALLBACK).catch(e => console.warn('Sin HDRI:', e)));

/** ========= LUZ ========= */
scene.add(new THREE.HemisphereLight(0xbfe7ff, 0x6f8f5f, 0.75));

const sunLight = new THREE.DirectionalLight(0xfff1b8, 1.7);
sunLight.position.set(80, 180, -90);
sunLight.castShadow = true;
sunLight.shadow.mapSize.set(2048, 2048);
sunLight.shadow.camera.near = 0.5;
sunLight.shadow.camera.far = 300;
scene.add(sunLight);

/** ========= CIELO ========= */
const skyGeo = new THREE.SphereGeometry(2200, 48, 24);
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide,
  depthWrite: false,
  depthTest: false,
  fog: false,
  uniforms: {
    topColor: { value: new THREE.Color(0x4da6ff) },
    bottomColor: { value: new THREE.Color(0xccefff) }
  },
  vertexShader: `
    varying vec3 vDir;
    void main(){
      vDir = normalize(position);
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    varying vec3 vDir;
    uniform vec3 topColor;
    uniform vec3 bottomColor;
    void main(){
      float t = smoothstep(-0.25, 0.85, vDir.y);
      vec3 col = mix(bottomColor, topColor, t);
      gl_FragColor = vec4(col, 1.0);
    }
  `
});

const skyMesh = new THREE.Mesh(skyGeo, skyMat);
skyMesh.renderOrder = -3;
skyMesh.frustumCulled = false;
bgScene.add(skyMesh);

/** ========= SOL CON HALO ========= */
function createRadialTexture(inner, outer) {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');

  const g = ctx.createRadialGradient(size / 2, size / 2, 10, size / 2, size / 2, size / 2);
  g.addColorStop(0.0, inner);
  g.addColorStop(0.22, 'rgba(255,245,180,0.95)');
  g.addColorStop(0.55, 'rgba(255,210,80,0.35)');
  g.addColorStop(1.0, outer);

  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const sunGroup = new THREE.Group();

const sunCore = new THREE.Mesh(
  new THREE.SphereGeometry(9, 48, 48),
  new THREE.MeshBasicMaterial({ color: 0xfff3a0, fog: false, depthTest: false })
);

const sunHalo = new THREE.Sprite(
  new THREE.SpriteMaterial({
    map: createRadialTexture('rgba(255,255,220,1)', 'rgba(255,220,80,0)'),
    transparent: true,
    depthTest: false,
    depthWrite: false,
    fog: false,
    blending: THREE.AdditiveBlending
  })
);

sunHalo.scale.set(80, 80, 1);
sunGroup.add(sunHalo, sunCore);
sunGroup.frustumCulled = false;
sunGroup.renderOrder = 20;
scene.add(sunGroup);

/** ========= MURO / FRONTERA ========= */
const wallHeight = 6;
const wallGeo = new THREE.CylinderGeometry(PLAY_RADIUS + 0.5, PLAY_RADIUS + 0.5, wallHeight, 96, 1, true);
const wallMat = new THREE.MeshBasicMaterial({
  color: 0x6fb0e8,
  side: THREE.BackSide,
  fog: false,
  transparent: true,
  opacity: 0.22
});

const wallMesh = new THREE.Mesh(wallGeo, wallMat);
wallMesh.position.y = wallHeight / 2;
wallMesh.renderOrder = 5;
scene.add(wallMesh);

/** ========= PERLIN / TERRENO ========= */
function makePerlin(seed = 1337) {
  const p = new Uint8Array(512);
  for (let i = 0; i < 256; i++) p[i] = i;

  let n, q;
  for (let i = 255; i > 0; i--) {
    n = Math.floor((seed = (seed * 16807) % 2147483647) / 2147483647 * (i + 1));
    q = p[i]; p[i] = p[n]; p[n] = q;
  }

  for (let i = 0; i < 256; i++) p[256 + i] = p[i];

  const grad = (h, x, y) => {
    switch (h & 3) {
      case 0: return x + y;
      case 1: return -x + y;
      case 2: return x - y;
      default: return -x - y;
    }
  };

  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  const lerp = (a, b, t) => a + t * (b - a);

  return function noise(x, y) {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);

    const u = fade(x);
    const v = fade(y);
    const A = p[X] + Y;
    const B = p[X + 1] + Y;

    return lerp(
      lerp(grad(p[A], x, y), grad(p[B], x - 1, y), u),
      lerp(grad(p[A + 1], x, y - 1), grad(p[B + 1], x - 1, y - 1), u),
      v
    );
  };
}

const noise2D = makePerlin(2026);

const terrainGeo = new THREE.PlaneGeometry(VISUAL_SIZE, VISUAL_SIZE, TERRAIN_RES, TERRAIN_RES);
terrainGeo.rotateX(-Math.PI / 2);

const tPos = terrainGeo.attributes.position;
for (let i = 0; i < tPos.count; i++) {
  const x = tPos.getX(i);
  const z = tPos.getZ(i);
  const h =
    noise2D(x * 0.02, z * 0.02) * 0.5 +
    noise2D(x * 0.05, z * 0.05) * 0.20 +
    noise2D(x * 0.1, z * 0.1) * 0.08;

  tPos.setY(i, h * TERRAIN_MAX_H);
}

tPos.needsUpdate = true;
terrainGeo.computeVertexNormals();
terrainGeo.setAttribute('uv2', new THREE.BufferAttribute(new Float32Array(terrainGeo.attributes.uv.array), 2));

const texLoader = new THREE.TextureLoader();

function loadTex(path) {
  const tex = texLoader.load(path);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(8, 8);
  tex.anisotropy = renderer.capabilities.getMaxAnisotropy?.() || 8;
  return tex;
}

const groundColor = loadTex('assets/textures/ground/ground_color.jpg');
const groundNormal = loadTex('assets/textures/ground/ground_normal.jpg');
const groundRough = loadTex('assets/textures/ground/ground_roughness.jpg');
const groundAO = loadTex('assets/textures/ground/ground_ao.jpg');

const grassTexture = loadTex('assets/textures/ground/grass_color.jpg');
grassTexture.repeat.set(4, 4);

const terrainMat = new THREE.MeshStandardMaterial({
  color: new THREE.Color(0x4a8b35),
  map: groundColor,
  normalMap: groundNormal,
  roughnessMap: groundRough,
  aoMap: groundAO,
  roughness: 1.0,
  metalness: 0.0
});

const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.receiveShadow = true;
scene.add(terrain);

/** ========= UTILIDADES ========= */
const raycaster = new THREE.Raycaster();

function getTerrainHitRay(origin, dir, far = 600) {
  raycaster.set(origin, dir);
  raycaster.far = far;
  return raycaster.intersectObject(terrain, false)[0] || null;
}

function getTerrainHeight(x, z) {
  const hit = getTerrainHitRay(new THREE.Vector3(x, 120, z), new THREE.Vector3(0, -1, 0));
  return hit ? hit.point.y : 0;
}

function clampToPlayArea(v) {
  const r = Math.hypot(v.x, v.z);
  if (r > PLAY_RADIUS - PLAYER_RADIUS) {
    const ang = Math.atan2(v.z, v.x);
    const rr = PLAY_RADIUS - PLAYER_RADIUS;
    v.x = Math.cos(ang) * rr;
    v.z = Math.sin(ang) * rr;
  }
  return v;
}

function clampToVisualArea(v) {
  const r = Math.hypot(v.x, v.z);
  if (r > VISUAL_RADIUS - 2) {
    const ang = Math.atan2(v.z, v.x);
    const rr = VISUAL_RADIUS - 2;
    v.x = Math.cos(ang) * rr;
    v.z = Math.sin(ang) * rr;
  }
  return v;
}

function randomPointInRing(minR, maxR, index, total, jitter = 0.35) {
  const angle = (index / total) * Math.PI * 2 + (Math.random() - 0.5) * jitter;
  const radius = minR + Math.random() * (maxR - minR);
  return { x: Math.cos(angle) * radius, z: Math.sin(angle) * radius };
}

/** ========= ÁRBOLES ========= */
const treeColliders = [];

function addTree(x, z, scale = 1, hasCollider = true) {
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.12 * scale, 0.22 * scale, 2.6 * scale, 8),
    new THREE.MeshStandardMaterial({ color: 0x5a351d, roughness: 1 })
  );

  trunk.castShadow = true;
  trunk.receiveShadow = true;

  const crowns = new THREE.Group();
  const levels = 3 + Math.floor(Math.random() * 2);

  for (let i = 0; i < levels; i++) {
    const crown = new THREE.Mesh(
      new THREE.ConeGeometry((1.6 - i * 0.25) * scale, (2.2 - i * 0.25) * scale, 10),
      new THREE.MeshStandardMaterial({
        color: 0x1f7a38,
        map: grassTexture,
        roughness: 0.9
      })
    );

    crown.castShadow = true;
    crown.position.y = (2.0 + i * 0.7) * scale;
    crowns.add(crown);
  }

  const y = getTerrainHeight(x, z);
  const tree = new THREE.Group();
  tree.position.set(x, y, z);
  tree.add(trunk, crowns);
  scene.add(tree);

  if (hasCollider) {
    treeColliders.push({ x, z, r: OBJ_TREE_R * scale });
  }
}

// Árboles dentro y fuera de la frontera.
// Afuera solo son visuales, para que después del muro siga el bosque.
for (let i = 0; i < TREE_COUNT; i++) {
  let x = (Math.random() - 0.5) * VISUAL_SIZE;
  let z = (Math.random() - 0.5) * VISUAL_SIZE;

  if (Math.hypot(x, z) > VISUAL_RADIUS) continue;

  if (Math.hypot(x - player.position.x, z - player.position.z) < 6) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 20;
    x = player.position.x + Math.cos(a) * r;
    z = player.position.z + Math.sin(a) * r;
  }

  const insidePlay = Math.hypot(x, z) < PLAY_RADIUS - 1;
  addTree(x, z, 0.8 + Math.random() * 1.8, insidePlay);
}

/** ========= AUDIO ========= */
const listener = new THREE.AudioListener();
camera.add(listener);

const audioLoader = new THREE.AudioLoader();
let chimeBuffer = null;
let windBuffer = null;
let winBuffer = null;

audioLoader.load('assets/audio/chime.mp3', buf => chimeBuffer = buf);
audioLoader.load('assets/audio/wind.mp3', buf => windBuffer = buf);
audioLoader.load('assets/audio/win.mp3', buf => winBuffer = buf);

let windSfx = null;

function startAmbientAudio() {
  const ctx = listener.context;

  if (ambientEl) {
    try {
      const srcNode = ctx.createMediaElementSource(ambientEl);
      srcNode.connect(listener.getInput());
      ambientEl.loop = true;
      ambientEl.volume = 0.32;
      ambientEl.play().catch(() => {});
    } catch {}
  }

  if (windBuffer && !windSfx) {
    windSfx = new THREE.Audio(listener);
    windSfx.setBuffer(windBuffer);
    windSfx.setLoop(true);
    windSfx.setVolume(0.18);
    windSfx.play();
  }
}

function playBuffer(buffer, volume = 0.8) {
  if (!buffer) return;
  const sfx = new THREE.Audio(listener);
  sfx.setBuffer(buffer);
  sfx.setLoop(false);
  sfx.setVolume(volume);
  sfx.play();
}

/** ========= PELOTAS ========= */
const balls = [];
const ballColliders = [];

function createBeachBallTexture(size = 512) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  const colors = ['#ff3333', '#ffffff', '#ffcc00', '#ffffff', '#1e90ff', '#ffffff', '#35d04f', '#ffffff'];

  for (let i = 0; i < colors.length; i++) {
    const a0 = (i / colors.length) * Math.PI * 2 - Math.PI / 2;
    const a1 = ((i + 1) / colors.length) * Math.PI * 2 - Math.PI / 2;

    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, size * 0.48, a0, a1);
    ctx.closePath();
    ctx.fillStyle = colors[i];
    ctx.fill();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.85)';
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.48, 0, Math.PI * 2);
  ctx.stroke();

  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.09, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = 'rgba(0,0,0,0.15)';
  ctx.lineWidth = 4;
  ctx.stroke();

  const tex = new THREE.CanvasTexture(c);
  tex.needsUpdate = true;
  return tex;
}

const beachBallTexture = createBeachBallTexture();

/** ========= PARTÍCULAS ========= */
const particleSystems = [];

function spawnParticles(pos) {
  const COUNT = 280;
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(COUNT * 3);
  const velocities = new Float32Array(COUNT * 3);
  const colors = new Float32Array(COUNT * 3);

  for (let i = 0; i < COUNT; i++) {
    const i3 = i * 3;
    positions[i3] = pos.x;
    positions[i3 + 1] = pos.y;
    positions[i3 + 2] = pos.z;

    const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 1.7, Math.random() * 2 - 1).normalize();
    const speed = 4.0 + Math.random() * 6.0;

    velocities[i3] = dir.x * speed;
    velocities[i3 + 1] = dir.y * speed;
    velocities[i3 + 2] = dir.z * speed;

    const color = new THREE.Color().setHSL(Math.random(), 1, 0.58);
    colors[i3] = color.r;
    colors[i3 + 1] = color.g;
    colors[i3 + 2] = color.b;
  }

  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

  const mat = new THREE.PointsMaterial({
    size: 0.12,
    vertexColors: true,
    transparent: true,
    opacity: 1,
    fog: false,
    blending: THREE.AdditiveBlending
  });

  const points = new THREE.Points(geo, mat);
  points.userData = { age: 0, mat };
  scene.add(points);
  particleSystems.push(points);
}

function updateParticles(dt) {
  for (let i = particleSystems.length - 1; i >= 0; i--) {
    const ps = particleSystems[i];
    ps.userData.age += dt;

    const pos = ps.geometry.getAttribute('position');
    const vel = ps.geometry.getAttribute('velocity');

    for (let j = 0; j < pos.count; j++) {
      const idx = j * 3;
      vel.array[idx + 1] -= 6.5 * dt;
      pos.array[idx] += vel.array[idx] * dt;
      pos.array[idx + 1] += vel.array[idx + 1] * dt;
      pos.array[idx + 2] += vel.array[idx + 2] * dt;
    }

    pos.needsUpdate = true;
    ps.userData.mat.opacity = Math.max(0, 1 - ps.userData.age / 1.9);

    if (ps.userData.age > 1.9) {
      scene.remove(ps);
      ps.geometry.dispose();
      ps.material.dispose();
      particleSystems.splice(i, 1);
    }
  }
}

function addBeachBall(x, z) {
  const y = getTerrainHeight(x, z) + 0.55;

  const mat = new THREE.MeshStandardMaterial({
    map: beachBallTexture,
    roughness: 0.35,
    metalness: 0.0
  });

  const mesh = new THREE.Mesh(new THREE.SphereGeometry(0.52, 40, 28), mat);
  mesh.castShadow = true;
  mesh.receiveShadow = true;

  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.add(mesh);

  group.userData.mat = mat;
  group.userData.mesh = mesh;
  group.userData.touched = false;
  group.userData.spin = Math.random() * Math.PI * 2;
  group.userData.bouncePhase = Math.random() * Math.PI * 2;
  group.userData.baseY = y;
  group.userData.speedAway = 0.55 + Math.random() * 0.35;

  scene.add(group);

  balls.push(group);
  ballColliders.push({ x, z, r: OBJ_BALL_R, idx: balls.length - 1 });
}

for (let i = 0; i < BALL_COUNT; i++) {
  const p = randomPointInRing(12, OBJECT_AREA, i, BALL_COUNT, 0.60);
  addBeachBall(p.x, p.z);
}

if (hudTotal) hudTotal.textContent = String(BALL_COUNT);

/** ========= ARBUSTOS ========= */
const bushColliders = [];

const bushMats = [
  new THREE.MeshStandardMaterial({ color: 0x2e8b45, map: grassTexture, roughness: 0.95 }),
  new THREE.MeshStandardMaterial({ color: 0x3fa34d, map: grassTexture, roughness: 0.95 }),
  new THREE.MeshStandardMaterial({ color: 0x1f6f34, map: grassTexture, roughness: 0.95 })
];

function addBush(x, z) {
  const y = getTerrainHeight(x, z);
  const group = new THREE.Group();
  const count = 4 + Math.floor(Math.random() * 4);

  for (let i = 0; i < count; i++) {
    const leaf = new THREE.Mesh(
      new THREE.SphereGeometry(0.35 + Math.random() * 0.18, 16, 10),
      bushMats[Math.floor(Math.random() * bushMats.length)]
    );

    leaf.position.set((Math.random() - 0.5) * 0.75, 0.25 + Math.random() * 0.35, (Math.random() - 0.5) * 0.75);
    leaf.scale.set(1.2, 0.75 + Math.random() * 0.35, 1.0);
    leaf.castShadow = true;
    leaf.receiveShadow = true;
    group.add(leaf);
  }

  group.position.set(x, y, z);
  group.rotation.y = Math.random() * Math.PI * 2;

  const s = 0.75 + Math.random() * 0.6;
  group.scale.setScalar(s);

  scene.add(group);
  bushColliders.push({ x, z, r: OBJ_BUSH_R * s });
}

for (let i = 0; i < BUSH_COUNT; i++) {
  const p = randomPointInRing(14, OBJECT_AREA, i, BUSH_COUNT, 0.85);
  addBush(p.x, p.z);
}

/** ========= VR ========= */
const vrBtn = VRButton.createButton(renderer);
vrBtn.classList.add('vr-button');
document.body.appendChild(vrBtn);

const controllerLeft = renderer.xr.getController(0);
const controllerRight = renderer.xr.getController(1);
scene.add(controllerLeft, controllerRight);

const controllerModelFactory = new XRControllerModelFactory();

const grip0 = renderer.xr.getControllerGrip(0);
grip0.add(controllerModelFactory.createControllerModel(grip0));
scene.add(grip0);

const grip1 = renderer.xr.getControllerGrip(1);
grip1.add(controllerModelFactory.createControllerModel(grip1));
scene.add(grip1);

/** ========= TELEPORT ========= */
const arcMatOK = new THREE.LineBasicMaterial({ color: 0x1876ff, transparent: true, opacity: 0.95 });
const arcMatBAD = new THREE.LineBasicMaterial({ color: 0xff5a5a, transparent: true, opacity: 0.95 });

const arcGeo = new THREE.BufferGeometry().setFromPoints(new Array(ARC_STEPS).fill(0).map(() => new THREE.Vector3()));
const arcLine = new THREE.Line(arcGeo, arcMatOK);
arcLine.visible = false;
scene.add(arcLine);

const marker = new THREE.Mesh(
  new THREE.RingGeometry(0.25, 0.30, 32),
  new THREE.MeshBasicMaterial({ color: 0x1876ff, transparent: true, opacity: 0.9, side: THREE.DoubleSide })
);

marker.rotation.x = -Math.PI / 2;
marker.visible = false;
scene.add(marker);

let teleportValid = false;
const teleportPoint = new THREE.Vector3();

controllerRight.addEventListener('selectstart', () => {
  arcLine.visible = true;
  marker.visible = true;
});

controllerRight.addEventListener('selectend', () => {
  arcLine.visible = false;
  marker.visible = false;

  if (teleportValid) {
    const clamped = clampToPlayArea(teleportPoint.clone());
    player.position.set(clamped.x, getTerrainHeight(clamped.x, clamped.z) + 1.6, clamped.z);
  }
});

renderer.xr.addEventListener('sessionstart', async () => {
  try {
    if (ambientEl) {
      ambientEl.volume = 0.32;
      await ambientEl.play();
    }
  } catch (e) {
    console.warn('Audio bloqueado:', e);
  }

  startAmbientAudio();
});

/** ========= MOVIMIENTO ========= */
function vrGamepadMove(dt) {
  const session = renderer.xr.getSession();
  if (!session) return;

  for (const src of session.inputSources) {
    if (!src.gamepad) continue;

    let [x, y] = [src.gamepad.axes[2], src.gamepad.axes[3]];

    if (x === undefined || y === undefined) {
      x = src.gamepad.axes[0] ?? 0;
      y = src.gamepad.axes[1] ?? 0;
    }

    const dead = 0.12;
    if (Math.abs(x) < dead) x = 0;
    if (Math.abs(y) < dead) y = 0;
    if (x === 0 && y === 0) continue;

    const forward = new THREE.Vector3();
    camera.getWorldDirection(forward);
    forward.y = 0;
    forward.normalize();

    const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();

    let next = player.position.clone();
    next.addScaledVector(forward, -y * VR_WALK_SPEED * dt);
    next.addScaledVector(right, x * VR_STRAFE_SPEED * dt);

    next = clampToPlayArea(next);
    next.y = getTerrainHeight(next.x, next.z) + 1.6;
    next = resolveCollisions(player.position, next);

    player.position.copy(next);
  }
}

/** ========= TELEPORT UPDATE ========= */
const arcPointsBuf = new Float32Array(ARC_STEPS * 3);

function segmentIntersectTerrain(a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  if (!len) return null;

  dir.normalize();
  raycaster.set(a, dir);
  raycaster.far = len + 0.01;

  const h = raycaster.intersectObject(terrain, false)[0];
  if (!h) return null;

  const n = h.face?.normal.clone() || new THREE.Vector3(0, 1, 0);
  n.transformDirection(terrain.matrixWorld);

  return { point: h.point.clone(), faceNormal: n.normalize() };
}

function updateTeleportArc() {
  if (!arcLine.visible) return;

  teleportValid = false;

  const origin = new THREE.Vector3().setFromMatrixPosition(controllerRight.matrixWorld);
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(controllerRight.quaternion).normalize();

  const pts = [];
  let hit = null;

  const v0 = dir.clone().multiplyScalar(ARC_SPEED);
  const g = new THREE.Vector3(0, -ARC_GRAVITY, 0);
  let p = origin.clone();
  let v = v0.clone();

  for (let i = 0; i < ARC_STEPS; i++) {
    pts.push(p.clone());

    v.addScaledVector(g, 1 / 60);
    const np = p.clone().addScaledVector(v, 1 / 60);
    const segHit = segmentIntersectTerrain(p, np);

    if (segHit) {
      hit = segHit;
      break;
    }

    p.copy(np);
  }

  for (let i = 0; i < ARC_STEPS; i++) {
    const P = pts[Math.min(i, pts.length - 1)];
    arcPointsBuf[i * 3] = P.x;
    arcPointsBuf[i * 3 + 1] = P.y;
    arcPointsBuf[i * 3 + 2] = P.z;
  }

  arcGeo.setAttribute('position', new THREE.BufferAttribute(arcPointsBuf, 3));
  arcGeo.attributes.position.needsUpdate = true;

  if (hit) {
    const slopeDeg = THREE.MathUtils.radToDeg(Math.acos(hit.faceNormal.dot(new THREE.Vector3(0, 1, 0))));
    const inside = hit.point.distanceTo(new THREE.Vector3(0, hit.point.y, 0)) <= PLAY_RADIUS;

    teleportValid = slopeDeg <= MAX_SLOPE_DEG && inside;

    arcLine.material = teleportValid ? arcMatOK : arcMatBAD;
    marker.material.color.set(teleportValid ? 0x1876ff : 0xff5a5a);

    const clamped = clampToPlayArea(hit.point.clone());
    marker.position.set(clamped.x, getTerrainHeight(clamped.x, clamped.z) + 0.02, clamped.z);
    teleportPoint.copy(clamped);
  }
}

/** ========= COLISIONES / REGLAS ========= */
let hitCount = 0;
let winPlayed = false;

function resolveCollisions(curr, next) {
  for (const t of treeColliders) {
    const dx = next.x - t.x;
    const dz = next.z - t.z;
    const dist = Math.hypot(dx, dz);
    const minD = PLAYER_RADIUS + t.r;

    if (dist < minD) {
      const push = minD - dist + 1e-3;
      next.x += (dx / (dist || 1)) * push;
      next.z += (dz / (dist || 1)) * push;
    }
  }

  for (const b of bushColliders) {
    const dx = next.x - b.x;
    const dz = next.z - b.z;
    const dist = Math.hypot(dx, dz);
    const minD = PLAYER_RADIUS + b.r;

    if (dist < minD) {
      const push = minD - dist + 1e-3;
      next.x += (dx / (dist || 1)) * push;
      next.z += (dz / (dist || 1)) * push;
    }
  }

  for (const c of ballColliders) {
    const dx = next.x - c.x;
    const dz = next.z - c.z;
    const dist = Math.hypot(dx, dz);
    const minD = PLAYER_RADIUS + c.r;

    if (dist < minD) {
      const push = minD - dist + 1e-3;
      next.x += (dx / (dist || 1)) * push;
      next.z += (dz / (dist || 1)) * push;

      const ball = balls[c.idx];

      if (ball && !ball.userData.touched) {
        ball.userData.touched = true;
        hitCount++;

        if (hudHit) hudHit.textContent = String(hitCount);

        playBuffer(chimeBuffer, 0.8);

        const redMat = new THREE.MeshStandardMaterial({
          color: 0xff2222,
          roughness: 0.35,
          metalness: 0.0,
          emissive: 0x330000,
          emissiveIntensity: 0.25
        });

        if (ball.userData.mesh) {
          ball.userData.mesh.material = redMat;
        }

        ball.scale.setScalar(1.35);
        spawnParticles(ball.position.clone().add(new THREE.Vector3(0, 0.4, 0)));

        if (hitCount >= WIN_TARGET && !winPlayed) {
          winPlayed = true;
          playBuffer(winBuffer, 1.0);
        }
      }
    }
  }

  return clampToPlayArea(next);
}

/** ========= MOVIMIENTO DE PELOTAS SIN REBOTE ========= */
function updateBalls(dt) {
  for (let i = 0; i < balls.length; i++) {
    const ball = balls[i];
    const col = ballColliders[i];

    const away = new THREE.Vector3(
      ball.position.x - player.position.x,
      0,
      ball.position.z - player.position.z
    );

    const d = away.length();

    if (d < 28 && d > 0.001 && !ball.userData.touched) {
      away.normalize();

      ball.position.x += away.x * ball.userData.speedAway * dt;
      ball.position.z += away.z * ball.userData.speedAway * dt;

      const clamped = clampToPlayArea(ball.position.clone());
      ball.position.x = clamped.x;
      ball.position.z = clamped.z;

      col.x = ball.position.x;
      col.z = ball.position.z;
    }

    // Ya no se recalcula la altura ni se aplica rebote.
    ball.userData.spin += dt * 1.2;
    ball.rotation.y = ball.userData.spin;

    if (ball.userData.touched) {
      ball.scale.lerp(new THREE.Vector3(1, 1, 1), dt * 1.5);
    }
  }
}

/** ========= BRÚJULA / MINIMAPA ========= */
function updateCompass() {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0;
  dir.normalize();

  const angle = Math.atan2(dir.x, dir.z);
  let deg = THREE.MathUtils.radToDeg(angle);
  if (deg < 0) deg += 360;

  let label = 'N';
  if (deg >= 45 && deg < 135) label = 'E';
  else if (deg >= 135 && deg < 225) label = 'S';
  else if (deg >= 225 && deg < 315) label = 'O';

  compassEl.textContent = `${label} ↑`;
}

function updateMinimap() {
  const w = minimap.width;
  const h = minimap.height;
  const cx = w / 2;
  const cy = h / 2;
  const scale = (w * 0.46) / PLAY_RADIUS;

  minimapCtx.clearRect(0, 0, w, h);

  minimapCtx.fillStyle = 'rgba(220,255,220,0.85)';
  minimapCtx.fillRect(0, 0, w, h);

  minimapCtx.strokeStyle = 'rgba(0,90,40,0.45)';
  minimapCtx.lineWidth = 2;
  minimapCtx.beginPath();
  minimapCtx.arc(cx, cy, PLAY_RADIUS * scale, 0, Math.PI * 2);
  minimapCtx.stroke();

  // árboles
  minimapCtx.fillStyle = 'rgba(0,100,30,0.55)';
  for (const t of treeColliders) {
    const x = cx + t.x * scale;
    const y = cy + t.z * scale;
    minimapCtx.fillRect(x - 1, y - 1, 2, 2);
  }

  // pelotas
  for (let i = 0; i < balls.length; i++) {
    const ball = balls[i];
    const x = cx + ball.position.x * scale;
    const y = cy + ball.position.z * scale;

    minimapCtx.fillStyle = ball.userData.touched ? '#ff2222' : '#0066ff';
    minimapCtx.beginPath();
    minimapCtx.arc(x, y, 3, 0, Math.PI * 2);
    minimapCtx.fill();
  }

  // jugador
  const px = cx + player.position.x * scale;
  const py = cy + player.position.z * scale;

  minimapCtx.fillStyle = '#ff9900';
  minimapCtx.beginPath();
  minimapCtx.arc(px, py, 5, 0, Math.PI * 2);
  minimapCtx.fill();

  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  dir.y = 0;
  dir.normalize();

  minimapCtx.strokeStyle = '#ff6600';
  minimapCtx.lineWidth = 2;
  minimapCtx.beginPath();
  minimapCtx.moveTo(px, py);
  minimapCtx.lineTo(px + dir.x * 14, py + dir.z * 14);
  minimapCtx.stroke();
}

/** ========= LOOP ========= */
const clock = new THREE.Clock();

renderer.setAnimationLoop(() => {
  const dt = Math.min(clock.getDelta(), 0.05);

  if (renderer.xr.isPresenting) {
    vrGamepadMove(dt);
    updateTeleportArc();
  }

  const p = player.position;

  skyMesh.position.copy(p);
  sunGroup.position.copy(p).add(new THREE.Vector3(80, 180, -120));
  sunLight.position.set(80, 180, -90);

  updateBalls(dt);
  updateParticles(dt);
  updateCompass();
  updateMinimap();

  renderer.clear();

  bgCam.projectionMatrix.copy(camera.projectionMatrix);
  bgCam.matrixWorld.copy(camera.matrixWorld);
  bgCam.matrixWorldInverse.copy(camera.matrixWorldInverse);

  renderer.render(bgScene, bgCam);
  renderer.render(scene, camera);
});

/** ========= RESIZE ========= */
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();

  bgCam.aspect = innerWidth / innerHeight;
  bgCam.updateProjectionMatrix();

  renderer.setSize(innerWidth, innerHeight);
});