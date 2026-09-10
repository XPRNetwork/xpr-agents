import { useCallback, useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { ipfsCandidates } from '@/lib/ipfs';

interface ModelViewerProps {
  /** GLB/GLTF URL — gateway URL, `ipfs://` URI or bare CID. */
  url: string;
  /** Display label (usually the filename). */
  name?: string;
  /** Tailwind height class for the canvas area. */
  heightClass?: string;
}

interface ViewerStats {
  triangles: number;
  meshes: number;
}

/** Free every GPU resource under an object before dropping it. */
function disposeObject(root: THREE.Object3D) {
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const material = mesh.material;
    if (!material) return;
    const materials = Array.isArray(material) ? material : [material];
    for (const mat of materials) {
      for (const value of Object.values(mat)) {
        if (value instanceof THREE.Texture) value.dispose();
      }
      mat.dispose();
    }
  });
}

function countTriangles(root: THREE.Object3D): ViewerStats {
  let triangles = 0;
  let meshes = 0;
  root.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    meshes += 1;
    const geometry = mesh.geometry;
    triangles += geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
  });
  return { triangles: Math.round(triangles), meshes };
}

/**
 * Read a design token off the document as a three.js colour.
 * Tokens are stored space-separated RGB (`--c-accent: 122 104 255`) so Tailwind can apply
 * opacity to them; three wants a packed integer.
 */
function tokenColor(name: string, fallback: number): number {
  if (typeof window === 'undefined') return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const parts = raw.split(/[\s,]+/).map(Number);
  if (parts.length < 3 || !parts.slice(0, 3).every((n) => Number.isFinite(n))) return fallback;
  return (parts[0] << 16) | (parts[1] << 8) | parts[2];
}

function isDarkTheme(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

export function ModelViewer({ url, name, heightClass = 'h-[26rem]' }: ModelViewerProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const controlsRef = useRef<OrbitControls | null>(null);
  const homeRef = useRef<{ position: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const playingRef = useRef(true);
  /** Set by the scene effect so the theme observer can recolour without a remount. */
  const applyThemeRef = useRef<(() => void) | null>(null);

  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [progress, setProgress] = useState(0);
  const [stats, setStats] = useState<ViewerStats | null>(null);
  const [hasAnimation, setHasAnimation] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof window === 'undefined') return;

    let disposed = false;
    let frameId = 0;
    let visible = true;
    let mixer: THREE.AnimationMixer | null = null;
    let modelRoot: THREE.Object3D | null = null;

    // alpha:true lets the wrapper's own `bg-surface` show through, so the canvas
    // background follows the site theme for free.
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(host.clientWidth || 1, host.clientHeight || 1);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';
    renderer.domElement.style.cursor = 'grab';
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    const envTarget = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envTarget.texture;

    const keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
    keyLight.position.set(4, 6, 4);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.set(1024, 1024);
    keyLight.shadow.bias = -0.0005;
    scene.add(keyLight);

    const fillLight = new THREE.HemisphereLight(0xffffff, 0xffffff, 0.6);
    scene.add(fillLight);

    const groundMaterial = new THREE.ShadowMaterial({ opacity: 0.35 });
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.visible = false;
    scene.add(ground);

    /**
     * Tint the lighting from the theme tokens. The sky term picks up the accent so models
     * sit in the site's palette; the ground term is the surface the canvas is drawn on.
     * A dark surface swallows a dark contact shadow, so soften it in dark mode.
     */
    const applyTheme = () => {
      const dark = isDarkTheme();
      fillLight.color.setHex(tokenColor('--c-accent', dark ? 0x7a68ff : 0x4b3adf));
      fillLight.groundColor.setHex(tokenColor('--c-surface', dark ? 0x151821 : 0xf6f7fa));
      fillLight.intensity = dark ? 0.75 : 0.6;
      groundMaterial.opacity = dark ? 0.2 : 0.35;
    };
    applyTheme();
    applyThemeRef.current = applyTheme;

    // A slightly long lens (35mm-ish) keeps perspective distortion low so the model fills more frame.
    const camera = new THREE.PerspectiveCamera(35, (host.clientWidth || 1) / (host.clientHeight || 1), 0.01, 1000);
    camera.position.set(0, 1, 3);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.9;
    controls.panSpeed = 0.8;
    controls.zoomSpeed = 0.9;
    controls.screenSpacePanning = true;
    controls.autoRotateSpeed = 1.4;
    controlsRef.current = controls;

    function frameModel(root: THREE.Object3D) {
      const box = new THREE.Box3().setFromObject(root);
      if (box.isEmpty()) return;
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());

      // Recentre horizontally and drop the model onto y = 0 so the shadow plane reads as ground.
      root.position.sub(center);
      root.position.y += size.y / 2;

      const radius = Math.max(size.length() / 2, 1e-4);
      const target = new THREE.Vector3(0, size.y / 2, 0);
      const direction = new THREE.Vector3(1, 0.45, 1).normalize();

      // Fit each of the 8 bounding-box corners individually: a corner's screen position depends on
      // its own depth, so summing worst-case half-extents (or fitting the bounding sphere) parks the
      // camera much further back than it needs to be and leaves the model marooned in dead space.
      const cameraRight = new THREE.Vector3().crossVectors(direction, new THREE.Vector3(0, 1, 0)).normalize();
      const cameraUp = new THREE.Vector3().crossVectors(cameraRight, direction).normalize();
      const vFov = (camera.fov * Math.PI) / 180;
      const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);
      const tanV = Math.tan(vFov / 2);
      const tanH = Math.tan(hFov / 2);
      const half = size.clone().multiplyScalar(0.5);
      let distance = 0;
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          for (const sz of [-1, 1]) {
            const corner = new THREE.Vector3(half.x * sx, half.y * sy, half.z * sz);
            const depth = corner.dot(direction);
            distance = Math.max(
              distance,
              Math.abs(corner.dot(cameraUp)) / tanV + depth,
              Math.abs(corner.dot(cameraRight)) / tanH + depth
            );
          }
        }
      }
      distance = Math.max(distance * 1.04, radius * 0.5);
      camera.near = Math.max(radius / 500, 0.001);
      camera.far = radius * 200;
      camera.position.copy(target).addScaledVector(direction, distance);
      camera.updateProjectionMatrix();

      controls.target.copy(target);
      controls.minDistance = radius * 0.25;
      controls.maxDistance = distance * 8;
      controls.update();
      homeRef.current = { position: camera.position.clone(), target: target.clone() };

      // Scale the light rig and its shadow frustum to the model, or the shadow misses it entirely.
      const lightDistance = radius * 3;
      keyLight.position.set(lightDistance, lightDistance * 1.6, lightDistance);
      const shadowCamera = keyLight.shadow.camera;
      shadowCamera.left = -radius * 1.8;
      shadowCamera.right = radius * 1.8;
      shadowCamera.top = radius * 1.8;
      shadowCamera.bottom = -radius * 1.8;
      shadowCamera.near = radius * 0.1;
      shadowCamera.far = lightDistance * 6;
      shadowCamera.updateProjectionMatrix();

      ground.scale.setScalar(Math.max(radius * 12, 1));
      ground.visible = true;
    }

    const dracoLoader = new DRACOLoader().setDecoderPath('/draco/');
    const loader = new GLTFLoader();
    loader.setDRACOLoader(dracoLoader);
    loader.setMeshoptDecoder(MeshoptDecoder);

    function loadFrom(candidate: string): Promise<GLTF> {
      return new Promise((resolve, reject) => {
        loader.load(
          candidate,
          resolve,
          (event) => {
            if (event.total > 0) setProgress(Math.min(100, Math.round((event.loaded / event.total) * 100)));
          },
          reject
        );
      });
    }

    (async () => {
      for (const candidate of ipfsCandidates(url)) {
        try {
          const gltf = await loadFrom(candidate);
          if (disposed) {
            disposeObject(gltf.scene);
            return;
          }
          modelRoot = gltf.scene;
          modelRoot.traverse((child) => {
            const mesh = child as THREE.Mesh;
            if (mesh.isMesh) {
              mesh.castShadow = true;
              mesh.receiveShadow = true;
            }
          });
          scene.add(modelRoot);
          frameModel(modelRoot);
          setStats(countTriangles(modelRoot));

          if (gltf.animations.length > 0) {
            mixer = new THREE.AnimationMixer(modelRoot);
            mixer.clipAction(gltf.animations[0]).play();
            setHasAnimation(true);
          }
          setStatus('ready');
          return;
        } catch {
          /* try the next gateway */
        }
      }
      if (!disposed) setStatus('error');
    })();

    const clock = new THREE.Clock();
    const tick = () => {
      frameId = requestAnimationFrame(tick);
      const delta = clock.getDelta();
      if (!visible) return;
      if (mixer && playingRef.current) mixer.update(delta);
      controls.update();
      renderer.render(scene, camera);
    };
    tick();

    const resizeObserver = new ResizeObserver(() => {
      const width = host.clientWidth || 1;
      const height = host.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(host);

    // Don't burn GPU on a viewer that's scrolled out of sight or on a hidden tab.
    const intersectionObserver = new IntersectionObserver(
      ([entry]) => { visible = entry.isIntersecting && !document.hidden; },
      { threshold: 0.01 }
    );
    intersectionObserver.observe(host);
    const onVisibilityChange = () => { visible = !document.hidden; };
    document.addEventListener('visibilitychange', onVisibilityChange);

    return () => {
      disposed = true;
      applyThemeRef.current = null;
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      intersectionObserver.disconnect();
      document.removeEventListener('visibilitychange', onVisibilityChange);
      mixer?.stopAllAction();
      controls.dispose();
      controlsRef.current = null;
      if (modelRoot) {
        scene.remove(modelRoot);
        disposeObject(modelRoot);
      }
      ground.geometry.dispose();
      groundMaterial.dispose();
      envTarget.dispose();
      pmrem.dispose();
      dracoLoader.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [url, reloadKey]);

  // The theme toggle swaps a class on <html>; recolour the rig in place rather than reloading.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const observer = new MutationObserver(() => applyThemeRef.current?.());
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => observer.disconnect();
  }, []);

  // Respect the OS reduced-motion setting for the initial auto-rotate state.
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    setAutoRotate(!window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  }, []);

  useEffect(() => {
    if (controlsRef.current) controlsRef.current.autoRotate = autoRotate;
  }, [autoRotate, status]);

  useEffect(() => { playingRef.current = playing; }, [playing]);

  useEffect(() => {
    const onFullscreenChange = () => setIsFullscreen(document.fullscreenElement === wrapperRef.current);
    document.addEventListener('fullscreenchange', onFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', onFullscreenChange);
  }, []);

  const resetView = useCallback(() => {
    const controls = controlsRef.current;
    const home = homeRef.current;
    if (!controls || !home) return;
    controls.object.position.copy(home.position);
    controls.target.copy(home.target);
    controls.update();
  }, []);

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    } else {
      wrapperRef.current?.requestFullscreen?.().catch(() => {});
    }
  }, []);

  const retry = useCallback(() => {
    setStatus('loading');
    setProgress(0);
    setStats(null);
    setHasAnimation(false);
    setReloadKey((k) => k + 1);
  }, []);

  const buttonClass =
    'rounded-md border border-line-2 bg-canvas/85 px-2 py-1 text-ink-2 backdrop-blur transition-colors hover:border-ink hover:text-ink';

  return (
    <div ref={wrapperRef} className="relative overflow-hidden rounded-lg border border-line bg-surface">
      <div ref={hostRef} className={`w-full ${isFullscreen ? 'h-[calc(100vh-2.25rem)]' : heightClass}`} />

      {/* Toolbar */}
      {status === 'ready' && (
        <div className="absolute right-2 top-2 flex gap-1 text-xs">
          {hasAnimation && (
            <button type="button" onClick={() => setPlaying((p) => !p)} className={buttonClass}
              title={playing ? 'Pause animation' : 'Play animation'}>
              {playing ? 'Pause' : 'Play'}
            </button>
          )}
          <button type="button" onClick={() => setAutoRotate((r) => !r)} className={buttonClass}
            title="Toggle auto-rotate">
            {autoRotate ? 'Stop spin' : 'Spin'}
          </button>
          <button type="button" onClick={resetView} className={buttonClass} title="Reset camera">
            Reset
          </button>
          <button type="button" onClick={toggleFullscreen} className={buttonClass} title="Toggle fullscreen">
            {isFullscreen ? 'Exit' : 'Fullscreen'}
          </button>
        </div>
      )}

      {/* Loading overlay */}
      {status === 'loading' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-canvas/70">
          <svg className="h-6 w-6 animate-spin text-accent" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          <p className="text-xs text-ink-2">
            {progress > 0 ? `Loading 3D model — ${progress}%` : 'Loading 3D model from IPFS…'}
          </p>
          {progress > 0 && (
            <div className="h-1 w-40 overflow-hidden rounded bg-surface-2">
              <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
            </div>
          )}
        </div>
      )}

      {/* Error state */}
      {status === 'error' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-canvas/85 px-6 text-center">
          <p className="text-sm text-ink-2">Could not load this 3D model.</p>
          <p className="break-all font-mono text-xs text-muted">{name || url}</p>
          <div className="flex gap-2 text-xs">
            <button type="button" onClick={retry} className={buttonClass}>Retry</button>
            <a href={url} target="_blank" rel="noopener noreferrer" className={buttonClass}>Download</a>
          </div>
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between gap-3 border-t border-line bg-surface px-3 py-2 text-xs">
        <span className="truncate text-ink-2">{name || 'GLB model'}</span>
        <span className="flex shrink-0 items-center gap-3">
          {stats && (
            <span className="hidden font-mono tabular text-muted sm:inline">
              {stats.meshes} mesh{stats.meshes === 1 ? '' : 'es'} · {stats.triangles.toLocaleString()} tris
            </span>
          )}
          <span className="hidden text-muted md:inline">Drag to rotate · Scroll to zoom · Right-drag to pan</span>
          <a href={url} target="_blank" rel="noopener noreferrer" className="text-accent hover:text-accent-hover">
            Download
          </a>
        </span>
      </div>
    </div>
  );
}

export default ModelViewer;
