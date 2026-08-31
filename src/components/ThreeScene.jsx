import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export default function ThreeScene({ scrollProgress = 0, mousePos = { x: 0, y: 0 } }) {
  const mountRef = useRef(null);
  const sceneRef = useRef(null);
  const rendererRef = useRef(null);
  const cameraRef = useRef(null);
  const frameIdRef = useRef(null);

  // References for animated objects
  const particlesRef = useRef(null);
  const ringsRef = useRef([]);
  const floatingMeshesRef = useRef([]);
  const gridHelperRef = useRef(null);
  const lightsRef = useRef({});

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const width = container.clientWidth || window.innerWidth;
    const height = container.clientHeight || window.innerHeight;

    // 1. Scene setup
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x05030f, 0.015);
    sceneRef.current = scene;

    // 2. Camera setup
    const camera = new THREE.PerspectiveCamera(60, width / height, 0.1, 1000);
    camera.position.set(0, 0, 35);
    cameraRef.current = camera;

    // 3. Renderer setup
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.2;
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // 4. Dynamic Lighting
    const ambientLight = new THREE.AmbientLight(0x221133, 2);
    scene.add(ambientLight);

    const pointLight1 = new THREE.PointLight(0x7c3aed, 8, 80); // Electric Purple
    pointLight1.position.set(20, 20, 20);
    scene.add(pointLight1);

    const pointLight2 = new THREE.PointLight(0xec4899, 6, 80); // Neon Pink / Magenta
    pointLight2.position.set(-20, -10, 15);
    scene.add(pointLight2);

    const pointLight3 = new THREE.PointLight(0x00f5ff, 5, 70); // Cyber Cyan
    pointLight3.position.set(0, 30, -10);
    scene.add(pointLight3);

    lightsRef.current = { pointLight1, pointLight2, pointLight3 };

    // 5. 3D Particle Starfield & Cyber Vortex (3000 particles)
    const particleCount = 2800;
    const geometry = new THREE.BufferGeometry();
    const positions = new Float32Array(particleCount * 3);
    const colors = new Float32Array(particleCount * 3);
    const scales = new Float32Array(particleCount);

    const colorChoices = [
      new THREE.Color(0x7c3aed), // purple
      new THREE.Color(0xc026d3), // violet/fuchsia
      new THREE.Color(0x00f5ff), // cyan
      new THREE.Color(0xec4899), // pink
      new THREE.Color(0xffffff), // white spark
    ];

    for (let i = 0; i < particleCount; i++) {
      // Cylindrical/spherical cosmic distribution
      const radius = 15 + Math.random() * 65;
      const theta = Math.random() * Math.PI * 2;
      const z = (Math.random() - 0.5) * 120;

      positions[i * 3] = Math.cos(theta) * radius;
      positions[i * 3 + 1] = (Math.random() - 0.5) * 60 + Math.sin(theta * 2) * 5;
      positions[i * 3 + 2] = z;

      const col = colorChoices[Math.floor(Math.random() * colorChoices.length)];
      colors[i * 3] = col.r;
      colors[i * 3 + 1] = col.g;
      colors[i * 3 + 2] = col.b;

      scales[i] = Math.random() * 2.5 + 0.5;
    }

    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    // Particle Material
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');
    const grad = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.3, 'rgba(200,180,255,0.8)');
    grad.addColorStop(0.7, 'rgba(124,58,237,0.3)');
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 64, 64);
    const particleTexture = new THREE.CanvasTexture(canvas);

    const particleMaterial = new THREE.PointsMaterial({
      size: 1.2,
      map: particleTexture,
      transparent: true,
      vertexColors: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });

    const particleSystem = new THREE.Points(geometry, particleMaterial);
    scene.add(particleSystem);
    particlesRef.current = particleSystem;

    // 6. Glowing Hologram Cyber Rings
    const rings = [];
    const ringConfigs = [
      { radius: 18, tube: 0.12, color: 0x7c3aed, rotX: 1.2, rotY: 0.4, speed: 0.003 },
      { radius: 24, tube: 0.08, color: 0xec4899, rotX: -0.8, rotY: 0.9, speed: -0.002 },
      { radius: 30, tube: 0.06, color: 0x00f5ff, rotX: 0.5, rotY: -1.1, speed: 0.004 },
    ];

    ringConfigs.forEach((cfg) => {
      const ringGeo = new THREE.TorusGeometry(cfg.radius, cfg.tube, 16, 100);
      const ringMat = new THREE.MeshBasicMaterial({
        color: cfg.color,
        transparent: true,
        opacity: 0.45,
        wireframe: true,
      });
      const ringMesh = new THREE.Mesh(ringGeo, ringMat);
      ringMesh.rotation.x = cfg.rotX;
      ringMesh.rotation.y = cfg.rotY;
      ringMesh.userData = { speed: cfg.speed };
      scene.add(ringMesh);
      rings.push(ringMesh);
    });
    ringsRef.current = rings;

    // 7. Floating 3D Geometric Polyhedra Crystals
    const crystals = [];
    const crystalGeos = [
      new THREE.IcosahedronGeometry(1.8, 0),
      new THREE.OctahedronGeometry(2.2, 0),
      new THREE.TetrahedronGeometry(2.0, 0),
      new THREE.DodecahedronGeometry(1.6, 0),
    ];

    const crystalMat = new THREE.MeshPhysicalMaterial({
      color: 0xa855f7,
      emissive: 0x4c1d95,
      emissiveIntensity: 0.6,
      roughness: 0.1,
      metalness: 0.9,
      transmission: 0.6,
      thickness: 1.2,
      wireframe: false,
    });

    const wireMat = new THREE.MeshBasicMaterial({
      color: 0x00f5ff,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });

    const positionsList = [
      { x: -22, y: 12, z: 0, rotSpeed: 0.015 },
      { x: 24, y: -10, z: -5, rotSpeed: -0.012 },
      { x: -18, y: -14, z: -10, rotSpeed: 0.018 },
      { x: 20, y: 15, z: -15, rotSpeed: -0.01 },
    ];

    positionsList.forEach((pos, idx) => {
      const group = new THREE.Group();
      const mesh = new THREE.Mesh(crystalGeos[idx % crystalGeos.length], crystalMat);
      const wire = new THREE.Mesh(crystalGeos[idx % crystalGeos.length], wireMat);
      wire.scale.set(1.05, 1.05, 1.05);

      group.add(mesh);
      group.add(wire);
      group.position.set(pos.x, pos.y, pos.z);
      group.userData = {
        baseY: pos.y,
        baseX: pos.x,
        rotSpeed: pos.rotSpeed,
        phase: idx * 1.5,
      };

      scene.add(group);
      crystals.push(group);
    });
    floatingMeshesRef.current = crystals;

    // 8. Cyber Depth Floor Grid
    const gridHelper = new THREE.GridHelper(120, 40, 0xec4899, 0x2e1065);
    gridHelper.position.y = -22;
    gridHelper.material.transparent = true;
    gridHelper.material.opacity = 0.35;
    scene.add(gridHelper);
    gridHelperRef.current = gridHelper;

    // 9. Resize handler
    const handleResize = () => {
      if (!mountRef.current || !rendererRef.current || !cameraRef.current) return;
      const w = mountRef.current.clientWidth;
      const h = mountRef.current.clientHeight;
      cameraRef.current.aspect = w / h;
      cameraRef.current.updateProjectionMatrix();
      rendererRef.current.setSize(w, h);
    };
    window.addEventListener('resize', handleResize);

    // 10. Animation Loop
    let clock = new THREE.Clock();

    const animate = () => {
      frameIdRef.current = requestAnimationFrame(animate);
      const elapsedTime = clock.getElapsedTime();

      // Rotate particle vortex
      if (particlesRef.current) {
        particlesRef.current.rotation.y = elapsedTime * 0.03;
        particlesRef.current.rotation.z = Math.sin(elapsedTime * 0.1) * 0.05;
      }

      // Rotate rings
      ringsRef.current.forEach((ring) => {
        ring.rotation.z += ring.userData.speed;
        ring.rotation.x += ring.userData.speed * 0.6;
      });

      // Float and rotate crystals
      floatingMeshesRef.current.forEach((crystal) => {
        crystal.rotation.x += crystal.userData.rotSpeed;
        crystal.rotation.y += crystal.userData.rotSpeed * 1.2;
        crystal.position.y = crystal.userData.baseY + Math.sin(elapsedTime * 1.5 + crystal.userData.phase) * 1.8;
      });

      // Infinite cyber grid motion
      if (gridHelperRef.current) {
        gridHelperRef.current.position.z = (elapsedTime * 4) % 3;
      }

      // Camera smooth follow with scroll & mouse
      if (cameraRef.current) {
        const targetX = (mousePos.x * 6);
        const targetY = -(mousePos.y * 4) - (scrollProgress * 25);
        const targetZ = 35 - (scrollProgress * 30);

        cameraRef.current.position.x += (targetX - cameraRef.current.position.x) * 0.05;
        cameraRef.current.position.y += (targetY - cameraRef.current.position.y) * 0.05;
        cameraRef.current.position.z += (targetZ - cameraRef.current.position.z) * 0.05;
        cameraRef.current.lookAt(0, -scrollProgress * 20, 0);
      }

      // Dynamic light movement
      if (lightsRef.current.pointLight1) {
        lightsRef.current.pointLight1.position.x = 20 + Math.sin(elapsedTime) * 10;
        lightsRef.current.pointLight1.position.y = 20 + Math.cos(elapsedTime * 0.8) * 8;
      }

      renderer.render(scene, camera);
    };

    animate();

    return () => {
      cancelAnimationFrame(frameIdRef.current);
      window.removeEventListener('resize', handleResize);
      if (container && renderer.domElement) {
        container.removeChild(renderer.domElement);
      }
      renderer.dispose();
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100vw',
        height: '100vh',
        pointerEvents: 'none',
        zIndex: 0,
        overflow: 'hidden',
      }}
    />
  );
}
