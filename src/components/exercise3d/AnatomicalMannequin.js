import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

/**
 * Creates an authentic commercial rubber hex dumbbell with steel knurled grip.
 */
export function createRealisticHexDumbbell(steelBarMat, hexPlateMat) {
  const group = new THREE.Group();
  group.name = 'hex_dumbbell';

  // Knurled steel center handle
  const barGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.22, 16);
  const bar = new THREE.Mesh(barGeo, steelBarMat);
  group.add(bar);

  // Hexagonal rubber weight heads on each side (6-sided cylinder)
  [-0.10, 0.10].forEach((pos) => {
    const headGeo = new THREE.CylinderGeometry(0.068, 0.068, 0.045, 6);
    const head = new THREE.Mesh(headGeo, hexPlateMat);
    head.position.y = pos;
    group.add(head);

    // Inner bevel collar
    const collarGeo = new THREE.CylinderGeometry(0.028, 0.028, 0.012, 12);
    const collar = new THREE.Mesh(collarGeo, steelBarMat);
    collar.position.y = pos > 0 ? pos - 0.025 : pos + 0.025;
    group.add(collar);
  });

  return group;
}

/**
 * Creates a clean commercial gym rubber mat platform.
 */
export function createGymFloorMat() {
  const floorGroup = new THREE.Group();
  floorGroup.name = 'gym_floor';
  floorGroup.position.y = 0;

  const matGeo = new THREE.CylinderGeometry(1.05, 1.1, 0.028, 36);
  const matMaterial = new THREE.MeshStandardMaterial({
    color: 0x0c101c,
    roughness: 0.85,
    metalness: 0.1,
  });
  const matMesh = new THREE.Mesh(matGeo, matMaterial);
  matMesh.position.y = -0.014;
  matMesh.receiveShadow = true;
  floorGroup.add(matMesh);

  // Clean subtle perimeter border
  const matRingGeo = new THREE.RingGeometry(0.85, 0.87, 48);
  matRingGeo.rotateX(-Math.PI / 2);
  const matRingMat = new THREE.MeshBasicMaterial({
    color: 0x334155,
    transparent: true,
    opacity: 0.45,
    side: THREE.DoubleSide,
  });
  const matRing = new THREE.Mesh(matRingGeo, matRingMat);
  matRing.position.y = 0.002;
  floorGroup.add(matRing);

  return floorGroup;
}

/**
 * Loads a real high-fidelity rigged human athlete (skinned mesh with bone armature).
 * Deforms organically through forward kinematics and holds hex dumbbells.
 */
export async function loadRiggedHumanAthlete(modelUrl = '/models/human_athlete.glb') {
  const loader = new GLTFLoader();

  return new Promise((resolve, reject) => {
    loader.load(
      modelUrl,
      (gltf) => {
        const root = gltf.scene;
        root.name = 'real_human_athlete';

        // Traverse meshes to enable high-quality shadows and skinning
        const bones = {};
        root.traverse((obj) => {
          if (obj.isMesh) {
            obj.castShadow = true;
            obj.receiveShadow = true;
            if (obj.material) {
              obj.material.roughness = Math.max(obj.material.roughness, 0.45);
              obj.material.metalness = Math.min(obj.material.metalness || 0, 0.2);
            }
          }
          if (obj.isBone) {
            bones[obj.name] = obj;
          }
        });

        // Store initial rest rotations for reference
        const initialRotations = {};
        for (const [name, bone] of Object.entries(bones)) {
          initialRotations[name] = bone.rotation.clone();
        }

        // Attach realistic rubber hex dumbbells to the hands
        const hexPlateMat = new THREE.MeshStandardMaterial({
          color: 0x20242e,
          roughness: 0.7,
          metalness: 0.2,
        });
        const steelBarMat = new THREE.MeshStandardMaterial({
          color: 0xb8c2cc,
          roughness: 0.35,
          metalness: 0.85,
        });

        const dumbbells = [];

        if (bones.RightHand) {
          const rDumbbell = createRealisticHexDumbbell(steelBarMat, hexPlateMat);
          rDumbbell.position.set(0, 0.05, 0.015);
          rDumbbell.rotation.set(0, 0, Math.PI / 2);
          bones.RightHand.add(rDumbbell);
          dumbbells.push(rDumbbell);
        }

        if (bones.LeftHand) {
          const lDumbbell = createRealisticHexDumbbell(steelBarMat, hexPlateMat);
          lDumbbell.position.set(0, 0.05, 0.015);
          lDumbbell.rotation.set(0, 0, Math.PI / 2);
          bones.LeftHand.add(lDumbbell);
          dumbbells.push(lDumbbell);
        }

        // Floor Mat
        const floor = createGymFloorMat();
        root.add(floor);

        resolve({
          isRiggedModel: true,
          root,
          bones,
          initialRotations,
          dumbbells,
          meshes: { dumbbells },
          materials: {},
        });
      },
      undefined,
      (err) => reject(err)
    );
  });
}

/**
 * Creates a procedural 3D human athletic mannequin as instantaneous fallback.
 */
export function createAnatomicalMannequin() {
  const root = new THREE.Group();
  root.name = 'athlete_root';

  // --- Materials ---
  const humanSkinMat = new THREE.MeshStandardMaterial({
    color: 0xdca882,
    roughness: 0.68,
    metalness: 0.02,
    flatShading: false,
  });

  const humanMuscleMat = new THREE.MeshStandardMaterial({
    color: 0xd49b74,
    roughness: 0.65,
    metalness: 0.02,
  });

  const bicepMat = new THREE.MeshStandardMaterial({
    color: 0xdca882,
    emissive: 0xb91c1c,
    emissiveIntensity: 0.0,
    roughness: 0.64,
    metalness: 0.02,
  });

  const hairMat = new THREE.MeshStandardMaterial({
    color: 0x221a15,
    roughness: 0.92,
    metalness: 0.05,
  });

  const shortsMat = new THREE.MeshStandardMaterial({
    color: 0x1e2433,
    roughness: 0.88,
    metalness: 0.05,
  });

  const waistbandMat = new THREE.MeshStandardMaterial({
    color: 0x111624,
    roughness: 0.9,
    metalness: 0.02,
  });

  const sneakerUpperMat = new THREE.MeshStandardMaterial({
    color: 0x252d3d,
    roughness: 0.8,
    metalness: 0.1,
  });

  const sneakerSoleMat = new THREE.MeshStandardMaterial({
    color: 0xf3f6f9,
    roughness: 0.5,
    metalness: 0.05,
  });

  const sneakerAccentMat = new THREE.MeshStandardMaterial({
    color: 0x0fb9a6,
    roughness: 0.4,
    metalness: 0.2,
  });

  const hexPlateMat = new THREE.MeshStandardMaterial({
    color: 0x20242e,
    roughness: 0.65,
    metalness: 0.2,
  });

  const steelBarMat = new THREE.MeshStandardMaterial({
    color: 0xb8c2cc,
    roughness: 0.35,
    metalness: 0.85,
  });

  const rig = {
    isRiggedModel: false,
    root,
    materials: {
      bicepMat,
      secondaryMuscleMat: humanMuscleMat,
      skinMat: humanSkinMat,
      muscleMat: humanMuscleMat,
    },
    meshes: {
      leftBicep: null,
      rightBicep: null,
      leftForearm: null,
      rightForearm: null,
      dumbbells: [],
      backpack: null,
    },
    bones: {
      pelvis: null,
      spine: null,
      chest: null,
      neck: null,
      head: null,
      leftShoulder: null,
      leftUpperArm: null,
      leftElbow: null,
      leftForearm: null,
      leftWrist: null,
      rightShoulder: null,
      rightUpperArm: null,
      rightElbow: null,
      rightForearm: null,
      rightWrist: null,
      leftHip: null,
      leftKnee: null,
      leftAnkle: null,
      rightHip: null,
      rightKnee: null,
      rightAnkle: null,
    },
  };

  // Pelvis / Hips
  const pelvis = new THREE.Group();
  pelvis.position.y = 0.92;
  root.add(pelvis);
  rig.bones.pelvis = pelvis;

  const pelvisGeo = new THREE.CylinderGeometry(0.16, 0.145, 0.16, 20);
  const pelvisMesh = new THREE.Mesh(pelvisGeo, shortsMat);
  pelvisMesh.castShadow = true;
  pelvis.add(pelvisMesh);

  const waistbandGeo = new THREE.CylinderGeometry(0.163, 0.16, 0.035, 20);
  const waistbandMesh = new THREE.Mesh(waistbandGeo, waistbandMat);
  waistbandMesh.position.y = 0.07;
  pelvis.add(waistbandMesh);

  // Spine & Torso
  const spine = new THREE.Group();
  spine.position.y = 0.08;
  pelvis.add(spine);
  rig.bones.spine = spine;

  const absGroup = new THREE.Group();
  absGroup.position.set(0, 0.10, 0);
  spine.add(absGroup);

  const waistGeo = new THREE.CylinderGeometry(0.165, 0.145, 0.18, 20);
  const waistMesh = new THREE.Mesh(waistGeo, humanSkinMat);
  absGroup.add(waistMesh);

  for (let row = 0; row < 3; row++) {
    for (let col = -1; col <= 1; col += 2) {
      const abGeo = new THREE.BoxGeometry(0.052, 0.042, 0.02);
      const abMesh = new THREE.Mesh(abGeo, humanMuscleMat);
      abMesh.position.set(col * 0.036, 0.06 - row * 0.05, 0.145);
      absGroup.add(abMesh);
    }
  }

  const chest = new THREE.Group();
  chest.position.y = 0.22;
  spine.add(chest);
  rig.bones.chest = chest;

  const ribcageGeo = new THREE.CylinderGeometry(0.205, 0.168, 0.24, 20);
  const ribcageMesh = new THREE.Mesh(ribcageGeo, humanSkinMat);
  chest.add(ribcageMesh);

  [-1, 1].forEach((side) => {
    const pecGeo = new THREE.BoxGeometry(0.12, 0.105, 0.045);
    const pecMesh = new THREE.Mesh(pecGeo, humanMuscleMat);
    pecMesh.position.set(side * 0.076, 0.045, 0.178);
    pecMesh.rotation.y = side * 0.10;
    pecMesh.rotation.z = side * -0.04;
    chest.add(pecMesh);
  });

  const neck = new THREE.Group();
  neck.position.y = 0.16;
  chest.add(neck);
  rig.bones.neck = neck;

  const neckGeo = new THREE.CylinderGeometry(0.062, 0.074, 0.11, 20);
  neck.add(new THREE.Mesh(neckGeo, humanSkinMat));

  const head = new THREE.Group();
  head.position.y = 0.12;
  neck.add(head);
  rig.bones.head = head;

  const headGeo = new THREE.SphereGeometry(0.105, 24, 24);
  headGeo.scale(0.92, 1.15, 1.02);
  const headMesh = new THREE.Mesh(headGeo, humanSkinMat);
  head.add(headMesh);

  const jawGeo = new THREE.BoxGeometry(0.082, 0.052, 0.072);
  const jawMesh = new THREE.Mesh(jawGeo, humanSkinMat);
  jawMesh.position.set(0, -0.048, 0.038);
  head.add(jawMesh);

  const noseGeo = new THREE.ConeGeometry(0.018, 0.042, 5);
  const noseMesh = new THREE.Mesh(noseGeo, humanSkinMat);
  noseMesh.rotation.x = Math.PI / 2 + 0.15;
  noseMesh.position.set(0, 0.008, 0.112);
  head.add(noseMesh);

  [-1, 1].forEach((side) => {
    const earGeo = new THREE.SphereGeometry(0.024, 10, 10);
    earGeo.scale(0.4, 1.1, 0.7);
    const earMesh = new THREE.Mesh(earGeo, humanSkinMat);
    earMesh.position.set(side * 0.098, 0.005, -0.01);
    head.add(earMesh);
  });

  // Expressive human eyes & eyebrows clearly facing the front (+Z)
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0x18181b, roughness: 0.2 });
  [-1, 1].forEach((side) => {
    // Eye
    const eyeGeo = new THREE.SphereGeometry(0.012, 10, 10);
    const eyeMesh = new THREE.Mesh(eyeGeo, eyeMat);
    eyeMesh.position.set(side * 0.036, 0.018, 0.103);
    head.add(eyeMesh);

    // Eyebrow
    const browGeo = new THREE.BoxGeometry(0.026, 0.006, 0.012);
    const browMesh = new THREE.Mesh(browGeo, hairMat);
    browMesh.position.set(side * 0.038, 0.035, 0.105);
    browMesh.rotation.z = side * -0.1;
    head.add(browMesh);
  });

  // Human mouth / lips facing the front (+Z)
  const lipMat = new THREE.MeshStandardMaterial({ color: 0xba765c, roughness: 0.6 });
  const lipGeo = new THREE.BoxGeometry(0.034, 0.009, 0.014);
  const lipMesh = new THREE.Mesh(lipGeo, lipMat);
  lipMesh.position.set(0, -0.024, 0.103);
  head.add(lipMesh);

  // Hair cap (positioned strictly on the crown, back, and sides of the head - never obscuring face)
  const hairCapGeo = new THREE.SphereGeometry(0.102, 20, 20, 0, Math.PI * 2, 0, Math.PI * 0.52);
  hairCapGeo.scale(0.96, 1.05, 1.0);
  const hairCap = new THREE.Mesh(hairCapGeo, hairMat);
  hairCap.position.set(0, 0.036, -0.02);
  head.add(hairCap);

  // Back of head hair coverage
  const backHairGeo = new THREE.SphereGeometry(0.096, 16, 16);
  backHairGeo.scale(0.92, 1.0, 0.85);
  const backHair = new THREE.Mesh(backHairGeo, hairMat);
  backHair.position.set(0, 0.01, -0.045);
  head.add(backHair);

  function buildArm(isLeft) {
    const side = isLeft ? -1 : 1;
    const prefix = isLeft ? 'left' : 'right';

    const shoulder = new THREE.Group();
    shoulder.position.set(side * 0.23, 0.09, 0);
    chest.add(shoulder);
    rig.bones[`${prefix}Shoulder`] = shoulder;

    const deltoidGeo = new THREE.SphereGeometry(0.082, 20, 20);
    deltoidGeo.scale(1.0, 1.25, 1.1);
    const deltoidMesh = new THREE.Mesh(deltoidGeo, humanSkinMat);
    deltoidMesh.position.set(side * 0.02, 0, 0);
    shoulder.add(deltoidMesh);

    const upperArm = new THREE.Group();
    shoulder.add(upperArm);
    rig.bones[`${prefix}UpperArm`] = upperArm;

    const armBoneGeo = new THREE.CylinderGeometry(0.052, 0.046, 0.26, 20);
    const armBoneMesh = new THREE.Mesh(armBoneGeo, humanSkinMat);
    armBoneMesh.position.y = -0.13;
    upperArm.add(armBoneMesh);

    const tricepGeo = new THREE.SphereGeometry(0.054, 16, 16);
    tricepGeo.scale(0.85, 1.4, 0.85);
    const tricepMesh = new THREE.Mesh(tricepGeo, humanMuscleMat);
    tricepMesh.position.set(0, -0.11, -0.028);
    upperArm.add(tricepMesh);

    const bicepGeo = new THREE.SphereGeometry(0.056, 20, 20);
    bicepGeo.scale(0.92, 1.35, 1.08);
    const bicepMesh = new THREE.Mesh(bicepGeo, bicepMat);
    bicepMesh.position.set(0, -0.11, 0.036);
    upperArm.add(bicepMesh);
    rig.meshes[`${prefix}Bicep`] = bicepMesh;

    const elbow = new THREE.Group();
    elbow.position.y = -0.26;
    upperArm.add(elbow);
    rig.bones[`${prefix}Elbow`] = elbow;

    const elbowSkinGeo = new THREE.SphereGeometry(0.045, 16, 16);
    elbow.add(new THREE.Mesh(elbowSkinGeo, humanSkinMat));

    const forearm = new THREE.Group();
    elbow.add(forearm);
    rig.bones[`${prefix}Forearm`] = forearm;

    const forearmGeo = new THREE.CylinderGeometry(0.046, 0.034, 0.25, 20);
    const forearmMesh = new THREE.Mesh(forearmGeo, humanSkinMat);
    forearmMesh.position.y = -0.125;
    forearm.add(forearmMesh);

    const forearmMuscleGeo = new THREE.SphereGeometry(0.044, 16, 16);
    forearmMuscleGeo.scale(0.88, 1.3, 0.88);
    const forearmMuscleMesh = new THREE.Mesh(forearmMuscleGeo, humanMuscleMat);
    forearmMuscleMesh.position.set(0, -0.08, 0.02);
    forearm.add(forearmMuscleMesh);
    rig.meshes[`${prefix}Forearm`] = forearmMuscleMesh;

    const wrist = new THREE.Group();
    wrist.position.y = -0.25;
    forearm.add(wrist);
    rig.bones[`${prefix}Wrist`] = wrist;

    const palmGeo = new THREE.BoxGeometry(0.046, 0.065, 0.036);
    const palmMesh = new THREE.Mesh(palmGeo, humanSkinMat);
    palmMesh.position.y = -0.032;
    wrist.add(palmMesh);

    const thumbGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.038, 8);
    const thumbMesh = new THREE.Mesh(thumbGeo, humanSkinMat);
    thumbMesh.position.set(side * 0.026, -0.022, 0.016);
    thumbMesh.rotation.z = side * -0.5;
    wrist.add(thumbMesh);

    const dumbbell = createRealisticHexDumbbell(steelBarMat, hexPlateMat);
    dumbbell.position.set(0, -0.036, 0.008);
    dumbbell.rotation.z = Math.PI / 2;
    wrist.add(dumbbell);
    rig.meshes.dumbbells.push(dumbbell);
  }

  buildArm(true);
  buildArm(false);

  function buildLeg(isLeft) {
    const side = isLeft ? -1 : 1;
    const prefix = isLeft ? 'left' : 'right';

    const hip = new THREE.Group();
    hip.position.set(side * 0.105, -0.04, 0);
    pelvis.add(hip);
    rig.bones[`${prefix}Hip`] = hip;

    const shortsLegGeo = new THREE.CylinderGeometry(0.092, 0.086, 0.16, 20);
    const shortsLegMesh = new THREE.Mesh(shortsLegGeo, shortsMat);
    shortsLegMesh.position.y = -0.08;
    hip.add(shortsLegMesh);

    const thighGeo = new THREE.CylinderGeometry(0.082, 0.062, 0.28, 20);
    const thighMesh = new THREE.Mesh(thighGeo, humanSkinMat);
    thighMesh.position.y = -0.28;
    hip.add(thighMesh);

    const quadGeo = new THREE.SphereGeometry(0.076, 16, 16);
    quadGeo.scale(0.88, 1.45, 0.95);
    const quadMesh = new THREE.Mesh(quadGeo, humanMuscleMat);
    quadMesh.position.set(0, -0.24, 0.028);
    hip.add(quadMesh);

    const knee = new THREE.Group();
    knee.position.y = -0.42;
    hip.add(knee);
    rig.bones[`${prefix}Knee`] = knee;

    const kneecapGeo = new THREE.SphereGeometry(0.054, 18, 18);
    kneecapGeo.scale(0.9, 1.1, 0.95);
    knee.add(new THREE.Mesh(kneecapGeo, humanSkinMat));

    const shinGeo = new THREE.CylinderGeometry(0.056, 0.042, 0.40, 20);
    const shinMesh = new THREE.Mesh(shinGeo, humanSkinMat);
    shinMesh.position.y = -0.20;
    knee.add(shinMesh);

    const calfGeo = new THREE.SphereGeometry(0.056, 16, 16);
    calfGeo.scale(0.88, 1.35, 0.88);
    const calfMesh = new THREE.Mesh(calfGeo, humanMuscleMat);
    calfMesh.position.set(0, -0.14, -0.028);
    knee.add(calfMesh);

    const ankle = new THREE.Group();
    ankle.position.y = -0.40;
    knee.add(ankle);
    rig.bones[`${prefix}Ankle`] = ankle;

    const shoeGroup = new THREE.Group();
    ankle.add(shoeGroup);

    const soleGeo = new THREE.BoxGeometry(0.082, 0.022, 0.19);
    const soleMesh = new THREE.Mesh(soleGeo, sneakerSoleMat);
    soleMesh.position.set(0, -0.042, 0.045);
    shoeGroup.add(soleMesh);

    const upperGeo = new THREE.BoxGeometry(0.078, 0.046, 0.17);
    const upperMesh = new THREE.Mesh(upperGeo, sneakerUpperMat);
    upperMesh.position.set(0, -0.015, 0.04);
    shoeGroup.add(upperMesh);

    const accentGeo = new THREE.BoxGeometry(0.08, 0.016, 0.04);
    const accentMesh = new THREE.Mesh(accentGeo, sneakerAccentMat);
    accentMesh.position.set(0, 0.01, -0.035);
    shoeGroup.add(accentMesh);
  }

  buildLeg(true);
  buildLeg(false);

  const floorGroup = createGymFloorMat();
  root.add(floorGroup);

  return rig;
}
