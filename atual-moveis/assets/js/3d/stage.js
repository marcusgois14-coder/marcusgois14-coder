// Estúdio 3D compartilhado: renderizador, luz neutra (RoomEnvironment + luz principal com sombra),
// sombra de contato no chão, enquadramento por ângulo e captura de imagem.
// Um único WebGLRenderer por página: reutilize o mesmo stage para miniaturas e visualização.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Ângulos de câmera (graus): az = giro a partir da frente (+Z) para a direita (+X); el = elevação
export const VIEWS = {
  front: { az: 0, el: 6 },
  'three-quarter': { az: 35, el: 18 },
  side: { az: 90, el: 6 },
  top: { az: 0, el: 89 },
  back: { az: 180, el: 12 },
};
export const VIEW_LABELS = { 'three-quarter': '3/4', front: 'Frente', side: 'Lado', top: 'Topo', back: 'Costas' };

// Textura de sombra de contato: retângulo arredondado com borda esfumada (centro = 60% da textura)
function contactTexture() {
  const S = 128;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const img = g.createImageData(S, S);
  const inner = 0.3; // meia-largura do retângulo interno (fração)
  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const x = Math.abs((i + 0.5) / S - 0.5);
      const y = Math.abs((j + 0.5) / S - 0.5);
      const dx = Math.max(0, x - inner);
      const dy = Math.max(0, y - inner);
      const d = Math.hypot(dx, dy) / (0.5 - inner);
      const core = Math.max(0, Math.min(1, 1 - Math.max(x, y) / inner));
      const a = Math.pow(Math.max(0, 1 - d), 2.2) * (0.75 + 0.25 * core);
      const k = (j * S + i) * 4;
      img.data[k] = img.data[k + 1] = img.data[k + 2] = Math.round(a * 255);
      img.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

export function createStage({ canvas, width = 800, height = 600, background = '#f4f3f0', transparent = false, pixelRatio, preserveDrawingBuffer = false, shadows = true, fov = 30 } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: transparent, preserveDrawingBuffer, powerPreference: 'high-performance' });
  renderer.setPixelRatio(pixelRatio ?? Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = shadows;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  scene.background = transparent ? null : new THREE.Color(background);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.65;
  pmrem.dispose();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xd8d0c4, 0.25));
  const key = new THREE.DirectionalLight(0xfff8f0, 1.35);
  key.castShadow = shadows;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.bias = -0.0003;
  key.shadow.normalBias = 0.015;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xf0f4ff, 0.35);
  scene.add(fill, fill.target);

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.ShadowMaterial({ opacity: 0.2, depthWrite: false }));
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.renderOrder = -2;
  scene.add(ground);
  const blob = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: 0x000000, alphaMap: contactTexture(), transparent: true, opacity: 0.32, depthWrite: false, toneMapped: false })
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.0006;
  blob.renderOrder = -1;
  scene.add(blob);

  const root = new THREE.Group();
  root.name = 'stage-root';
  scene.add(root);

  const camera = new THREE.PerspectiveCamera(fov, width / height, 0.01, 100);
  let bbox = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
  let controls = null;
  let size = { w: width, h: height };

  function fitEnvironment() {
    const s = bbox.getSize(new THREE.Vector3());
    const c = bbox.getCenter(new THREE.Vector3());
    const R = Math.max(0.3, s.length() / 2);
    ground.scale.set(R * 8, R * 8, 1);
    ground.position.set(c.x, 0, c.z);
    blob.scale.set((s.x + 0.06) / 0.6, (s.z + 0.06) / 0.6, 1);
    blob.position.set(c.x, 0.0006, c.z);
    // luz alta (sombra curta, como foto de produto) e frustum folgado para a sombra não ser cortada
    key.position.set(c.x + R * 1.3, c.y + R * 4.2, c.z + R * 1.9);
    key.target.position.copy(c);
    const sc = key.shadow.camera;
    sc.left = sc.bottom = -R * 2.4;
    sc.right = sc.top = R * 2.4;
    sc.near = 0.05;
    sc.far = R * 10;
    sc.updateProjectionMatrix();
    fill.position.set(c.x - R * 2.5, c.y + R * 1.2, c.z + R * 1.5);
    fill.target.position.copy(c);
    camera.near = Math.max(0.005, R / 200);
    camera.far = R * 60;
  }

  // Posiciona a câmera para enquadrar a caixa inteira no ângulo pedido (margem 1 = justo)
  function frame(view = 'three-quarter', { margin = 1.1, aspect } = {}) {
    const v = typeof view === 'string' ? VIEWS[view] || VIEWS['three-quarter'] : view;
    camera.aspect = aspect || size.w / size.h;
    const az = THREE.MathUtils.degToRad(v.az);
    // com OrbitControls o "up" da câmera precisa continuar +Y: limita a elevação
    const el = THREE.MathUtils.degToRad(controls ? Math.min(v.el, 84) : v.el);
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)).normalize();
    const c = bbox.getCenter(new THREE.Vector3());
    const worldUp = !controls && Math.abs(dir.y) > 0.99 ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0);
    const right = new THREE.Vector3().crossVectors(worldUp, dir).normalize();
    const up = new THREE.Vector3().crossVectors(dir, right).normalize();
    const tv = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / margin;
    const th = tv * camera.aspect;
    let dist = 0;
    for (const x of [bbox.min.x, bbox.max.x]) {
      for (const y of [bbox.min.y, bbox.max.y]) {
        for (const z of [bbox.min.z, bbox.max.z]) {
          const p = new THREE.Vector3(x, y, z).sub(c);
          const depth = p.dot(dir);
          dist = Math.max(dist, depth + Math.abs(p.dot(right)) / th, depth + Math.abs(p.dot(up)) / tv);
        }
      }
    }
    camera.up.copy(worldUp);
    camera.position.copy(c).addScaledVector(dir, dist);
    camera.lookAt(c);
    camera.updateProjectionMatrix();
    if (controls) {
      controls.target.copy(c);
      controls.update();
    }
    return camera;
  }

  const stage = {
    THREE,
    renderer,
    scene,
    camera,
    root,
    get bbox() {
      return bbox;
    },
    // Troca o objeto exibido (não descarta o anterior: modelos do cache são compartilhados)
    setModel(obj) {
      while (root.children.length) root.remove(root.children[0]);
      if (obj) {
        root.add(obj);
        obj.updateMatrixWorld(true);
        bbox = new THREE.Box3().setFromObject(obj, true);
        if (bbox.isEmpty()) bbox = new THREE.Box3(new THREE.Vector3(-0.5, 0, -0.5), new THREE.Vector3(0.5, 1, 0.5));
      }
      fitEnvironment();
      return stage;
    },
    // Enquadra no ângulo pedido; devolve o próprio stage (encadeável)
    frame(view, opts) {
      frame(view, opts);
      return stage;
    },
    resize(w, h) {
      size = { w: Math.max(1, Math.round(w)), h: Math.max(1, Math.round(h)) };
      renderer.setSize(size.w, size.h, false);
      camera.aspect = size.w / size.h;
      camera.updateProjectionMatrix();
      return stage;
    },
    render() {
      renderer.render(scene, camera);
      return stage;
    },
    // Renderiza e devolve um dataURL (mesmo canvas, tamanho temporário)
    snapshot({ width = 512, height = width, view = 'three-quarter', margin = 1.1, type = 'image/webp', quality = 0.9, pixelRatio = 1 } = {}) {
      const prev = { ...size, pr: renderer.getPixelRatio() };
      renderer.setPixelRatio(pixelRatio);
      stage.resize(width, height);
      frame(view, { margin });
      renderer.render(scene, camera);
      const url = renderer.domElement.toDataURL(type, quality);
      renderer.setPixelRatio(prev.pr);
      stage.resize(prev.w, prev.h);
      return url;
    },
    // Controles de órbita (arrastar para girar, pinça/roda para zoom)
    controls(dom = renderer.domElement) {
      if (controls) return controls;
      controls = new OrbitControls(camera, dom);
      controls.enableDamping = true;
      controls.dampingFactor = 0.08;
      controls.enablePan = false;
      controls.minPolarAngle = 0.05;
      controls.maxPolarAngle = Math.PI / 2 - 0.02;
      const s = bbox.getSize(new THREE.Vector3()).length();
      controls.minDistance = s * 0.4;
      controls.maxDistance = s * 5;
      controls.target.copy(bbox.getCenter(new THREE.Vector3()));
      return controls;
    },
    updateControlLimits() {
      if (!controls) return;
      const s = bbox.getSize(new THREE.Vector3()).length();
      controls.minDistance = s * 0.4;
      controls.maxDistance = s * 5;
    },
    dispose() {
      controls?.dispose();
      envRT.dispose();
      renderer.dispose();
    },
  };
  fitEnvironment();
  return stage;
}
