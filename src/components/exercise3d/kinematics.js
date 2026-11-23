import * as THREE from 'three';

/**
 * Exercise Kinematics Engine
 * Translates workout phases, rep timings, and exercise types into exact
 * joint angles, muscle swelling/deformation, and biomechanical form cues.
 */

// Step-by-step breakdowns for educational inspection
export const EXERCISE_STEP_GUIDES = {
  curl: [
    {
      step: 1,
      title: 'Setup & Core Brace',
      cue: 'Stand tall with feet shoulder-width apart. Hold dumbbells with elbows pinned close to your ribs. Keep shoulders down and back.',
      targetElbowDeg: 20,
      muscleTarget: 'Core braced, Biceps on passive stretch',
    },
    {
      step: 2,
      title: 'Concentric Drive (Curl Up)',
      cue: 'Exhale and curl the weights up without swinging your torso. Keep upper arms completely stationary; only forearms move.',
      targetElbowDeg: 90,
      muscleTarget: 'High Bicep Brachii recruitment & Brachialis engagement',
    },
    {
      step: 3,
      title: 'Peak Contraction & Squeeze',
      cue: 'Reach top flexion (~135°–140°). Squeeze your biceps hard at the peak for half a second. Do not let elbows drift forward.',
      targetElbowDeg: 140,
      muscleTarget: 'Maximum bicep motor unit recruitment & peak tension',
    },
    {
      step: 4,
      title: 'Controlled Eccentric (Negative)',
      cue: 'Inhale and lower the weights slowly over 2–3 seconds against gravity. Stop just before total elbow lockout to maintain tension.',
      targetElbowDeg: 25,
      muscleTarget: 'Eccentric hypertrophy overload',
    },
  ],
  push: [
    {
      step: 1,
      title: 'Plank Foundation',
      cue: 'Hands just wider than shoulder width. Body in straight line from head to heels. Core tight, glutes squeezed.',
      targetElbowDeg: 10,
      muscleTarget: 'Full body tension & core stabilization',
    },
    {
      step: 2,
      title: 'Controlled Descent',
      cue: 'Lower your chest to an inch above the floor. Keep elbows tucked at roughly 45 degrees, not flared out 90 degrees.',
      targetElbowDeg: 90,
      muscleTarget: 'Pectoralis major, anterior deltoid eccentric stretch',
    },
    {
      step: 3,
      title: 'Press to Lockout',
      cue: 'Drive through your palms and press back up aggressively while keeping your torso rigid.',
      targetElbowDeg: 10,
      muscleTarget: 'Pectoral contraction, tricep lockout',
    },
  ],
  squat: [
    {
      step: 1,
      title: 'Stance & Balance',
      cue: 'Feet shoulder-width apart, toes turned out 15–30 degrees. Chest upright, gaze straight ahead.',
      targetElbowDeg: 0,
      muscleTarget: 'Quad & core bracing',
    },
    {
      step: 2,
      title: 'Hip Hinge & Depth',
      cue: 'Push hips back and bend knees. Lower until hip crease is below top of knees (parallel or below).',
      targetElbowDeg: 0,
      muscleTarget: 'Quadriceps, gluteus maximus, hamstrings',
    },
    {
      step: 3,
      title: 'Drive from Midfoot',
      cue: 'Drive your feet through the floor, knees tracking over toes, returning to standing position.',
      targetElbowDeg: 0,
      muscleTarget: 'Full lower chain extension',
    },
  ],
};

/**
 * Resolves exercise family name to kinematics profile
 */
export function resolveKinematicFamily(exerciseName = '') {
  const norm = exerciseName.toLowerCase();
  if (norm.includes('curl') || norm.includes('bicep')) return 'curl';
  if (norm.includes('push') || norm.includes('diamond') || norm.includes('pike')) return 'push';
  if (norm.includes('squat') || norm.includes('pistol') || norm.includes('split squat')) return 'squat';
  if (norm.includes('dip')) return 'dip';
  if (norm.includes('row') || norm.includes('pull')) return 'row';
  return 'default';
}

// Internal smoothing state
const currentAngles = {
  leftElbow: 0.3,
  rightElbow: 0.3,
  leftShoulderX: 0,
  rightShoulderX: 0,
  torsoPitch: 0,
  torsoY: 0.92,
  bicepActivation: 0.2,
  bicepScale: 1.0,
};

/**
 * Updates rig bone rotations, muscle scaling and emissive lighting
 * based on current phase and normalized timeline progress.
 */
export function updateKinematics(rig, exerciseName, phaseInfo, elapsedTime) {
  if (!rig || !rig.bones) return null;

  const family = resolveKinematicFamily(exerciseName);
  const { phase = 'GET READY', progress = 0, paused = false } = phaseInfo;

  let targetLeftElbow = 0.3; // ~17 degrees
  let targetRightElbow = 0.3;
  let targetShoulderX = 0;
  let targetTorsoPitch = 0;
  let targetTorsoY = 0.92;
  let targetActivation = 0.15;
  let targetBicepScale = 1.0;
  let activeStepTitle = 'Ready Stance';
  let activeCue = 'Prepare for next set';
  let primaryMuscle = 'Biceps Brachii';
  let secondaryMuscle = 'Brachialis, Forearm Flexors';

  // Natural idle breathing frequency
  const breath = Math.sin(elapsedTime * 2.5) * 0.015;

  if (family === 'curl') {
    primaryMuscle = 'Biceps Brachii (Short & Long Heads)';
    secondaryMuscle = 'Brachialis, Brachioradialis, Anterior Deltoid';

    if (phase.includes('UP')) {
      // Concentric Phase (Curling up to peak contraction)
      // Progress 0.0 -> 1.0
      const smoothP = easeOutQuad(Math.min(Math.max(progress, 0), 1));
      const minFlex = 0.3; // ~17 deg
      const maxFlex = 2.45; // ~140 deg
      const flex = THREE.MathUtils.lerp(minFlex, maxFlex, smoothP);

      targetLeftElbow = flex;
      targetRightElbow = flex;
      targetShoulderX = THREE.MathUtils.lerp(0, 0.08, smoothP); // upper arm stays pinned, subtle forward clear
      targetActivation = THREE.MathUtils.lerp(0.3, 0.95, smoothP);
      targetBicepScale = THREE.MathUtils.lerp(1.0, 1.30, smoothP); // Bicep bulges dramatically

      if (smoothP < 0.3) {
        activeStepTitle = 'Step 2: Concentric Curl Initiate';
        activeCue = 'Drive through forearms; keep upper arms pinned to ribs.';
      } else if (smoothP < 0.85) {
        activeStepTitle = 'Step 2: Mid-Range Squeeze';
        activeCue = 'Supinate wrists slightly; feel intense bicep contraction.';
      } else {
        activeStepTitle = 'Step 3: Peak Contraction (140°)';
        activeCue = 'Hard squeeze at apex! No hip or back swing.';
      }
    } else if (phase.includes('DOWN')) {
      // Eccentric Phase (Controlled negative lowering)
      // Progress 0.0 -> 1.0
      const smoothP = easeInOutCubic(Math.min(Math.max(progress, 0), 1));
      const maxFlex = 2.45;
      const minFlex = 0.3;
      const flex = THREE.MathUtils.lerp(maxFlex, minFlex, smoothP);

      targetLeftElbow = flex;
      targetRightElbow = flex;
      targetShoulderX = THREE.MathUtils.lerp(0.08, 0, smoothP);
      targetActivation = THREE.MathUtils.lerp(0.85, 0.25, smoothP);
      targetBicepScale = THREE.MathUtils.lerp(1.28, 1.0, smoothP);

      activeStepTitle = 'Step 4: Controlled Negative';
      activeCue = 'Fight gravity over 3 seconds. Stop just shy of full lockout.';
    } else if (phase === 'REST' || phase === 'TRANSITION') {
      // Resting stance
      targetLeftElbow = 0.25;
      targetRightElbow = 0.25;
      targetActivation = 0.1;
      targetBicepScale = 1.0;
      activeStepTitle = 'Rest & Recovery';
      activeCue = 'Shake out arms, breathe deeply, prepare for next set.';
    } else {
      // GET READY / Demonstration stance
      const demoCycle = (Math.sin(elapsedTime * 1.8) + 1) / 2;
      targetLeftElbow = THREE.MathUtils.lerp(0.3, 2.3, demoCycle);
      targetRightElbow = THREE.MathUtils.lerp(0.3, 2.3, demoCycle);
      targetActivation = THREE.MathUtils.lerp(0.2, 0.8, demoCycle);
      targetBicepScale = THREE.MathUtils.lerp(1.0, 1.25, demoCycle);
      activeStepTitle = 'Step 1: Stance & Demonstration';
      activeCue = 'Grip weights firmly, brace core, prepare to curl.';
    }
  } else if (family === 'push') {
    primaryMuscle = 'Pectoralis Major & Triceps Brachii';
    secondaryMuscle = 'Anterior Deltoids, Rectus Abdominis';

    // Prone horizontal orientation for push-up
    targetTorsoPitch = -Math.PI / 2 + 0.15;
    targetTorsoY = 0.35;

    if (phase.includes('DOWN')) {
      const p = easeInOutCubic(progress);
      targetLeftElbow = THREE.MathUtils.lerp(0.2, 1.6, p);
      targetRightElbow = THREE.MathUtils.lerp(0.2, 1.6, p);
      targetTorsoY = THREE.MathUtils.lerp(0.35, 0.20, p);
      targetActivation = THREE.MathUtils.lerp(0.3, 0.9, p);
      activeStepTitle = 'Controlled Push-Up Descent';
      activeCue = 'Keep elbows at 45 degrees, lower chest near floor.';
    } else if (phase.includes('UP')) {
      const p = easeOutQuad(progress);
      targetLeftElbow = THREE.MathUtils.lerp(1.6, 0.2, p);
      targetRightElbow = THREE.MathUtils.lerp(1.6, 0.2, p);
      targetTorsoY = THREE.MathUtils.lerp(0.20, 0.35, p);
      targetActivation = THREE.MathUtils.lerp(0.8, 0.4, p);
      activeStepTitle = 'Drive to Lockout';
      activeCue = 'Press the floor away, maintain tight core plank.';
    }
  } else if (family === 'squat') {
    primaryMuscle = 'Quadriceps & Gluteus Maximus';
    secondaryMuscle = 'Hamstrings, Calves, Erector Spinae';

    if (phase.includes('DOWN')) {
      const p = easeInOutCubic(progress);
      targetTorsoY = THREE.MathUtils.lerp(0.92, 0.60, p);
      targetActivation = THREE.MathUtils.lerp(0.2, 0.85, p);
      activeStepTitle = 'Squat Descent';
      activeCue = 'Hips back, knees track over toes, chest proud.';
    } else if (phase.includes('UP')) {
      const p = easeOutQuad(progress);
      targetTorsoY = THREE.MathUtils.lerp(0.60, 0.92, p);
      targetActivation = THREE.MathUtils.lerp(0.85, 0.3, p);
      activeStepTitle = 'Ascent to Stand';
      activeCue = 'Drive through midfoot, stand tall at top.';
    }
  }

  // Smooth lerp to targets (60fps smoothing factor)
  const lerpSpeed = paused ? 0.05 : 0.18;
  currentAngles.leftElbow = THREE.MathUtils.lerp(currentAngles.leftElbow, targetLeftElbow, lerpSpeed);
  currentAngles.rightElbow = THREE.MathUtils.lerp(currentAngles.rightElbow, targetRightElbow, lerpSpeed);
  currentAngles.leftShoulderX = THREE.MathUtils.lerp(currentAngles.leftShoulderX, targetShoulderX, lerpSpeed);
  currentAngles.rightShoulderX = THREE.MathUtils.lerp(currentAngles.rightShoulderX, targetShoulderX, lerpSpeed);
  currentAngles.torsoPitch = THREE.MathUtils.lerp(currentAngles.torsoPitch, targetTorsoPitch, lerpSpeed);
  currentAngles.torsoY = THREE.MathUtils.lerp(currentAngles.torsoY, targetTorsoY, lerpSpeed);
  currentAngles.bicepActivation = THREE.MathUtils.lerp(currentAngles.bicepActivation, targetActivation, lerpSpeed);
  currentAngles.bicepScale = THREE.MathUtils.lerp(currentAngles.bicepScale, targetBicepScale, lerpSpeed);

  // Apply kinematics to either the real human rigged character or the procedural fallback
  if (rig.isRiggedModel) {
    // High-Fidelity Rigged Human Character Model
    const bones = rig.bones;

    // Mixamo humanoid skeleton:
    // RightForeArm flexes along Z (negative direction from -0.45 to -2.35)
    // LeftForeArm flexes along Z (positive direction from +0.45 to +2.35)
    const normFlex = (currentAngles.rightElbow - 0.3) / (2.45 - 0.3);

    if (bones.RightForeArm) {
      bones.RightForeArm.rotation.z = THREE.MathUtils.lerp(-0.45, -2.35, normFlex);
    }
    if (bones.LeftForeArm) {
      bones.LeftForeArm.rotation.z = THREE.MathUtils.lerp(0.45, 2.35, normFlex);
    }

    // Upper arms stay pinned downwards along ribs with natural athletic posture
    if (bones.RightArm) {
      bones.RightArm.rotation.x = THREE.MathUtils.lerp(0.85, 0.98, currentAngles.rightShoulderX);
      bones.RightArm.rotation.z = -0.16;
    }
    if (bones.LeftArm) {
      bones.LeftArm.rotation.x = THREE.MathUtils.lerp(0.85, 0.98, currentAngles.leftShoulderX);
      bones.LeftArm.rotation.z = 0.16;
    }

    // Spine breathing motion
    if (bones.Spine1) {
      bones.Spine1.rotation.x = breath * 0.6;
    }
    if (bones.Spine2) {
      bones.Spine2.rotation.x = breath * 0.4;
    }
  } else {
    // Procedural Fallback Mannequin
    const bones = rig.bones;
    const meshes = rig.meshes;

    if (bones.pelvis) {
      bones.pelvis.position.y = currentAngles.torsoY;
      bones.pelvis.rotation.x = currentAngles.torsoPitch;
    }
    if (bones.chest) {
      bones.chest.position.y = 0.22 + breath;
    }

    // Invert X rotation so the elbow bends FORWARD into +Z (in front of the chest, towards viewer)
    if (bones.leftElbow) bones.leftElbow.rotation.x = -currentAngles.leftElbow;
    if (bones.rightElbow) bones.rightElbow.rotation.x = -currentAngles.rightElbow;

    if (bones.leftUpperArm) bones.leftUpperArm.rotation.x = -currentAngles.leftShoulderX;
    if (bones.rightUpperArm) bones.rightUpperArm.rotation.x = -currentAngles.rightShoulderX;

    const bulge = currentAngles.bicepScale;
    if (meshes && meshes.leftBicep) {
      meshes.leftBicep.scale.set(bulge, 1.35 * (2 - bulge * 0.7), bulge);
    }
    if (meshes && meshes.rightBicep) {
      meshes.rightBicep.scale.set(bulge, 1.35 * (2 - bulge * 0.7), bulge);
    }

    if (rig.materials && rig.materials.bicepMat) {
      const act = currentAngles.bicepActivation;
      rig.materials.bicepMat.emissive.setHex(0xb91c1c);
      rig.materials.bicepMat.emissiveIntensity = Math.max(0, (act - 0.25) * 0.32);
    }
  }

  // Compute actual degrees for the live HUD readout
  const elbowDeg = Math.round((currentAngles.leftElbow / Math.PI) * 180);

  return {
    elbowAngleDeg: elbowDeg,
    muscleActivation: Math.round(currentAngles.bicepActivation * 100),
    activeStep: activeStepTitle,
    formCue: activeCue,
    primaryMuscle,
    secondaryMuscle,
  };
}

// Easing utilities
function easeOutQuad(x) {
  return 1 - (1 - x) * (1 - x);
}

function easeInOutCubic(x) {
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}
