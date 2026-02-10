import { useRef, useEffect } from 'react';
import * as THREE from 'three';

interface HeroCanvasProps {
  onChainPulse?: number;
}

const PARTICLE_COUNT = 60;
const CONNECTION_DISTANCE = 1.8;
const FIELD_SIZE = 10;

/** Create a radial-gradient sprite texture for bloom-style glow */
function createGlowTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const half = size / 2;
  const gradient = ctx.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
  gradient.addColorStop(0.15, 'rgba(255, 255, 255, 0.7)');
  gradient.addColorStop(0.4, 'rgba(255, 255, 255, 0.15)');
  gradient.addColorStop(0.7, 'rgba(255, 255, 255, 0.03)');
  gradient.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

export function HeroCanvas({ onChainPulse = 0 }: HeroCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const pulseRef = useRef(onChainPulse);
  const flashRef = useRef<{ origin: [number, number, number]; startTime: number | null } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined' || !containerRef.current) return;
    // Respect reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const container = containerRef.current;
    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 100);
    camera.position.set(0, 0, 8);

    const glowTexture = createGlowTexture();

    // Particles
    const positions = new Float32Array(PARTICLE_COUNT * 3);
    const colors = new Float32Array(PARTICLE_COUNT * 3);
    const baseColors = new Float32Array(PARTICLE_COUNT * 3);
    const velocities = new Float32Array(PARTICLE_COUNT * 3);

    const purple = new THREE.Color(0x9D5CFF);
    const indigo = new THREE.Color(0x6366f1);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const i3 = i * 3;
      positions[i3] = (Math.random() - 0.5) * FIELD_SIZE;
      positions[i3 + 1] = (Math.random() - 0.5) * FIELD_SIZE * 0.6;
      positions[i3 + 2] = (Math.random() - 0.5) * FIELD_SIZE * 0.4;
      velocities[i3] = (Math.random() - 0.5) * 0.003;
      velocities[i3 + 1] = (Math.random() - 0.5) * 0.003;
      velocities[i3 + 2] = (Math.random() - 0.5) * 0.002;
      const mix = Math.random();
      const c = purple.clone().lerp(indigo, mix);
      baseColors[i3] = c.r;
      baseColors[i3 + 1] = c.g;
      baseColors[i3 + 2] = c.b;
      colors[i3] = c.r;
      colors[i3 + 1] = c.g;
      colors[i3 + 2] = c.b;
    }

    const particleGeometry = new THREE.BufferGeometry();
    particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const particleMaterial = new THREE.PointsMaterial({
      size: 0.35,
      map: glowTexture,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
      depthWrite: false,
    });

    const particles = new THREE.Points(particleGeometry, particleMaterial);
    scene.add(particles);

    // Connection lines
    const maxLines = (PARTICLE_COUNT * (PARTICLE_COUNT - 1)) / 2;
    const linePositions = new Float32Array(maxLines * 6);
    const lineColors = new Float32Array(maxLines * 6);
    const lineGeometry = new THREE.BufferGeometry();
    lineGeometry.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
    lineGeometry.setAttribute('color', new THREE.BufferAttribute(lineColors, 3));

    const lineMaterial = new THREE.LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      opacity: 0.35,
      blending: THREE.AdditiveBlending,
    });

    const lines = new THREE.LineSegments(lineGeometry, lineMaterial);
    scene.add(lines);

    function handleResize() {
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    }

    const observer = new ResizeObserver(handleResize);
    observer.observe(container);
    handleResize();

    let animId: number;
    const clock = new THREE.Clock();

    function animate() {
      animId = requestAnimationFrame(animate);
      const t = clock.getElapsedTime();

      // Move particles
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const i3 = i * 3;
        positions[i3] += velocities[i3] + Math.sin(t * 0.5 + i) * 0.001;
        positions[i3 + 1] += velocities[i3 + 1] + Math.cos(t * 0.3 + i * 0.5) * 0.001;
        positions[i3 + 2] += velocities[i3 + 2];
        for (let d = 0; d < 3; d++) {
          const half = FIELD_SIZE * (d === 0 ? 0.5 : d === 1 ? 0.3 : 0.2);
          if (positions[i3 + d] > half) positions[i3 + d] = -half;
          if (positions[i3 + d] < -half) positions[i3 + d] = half;
        }
      }

      // Ripple wave effect from chain pulse
      const flash = flashRef.current;
      const RIPPLE_DURATION = 1.8;
      const RIPPLE_SPEED = 8; // units per second
      const RIPPLE_WIDTH = 2.5; // thickness of the wave ring
      if (flash) {
        if (flash.startTime === null) flash.startTime = t;
        const elapsed = t - flash.startTime;
        if (elapsed < RIPPLE_DURATION) {
          const waveFront = elapsed * RIPPLE_SPEED;
          const fadeOut = 1 - elapsed / RIPPLE_DURATION;
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            const i3 = i * 3;
            const dx = positions[i3] - flash.origin[0];
            const dy = positions[i3 + 1] - flash.origin[1];
            const dz = positions[i3 + 2] - flash.origin[2];
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            const waveDist = Math.abs(dist - waveFront);
            if (waveDist < RIPPLE_WIDTH) {
              const intensity = (1 - waveDist / RIPPLE_WIDTH) * fadeOut;
              colors[i3] = baseColors[i3] + (1 - baseColors[i3]) * intensity;
              colors[i3 + 1] = baseColors[i3 + 1] + (1 - baseColors[i3 + 1]) * intensity;
              colors[i3 + 2] = baseColors[i3 + 2] + (1 - baseColors[i3 + 2]) * intensity;
            } else {
              colors[i3] = baseColors[i3];
              colors[i3 + 1] = baseColors[i3 + 1];
              colors[i3 + 2] = baseColors[i3 + 2];
            }
          }
          // Also boost line brightness during pulse
          lineMaterial.opacity = 0.35 + 0.4 * fadeOut;
          particleMaterial.size = 0.35 + 0.15 * fadeOut;
        } else {
          for (let i = 0; i < PARTICLE_COUNT; i++) {
            const i3 = i * 3;
            colors[i3] = baseColors[i3];
            colors[i3 + 1] = baseColors[i3 + 1];
            colors[i3 + 2] = baseColors[i3 + 2];
          }
          lineMaterial.opacity = 0.35;
          particleMaterial.size = 0.35;
          flashRef.current = null;
        }
        particleGeometry.attributes.color.needsUpdate = true;
      }

      // Update connections
      let lineIdx = 0;
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        for (let j = i + 1; j < PARTICLE_COUNT; j++) {
          const i3 = i * 3;
          const j3 = j * 3;
          const dx = positions[i3] - positions[j3];
          const dy = positions[i3 + 1] - positions[j3 + 1];
          const dz = positions[i3 + 2] - positions[j3 + 2];
          const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
          if (dist < CONNECTION_DISTANCE) {
            const alpha = 1 - dist / CONNECTION_DISTANCE;
            const li = lineIdx * 6;
            linePositions[li] = positions[i3];
            linePositions[li + 1] = positions[i3 + 1];
            linePositions[li + 2] = positions[i3 + 2];
            linePositions[li + 3] = positions[j3];
            linePositions[li + 4] = positions[j3 + 1];
            linePositions[li + 5] = positions[j3 + 2];
            const r = 0.62 * alpha;
            const g = 0.38 * alpha;
            const b = 1.0 * alpha;
            lineColors[li] = r; lineColors[li + 1] = g; lineColors[li + 2] = b;
            lineColors[li + 3] = r; lineColors[li + 4] = g; lineColors[li + 5] = b;
            lineIdx++;
          }
        }
      }
      for (let i = lineIdx * 6; i < linePositions.length; i++) {
        linePositions[i] = 0;
        lineColors[i] = 0;
      }

      lineGeometry.setDrawRange(0, lineIdx * 2);
      lineGeometry.attributes.position.needsUpdate = true;
      lineGeometry.attributes.color.needsUpdate = true;
      particleGeometry.attributes.position.needsUpdate = true;

      camera.position.x = Math.sin(t * 0.1) * 0.5;
      camera.position.y = Math.cos(t * 0.08) * 0.3;
      camera.lookAt(0, 0, 0);

      renderer.render(scene, camera);
    }

    animate();

    return () => {
      cancelAnimationFrame(animId);
      observer.disconnect();
      renderer.dispose();
      particleGeometry.dispose();
      particleMaterial.dispose();
      glowTexture.dispose();
      lineGeometry.dispose();
      lineMaterial.dispose();
      if (container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  // Handle pulse changes — spawn a ripple wave from a random point
  useEffect(() => {
    if (onChainPulse > pulseRef.current) {
      pulseRef.current = onChainPulse;
      const origin: [number, number, number] = [
        (Math.random() - 0.5) * FIELD_SIZE * 0.6,
        (Math.random() - 0.5) * FIELD_SIZE * 0.3,
        (Math.random() - 0.5) * FIELD_SIZE * 0.2,
      ];
      flashRef.current = { origin, startTime: null };
    }
  }, [onChainPulse]);

  return (
    <div
      ref={containerRef}
      className="absolute inset-0 pointer-events-none"
      aria-hidden="true"
    />
  );
}
