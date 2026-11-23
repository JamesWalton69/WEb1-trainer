import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createAnatomicalMannequin, loadRiggedHumanAthlete } from './AnatomicalMannequin';
import { updateKinematics } from './kinematics';
import FormOverlayHUD from './FormOverlayHUD';

const VIEW_PRESETS = [
  { name: '3/4 View', pos: [1.25, 1.4, 2.1], target: [0, 1.05, 0] },
  { name: 'Side Profile', pos: [2.3, 1.3, 0.1], target: [0, 1.05, 0] },
  { name: 'Front View', pos: [0, 1.3, 2.4], target: [0, 1.05, 0] },
];

export default function ExerciseCanvas3D({
  exerciseName = 'Backpack curls',
  phase = 'GET READY',
  countdown = 0,
  countdownMax = 0,
  paused = false,
  onExpand = null,
  height = '240px',
  compact = false,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);

  const [hudStats, setHudStats] = useState(null);
  const [viewIndex, setViewIndex] = useState(0);

  // References to keep Three.js loop independent of React render cycle
  const threeRefs = useRef({
    scene: null,
    camera: null,
    renderer: null,
    controls: null,
    rig: null,
    reqId: null,
    clock: new THREE.Clock(),
  });

  const stateRef = useRef({
    exerciseName,
    phase,
    countdown,
    countdownMax,
    paused,
  });

  // Keep stateRef fresh for the RAF loop
  useEffect(() => {
    stateRef.current = {
      exerciseName,
      phase,
      countdown,
      countdownMax,
      paused,
    };
  }, [exerciseName, phase, countdown, countdownMax, paused]);

  // Set camera to preset
  const setCameraView = useCallback((preset) => {
    const { camera, controls } = threeRefs.current;
    if (!camera || !controls) return;

    camera.position.set(...preset.pos);
    controls.target.set(...preset.target);
    controls.update();
  }, []);

  const handleToggleView = useCallback(() => {
    setViewIndex((prev) => {
      const next = (prev + 1) % VIEW_PRESETS.length;
      setCameraView(VIEW_PRESETS[next]);
      return next;
    });
  }, [setCameraView]);

  const handleResetCamera = useCallback(() => {
    setCameraView(VIEW_PRESETS[viewIndex]);
  }, [setCameraView, viewIndex]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    const width = container.clientWidth || 340;
    const heightPx = container.clientHeight || 240;

    // --- Scene Setup ---
    const scene = new THREE.Scene();
    // Subtle athletic dark fog for depth
    scene.fog = new THREE.FogExp2(0x0c1222, 0.18);

    // --- Camera ---
    const camera = new THREE.PerspectiveCamera(44, width / heightPx, 0.1, 20);
    const initialPreset = VIEW_PRESETS[0];
    camera.position.set(...initialPreset.pos);

    // --- Renderer ---
    const renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, heightPx, false);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;

    // --- Orbit Controls ---
    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(...initialPreset.target);
    controls.minDistance = 1.0;
    controls.maxDistance = 4.2;
    // Restrict vertical orbit so floor stays grounded
    controls.maxPolarAngle = Math.PI / 2 + 0.05;
    controls.minPolarAngle = 0.2;
    controls.update();

    // --- Studio Lighting for Natural Human Skin ---
    // Ambient soft fill
    const ambientLight = new THREE.AmbientLight(0xfff5ea, 1.05);
    scene.add(ambientLight);

    // Warm Key Light (top-front-right studio spotlight)
    const keyLight = new THREE.DirectionalLight(0xfff8f0, 1.9);
    keyLight.position.set(2.4, 4.0, 3.0);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    scene.add(keyLight);

    // Soft Neutral Fill Light (softens shadows across torso and arms)
    const fillLight = new THREE.DirectionalLight(0xe8eef8, 0.85);
    fillLight.position.set(-2.5, 2.2, 1.8);
    scene.add(fillLight);

    // Clean Contour Rim Light (highlights muscular silhouette without unnatural tints)
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.75);
    rimLight.position.set(0, 2.8, -2.6);
    scene.add(rimLight);

    // --- Athlete Rig: Initial Mount & Custom Real Human Character Loader ---
    const initialRig = createAnatomicalMannequin();
    scene.add(initialRig.root);

    threeRefs.current = {
      scene,
      camera,
      renderer,
      controls,
      rig: initialRig,
      clock: new THREE.Clock(),
      reqId: null,
    };

    let isDisposed = false;
    loadRiggedHumanAthlete('/models/human_athlete.glb')
      .then((realAthleteRig) => {
        if (isDisposed || !threeRefs.current.scene) return;
        scene.remove(initialRig.root);
        scene.add(realAthleteRig.root);
        threeRefs.current.rig = realAthleteRig;
      })
      .catch((err) => {
        console.warn('Real human model load deferred to procedural rig:', err);
      });

    // --- Animation Loop ---
    let lastHudUpdate = 0;

    const animate = () => {
      const { clock, rig: activeRig, controls: activeControls, renderer: activeRenderer, scene: activeScene, camera: activeCamera } = threeRefs.current;
      if (!activeRenderer || !activeScene || !activeCamera) return;

      const elapsed = clock.getElapsedTime();

      activeControls.update();

      // Read current state
      const { exerciseName: exName, phase: curPhase, countdown: curCd, countdownMax: curMax, paused: isPaused } = stateRef.current;

      // Calculate normalized progress within the phase
      let progress = 0;
      if (curMax > 0) {
        progress = Math.min(Math.max((curMax - curCd) / curMax, 0), 1);
      }

      // Update Rig Kinematics
      const stats = updateKinematics(
        activeRig,
        exName,
        { phase: curPhase, progress, paused: isPaused },
        elapsed
      );

      // Throttle React state updates to ~15fps so React doesn't re-render excessively
      if (stats && elapsed - lastHudUpdate > 0.065) {
        lastHudUpdate = elapsed;
        setHudStats(stats);
      }

      activeRenderer.render(activeScene, activeCamera);
      threeRefs.current.reqId = requestAnimationFrame(animate);
    };

    threeRefs.current.reqId = requestAnimationFrame(animate);

    // --- Responsive Resize Handling ---
    const resizeObserver = new ResizeObserver((entries) => {
      if (!entries.length || !threeRefs.current.renderer) return;
      const { width: newW, height: newH } = entries[0].contentRect;
      if (newW > 0 && newH > 0) {
        threeRefs.current.camera.aspect = newW / newH;
        threeRefs.current.camera.updateProjectionMatrix();
        threeRefs.current.renderer.setSize(newW, newH, false);
      }
    });

    resizeObserver.observe(container);

    // --- Cleanup ---
    return () => {
      isDisposed = true;
      resizeObserver.disconnect();
      if (threeRefs.current.reqId) {
        cancelAnimationFrame(threeRefs.current.reqId);
      }
      if (threeRefs.current.controls) {
        threeRefs.current.controls.dispose();
      }
      if (threeRefs.current.renderer) {
        threeRefs.current.renderer.dispose();
      }
      // Traverse and dispose materials and geometries
      scene.traverse((obj) => {
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) {
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className="exercise3d-container"
      style={{ height, position: 'relative' }}
    >
      <canvas
        ref={canvasRef}
        className="exercise3d-canvas"
        aria-label="3D biomechanical exercise demonstration"
      />

      <FormOverlayHUD
        stats={hudStats}
        exerciseName={exerciseName}
        onResetCamera={handleResetCamera}
        onToggleView={handleToggleView}
        viewAngle={VIEW_PRESETS[viewIndex].name}
        onExpand={onExpand}
        compact={compact}
      />
    </div>
  );
}
