import RAPIER from "https://cdn.jsdelivr.net/npm/@dimforge/rapier3d-compat@0.12.0/rapier.es.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

const PHYSICS_INIT_TIMEOUT_MS = 2200;
const PHYSICS_FIXED_TIMESTEP = 1 / 60;
const MAX_PHYSICS_STEPS_PER_FRAME = 4;
let physicsWorld = null;
let physicsReady = false;
let vehicleController = null;
let carBody = null;
let previousCarPos = new THREE.Vector3();
let previousCarQuat = new THREE.Quaternion();
let visualWheels = [];
let terrainCollider = null;
let physicsAccumulator = 0;

const canvas = document.querySelector("#scene");
const wallpaperEntry = document.querySelector("#wallpaper-entry");
const bgm = document.querySelector("#bgm");
const volumeBtn = document.querySelector("#volume-btn");
const volumePopup = document.querySelector("#volume-popup");
const volumeSlider = document.querySelector("#volume-slider");
const volumeIcon = document.querySelector("#volume-icon");
const settingsBtn = document.querySelector("#settings-btn");
const tuningPanel = document.querySelector("#tuning-panel");
const fpsMeter = document.querySelector("#fps-meter");
const fpsValue = document.querySelector("#fps-value");
const fpsBar = document.querySelector("#fps-bar");
const qualityControl = document.querySelector("#quality-control");
const qualitySlider = document.querySelector("#quality-slider-input");
const qualitySliderWrap = document.querySelector("#quality-slider-wrap");
const qualityOutput = document.querySelector("#quality-output");
const qualitySteps = document.querySelector("#quality-steps");
const tuningToggle = document.querySelector("#tuning-toggle");
const exportStatus = document.querySelector("#export-status");
const settingsOutput = document.querySelector("#settings-output");
const tuningControls = {
  grassHeight: document.querySelector("#grass-height-control"),
  grassBaseColor: document.querySelector("#grass-base-control"),
  grassTipColorA: document.querySelector("#grass-tip-a-control"),
  grassTipColorB: document.querySelector("#grass-tip-b-control"),
  terrainColor: document.querySelector("#terrain-color-control"),
  skyColor: document.querySelector("#sky-color-control"),
  fogColor: document.querySelector("#fog-color-control"),
  fogDensity: document.querySelector("#fog-density-control"),
  windStrength: document.querySelector("#wind-strength-control"),
  showFps: document.querySelector("#show-fps-control"),
  cloudTextPosX: document.querySelector("#cloud-text-x-control"),
  cloudTextPosY: document.querySelector("#cloud-text-y-control"),
  cloudTextPosZ: document.querySelector("#cloud-text-z-control"),
  cloudTextRotX: document.querySelector("#cloud-text-rx-control"),
  cloudTextRotY: document.querySelector("#cloud-text-ry-control"),
  cloudTextRotZ: document.querySelector("#cloud-text-rz-control"),
  exportSettings: document.querySelector("#export-settings"),
  saveSpawn: document.querySelector("#save-spawn")
};
const spawnOutput = document.querySelector("#spawn-output");

const sceneSettings = {
  grassHeight: 1.01,
  grassBaseColor: "#33421f",
  grassTipColorA: "#bfff00",
  grassTipColorB: "#2c3918",
  terrainColor: "#0b1202",
  skyColor: "#5fa6ff",
  fogColor: "#e0efff",
  fogDensity: 0.0072,
  windStrength: 1,
  qualityLevel: 3,
  cloudTextPosX: 154,
  cloudTextPosY: 117,
  cloudTextPosZ: -217,
  cloudTextRotX: -14,
  cloudTextRotY: -39,
  cloudTextRotZ: 0
};

const QUALITY_PRESETS = [
  null,
  { name: "Low", renderScale: 0.62, minScale: 0.56, maxScale: 0.68, grassDistance: 0.58, highDensityDistance: 0.52, cloudSteps: 16 },
  { name: "Balanced", renderScale: 0.74, minScale: 0.62, maxScale: 0.8, grassDistance: 0.76, highDensityDistance: 0.72, cloudSteps: 32 },
  { name: "Medium", renderScale: 0.85, minScale: 0.68, maxScale: 0.92, grassDistance: 1, highDensityDistance: 1, cloudSteps: 48 },
  { name: "High", renderScale: 0.95, minScale: 0.76, maxScale: 1, grassDistance: 1, highDensityDistance: 1.15, cloudSteps: 64 },
  { name: "Ultra", renderScale: 1, minScale: 0.86, maxScale: 1, grassDistance: 1, highDensityDistance: 1.3, cloudSteps: 80 }
];

const scene = new THREE.Scene();
scene.background = new THREE.Color(sceneSettings.skyColor);
scene.fog = new THREE.FogExp2(sceneSettings.fogColor, sceneSettings.fogDensity);

const DEFAULT_CAMERA_FOV = 72 * 0.65;
const camera = new THREE.PerspectiveCamera(DEFAULT_CAMERA_FOV, window.innerWidth / window.innerHeight, 0.1, 700);
camera.rotation.order = "YXZ";

// Recent world-space car footprints are passed straight to the grass shader.
const TRAIL_STAMP_DISTANCE = 0.65;
// Keeping the most recent stamps makes the interaction feel immediate without
// paying for a 72-iteration loop in every grass vertex.
const MAX_SHADER_TRAIL_STAMPS = 12;
let lastTrailPoint = new THREE.Vector3(0, -9999, 0);
const trailStamps = [];
const trailStampPositionRightUniforms = Array.from({ length: MAX_SHADER_TRAIL_STAMPS }, () => new THREE.Vector4(0, 0, 1, 0));
const trailStampForwardFadeUniforms = Array.from({ length: MAX_SHADER_TRAIL_STAMPS }, () => new THREE.Vector4(0, 1, 0, 0));
const carRight2D = new THREE.Vector2(1, 0);
const carForward2D = new THREE.Vector2(0, 1);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  powerPreference: "high-performance",
  precision: "highp"
});
setRendererColorSpace(renderer);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.04;
const renderQuality = {
  scale: 0.85,
  minScale: 0.68,
  maxScale: 0.92,
  sampleTime: 0,
  sampleFrames: 0
};
renderer.setPixelRatio(renderQuality.scale);
renderer.setSize(window.innerWidth, window.innerHeight, false);

const textureLoader = new THREE.TextureLoader();
const grassAlphaTexture = textureLoader.load("assets/fluffy-grass-alpha.jpeg");
const grassNoiseTexture = textureLoader.load("assets/perlinnoise.webp");
grassAlphaTexture.minFilter = THREE.LinearFilter;
grassAlphaTexture.magFilter = THREE.LinearFilter;
grassNoiseTexture.wrapS = THREE.RepeatWrapping;
grassNoiseTexture.wrapT = THREE.RepeatWrapping;
grassNoiseTexture.minFilter = THREE.LinearFilter;
grassNoiseTexture.magFilter = THREE.LinearFilter;

let seed = 1842;
function random() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}

// Procedural Noise for Terrain
function terrainHeight(x, z) {
  // Use sine waves for the broad rolling hills, they are infinite and fast!
  const broadHill = 12 * Math.sin(x * 0.005) * Math.cos(z * 0.005);
  const leftRise = 8 * Math.sin((x - z) * 0.008);
  const gentleRoll = 2 * Math.sin(x * 0.03 + z * 0.02);

  return broadHill + leftRise + gentleRoll - 5.0;
}

const player = {
  position: new THREE.Vector3(-55.17, -14.6419, 18.7405),
  velocity: new THREE.Vector3(0, 0, 0),
  pitch: -0.15,
  // Yaw extracted from spawn quaternion (Y component via atan2)
  yaw: 2 * Math.atan2(-0.098041, 0.992882),
  camYawOffset: -0.5061,
  camPitchOffset: 0.231,
  isOnGround: false,
};

let grassTrail = [];
let grassTrailCount = 0;

let carGroup = null;
let carVisualRoot = null;
let loadedCarQualityLevel = 0;
let pendingCarQualityLevel = 0;
let carModelRequestId = 0;
let carSpeed = 0;
const carMaxSpeed = 65;
const carAcceleration = 35;
let brakeLightMaterials = [];
const carBrake = 40;
const carFriction = 0.98;
let carSteering = 0;
const carMaxSteering = 0.035;
let physicsThrottle = 0;

camera.position.copy(player.position);
camera.rotation.set(player.pitch, player.yaw, 0);

const keys = new Set();
const clock = new THREE.Clock();
const forward = new THREE.Vector3();
const right = new THREE.Vector3();
const move = new THREE.Vector3();
const cameraFollow = {
  vehicleYaw: 0,
  initialized: false,
  target: new THREE.Vector3()
};
const initialCameraDistance = window.matchMedia("(pointer: coarse)").matches ? 25.0 : 15.897;
const cameraZoom = {
  distance: initialCameraDistance,
  targetDistance: initialCameraDistance,
  fov: 54.593,
  targetFov: 54.593
};
const cameraDesiredPosition = new THREE.Vector3();
const cameraDesiredTarget = new THREE.Vector3();
const cameraPlanarForward = new THREE.Vector3();
const clouds = [];
const cloudMaterials = [];
const grassMaterials = [];
const followGrassLayers = [];
const grassDrawLayers = [];
let distantGrass = null;
let distantGrassMaterial = null;
let lastDistantGrassSnapX = -99999;
let lastDistantGrassSnapZ = -99999;
let grassGLBGeometry = null;
let grassQualityDistance = 1;
let highDensityGrassDistance = 1;
const grassVisibilityFrustum = new THREE.Frustum();
const grassProjectionMatrix = new THREE.Matrix4();
const grassLayerCenter = new THREE.Vector3();
const grassLayerSphere = new THREE.Sphere();
const grassStats = {
  activeInstances: 0,
  maxInstances: 0,
  proceduralBlades: 0,
  proceduralVertices: 0,
  visibleTiles: 0,
  totalTiles: 0,
  activeTilesByLod: {},
  visibleTilesByLod: {},
  activeInstancesByLod: {}
};
window.blissGrassStats = grassStats;
let terrainMaterial = null;
let terrain = null;
let terrainGeometry = null;
let lastTerrainSnapX = -99999;
let lastTerrainSnapZ = -99999;
const touch = {
  moveId: null,
  lookId: null,
  moveStart: new THREE.Vector2(),
  lookLast: new THREE.Vector2(),
  moveVector: new THREE.Vector2()
};
const fpsStats = {
  frames: 0,
  elapsed: 0,
  displayFps: 0
};

startScene();

async function initializePhysics() {
  try {
    await Promise.race([
      RAPIER.init(),
      new Promise((_, reject) => {
        window.setTimeout(() => reject(new Error("Physics initialization timed out")), PHYSICS_INIT_TIMEOUT_MS);
      })
    ]);
    physicsWorld = new RAPIER.World({ x: 0.0, y: -9.81, z: 0.0 });
    physicsWorld.timestep = PHYSICS_FIXED_TIMESTEP;
    physicsReady = true;
  } catch {
    physicsWorld = null;
    physicsReady = false;
  }
}

async function startScene() {
  await initializePhysics();

  createLights();
  createTerrain();
  createClouds();
  loadCarModel();
  loadGrassGLBAndCreateBlades();

  window.addEventListener("resize", resizeScene);
  window.addEventListener("keydown", handleKeyDown);
  window.addEventListener("keyup", handleKeyUp);
  document.addEventListener("pointerlockchange", syncPointerLockClass);
  document.addEventListener("mousemove", handleMouseLook);

  canvas.addEventListener("click", lockPointer);
  canvas.addEventListener("wheel", handleCameraZoom, { passive: false });
  canvas.addEventListener("touchstart", handleTouchStart, { passive: false });
  canvas.addEventListener("touchmove", handleTouchMove, { passive: false });
  canvas.addEventListener("touchend", handleTouchEnd, { passive: false });
  canvas.addEventListener("touchcancel", handleTouchEnd, { passive: false });

  wallpaperEntry.addEventListener("click", lockPointer);
  canvas.addEventListener("click", togglePointerLock);
  initializeTuningPanel();
  initializeQualityControl();
  initializeVolumeControl();
  initializeSettingsBtn();

  animate();
}

function initializeSettingsBtn() {
  if (!settingsBtn || !qualityControl) {
    return;
  }

  settingsBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = qualityControl.classList.toggle("is-visible");
    settingsBtn.setAttribute("aria-expanded", String(isOpen));
  });

  // Close when clicking outside both the button and the quality control
  document.addEventListener("click", (e) => {
    if (!settingsBtn.contains(e.target) && !qualityControl.contains(e.target)) {
      qualityControl.classList.remove("is-visible");
      settingsBtn.setAttribute("aria-expanded", "false");
    }
  });

  qualityControl.addEventListener("click", (e) => e.stopPropagation());
}

function initializeVolumeControl() {

  if (!volumeBtn || !volumePopup || !volumeSlider) {
    return;
  }

  // Toggle popup open/closed on button click
  volumeBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = volumePopup.classList.toggle("is-open");
    volumeBtn.setAttribute("aria-expanded", String(isOpen));
  });

  // Close when clicking outside
  document.addEventListener("click", (e) => {
    if (!volumeBtn.contains(e.target) && !volumePopup.contains(e.target)) {
      volumePopup.classList.remove("is-open");
      volumeBtn.setAttribute("aria-expanded", "false");
    }
  });

  // Stop pointer events from leaking to the scene
  volumePopup.addEventListener("click", (e) => e.stopPropagation());

  // Sync slider → BGM volume + update icon
  volumeSlider.addEventListener("input", () => {
    const v = Math.min(1, Math.max(0, parseFloat(volumeSlider.value)));
    if (bgm) {
      bgm.volume = v;
    }
    updateVolumeIcon(v);
  });

  updateVolumeIcon(parseFloat(volumeSlider.value));
}

// SVG paths for muted / low / high volume states
const VOLUME_ICON_PATHS = {
  mute: "M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z",
  low:  "M18.5 12c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM5 9v6h4l5 5V4L9 9H5z",
  high: "M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
};

function updateVolumeIcon(v) {
  if (!volumeIcon) return;
  const key = v === 0 ? "mute" : v < 0.5 ? "low" : "high";
  volumeIcon.querySelector("path").setAttribute("d", VOLUME_ICON_PATHS[key]);
}

// ============================================================================
// START 3D CAR + RAPIER VEHICLE LOGIC
// ============================================================================
const CAR_MODEL_PATH = "car/toyota_levin_ae85_grandfather/scene.gltf";
const CAR_MODEL_PATHS = [
  null,
  "car/toyota_levin_ae85_grandfather/lods/levin_lod_1.glb",
  "car/toyota_levin_ae85_grandfather/lods/levin_lod_2.glb",
  "car/toyota_levin_ae85_grandfather/lods/levin_lod_3.glb",
  "car/toyota_levin_ae85_grandfather/lods/levin_lod_4.glb",
  CAR_MODEL_PATH
];
const CAR_RAW_CENTER_X = 60.83647346496582;
const CAR_RAW_CENTER_Z = 211.54385185241702;
const CAR_RAW_MIN_Y = -0.46939998865137395;
const CAR_SCALE = 9.2 / 462.1883583068848;
const CAR_RAW_LEFT_X = 136.65182495117188;
const CAR_RAW_RIGHT_X = -13.471727460622787;
const CAR_RAW_FRONT_Z = 349.9110870361328;
const CAR_RAW_REAR_Z = 86.52527523040771;
const CAR_RAW_WHEEL_Y = 31.578731536865234;
const CAR_RAW_WHEEL_RADIUS = 32.0511;
// The model is authored +Z-forward and is rotated 180 degrees into -Z-forward.
const TRUCK_FRONT_Z = -(CAR_RAW_FRONT_Z - CAR_RAW_CENTER_Z) * CAR_SCALE;
const TRUCK_REAR_Z = -(CAR_RAW_REAR_Z - CAR_RAW_CENTER_Z) * CAR_SCALE;
const TRUCK_HALF_TRACK = ((CAR_RAW_LEFT_X - CAR_RAW_RIGHT_X) * 0.5) * CAR_SCALE;
const TRUCK_WHEEL_CENTER_Y = (CAR_RAW_WHEEL_Y - CAR_RAW_MIN_Y) * CAR_SCALE;
const TRUCK_WHEEL_Y = TRUCK_WHEEL_CENTER_Y + 0.35;
const TRUCK_WHEEL_RADIUS = CAR_RAW_WHEEL_RADIUS * CAR_SCALE;
const TRUCK_FRONT_WHEEL_INDICES = new Set([0, 1]);
const TRUCK_FRONT_MIN_VISUAL_SUSPENSION = 0.08;
const TRUCK_REAR_MIN_VISUAL_SUSPENSION = 0.08;
const TRUCK_WHEEL_POSITIONS = [
  new THREE.Vector3(TRUCK_HALF_TRACK, TRUCK_WHEEL_Y, TRUCK_FRONT_Z),
  new THREE.Vector3(-TRUCK_HALF_TRACK, TRUCK_WHEEL_Y, TRUCK_FRONT_Z),
  new THREE.Vector3(TRUCK_HALF_TRACK, TRUCK_WHEEL_Y, TRUCK_REAR_Z),
  new THREE.Vector3(-TRUCK_HALF_TRACK, TRUCK_WHEEL_Y, TRUCK_REAR_Z)
];

function loadCarModel() {
  carGroup = new THREE.Group();
  carGroup.position.copy(player.position);
  carGroup.position.y += 1;
  scene.add(carGroup);

  requestCarQualityLevel(sceneSettings.qualityLevel);
}

function disposeCarModel(root) {
  const disposedMaterials = new Set();
  root?.traverse((child) => {
    if (!child.isMesh) return;
    child.geometry?.dispose();
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    materials.forEach((material) => {
      if (material && !disposedMaterials.has(material)) {
        disposedMaterials.add(material);
        material.dispose();
      }
    });
  });
}

function requestCarQualityLevel(level) {
  const safeLevel = THREE.MathUtils.clamp(Math.round(level), 1, 5);
  if (safeLevel === loadedCarQualityLevel && carVisualRoot) return;
  if (safeLevel === pendingCarQualityLevel) return;
  const requestId = ++carModelRequestId;
  pendingCarQualityLevel = safeLevel;

  const loader = new GLTFLoader();
  loader.load(
    CAR_MODEL_PATHS[safeLevel],
    (gltf) => {
      if (requestId !== carModelRequestId) {
        disposeCarModel(gltf.scene);
        return;
      }
      pendingCarQualityLevel = 0;
      attachCarModel(gltf.scene);
      loadedCarQualityLevel = safeLevel;
      setupVehiclePhysics();
    },
    undefined,
    () => {
      if (requestId === carModelRequestId) pendingCarQualityLevel = 0;
      if (requestId === carModelRequestId && !carVisualRoot) {
        attachFallbackTruckModel();
        setupVehiclePhysics();
      }
    }
  );
}

function addWheelMotionMarkers(wheelGroup, sideSign = 1) {
  const hubMaterial = new THREE.MeshStandardMaterial({ color: 0xbfc3b6, roughness: 0.38, metalness: 0.28 });
  const markerMaterial = new THREE.MeshStandardMaterial({
    color: 0xf0b44b,
    emissive: 0x5a3200,
    roughness: 0.45,
    metalness: 0.08
  });
  const hubGeometry = new THREE.CylinderGeometry(0.28, 0.28, 0.74, 18);
  const spokeGeometry = new THREE.BoxGeometry(0.68, 0.08, 0.1);
  const sideMarkerGeometry = new THREE.BoxGeometry(0.1, 0.2, 0.32);
  const hub = new THREE.Mesh(hubGeometry, hubMaterial);
  const spoke = new THREE.Mesh(spokeGeometry, markerMaterial);
  const sideMarker = new THREE.Mesh(sideMarkerGeometry, markerMaterial);

  hubGeometry.rotateZ(Math.PI / 2);
  hub.position.x = sideSign * 0.16;
  spoke.position.set(sideSign * 0.48, 0.34, 0);
  sideMarker.position.set(sideSign * 0.66, 0.54, 0);
  hub.castShadow = true;
  hub.receiveShadow = true;
  spoke.castShadow = true;
  spoke.receiveShadow = true;
  sideMarker.castShadow = true;
  sideMarker.receiveShadow = true;
  wheelGroup.add(hub, spoke, sideMarker);
}

const CAR_WHEEL_SPIN_MATERIALS = new Set(["advan_neova1", "default_grey__s1", "default_grey__e"]);
const CAR_WHEEL_STEER_MATERIALS = new Set(["brake__spec_2", "Matte__FF191919"]);
const CAR_WHEEL_RAW_CENTERS = [
  new THREE.Vector3(CAR_RAW_RIGHT_X, CAR_RAW_WHEEL_Y, CAR_RAW_REAR_Z),
  new THREE.Vector3(CAR_RAW_LEFT_X, CAR_RAW_WHEEL_Y, CAR_RAW_REAR_Z),
  new THREE.Vector3(CAR_RAW_RIGHT_X, CAR_RAW_WHEEL_Y, CAR_RAW_FRONT_Z),
  new THREE.Vector3(CAR_RAW_LEFT_X, CAR_RAW_WHEEL_Y, CAR_RAW_FRONT_Z)
];

function splitCombinedWheelMesh(sourceMesh) {
  const sourceGeometry = sourceMesh.geometry.index
    ? sourceMesh.geometry.toNonIndexed()
    : sourceMesh.geometry.clone();
  const buckets = CAR_WHEEL_RAW_CENTERS.map(() => ({}));
  const position = sourceGeometry.attributes.position;
  const worldPosition = new THREE.Vector3();
  const worldNormal = new THREE.Vector3();
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(sourceMesh.matrixWorld);

  Object.entries(sourceGeometry.attributes).forEach(([name]) => {
    buckets.forEach((bucket) => { bucket[name] = []; });
  });

  for (let triangle = 0; triangle < position.count; triangle += 3) {
    let centerX = 0;
    let centerZ = 0;
    for (let vertex = 0; vertex < 3; vertex += 1) {
      worldPosition.fromBufferAttribute(position, triangle + vertex).applyMatrix4(sourceMesh.matrixWorld);
      centerX += worldPosition.x;
      centerZ += worldPosition.z;
    }
    centerX /= 3;
    centerZ /= 3;
    const region = (centerX >= CAR_RAW_CENTER_X ? 1 : 0) + (centerZ >= CAR_RAW_CENTER_Z ? 2 : 0);
    const wheelCenter = CAR_WHEEL_RAW_CENTERS[region];

    Object.entries(sourceGeometry.attributes).forEach(([name, attribute]) => {
      for (let vertex = 0; vertex < 3; vertex += 1) {
        const index = triangle + vertex;
        if (name === "position") {
          worldPosition.fromBufferAttribute(attribute, index).applyMatrix4(sourceMesh.matrixWorld).sub(wheelCenter);
          buckets[region][name].push(worldPosition.x, worldPosition.y, worldPosition.z);
        } else if (name === "normal") {
          worldNormal.fromBufferAttribute(attribute, index).applyMatrix3(normalMatrix).normalize();
          buckets[region][name].push(worldNormal.x, worldNormal.y, worldNormal.z);
        } else {
          for (let component = 0; component < attribute.itemSize; component += 1) {
            buckets[region][name].push(attribute.array[index * attribute.itemSize + component]);
          }
        }
      }
    });
  }

  const parts = buckets.map((bucket, region) => {
    const geometry = new THREE.BufferGeometry();
    Object.entries(sourceGeometry.attributes).forEach(([name, attribute]) => {
      geometry.setAttribute(name, new THREE.Float32BufferAttribute(bucket[name], attribute.itemSize, attribute.normalized));
    });
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const part = new THREE.Mesh(geometry, sourceMesh.material);
    part.name = `${sourceMesh.name}_wheel_${region}`;
    part.castShadow = true;
    part.receiveShadow = true;
    return part;
  });
  sourceGeometry.dispose();
  return parts;
}

function attachCarModel(carModel) {
  brakeLightMaterials = [];
  carModel.updateMatrixWorld(true);
  const wheelSourceMeshes = [];
  const edgeOverlayMeshes = [];
  carModel.traverse((child) => {
    if (!child.isMesh) return;
    child.castShadow = true;
    child.receiveShadow = true;
    const materialName = child.material?.name || "";
    if (materialName.startsWith("edge_color")) {
      edgeOverlayMeshes.push(child);
      return;
    }
    if (materialName.includes("vehiclelights") || materialName.includes("lights")) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((m) => brakeLightMaterials.push(m));
    }
    if (CAR_WHEEL_SPIN_MATERIALS.has(materialName) || CAR_WHEEL_STEER_MATERIALS.has(materialName)) {
      wheelSourceMeshes.push(child);
    }
  });

  const edgeMaterials = new Set();
  edgeOverlayMeshes.forEach((mesh) => {
    mesh.parent?.remove(mesh);
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    materials.forEach((material) => { if (material) edgeMaterials.add(material); });
  });
  edgeMaterials.forEach((material) => material.dispose());

  const wheelParts = CAR_WHEEL_RAW_CENTERS.map(() => ({ spin: [], steer: [] }));
  wheelSourceMeshes.forEach((sourceMesh) => {
    const parts = splitCombinedWheelMesh(sourceMesh);
    const spins = CAR_WHEEL_SPIN_MATERIALS.has(sourceMesh.material?.name || "");
    parts.forEach((part, region) => wheelParts[region][spins ? "spin" : "steer"].push(part));
    sourceMesh.parent?.remove(sourceMesh);
    sourceMesh.geometry.dispose();
  });

  const content = new THREE.Group();
  content.name = "LevinContent";
  content.position.set(-CAR_RAW_CENTER_X, -CAR_RAW_MIN_Y, -CAR_RAW_CENTER_Z);
  content.add(carModel);

  const regionPivots = CAR_WHEEL_RAW_CENTERS.map((wheelCenter, region) => {
    const steerPivot = new THREE.Group();
    const spinPivot = new THREE.Group();
    steerPivot.name = `LevinWheelSteer${region}`;
    spinPivot.name = `LevinWheelSpin${region}`;
    steerPivot.position.copy(wheelCenter);
    steerPivot.add(spinPivot);
    wheelParts[region].spin.forEach((part) => spinPivot.add(part));
    wheelParts[region].steer.forEach((part) => spinPivot.add(part));
    steerPivot.userData.authoredWheel = true;
    steerPivot.userData.basePosition = steerPivot.position.clone();
    steerPivot.userData.spinPivot = spinPivot;
    steerPivot.userData.spin = 0;
    content.add(steerPivot);
    return steerPivot;
  });

  const normalization = new THREE.Group();
  normalization.name = "ToyotaLevinVisual";
  normalization.scale.setScalar(CAR_SCALE);
  normalization.rotation.y = Math.PI;
  normalization.add(content);
  carGroup.add(normalization);

  // Physics order: front right, front left, rear right, rear left.
  visualWheels = [regionPivots[2], regionPivots[3], regionPivots[0], regionPivots[1]];
  visualWheels.forEach((wheel, index) => {
    wheel.userData.restSuspensionLength = TRUCK_FRONT_WHEEL_INDICES.has(index) ? 0.36 : 0.34;
  });

  const previousVisual = carVisualRoot;
  carVisualRoot = normalization;
  if (previousVisual) {
    carGroup.remove(previousVisual);
    disposeCarModel(previousVisual);
  }
}

function attachFallbackTruckModel() {
  const wrapper = new THREE.Group();
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xd94a35, roughness: 0.55, metalness: 0.08 });
  const cabinMaterial = new THREE.MeshStandardMaterial({ color: 0x2e4c68, roughness: 0.28, metalness: 0.12 });
  const tireMaterial = new THREE.MeshStandardMaterial({ color: 0x080808, roughness: 0.82, metalness: 0.0 });

  const body = new THREE.Mesh(new THREE.BoxGeometry(3.3, 1.1, 6.4), bodyMaterial);
  body.position.set(0, 1.25, 0.25);
  const cabin = new THREE.Mesh(new THREE.BoxGeometry(2.5, 1.65, 2.45), cabinMaterial);
  cabin.position.set(0, 2.18, -0.9);
  const tray = new THREE.Mesh(new THREE.BoxGeometry(3.15, 0.5, 2.9), bodyMaterial);
  tray.position.set(0, 1.85, 1.65);
  wrapper.add(body, cabin, tray);

  visualWheels = TRUCK_WHEEL_POSITIONS.map((pos) => {
    const wheelGroup = new THREE.Group();
    const tireGeometry = new THREE.CylinderGeometry(TRUCK_WHEEL_RADIUS, TRUCK_WHEEL_RADIUS, 0.65, 24);
    tireGeometry.rotateZ(Math.PI / 2);
    wheelGroup.add(new THREE.Mesh(tireGeometry, tireMaterial));
    addWheelMotionMarkers(wheelGroup, Math.sign(pos.x) || 1);
    wheelGroup.position.copy(pos);
    wheelGroup.userData.spin = 0;
    wrapper.add(wheelGroup);
    return wheelGroup;
  });

  wrapper.traverse((child) => {
    if (child.isMesh) {
      child.castShadow = true;
      child.receiveShadow = true;
    }
  });

  carGroup.add(wrapper);
  carVisualRoot = wrapper;
}

function setupVehiclePhysics() {
  if (!physicsReady || !physicsWorld || carBody || vehicleController) {
    return;
  }

  const rigidBodyDesc = RAPIER.RigidBodyDesc.dynamic()
    .setTranslation(-55.17, -14.6419, 18.7405)
    .setRotation({ x: 0.026907, y: -0.098041, z: 0.062049, w: 0.992882 })
    .setLinearDamping(0.12)
    .setAngularDamping(1.65);
  carBody = physicsWorld.createRigidBody(rigidBodyDesc);

  const colliderDesc = RAPIER.ColliderDesc.cuboid(1.78, 0.78, 4.15)
    .setTranslation(0, 1.08, 0)
    .setMass(1800.0);
  physicsWorld.createCollider(colliderDesc, carBody);

  vehicleController = physicsWorld.createVehicleController(carBody);

  TRUCK_WHEEL_POSITIONS.forEach((pos, index) => {
    const isFrontWheel = TRUCK_FRONT_WHEEL_INDICES.has(index);
    const suspensionRestLength = isFrontWheel ? 0.36 : 0.34;

    vehicleController.addWheel(
      new RAPIER.Vector3(pos.x, pos.y, pos.z),
      new RAPIER.Vector3(0, -1, 0), // direction down
      new RAPIER.Vector3(-1, 0, 0), // axle left
      suspensionRestLength,
      TRUCK_WHEEL_RADIUS
    );
    vehicleController.setWheelSuspensionStiffness(index, isFrontWheel ? 44.0 : 58.0);
    vehicleController.setWheelSuspensionCompression(index, isFrontWheel ? 5.2 : 7.2);
    vehicleController.setWheelSuspensionRelaxation(index, isFrontWheel ? 6.2 : 8.6);
    vehicleController.setWheelMaxSuspensionTravel(index, isFrontWheel ? 0.36 : 0.26);
    vehicleController.setWheelMaxSuspensionForce(index, isFrontWheel ? 10500.0 : 14500.0);
    vehicleController.setWheelFrictionSlip(index, 2.8);
    vehicleController.setWheelSideFrictionStiffness(index, 1.2);
  });
}

function initializeTuningPanel() {
  if (!tuningPanel) {
    return;
  }

  ["click", "dblclick", "pointerdown", "pointerup", "mousedown", "mouseup", "mousemove", "touchstart", "touchmove", "touchend", "wheel", "keydown", "keyup"].forEach((eventName) => {
    tuningPanel.addEventListener(eventName, (event) => {
      event.stopPropagation();
    }, { passive: eventName !== "touchmove" && eventName !== "wheel" });
  });

  const inputs = [
    tuningControls.grassHeight,
    tuningControls.grassBaseColor,
    tuningControls.grassTipColorA,
    tuningControls.grassTipColorB,
    tuningControls.terrainColor,
    tuningControls.skyColor,
    tuningControls.fogColor,
    tuningControls.fogDensity,
    tuningControls.windStrength,
    tuningControls.cloudTextPosX,
    tuningControls.cloudTextPosY,
    tuningControls.cloudTextPosZ,
    tuningControls.cloudTextRotX,
    tuningControls.cloudTextRotY,
    tuningControls.cloudTextRotZ
  ].filter(Boolean);

  inputs.forEach((input) => {
    input.addEventListener("input", updateSettingsFromControls);
  });

  if (tuningControls.showFps) {
    tuningControls.showFps.addEventListener("change", (e) => {
      document.body.classList.toggle("show-fps", e.target.checked);
    });
  }

  if (tuningControls.saveSpawn) {
    tuningControls.saveSpawn.addEventListener("click", saveSpawnPoint);
  }

  if (tuningControls.exportSettings) {
    tuningControls.exportSettings.addEventListener("click", exportSceneSettings);
  }

  syncControlsFromSettings();
  applySceneSettings();
}

function initializeQualityControl() {
  if (!qualitySlider || !qualitySliderWrap || !qualityOutput) {
    return;
  }

  const stopInputPropagation = (event) => event.stopPropagation();
  ["click", "pointerdown", "pointermove", "pointerup", "keydown"].forEach((eventName) => {
    qualityControl?.addEventListener(eventName, stopInputPropagation);
  });

  qualitySlider.addEventListener("input", () => {
    applyQualityLevel(Number.parseInt(qualitySlider.value, 10));
  });
  qualitySlider.addEventListener("pointerdown", () => qualityControl?.classList.add("is-dragging"));
  qualitySlider.addEventListener("pointerup", () => qualityControl?.classList.remove("is-dragging"));
  qualitySlider.addEventListener("pointercancel", () => qualityControl?.classList.remove("is-dragging"));
  qualitySlider.addEventListener("blur", () => qualityControl?.classList.remove("is-dragging"));
  tuningToggle?.addEventListener("click", () => {
    setTuningPanelOpen(!tuningPanel?.classList.contains("is-open"));
  });

  applyQualityLevel(sceneSettings.qualityLevel);
}

function setTuningPanelOpen(isOpen) {
  tuningPanel?.classList.toggle("is-open", isOpen);
  tuningToggle?.setAttribute("aria-expanded", String(isOpen));
  tuningToggle?.setAttribute("aria-label", isOpen ? "Hide scene tuning controls" : "Show scene tuning controls");
}

function applyQualityLevel(level) {
  const safeLevel = THREE.MathUtils.clamp(Math.round(level), 1, 5);
  const preset = QUALITY_PRESETS[safeLevel];
  const grassFlatteningEnabled = safeLevel >= 4;
  sceneSettings.qualityLevel = safeLevel;
  grassQualityDistance = preset.grassDistance;
  // The mobile tile pool has a smaller safe buffer than desktop, so cap its
  // extended near-field without ever letting recycled tiles enter the view.
  highDensityGrassDistance = Math.min(
    preset.highDensityDistance,
    window.innerWidth < 700 ? 1.12 : 1.3
  );
  renderQuality.minScale = preset.minScale;
  renderQuality.maxScale = preset.maxScale;

  renderQuality.scale = preset.renderScale;

  renderer.setPixelRatio(renderQuality.scale);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  cloudMaterials.forEach((material) => {
    material.uniforms.uRaymarchSteps.value = preset.cloudSteps;
  });
  grassMaterials.forEach((material) => {
    material.uniforms.uGrassFlatteningEnabled.value = grassFlatteningEnabled ? 1 : 0;
    material.uniforms.uTrailStampCount.value = grassFlatteningEnabled ? trailStamps.length : 0;
    if (material.userData.highDensityLayer) {
      material.uniforms.uLodDistanceScale.value = highDensityGrassDistance;
    }
    if (material.userData.highDensityTransition) {
      material.uniforms.uLodFadeInScale.value = highDensityGrassDistance;
    }
  });

  // Low through Medium only hide blades intersecting the car. Do not retain
  // dormant trail stamps that could suddenly reappear after raising quality.
  if (!grassFlatteningEnabled) {
    trailStamps.length = 0;
    lastTrailPoint.copy(player.position);
    updateTrailStampUniforms();
  }

  const progress = ((safeLevel - 1) / 4) * 100;
  qualitySlider.value = String(safeLevel);
  qualitySlider.setAttribute("aria-label", `Graphics quality, ${preset.name} ${safeLevel} of 5`);
  qualitySliderWrap.style.setProperty("--quality-progress", `${progress}%`);
  qualityOutput.textContent = `${preset.name} · ${safeLevel}/5`;
  qualitySteps?.querySelectorAll("span").forEach((step, index) => {
    step.classList.toggle("is-active", index < safeLevel);
  });

  window.blissPerformance = {
    qualityLevel: safeLevel,
    qualityName: preset.name,
    renderScale: renderQuality.scale,
    highDensityGrassDistance
  };

  if (carGroup) {
    requestCarQualityLevel(safeLevel);
  }
}

function syncControlsFromSettings() {
  if (tuningControls.grassHeight) tuningControls.grassHeight.value = sceneSettings.grassHeight;
  if (tuningControls.grassBaseColor) tuningControls.grassBaseColor.value = sceneSettings.grassBaseColor;
  if (tuningControls.grassTipColorA) tuningControls.grassTipColorA.value = sceneSettings.grassTipColorA;
  if (tuningControls.grassTipColorB) tuningControls.grassTipColorB.value = sceneSettings.grassTipColorB;
  if (tuningControls.terrainColor) tuningControls.terrainColor.value = sceneSettings.terrainColor;
  if (tuningControls.skyColor) tuningControls.skyColor.value = sceneSettings.skyColor;
  if (tuningControls.fogColor) tuningControls.fogColor.value = sceneSettings.fogColor;
  if (tuningControls.fogDensity) tuningControls.fogDensity.value = sceneSettings.fogDensity;
  if (tuningControls.windStrength) tuningControls.windStrength.value = sceneSettings.windStrength;
  if (tuningControls.cloudTextPosX) tuningControls.cloudTextPosX.value = sceneSettings.cloudTextPosX;
  if (tuningControls.cloudTextPosY) tuningControls.cloudTextPosY.value = sceneSettings.cloudTextPosY;
  if (tuningControls.cloudTextPosZ) tuningControls.cloudTextPosZ.value = sceneSettings.cloudTextPosZ;
  if (tuningControls.cloudTextRotX) tuningControls.cloudTextRotX.value = sceneSettings.cloudTextRotX;
  if (tuningControls.cloudTextRotY) tuningControls.cloudTextRotY.value = sceneSettings.cloudTextRotY;
  if (tuningControls.cloudTextRotZ) tuningControls.cloudTextRotZ.value = sceneSettings.cloudTextRotZ;
}

function updateSettingsFromControls() {
  sceneSettings.grassHeight = readNumberControl(tuningControls.grassHeight, sceneSettings.grassHeight);
  sceneSettings.grassBaseColor = readColorControl(tuningControls.grassBaseColor, sceneSettings.grassBaseColor);
  sceneSettings.grassTipColorA = readColorControl(tuningControls.grassTipColorA, sceneSettings.grassTipColorA);
  sceneSettings.grassTipColorB = readColorControl(tuningControls.grassTipColorB, sceneSettings.grassTipColorB);
  sceneSettings.terrainColor = readColorControl(tuningControls.terrainColor, sceneSettings.terrainColor);
  sceneSettings.skyColor = readColorControl(tuningControls.skyColor, sceneSettings.skyColor);
  sceneSettings.fogColor = readColorControl(tuningControls.fogColor, sceneSettings.fogColor);
  sceneSettings.fogDensity = readNumberControl(tuningControls.fogDensity, sceneSettings.fogDensity);
  sceneSettings.windStrength = readNumberControl(tuningControls.windStrength, sceneSettings.windStrength);

  applySceneSettings();
}

function readNumberControl(control, fallback) {
  if (!control) {
    return fallback;
  }

  const value = Number.parseFloat(control.value);

  return Number.isFinite(value) ? value : fallback;
}

function readColorControl(control, fallback) {
  return control && control.value ? control.value : fallback;
}

function applySceneSettings() {
  scene.background.set(sceneSettings.skyColor);
  scene.fog.color.set(sceneSettings.fogColor);
  scene.fog.density = sceneSettings.fogDensity;
  document.body.style.backgroundColor = sceneSettings.skyColor;

  if (terrainMaterial) {
    terrainMaterial.color.set(sceneSettings.terrainColor);
  }

  grassMaterials.forEach((material) => {
    material.uniforms.uGrassHeightMultiplier.value = sceneSettings.grassHeight;
    material.uniforms.uWindStrength.value = sceneSettings.windStrength;
    material.uniforms.uBaseColor.value.set(sceneSettings.grassBaseColor);
    material.uniforms.uTipColor1.value.set(sceneSettings.grassTipColorA);
    material.uniforms.uTipColor2.value.set(sceneSettings.grassTipColorB);
    material.uniforms.uFogColor.value.set(sceneSettings.fogColor);
    material.uniforms.uFogDensity.value = sceneSettings.fogDensity;
  });

  if (distantGrassMaterial) {
    distantGrassMaterial.color
      .set(sceneSettings.grassTipColorB)
      .lerp(new THREE.Color(sceneSettings.grassTipColorA), 0.34);
  }

  if (clouds && clouds.length > 0 && clouds[0].material.uniforms) {
    const cloudMat = clouds[0].material;
    const euler = new THREE.Euler(
      THREE.MathUtils.degToRad(sceneSettings.cloudTextRotX),
      THREE.MathUtils.degToRad(sceneSettings.cloudTextRotY),
      THREE.MathUtils.degToRad(sceneSettings.cloudTextRotZ),
      "YXZ"
    );
    const quat = new THREE.Quaternion().setFromEuler(euler);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(quat);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(quat);
    
    cloudMat.uniforms.uTextCenter.value.set(sceneSettings.cloudTextPosX, sceneSettings.cloudTextPosY, sceneSettings.cloudTextPosZ);
    cloudMat.uniforms.uTextRight.value.copy(right);
    cloudMat.uniforms.uTextUp.value.copy(up);
    cloudMat.uniforms.uTextForward.value.copy(forward);
  }
}

async function exportSceneSettings() {
  const payload = JSON.stringify(sceneSettings, null, 2);

  if (settingsOutput) {
    settingsOutput.value = payload;
    settingsOutput.classList.add("has-settings");
    settingsOutput.select();
  }

  try {
    await navigator.clipboard.writeText(payload);
    setExportStatus("Copied");
  } catch {
    setExportStatus("Select text");
  }
}

function setExportStatus(message) {
  if (!exportStatus) {
    return;
  }

  exportStatus.textContent = message;
  window.clearTimeout(setExportStatus.timeoutId);
  setExportStatus.timeoutId = window.setTimeout(() => {
    exportStatus.textContent = "";
  }, 1800);
}

async function saveSpawnPoint() {
  // Prefer the physics body position/rotation for accuracy; fall back to
  // the visual group if physics hasn't initialised yet.
  let carPos, carQuat;
  if (carBody) {
    const p = carBody.translation();
    const r = carBody.rotation();
    carPos = { x: p.x, y: p.y, z: p.z };
    carQuat = { x: r.x, y: r.y, z: r.z, w: r.w };
  } else if (carGroup) {
    carPos = { x: carGroup.position.x, y: carGroup.position.y, z: carGroup.position.z };
    const q = carGroup.quaternion;
    carQuat = { x: q.x, y: q.y, z: q.z, w: q.w };
  } else {
    carPos = { x: player.position.x, y: player.position.y, z: player.position.z };
    carQuat = { x: 0, y: 0, z: 0, w: 1 };
  }

  const spawn = {
    car: {
      position: { x: +carPos.x.toFixed(4), y: +carPos.y.toFixed(4), z: +carPos.z.toFixed(4) },
      quaternion: { x: +carQuat.x.toFixed(6), y: +carQuat.y.toFixed(6), z: +carQuat.z.toFixed(6), w: +carQuat.w.toFixed(6) }
    },
    camera: {
      yawOffset: +player.camYawOffset.toFixed(4),
      pitchOffset: +player.camPitchOffset.toFixed(4),
      distance: +cameraZoom.targetDistance.toFixed(3),
      fov: +cameraZoom.targetFov.toFixed(3)
    }
  };

  const payload = JSON.stringify(spawn, null, 2);

  if (spawnOutput) {
    spawnOutput.value = payload;
    spawnOutput.classList.add("has-spawn");
    spawnOutput.select();
  }

  try {
    await navigator.clipboard.writeText(payload);
    setExportStatus("Spawn copied!");
  } catch {
    setExportStatus("Select & copy");
  }
}

function createLights() {
  const hemisphere = new THREE.HemisphereLight(0xf3fbff, 0x78a530, 1.08);
  scene.add(hemisphere);

  const daylight = new THREE.DirectionalLight(0xffffff, 0.7);
  daylight.position.set(-80, 120, 60);
  scene.add(daylight);
}

function setRendererColorSpace(targetRenderer) {
  if ("outputColorSpace" in targetRenderer && THREE.SRGBColorSpace) {
    targetRenderer.outputColorSpace = THREE.SRGBColorSpace;
    return;
  }

  targetRenderer.outputEncoding = THREE.sRGBEncoding;
}

function setTextureColorSpace(texture) {
  if ("colorSpace" in texture && THREE.SRGBColorSpace) {
    texture.colorSpace = THREE.SRGBColorSpace;
    return;
  }

  texture.encoding = THREE.sRGBEncoding;
}

function createTerrain() {
  terrainGeometry = new THREE.PlaneGeometry(1200, 1200, 120, 120);
  terrainGeometry.rotateX(-Math.PI / 2);

  terrainMaterial = new THREE.MeshStandardMaterial({
    color: sceneSettings.terrainColor,
    map: createGrassTexture(),
    roughness: 0.96,
    metalness: 0,
    side: THREE.DoubleSide
  });

  terrainMaterial.userData = {
    uPlayerPosition: { value: new THREE.Vector2() },
    uCarRight: { value: new THREE.Vector2() },
    uCarForward: { value: new THREE.Vector2() },
    uShadowParams1: { value: new THREE.Vector4(0.0, -0.2, 1.6, 3.2) },
    uShadowParams2: { value: new THREE.Vector3(-0.3, 1.2, 0.25) }
  };

  terrainMaterial.onBeforeCompile = (shader) => {
    shader.uniforms.uPlayerPosition = terrainMaterial.userData.uPlayerPosition;
    shader.uniforms.uCarRight = terrainMaterial.userData.uCarRight;
    shader.uniforms.uCarForward = terrainMaterial.userData.uCarForward;
    shader.uniforms.uShadowParams1 = terrainMaterial.userData.uShadowParams1;
    shader.uniforms.uShadowParams2 = terrainMaterial.userData.uShadowParams2;
    
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
      varying vec2 vWorldXZ;`
    );
    
    shader.vertexShader = shader.vertexShader.replace(
      '#include <worldpos_vertex>',
      `#include <worldpos_vertex>
      vWorldXZ = (modelMatrix * vec4(transformed, 1.0)).xz;`
    );
    
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      `#include <common>
      uniform vec2 uPlayerPosition;
      uniform vec2 uCarRight;
      uniform vec2 uCarForward;
      uniform vec4 uShadowParams1;
      uniform vec3 uShadowParams2;
      varying vec2 vWorldXZ;`
    );
    
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <color_fragment>',
      `#include <color_fragment>
      vec2 playerDelta = vWorldXZ - uPlayerPosition;
      vec2 shadowLocal = vec2(
        dot(playerDelta, uCarRight) + uShadowParams1.x,
        dot(playerDelta, uCarForward) + uShadowParams1.y
      );
      vec2 shadowD = abs(shadowLocal) - uShadowParams1.zw;
      float shadowSdf = length(max(shadowD, 0.0)) + min(max(shadowD.x, shadowD.y), 0.0);
      float shadowAmount = 1.0 - smoothstep(uShadowParams2.x, uShadowParams2.y, shadowSdf);
      diffuseColor.rgb *= mix(1.0, uShadowParams2.z, shadowAmount);`
    );
  };

  terrain = new THREE.Mesh(terrainGeometry, terrainMaterial);
  terrain.receiveShadow = true;
  terrain.name = "rolling-grass";
  scene.add(terrain);
  
  updateTerrain();
}


function updateTerrain() {
  if (!terrain || !terrainGeometry) return;

  const snap = 10;
  const snapX = Math.round(player.position.x / snap) * snap;
  const snapZ = Math.round(player.position.z / snap) * snap;
  
  if (snapX === lastTerrainSnapX && snapZ === lastTerrainSnapZ) return;
  
  lastTerrainSnapX = snapX;
  lastTerrainSnapZ = snapZ;
  
  updatePhysicsTerrain(snapX, snapZ);
  
  terrain.position.set(snapX, 0, snapZ);
  
  const position = terrainGeometry.attributes.position;
  for (let i = 0; i < position.count; i += 1) {
    const localX = position.getX(i);
    const localZ = position.getZ(i);
    const worldX = snapX + localX;
    const worldZ = snapZ + localZ;
    position.setY(i, terrainHeight(worldX, worldZ));
  }
  
  position.needsUpdate = true;
  terrainGeometry.computeVertexNormals();
}

function updatePhysicsTerrain(snapX, snapZ) {
  if (!physicsWorld) return;
  if (terrainCollider) {
    physicsWorld.removeCollider(terrainCollider, true);
  }

  const size = 1000;
  const subdivs = 100;
  const heights = new Float32Array((subdivs + 1) * (subdivs + 1));
  
  for (let i = 0; i <= subdivs; i++) {
    for (let j = 0; j <= subdivs; j++) {
      // Rapier heightfield columns map to local X, rows map to local Z
      // BUT for safety we just sample at exact physical coords
      const x = snapX - size/2 + i * (size / subdivs);
      const z = snapZ - size/2 + j * (size / subdivs);
      heights[j + i * (subdivs + 1)] = terrainHeight(x, z);
    }
  }

  let colliderDesc = RAPIER.ColliderDesc.heightfield(
    subdivs, subdivs, heights,
    { x: size, y: 1.0, z: size }
  ).setTranslation(snapX, 0, snapZ);
  
  terrainCollider = physicsWorld.createCollider(colliderDesc);
}

function createGrassTexture() {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 1024;
  textureCanvas.height = 1024;

  const context = textureCanvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, textureCanvas.width, textureCanvas.height);

  for (let i = 0; i < 16000; i += 1) {
    const x = random() * textureCanvas.width;
    const y = random() * textureCanvas.height;
    const length = 5 + random() * 22;
    const shade = random() > 0.54 ? "255, 255, 255" : "0, 0, 0";
    context.strokeStyle = `rgba(${shade}, ${0.055 + random() * 0.105})`;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + random() * 10 - 5, y - length);
    context.stroke();
  }

  for (let y = 0; y < textureCanvas.height; y += 58) {
    context.fillStyle = `rgba(0, 0, 0, ${0.012 + random() * 0.02})`;
    context.fillRect(0, y + random() * 18, textureCanvas.width, 4 + random() * 5);
  }

  const texture = new THREE.CanvasTexture(textureCanvas);
  setTextureColorSpace(texture);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(28, 28);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();

  return texture;
}

function createCloudTextTexture(isMobile) {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = 1024;
  textureCanvas.height = isMobile ? 512 : 256;
  const context = textureCanvas.getContext("2d");
  
  context.fillStyle = "#000000";
  context.fillRect(0, 0, textureCanvas.width, textureCanvas.height);
  
  context.fillStyle = "#ffffff";
  context.textBaseline = "middle";
  
  if (isMobile) {
    context.textAlign = "left";
    context.font = "bold 140px sans-serif";
    context.fillText("a blissful", 140, textureCanvas.height / 2 - 80);
    context.fillText("drive", 140, textureCanvas.height / 2 + 80);
  } else {
    context.textAlign = "center";
    context.font = "bold 130px sans-serif";
    context.fillText("a blissful drive", textureCanvas.width / 2, textureCanvas.height / 2);
  }
  
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  return texture;
}

function createClouds() {
  const isMobile = window.matchMedia("(pointer: coarse)").matches;

  const volumetricCloudVertexShader = `
    varying vec3 vWorldPosition;
    void main() {
      vec4 worldPosition = modelMatrix * vec4(position, 1.0);
      vWorldPosition = worldPosition.xyz;
      gl_Position = projectionMatrix * viewMatrix * worldPosition;
    }
  `;
  
  const volumetricCloudFragmentShader = `
    uniform vec2 uTextBounds;

    varying vec3 vWorldPosition;

    uniform vec3 uCameraPos;
    uniform float uTime;
    uniform vec3 uSunDirection;
    uniform vec3 uBaseColor;
    uniform vec3 uSunColor;
    uniform vec3 uSkyColor;
    uniform int uRaymarchSteps;
    
    uniform sampler2D uCloudText;
    uniform float uTextProgress;
    uniform vec3 uTextCenter;
    uniform vec3 uTextRight;
    uniform vec3 uTextUp;
    uniform vec3 uTextForward;

    float hash(vec3 p) {
      p = fract(p * 0.3183099 + 0.1);
      p *= 17.0;
      return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
    }

    float noise(vec3 x) {
      vec3 i = floor(x);
      vec3 f = fract(x);
      f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(hash(i + vec3(0,0,0)), hash(i + vec3(1,0,0)), f.x),
                     mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),
                 mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x),
                     mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z);
    }

    float fbm(vec3 p) {
      float f = 0.0;
      float w = 0.5;
      for (int i = 0; i < 3; i++) {
        f += w * noise(p);
        p *= 2.0;
        w *= 0.5;
      }
      return f;
    }

    float getDensity(vec3 p) {
      vec3 q = p;
      q.x += uTime * 0.5;
      
      // Cirrus clouds (high altitude, thin, horizontal streaks)
      float cirrusH = clamp((p.y - 100.0) / 100.0, 0.0, 1.0);
      float cirrusMask = smoothstep(0.0, 0.3, cirrusH) * (1.0 - smoothstep(0.7, 1.0, cirrusH));
      float cirrusBase = fbm(vec3(q.x * 0.002, q.y * 0.02, q.z * 0.002));
      float cirrusDensity = max(0.0, cirrusBase - 0.65) * cirrusMask * 10.0;
      
      // Cumulus clouds (mid altitude, scattered puffs)
      float cumulusH = clamp((p.y - 50.0) / 100.0, 0.0, 1.0);
      float cumulusMask = smoothstep(0.0, 0.2, cumulusH) * (1.0 - smoothstep(0.6, 1.0, cumulusH));
      float cumulusBase = fbm(q * 0.008);
      float cumulusDensity = cumulusBase - (1.0 - cumulusMask) - 0.5;
      if (cumulusDensity > 0.0) {
        float detail = fbm(q * 0.02 + uTime * 0.1);
        cumulusDensity -= (1.0 - detail) * 0.2;
      }
      cumulusDensity = max(0.0, cumulusDensity * 10.0);
      
      float density = cirrusDensity + cumulusDensity;
      
      // --- CLOUD TEXT ---
      vec3 localP = p - uTextCenter;
      float zDist = dot(localP, uTextForward);
      
      // Keep it thin (8m thick slice) to avoid smearing when viewed from an angle
      if (abs(zDist) < 4.0) {
        float xDist = dot(localP, uTextRight);
        float yDist = dot(localP, uTextUp);
        
        if (abs(xDist) < uTextBounds.x * 0.5 && abs(yDist) < uTextBounds.y * 0.5) {
          // Map local X and Y bounds to 0-1 UV space
          vec2 uv = vec2(xDist / uTextBounds.x + 0.5, yDist / uTextBounds.y + 0.5);
          float textMask = texture2D(uCloudText, uv).r;
          
          float spawnMask = smoothstep(uTextProgress - 0.05, uTextProgress + 0.05, uv.x);
          textMask *= (1.0 - spawnMask);

          if (textMask > 0.01) {
            float textNoise = fbm(p * 0.03 + uTime * 0.2);
            float textDensity = textMask * max(0.0, textNoise - 0.2) * 18.0;
            
            float zFade = 1.0 - (abs(zDist) / 4.0);
            density += textDensity * zFade;
          }
        }
      }

      // Fade out at extreme distance
      float distFade = 1.0 - smoothstep(1500.0, 2500.0, length(p.xz - uCameraPos.xz));
      density *= distFade;
      
      return density;
    }

    void main() {
      vec3 rayDir = normalize(vWorldPosition - uCameraPos);
      
      float skyT = max(0.0, rayDir.y * 3.0);
      vec3 backgroundCol = mix(uBaseColor, uSkyColor, skyT);
      
      if (rayDir.y <= 0.001) {
        gl_FragColor = vec4(backgroundCol, 1.0);
        return;
      }
      
      float tNear = max(0.0, (60.0 - uCameraPos.y) / rayDir.y);
      float tFar = min(2500.0, (180.0 - uCameraPos.y) / rayDir.y);
      
      if (tNear >= tFar) {
        gl_FragColor = vec4(backgroundCol, 1.0);
        return;
      }
      
      float stepSize = (tFar - tNear) / float(uRaymarchSteps);
      vec3 p = uCameraPos + rayDir * tNear;
      
      vec3 colorAccum = vec3(0.0);
      float transmittance = 1.0;
      vec3 sunDir = normalize(uSunDirection);
      
      // Deterministic midpoint sampling keeps cloud edges clean. The quality
      // presets supply enough samples to avoid the layered look of low counts.
      p += rayDir * stepSize * 0.5;

      for (int i = 0; i < 80; i++) {
        if (i >= uRaymarchSteps) break;
        if (transmittance < 0.01) break;
        float d = getDensity(p);
        if (d > 0.01) {
          float lightDensity = getDensity(p + sunDir * 20.0);
          float shadow = exp(-lightDensity * 3.0);
          vec3 particleColor = mix(uBaseColor, uSunColor, shadow);
          float alpha = 1.0 - exp(-d * stepSize * 0.04);
          colorAccum += transmittance * alpha * particleColor;
          transmittance *= (1.0 - alpha);
        }
        p += rayDir * stepSize;
      }
      
      gl_FragColor = vec4(colorAccum + transmittance * backgroundCol, 1.0);
    }
  `;

  const geometry = new THREE.SphereGeometry(500, 32, 16);
  const material = new THREE.ShaderMaterial({
    vertexShader: volumetricCloudVertexShader,
    fragmentShader: volumetricCloudFragmentShader,
    uniforms: {
      uCameraPos: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uSunDirection: { value: new THREE.Vector3(-0.5, 0.8, -0.3).normalize() },
      uBaseColor: { value: new THREE.Color(sceneSettings.fogColor) },
      uSkyColor: { value: new THREE.Color(sceneSettings.skyColor) },
      uSunColor: { value: new THREE.Color(0xffffff) },
      uRaymarchSteps: { value: QUALITY_PRESETS[sceneSettings.qualityLevel].cloudSteps },
      uCloudText: { value: createCloudTextTexture(isMobile) },
      uTextBounds: { value: isMobile ? new THREE.Vector2(250.0, 125.0) : new THREE.Vector2(500.0, 120.0) },
      uTextProgress: { value: 0.0 },
      uTextCenter: { value: isMobile ? new THREE.Vector3(0, 110, -450) : new THREE.Vector3(0, 110, -250) },
      uTextRight: { value: new THREE.Vector3(1, 0, 0) },
      uTextUp: { value: new THREE.Vector3(0, 1, 0) },
      uTextForward: { value: new THREE.Vector3(0, 0, 1) }
    },
    transparent: true,
    depthWrite: false,
    side: THREE.BackSide,
    fog: false
  });
  
  const cloudBox = new THREE.Mesh(geometry, material);
  cloudBox.position.set(0, 0, 0);
  cloudBox.renderOrder = -2;
  scene.add(cloudBox);
  clouds.push(cloudBox);
  cloudMaterials.push(material);
}


function loadGrassGLBAndCreateBlades() {
  fetch("assets/grassLODs.glb")
    .then(function(response) { return response.arrayBuffer(); })
    .then(function(buffer) {
      grassGLBGeometry = parseGLBGeometry(buffer);
      if (grassGLBGeometry) {
        grassGLBGeometry.scale(4.8, 4.8, 4.8);
      }
      createGrassBlades();
    })
    .catch(function() {
      createGrassBlades();
    });
}

function parseGLBGeometry(buffer) {
  var view = new DataView(buffer);
  var magic = view.getUint32(0, true);

  if (magic !== 0x46546C67) {
    return null;
  }

  var jsonLength = view.getUint32(12, true);
  var jsonData = new Uint8Array(buffer, 20, jsonLength);
  var jsonString = "";

  for (var i = 0; i < jsonData.length; i += 1) {
    jsonString += String.fromCharCode(jsonData[i]);
  }

  var gltf = JSON.parse(jsonString);
  var binOffset = 20 + jsonLength + 8;
  var binData = new Uint8Array(buffer, binOffset);
  var targetMesh = null;

  if (gltf.meshes) {
    for (var m = 0; m < gltf.meshes.length; m += 1) {
      var mesh = gltf.meshes[m];
      if (mesh.name && mesh.name.indexOf("LOD0") !== -1) {
        targetMesh = mesh;
        break;
      }
    }
    if (!targetMesh) {
      targetMesh = gltf.meshes[0];
    }
  }

  if (!targetMesh || !targetMesh.primitives || targetMesh.primitives.length === 0) {
    return null;
  }

  var primitive = targetMesh.primitives[0];
  var geometry = new THREE.BufferGeometry();

  function readAccessor(accessorIndex) {
    var accessor = gltf.accessors[accessorIndex];
    var bufferView = gltf.bufferViews[accessor.bufferView];
    var offset = (bufferView.byteOffset || 0) + (accessor.byteOffset || 0);
    var count = accessor.count;
    var type = accessor.componentType;
    var numComponents = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[accessor.type] || 1;
    var totalElements = count * numComponents;

    if (type === 5126) {
      var floatArray = new Float32Array(binData.buffer, binData.byteOffset + offset, totalElements);
      return { data: floatArray, components: numComponents };
    }

    if (type === 5123) {
      var shortArray = new Uint16Array(binData.buffer, binData.byteOffset + offset, totalElements);
      return { data: shortArray, components: numComponents };
    }

    if (type === 5125) {
      var intArray = new Uint32Array(binData.buffer, binData.byteOffset + offset, totalElements);
      return { data: intArray, components: numComponents };
    }

    return null;
  }

  if (primitive.attributes.POSITION !== undefined) {
    var posData = readAccessor(primitive.attributes.POSITION);
    if (posData) {
      geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(posData.data), posData.components));
    }
  }

  if (primitive.attributes.NORMAL !== undefined) {
    var normData = readAccessor(primitive.attributes.NORMAL);
    if (normData) {
      geometry.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(normData.data), normData.components));
    }
  }

  if (primitive.attributes.TEXCOORD_0 !== undefined) {
    var uvData = readAccessor(primitive.attributes.TEXCOORD_0);
    if (uvData) {
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvData.data), uvData.components));
    }
  }

  if (primitive.indices !== undefined) {
    var indexData = readAccessor(primitive.indices);
    if (indexData) {
      geometry.setIndex(new THREE.BufferAttribute(indexData.data.constructor === Uint16Array ? new Uint16Array(indexData.data) : new Uint32Array(indexData.data), 1));
    }
  }

  geometry.computeBoundingSphere();
  geometry.computeVertexNormals();
  return geometry;
}

function createGrassBlades() {
  const geometryBySegmentCount = new Map();
  const isMobile = window.innerWidth < 700;
  const layers = isMobile
    ? [
        // The extra page around each band is a safety buffer: recycled tiles are
        // always outside their final fade distance, never in the camera view.
        { width: 660, depth: 660, spacing: 5.8, baseScale: 0.9, heightScale: 0.58, carpet: true, followPlayer: true, tileSize: 55, maxDistance: 242, densityScale: 0.46, segments: 3, lodFadeIn: [134, 158], lodFadeOut: [212, 242] },
        { width: 405, depth: 405, spacing: 3.2, baseScale: 0.86, heightScale: 0.78, carpet: true, followPlayer: true, tileSize: 33.75, maxDistance: 156, densityScale: 0.58, segments: 3, followsHighDensity: true, lodFadeIn: [72, 96], lodFadeOut: [134, 158] },
        { width: 262.5, depth: 262.5, spacing: 1.46, baseScale: 1.16, heightScale: 1.22, carpet: true, followPlayer: true, tileSize: 18.75, maxDistance: 92, densityScale: 0.76, segments: 4, highDensity: true, lodFadeIn: [0, 0], lodFadeOut: [72, 96] },
        { width: 144, depth: 144, spacing: 1.1, baseScale: 0.98, heightScale: 0.38, carpet: true, thatch: true, followPlayer: true, yOffset: 0.026, phaseX: 0.5, phaseZ: 0.5, tileSize: 12, maxDistance: 52, densityScale: 0.58, segments: 3, lodFadeIn: [0, 0], lodFadeOut: [39, 54] },
        { width: 79.3338, depth: 79.3338, spacing: 0.72, baseScale: 0.8, heightScale: 0.18, carpet: true, thatch: true, footLayer: true, followPlayer: true, yOffset: 0.055, phaseX: 0.25, phaseZ: 0.25, tileSize: 5.6667, maxDistance: 28, densityScale: 0.56, segments: 3, lodFadeIn: [0, 0], lodFadeOut: [21, 30] }
      ]
    : [
        // These dimensions are exact tile multiples. A tile can only recycle
        // beyond the LOD's fade-out radius, eliminating directional page pops.
        { width: 750, depth: 750, spacing: 6.0, baseScale: 0.9, heightScale: 0.6, carpet: true, followPlayer: true, tileSize: 62.5, maxDistance: 274, densityScale: 0.46, segments: 3, lodFadeIn: [156, 186], lodFadeOut: [240, 274] },
        { width: 525, depth: 525, spacing: 3.35, baseScale: 0.86, heightScale: 0.8, carpet: true, followPlayer: true, tileSize: 43.75, maxDistance: 184, densityScale: 0.58, segments: 3, followsHighDensity: true, lodFadeIn: [72, 96], lodFadeOut: [156, 186] },
        { width: 332.5, depth: 332.5, spacing: 1.4, baseScale: 1.18, heightScale: 1.24, carpet: true, followPlayer: true, tileSize: 23.75, maxDistance: 94, densityScale: 0.76, segments: 4, highDensity: true, lodFadeIn: [0, 0], lodFadeOut: [72, 96] },
        { width: 184, depth: 184, spacing: 1.08, baseScale: 1.0, heightScale: 0.4, carpet: true, thatch: true, followPlayer: true, yOffset: 0.026, phaseX: 0.5, phaseZ: 0.5, tileSize: 11.5, maxDistance: 68, densityScale: 0.58, segments: 3, lodFadeIn: [0, 0], lodFadeOut: [50, 70] },
        { width: 93.3338, depth: 93.3338, spacing: 0.7, baseScale: 0.82, heightScale: 0.19, carpet: true, thatch: true, footLayer: true, followPlayer: true, yOffset: 0.055, phaseX: 0.25, phaseZ: 0.25, tileSize: 6.6667, maxDistance: 34, densityScale: 0.56, segments: 3, lodFadeIn: [0, 0], lodFadeOut: [25, 36] }
      ];

  layers.forEach((layer) => {
    layer.depth = layer.depth || layer.zMax - layer.zMin || layer.width;
    layer.segmentCount = chooseGrassTileSegmentCount(layer);
    const material = createFluffyGrassMaterial(layer);
    grassMaterials.push(material);
    scene.add(createGrassFieldLayer(geometryBySegmentCount, material, layer));
  });
  createDistantGrassBillboards(isMobile);
}

function createProceduralBladeGeometry(segments) {
  // Two crossed cards preserve the fluffy silhouette while cutting one third
  // of grass vertex work before the per-blade shader runs.
  const planeCount = 2;
  const positions = [];
  const normals = [];
  const uvs = [];
  const indices = [];

  for (let plane = 0; plane < planeCount; plane += 1) {
    const angle = (plane / planeCount) * Math.PI;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const baseVertex = positions.length / 3;

    for (let i = 0; i <= segments; i += 1) {
      const t = i / segments;
      const halfWidth = 2.4;
      const h = t * 0.662;

      positions.push(-halfWidth * cosA, h, -halfWidth * sinA);
      normals.push(sinA, 0.2, -cosA);
      uvs.push(0, 1 - t);

      positions.push(halfWidth * cosA, h, halfWidth * sinA);
      normals.push(sinA, 0.2, -cosA);
      uvs.push(1, 1 - t);
    }

    for (let i = 0; i < segments; i += 1) {
      const base = baseVertex + i * 2;
      indices.push(base, base + 1, base + 2);
      indices.push(base + 1, base + 3, base + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();

  return geometry;
}

function createGrassFieldLayer(geometryBySegmentCount, material, layer) {
  const depth = layer.depth || layer.zMax - layer.zMin;
  const group = new THREE.Group();
  const center = getGrassLayerCenter(layer);
  const tileSize = layer.tileSize || 24;
  const tileColumns = Math.ceil(layer.width / tileSize);
  const tileRows = Math.ceil(depth / tileSize);
  const layerWindow = getGrassLayerWindow(layer);
  const originPageX = layer.followPlayer ? layerWindow.originPageX : 0;
  const originPageZ = layer.followPlayer ? layerWindow.originPageZ : 0;
  const tiles = [];

  for (let tileRow = 0; tileRow < tileRows; tileRow += 1) {
    for (let tileColumn = 0; tileColumn < tileColumns; tileColumn += 1) {
      const tileWidth = layer.followPlayer ? tileSize : Math.min(tileSize, layer.width - tileColumn * tileSize);
      const tileDepth = layer.followPlayer ? tileSize : Math.min(tileSize, depth - tileRow * tileSize);
      const columns = Math.max(1, Math.ceil(tileWidth / layer.spacing));
      const rows = Math.max(1, Math.ceil(tileDepth / layer.spacing));
      const count = columns * rows;
      const segmentCount = layer.segmentCount || chooseGrassTileSegmentCount(layer);
      const geometry = getGrassGeometryForSegments(geometryBySegmentCount, segmentCount);
      const grass = new THREE.InstancedMesh(geometry, material, count);
      const tile = {
        layer,
        mesh: grass,
        lod: segmentCount,
        lodDensityScale: getGrassTileDensityScale(segmentCount),
        columns,
        rows,
        tileColumn,
        tileRow,
        tileWidth,
        tileDepth,
        tileStartX: -layer.width * 0.5 + tileColumn * tileSize,
        tileStartZ: (layer.followPlayer ? -depth * 0.5 : layer.zMin) + tileRow * tileSize,
        pageX: layer.followPlayer ? originPageX + tileColumn : 0,
        pageZ: layer.followPlayer ? originPageZ + tileRow : 0,
        centerX: 0,
        centerZ: 0,
        radius: Math.hypot(tileWidth, tileDepth) * 0.5 + 8
      };

      grass.frustumCulled = false;
      grass.userData.maxCount = count;
      grass.userData.verticesPerInstance = geometry.attributes.position.count;
      populateGrassTile(tile, center.x, center.z);
      grassDrawLayers.push(tile);
      tiles.push(tile);
      group.add(grass);
    }
  }

  if (layer.followPlayer) {
    followGrassLayers.push({
      layer,
      group,
      tiles,
      tileColumns,
      tileRows,
      originPageX,
      originPageZ,
      centerX: center.x,
      centerZ: center.z
    });
  }

  return group;
}

function createDistantGrassBillboards(isMobile) {
  const geometry = createDistantGrassGeometry();
  distantGrassMaterial = new THREE.MeshBasicMaterial({
    color: new THREE.Color(sceneSettings.grassTipColorB).lerp(new THREE.Color(sceneSettings.grassTipColorA), 0.34),
    alphaMap: grassAlphaTexture,
    alphaTest: 0.22,
    transparent: false,
    side: THREE.DoubleSide,
    fog: true,
    depthWrite: true
  });

  distantGrass = new THREE.InstancedMesh(geometry, distantGrassMaterial, isMobile ? 900 : 1800);
  distantGrass.frustumCulled = false;
  distantGrass.userData.radius = isMobile ? 520 : 760;
  distantGrass.userData.innerRadius = isMobile ? 170 : 250;
  distantGrass.userData.snap = 80;
  distantGrass.userData.maxCount = distantGrass.count;
  scene.add(distantGrass);
  updateDistantGrass(true);
}

function createDistantGrassGeometry() {
  const halfWidth = 1.8;
  const height = 2.4;
  const positions = [];
  const uvs = [];
  const indices = [];

  for (let plane = 0; plane < 2; plane += 1) {
    const angle = plane * Math.PI * 0.5 + Math.PI * 0.25;
    const cosA = Math.cos(angle);
    const sinA = Math.sin(angle);
    const base = positions.length / 3;
    const xA = cosA * halfWidth;
    const zA = sinA * halfWidth;

    positions.push(-xA, 0, -zA, xA, 0, zA, xA, height, zA, -xA, height, -zA);
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function updateDistantGrass(force = false) {
  if (!distantGrass) {
    return;
  }

  const snap = distantGrass.userData.snap;
  const snapX = Math.round(player.position.x / snap) * snap;
  const snapZ = Math.round(player.position.z / snap) * snap;

  if (!force && snapX === lastDistantGrassSnapX && snapZ === lastDistantGrassSnapZ) {
    return;
  }

  lastDistantGrassSnapX = snapX;
  lastDistantGrassSnapZ = snapZ;
  distantGrass.position.set(snapX, 0, snapZ);

  const dummy = new THREE.Object3D();
  const radius = distantGrass.userData.radius;
  const innerRadius = distantGrass.userData.innerRadius;
  const count = distantGrass.userData.maxCount;
  let activeCount = 0;

  for (let i = 0; i < count; i += 1) {
    const gridX = Math.floor(i * 73.13);
    const gridZ = Math.floor(i * 41.79);
    const randomA = stableGrassRandom(gridX, gridZ, 101);
    const randomB = stableGrassRandom(gridX, gridZ, 103);
    const randomC = stableGrassRandom(gridX, gridZ, 107);
    const randomD = stableGrassRandom(gridX, gridZ, 109);
    const angle = randomA * Math.PI * 2;
    const distance = innerRadius + Math.sqrt(randomB) * (radius - innerRadius);
    const x = Math.cos(angle) * distance + (randomC - 0.5) * 22;
    const z = Math.sin(angle) * distance + (randomD - 0.5) * 22;
    const worldX = snapX + x;
    const worldZ = snapZ + z;
    const fade = smoothstep(innerRadius, innerRadius + 120, distance) * (1 - smoothstep(radius - 120, radius, distance));
    const scale = fade * (1.25 + stableGrassRandom(gridX, gridZ, 113) * 1.35);

    if (scale <= 0.03) {
      continue;
    }

    dummy.position.set(x, terrainHeight(worldX, worldZ) + 0.02, z);
    dummy.rotation.set(0, stableGrassRandom(gridX, gridZ, 127) * Math.PI * 2, 0);
    dummy.scale.setScalar(scale);
    dummy.updateMatrix();
    distantGrass.setMatrixAt(activeCount, dummy.matrix);
    activeCount += 1;
  }

  distantGrass.count = activeCount;
  distantGrass.instanceMatrix.needsUpdate = true;
}

function getGrassGeometryForSegments(geometryBySegmentCount, segmentCount) {
  if (grassGLBGeometry && segmentCount >= 7) {
    return grassGLBGeometry;
  }

  if (!geometryBySegmentCount.has(segmentCount)) {
    geometryBySegmentCount.set(segmentCount, createProceduralBladeGeometry(segmentCount));
  }

  return geometryBySegmentCount.get(segmentCount);
}

function chooseGrassTileSegmentCount(layer) {
  if (layer.segments >= 7) {
    return 7;
  }

  if (layer.segments >= 5) {
    return 5;
  }

  if (layer.segments >= 4) {
    return 4;
  }

  return 3;
}

function getGrassTileDensityScale(segmentCount) {
  if (segmentCount >= 7) {
    return 1;
  }

  if (segmentCount >= 5) {
    return 0.94;
  }

  return 0.86;
}

function populateGrassTile(tile, centerX, centerZ) {
  const { layer, mesh: grass, columns, rows } = tile;
  const depth = layer.depth || layer.zMax - layer.zMin;
  const tileSize = layer.tileSize || 24;
  const worldTileStartX = layer.followPlayer ? tile.pageX * tileSize : tile.tileStartX;
  const worldTileStartZ = layer.followPlayer ? tile.pageZ * tileSize : tile.tileStartZ;
  const startColumn = Math.floor(worldTileStartX / layer.spacing);
  const startRow = Math.floor(worldTileStartZ / layer.spacing);
  grass.position.set(worldTileStartX, 0, worldTileStartZ);
  const dummy = new THREE.Object3D();
  const normal = new THREE.Vector3();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const alignQuaternion = new THREE.Quaternion();
  const randomQuaternion = new THREE.Quaternion();
  const randomRotation = new THREE.Euler();
  let activeIndex = 0;
  tile.centerX = worldTileStartX + tile.tileWidth * 0.5;
  tile.centerZ = worldTileStartZ + tile.tileDepth * 0.5;

  for (let i = 0; i < columns * rows; i += 1) {
    const column = i % columns;
    const row = Math.floor(i / columns);
    const worldColumn = startColumn + column;
    const worldRow = startRow + row;
    const stagger = layer.carpet && Math.abs(worldRow) % 2 === 1 ? 0.5 : 0;
    const phaseX = layer.phaseX || 0;
    const phaseZ = layer.phaseZ || 0;
    const stableA = stableGrassRandom(worldColumn, worldRow, 1);
    const stableB = stableGrassRandom(worldColumn, worldRow, 2);
    const stableC = stableGrassRandom(worldColumn, worldRow, 3);
    const stableD = stableGrassRandom(worldColumn, worldRow, 4);
    const stableE = stableGrassRandom(worldColumn, worldRow, 5);
    const useStable = layer.followPlayer || layer.stable;
    const randomA = useStable ? stableA : random();
    const randomB = useStable ? stableB : random();
    const randomC = useStable ? stableC : random();
    const randomD = useStable ? stableD : random();
    const randomE = useStable ? stableE : random();
    const cellNoiseX = layer.carpet ? (stableGrassValueNoise(worldColumn * 0.73, worldRow * 0.73, 23) - 0.5) * 0.2 : 0;
    const cellNoiseZ = layer.carpet ? (stableGrassValueNoise(worldColumn * 0.73, worldRow * 0.73, 29) - 0.5) * 0.2 : 0;
    const cellX = layer.carpet ? randomA + stagger * 0.18 + phaseX + cellNoiseX : randomA;
    const cellZ = layer.carpet ? randomB + phaseZ + cellNoiseZ : randomB;
    const jitterAmount = layer.footLayer ? 0.03 : layer.thatch ? 0.06 : layer.carpet ? 0.08 : 0.72;
    const jitterX = (randomC - 0.5) * layer.spacing * jitterAmount;
    const jitterZ = (randomD - 0.5) * layer.spacing * jitterAmount;
    const warpStrength = layer.carpet ? layer.spacing * (layer.footLayer ? 0.08 : layer.thatch ? 0.24 : 0.48) : 0;
    const warpX = (stableGrassFractalNoise(worldColumn * 0.16, worldRow * 0.16, 11) - 0.5) * warpStrength;
    const warpZ = (stableGrassFractalNoise(worldColumn * 0.16, worldRow * 0.16, 17) - 0.5) * warpStrength;
    const x = (worldColumn + cellX) * layer.spacing + jitterX + warpX;
    const z = (worldRow + cellZ) * layer.spacing + jitterZ + warpZ;

    if (x < worldTileStartX - layer.spacing || x > worldTileStartX + tile.tileWidth + layer.spacing || z < worldTileStartZ - layer.spacing || z > worldTileStartZ + tile.tileDepth + layer.spacing) {
      continue;
    }

    const y = terrainHeight(x, z) + (layer.yOffset || 0.012);
    const distanceFromCenter = Math.hypot(x - centerX, z - centerZ);
    const tileColumn = Math.floor(x / tileSize);
    const tileRow = Math.floor(z / tileSize);
    const tileRandom = stableGrassRandom(tileColumn, tileRow, 41);
    const tileDistance = Math.hypot((tileColumn + 0.5) * tileSize - centerX, (tileRow + 0.5) * tileSize - centerZ);
    const edgeFadeStart = layer.edgeFadeStart || 0.86;
    const edgeScale = layer.maxDistance ? Math.max(0.18, 1 - smoothstep(layer.maxDistance * edgeFadeStart, layer.maxDistance, tileDistance) * 0.28) : 1;
    const densityVariation = 0.78 + tileRandom * 0.22;
    const layerDensityScale = layer.densityScale === undefined ? 1 : layer.densityScale;
    const tileDensity = Math.max(0, densityVariation * tile.lodDensityScale * layerDensityScale);
    const distanceCull = tileDensity <= 0.001 || stableGrassRandom(worldColumn, worldRow, 43) > tileDensity;

    if (distanceCull) {
      continue;
    }

    const footLayerFade = layer.footLayer ? 1 - smoothstep(Math.min(layer.width, depth) * 0.32, Math.min(layer.width, depth) * 0.5, distanceFromCenter) : 1;
    const densityFade = tileDensity * edgeScale;
    const widthScale = layer.baseScale * footLayerFade * densityFade * (layer.thatch ? 0.95 + randomE * 0.36 : 0.72 + randomE * 0.4);
    const heightScale = layer.heightScale * footLayerFade * densityFade * (layer.thatch ? 0.86 + stableGrassRandom(worldColumn, worldRow, 6) * 0.28 : 0.92 + Math.pow(stableGrassRandom(worldColumn, worldRow, 7), 1.45) * 0.46);

    if (widthScale <= 0.0001 || heightScale <= 0.0001) {
      continue;
    }

    terrainNormal(x, z, normal);
    alignQuaternion.setFromUnitVectors(yAxis, normal);
    randomRotation.set(0, stableGrassRandom(worldColumn, worldRow, 8) * Math.PI * 2, 0);
    randomQuaternion.setFromEuler(randomRotation);
    dummy.quaternion.copy(alignQuaternion).multiply(randomQuaternion);
    dummy.position.set(x - worldTileStartX, y, z - worldTileStartZ);
    dummy.scale.set(widthScale, heightScale, widthScale);
    dummy.updateMatrix();
    grass.setMatrixAt(activeIndex, dummy.matrix);
    activeIndex += 1;
  }

  grass.count = activeIndex;
  grass.userData.activeCount = activeIndex;
  grass.instanceMatrix.needsUpdate = true;
  tile.pending = false;
}

function stableGrassRandom(column, row, salt) {
  const value = Math.sin(column * 127.1 + row * 311.7 + salt * 74.7) * 43758.5453123;

  return value - Math.floor(value);
}

function smoothstep(edge0, edge1, value) {
  const x = THREE.MathUtils.clamp((value - edge0) / (edge1 - edge0), 0, 1);

  return x * x * (3 - 2 * x);
}

function stableGrassValueNoise(x, z, salt) {
  const x0 = Math.floor(x);
  const z0 = Math.floor(z);
  const xf = x - x0;
  const zf = z - z0;
  const u = xf * xf * (3 - 2 * xf);
  const v = zf * zf * (3 - 2 * zf);
  const a = stableGrassRandom(x0, z0, salt);
  const b = stableGrassRandom(x0 + 1, z0, salt);
  const c = stableGrassRandom(x0, z0 + 1, salt);
  const d = stableGrassRandom(x0 + 1, z0 + 1, salt);
  const xMixA = a + (b - a) * u;
  const xMixB = c + (d - c) * u;

  return xMixA + (xMixB - xMixA) * v;
}

function stableGrassFractalNoise(x, z, salt) {
  const broad = stableGrassValueNoise(x, z, salt) * 0.58;
  const mid = stableGrassValueNoise(x * 2.17 + 19.1, z * 2.17 - 8.4, salt + 31) * 0.3;
  const fine = stableGrassValueNoise(x * 4.03 - 5.7, z * 4.03 + 14.2, salt + 67) * 0.12;

  return broad + mid + fine;
}

function getGrassLayerCenter(layer) {
  if (!layer.followPlayer) {
    return { x: 0, z: 0 };
  }

  return {
    x: player.position.x,
    z: player.position.z
  };
}

function getGrassLayerWindow(layer) {
  if (!layer.followPlayer) {
    return {
      originPageX: 0,
      originPageZ: 0,
      centerX: 0,
      centerZ: 0
    };
  }

  const depth = layer.depth || layer.zMax - layer.zMin;
  const tileSize = layer.tileSize || 24;

  return {
    originPageX: Math.floor((player.position.x - layer.width * 0.5) / tileSize),
    originPageZ: Math.floor((player.position.z - depth * 0.5) / tileSize),
    centerX: player.position.x,
    centerZ: player.position.z
  };
}

function updateFollowGrassLayers() {
  followGrassLayers.forEach((entry) => {
    const layerWindow = getGrassLayerWindow(entry.layer);

    if (layerWindow.originPageX === entry.originPageX && layerWindow.originPageZ === entry.originPageZ) {
      entry.centerX = layerWindow.centerX;
      entry.centerZ = layerWindow.centerZ;
      return;
    }

    const desiredPages = new Map();
    for (let row = 0; row < entry.tileRows; row += 1) {
      for (let column = 0; column < entry.tileColumns; column += 1) {
        const pageX = layerWindow.originPageX + column;
        const pageZ = layerWindow.originPageZ + row;
        desiredPages.set(`${pageX},${pageZ}`, { pageX, pageZ });
      }
    }

    const keptPages = new Set();
    const freeTiles = [];
    entry.tiles.forEach((tile) => {
      const key = `${tile.pageX},${tile.pageZ}`;
      if (desiredPages.has(key) && !keptPages.has(key)) {
        keptPages.add(key);
        return;
      }

      freeTiles.push(tile);
    });

    const missingPages = [];
    desiredPages.forEach((page, key) => {
      if (keptPages.has(key)) return;

      const tileSize = entry.layer.tileSize || 24;
      const pageCenterX = (page.pageX + 0.5) * tileSize;
      const pageCenterZ = (page.pageZ + 0.5) * tileSize;
      missingPages.push({
        ...page,
        priority: Math.hypot(pageCenterX - player.position.x, pageCenterZ - player.position.z)
      });
    });

    missingPages.sort((a, b) => a.priority - b.priority);
    freeTiles.forEach((tile, index) => {
      const page = missingPages[index];
      if (!page) return;

      tile.pageX = page.pageX;
      tile.pageZ = page.pageZ;
      populateGrassTile(tile, layerWindow.centerX, layerWindow.centerZ);
    });

    entry.originPageX = layerWindow.originPageX;
    entry.originPageZ = layerWindow.originPageZ;
    entry.centerX = layerWindow.centerX;
    entry.centerZ = layerWindow.centerZ;
  });
}

function updateGrassLayerVisibility() {
  grassProjectionMatrix.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  grassVisibilityFrustum.setFromProjectionMatrix(grassProjectionMatrix);

  let activeInstances = 0;
  let maxInstances = 0;
  let proceduralVertices = 0;
  let visibleTiles = 0;
  const activeTilesByLod = {};
  const visibleTilesByLod = {};
  const activeInstancesByLod = {};

  grassDrawLayers.forEach((entry) => {
    grassLayerCenter.set(entry.centerX, terrainHeight(entry.centerX, entry.centerZ) + 2, entry.centerZ);
    grassLayerSphere.set(grassLayerCenter, entry.radius);

    const cameraDistance = Math.hypot(player.position.x - entry.centerX, player.position.z - entry.centerZ);
    const lodFadeIn = entry.layer.lodFadeIn || [0, 0];
    const lodFadeOut = entry.layer.lodFadeOut || [entry.layer.maxDistance || Infinity, entry.layer.maxDistance || Infinity];
    // Reject complete tiles before issuing a draw. The shader handles the small
    // overlap between bands, so LOD transitions remain invisible at tile edges.
    const qualityFadeIn = entry.layer.followsHighDensity
      ? lodFadeIn[0] * highDensityGrassDistance
      : lodFadeIn[0];
    const qualityFadeOut = entry.layer.highDensity
      ? lodFadeOut[1] * highDensityGrassDistance
      : lodFadeIn[0] === 0
        ? lodFadeOut[1]
        : lodFadeOut[1] * grassQualityDistance;
    const distanceVisible = cameraDistance + entry.radius >= qualityFadeIn
      && cameraDistance - entry.radius <= qualityFadeOut;
    const frustumVisible = grassVisibilityFrustum.intersectsSphere(grassLayerSphere);
    entry.mesh.visible = distanceVisible && frustumVisible && entry.mesh.count > 0;

    maxInstances += entry.mesh.userData.maxCount || 0;
    activeTilesByLod[entry.lod] = (activeTilesByLod[entry.lod] || 0) + 1;

    if (entry.mesh.visible) {
      visibleTiles += 1;
      activeInstances += entry.mesh.count;
      proceduralVertices += entry.mesh.count * entry.mesh.userData.verticesPerInstance;
      visibleTilesByLod[entry.lod] = (visibleTilesByLod[entry.lod] || 0) + 1;
      activeInstancesByLod[entry.lod] = (activeInstancesByLod[entry.lod] || 0) + entry.mesh.count;
    }
  });

  grassStats.activeInstances = activeInstances;
  grassStats.maxInstances = maxInstances;
  grassStats.proceduralBlades = activeInstances * 3;
  grassStats.proceduralVertices = proceduralVertices;
  grassStats.visibleTiles = visibleTiles;
  grassStats.totalTiles = grassDrawLayers.length;
  grassStats.activeTilesByLod = activeTilesByLod;
  grassStats.visibleTilesByLod = visibleTilesByLod;
  grassStats.activeInstancesByLod = activeInstancesByLod;
  window.blissGrassStats = grassStats;
  document.body.dataset.grassStats = JSON.stringify(grassStats);
}

function createFluffyGrassMaterial(layer) {
  const material = new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    transparent: false,
    alphaTest: 0.1,
    uniforms: {
      uTime: { value: 0 },
      uGrassAlphaTexture: { value: grassAlphaTexture },
      uNoiseTexture: { value: grassNoiseTexture },
      uNoiseScale: { value: 1.5 },
      uWindDirection: { value: new THREE.Vector2(1, 1).normalize() },
      uWindStrength: { value: sceneSettings.windStrength },
      uGrassHeightMultiplier: { value: sceneSettings.grassHeight },
      uLodFadeIn: { value: new THREE.Vector2(...(layer.lodFadeIn || [0, 0])) },
      uLodFadeOut: { value: new THREE.Vector2(...(layer.lodFadeOut || [layer.maxDistance || 1000, layer.maxDistance || 1000])) },
      uLodDistanceScale: { value: layer.highDensity ? highDensityGrassDistance : 1 },
      uLodFadeInScale: { value: layer.followsHighDensity ? highDensityGrassDistance : 1 },
      uPlayerPosition: { value: new THREE.Vector2(player.position.x, player.position.z) },
      uCarRight: { value: carRight2D.clone() },
      uCarForward: { value: carForward2D.clone() },
      uGrassFlatteningEnabled: { value: sceneSettings.qualityLevel >= 4 ? 1 : 0 },
      uTrailStampPositionRight: { value: trailStampPositionRightUniforms },
      uTrailStampForwardFade: { value: trailStampForwardFadeUniforms },
      uTrailStampCount: { value: 0 },
      uBaseColor: { value: new THREE.Color(sceneSettings.grassBaseColor) },
      uTipColor1: { value: new THREE.Color(sceneSettings.grassTipColorA) },
      uTipColor2: { value: new THREE.Color(sceneSettings.grassTipColorB) },
      uFogColor: { value: scene.fog.color },
      uFogDensity: { value: scene.fog.density },
      uShadowParams1: { value: new THREE.Vector4(0.0, -0.2, 1.6, 3.2) },
      uShadowParams2: { value: new THREE.Vector3(-0.3, 1.2, 0.25) }
    },
    vertexShader: `
      uniform float uTime;
      uniform sampler2D uNoiseTexture;
      uniform float uNoiseScale;
      uniform vec2 uWindDirection;
      uniform float uWindStrength;
      uniform float uGrassHeightMultiplier;
      uniform vec2 uLodFadeIn;
      uniform vec2 uLodFadeOut;
      uniform float uLodDistanceScale;
      uniform float uLodFadeInScale;
      uniform vec2 uPlayerPosition;
      uniform vec2 uCarRight;
      uniform vec2 uCarForward;
      uniform float uGrassFlatteningEnabled;
      uniform vec4 uTrailStampPositionRight[12];
      uniform vec4 uTrailStampForwardFade[12];
      uniform int uTrailStampCount;
      uniform vec4 uShadowParams1;
      uniform vec3 uShadowParams2;

      varying vec2 vUv;
      varying vec2 vGlobalUv;
      varying vec3 vNormal;
      varying float vHeight;
      varying float vFogDepth;
      varying float vBladeFade;
      varying float vLodDither;
      varying float vCrushAmount;
      varying float vShadowAmount;

      float hash12(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }

      void main() {
        // Get instance origin in world space (super fast translation extraction)
        vec4 instanceOrigin = modelMatrix * vec4(instanceMatrix[3].xyz, 1.0);
        
        // We still need distance to the car for fading
        vec2 playerDelta = instanceOrigin.xz - uPlayerPosition;
        float playerDistance = length(playerDelta);
        float lodFadeIn = uLodFadeIn.y <= uLodFadeIn.x
          ? 1.0
          : smoothstep(uLodFadeIn.x * uLodFadeInScale, uLodFadeIn.y * uLodFadeInScale, playerDistance);
        float lodFadeOut = uLodFadeOut.y <= uLodFadeOut.x
          ? 1.0
          : smoothstep(uLodFadeOut.x * uLodDistanceScale, uLodFadeOut.y * uLodDistanceScale, playerDistance);
        float lodVisibility = lodFadeIn * (1.0 - lodFadeOut);

        // Avoid the trail, wind and texture work for blades outside this LOD.
        // The dither value is world-stable, so an instance never visibly pops.
        if (lodVisibility < 0.002) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }

        // Global UV for noise sampling based on world position
        vec2 globalUv = (vec2(230.0) - instanceOrigin.xz) / 460.0;

        // Height parameter from UV (GLB convention: uv.y=1 at base, uv.y=0 at tip)
        float heightFactor = 1.0 - uv.y;

        // ============================================================================
        // START GRASS DISPLACEMENT LOGIC (SHADER)
        // ============================================================================
        // --- TRAIL AND CAR FLATTENING ---
        float maxPush = 0.0;
        vec2 bestPushDir = vec2(0.0);
        
        vec2 localBladePos = vec2(
          dot(playerDelta, uCarRight),
          dot(playerDelta, uCarForward)
        );
        
        vec2 d = abs(localBladePos) - vec2(1.95, 4.0);
        float sdf = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);

        // --- AMBIENT OCCLUSION SHADOW (OVERCAST) ---
        vec2 shadowLocal = vec2(
          dot(playerDelta, uCarRight) + uShadowParams1.x,
          dot(playerDelta, uCarForward) + uShadowParams1.y 
        );
        vec2 shadowD = abs(shadowLocal) - uShadowParams1.zw;
        float shadowSdf = length(max(shadowD, 0.0)) + min(max(shadowD.x, shadowD.y), 0.0);
        vShadowAmount = 1.0 - smoothstep(uShadowParams2.x, uShadowParams2.y, shadowSdf);

        // Lower quality levels skip deformation entirely. Cull only blades
        // intersecting the full 9.2 x 3.94 car footprint so they cannot poke
        // through the bodywork, including the front and rear overhangs.
        vec2 clipD = abs(localBladePos) - vec2(1.9, 4.45);
        float clipSdf = length(max(clipD, 0.0)) + min(max(clipD.x, clipD.y), 0.0);
        if (uGrassFlatteningEnabled < 0.5 && clipSdf < 0.08) {
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        
        float carPush = uGrassFlatteningEnabled * (1.0 - smoothstep(-0.16, 0.95, sdf));
        if (carPush > maxPush) {
          maxPush = carPush;
          vec2 localPush = normalize(vec2(localBladePos.x, max(abs(localBladePos.y) - 2.4, 0.0) * sign(localBladePos.y)) + vec2(0.0001));
          bestPushDir = normalize(uCarRight * localPush.x + uCarForward * localPush.y);
        }

        for (int i = 0; i < 12; i += 1) {
          if (i >= uTrailStampCount) {
            break;
          }

          vec4 stampPositionRight = uTrailStampPositionRight[i];
          vec4 stampForwardFade = uTrailStampForwardFade[i];
          vec2 stampDelta = instanceOrigin.xz - stampPositionRight.xy;
          vec2 stampRight = normalize(stampPositionRight.zw);
          vec2 stampForward = normalize(stampForwardFade.xy);
          vec2 stampLocal = vec2(
            dot(stampDelta, stampRight),
            dot(stampDelta, stampForward)
          );

          vec2 stampBox = abs(stampLocal) - vec2(2.08, 4.35);
          float stampSdf = length(max(stampBox, 0.0)) + min(max(stampBox.x, stampBox.y), 0.0);
          float bodyCrush = (1.0 - smoothstep(-0.12, 0.82, stampSdf)) * 0.48;
          float rutWidth = abs(abs(stampLocal.x) - 1.54);
          float rutCrush = (1.0 - smoothstep(0.0, 0.34, rutWidth)) * (1.0 - smoothstep(3.8, 4.55, abs(stampLocal.y))) * 0.88;
          float crushed = max(bodyCrush, rutCrush) * stampForwardFade.z;

          if (crushed > maxPush) {
            float side = stampLocal.x < 0.0 ? -1.0 : 1.0;
            maxPush = crushed;
            bestPushDir = normalize(stampRight * side + vec2(0.0001));
          }
        }

        // Transform to world space efficiently
        vec3 localPosition = position;
        vec2 worldBendDir = vec2(0.0);
        float worldPushDist = 0.0;
        
        if (maxPush > 0.0) {
          float flattenFactor = smoothstep(0.0, 1.0, maxPush) * heightFactor;
          worldPushDist = flattenFactor * uGrassHeightMultiplier * 0.92;
          worldBendDir = normalize(bestPushDir + vec2(0.0001));
          localPosition.y *= (1.0 - flattenFactor * 0.9);
        }

        localPosition.y *= uGrassHeightMultiplier;
        vec4 modelPosition = modelMatrix * (instanceMatrix * vec4(localPosition, 1.0));
        modelPosition.xz += worldBendDir * worldPushDist;

        // Wind displacement in world space (FluffyGrass approach)
        vec2 windDirection = normalize(uWindDirection);
        vec4 noise = texture2D(uNoiseTexture, globalUv + uTime * 0.001);
        float sinWave = sin(50.0 * dot(windDirection, globalUv) + noise.g * 5.5 + uTime * 1.0) * 0.1 * uWindStrength * heightFactor;
        modelPosition.x += sinWave;
        modelPosition.z += sinWave;

        // Height variation from noise (FluffyGrass approach)
        modelPosition.y += exp(texture2D(uNoiseTexture, globalUv * uNoiseScale).r) * 0.5 * heightFactor * uGrassHeightMultiplier;

        vec4 viewPosition = viewMatrix * modelPosition;

        vUv = vec2(uv.x, 1.0 - uv.y);
        vGlobalUv = globalUv;
        vNormal = normalize(normalMatrix * mat3(instanceMatrix) * normal);
        vHeight = heightFactor;
        vFogDepth = -viewPosition.z;
        vBladeFade = lodVisibility;
        vLodDither = hash12(floor(instanceOrigin.xz * 3.0));
        vCrushAmount = maxPush;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform sampler2D uGrassAlphaTexture;
      uniform sampler2D uNoiseTexture;
      uniform float uNoiseScale;
      uniform vec3 uBaseColor;
      uniform vec3 uTipColor1;
      uniform vec3 uTipColor2;
      uniform vec3 uShadowParams2;

      varying vec2 vUv;
      varying vec2 vGlobalUv;
      varying vec3 vNormal;
      varying float vHeight;
      varying float vFogDepth;
      varying float vBladeFade;
      varying float vLodDither;
      varying float vCrushAmount;
      varying float vShadowAmount;

      void main() {
        vec4 grassAlpha = texture2D(uGrassAlphaTexture, vUv);
        float alpha = step(0.1, grassAlpha.r) * vBladeFade;

        // Stochastic dither cross-fade: adjacent LOD bands overlap in distance,
        // but each blade has a stable winner rather than an alpha-sorted seam.
        if (alpha < 0.04 || vBladeFade < vLodDither) {
          discard;
        }

        vec4 grassVariation = texture2D(uNoiseTexture, vGlobalUv * uNoiseScale);
        vec3 tipColor = mix(uTipColor1, uTipColor2, grassVariation.r);
        vec3 litGrass = mix(uBaseColor, tipColor, clamp(vHeight, 0.0, 1.0));
        float lightAmount = 0.96 + max(dot(normalize(vNormal), normalize(vec3(-0.25, 0.9, 0.25))), 0.0) * 0.28;
        
        // Apply sun shadow from the car (uShadowParams2.z is the target darkness)
        lightAmount *= mix(1.0, uShadowParams2.z, vShadowAmount);
        litGrass *= lightAmount;
        
        float crushShade = smoothstep(0.18, 0.86, vCrushAmount);
        litGrass = mix(litGrass, litGrass * vec3(0.55, 0.64, 0.42), crushShade * 0.5);

        float fogFactor = 1.0 - exp(-uFogDensity * uFogDensity * vFogDepth * vFogDepth);
        gl_FragColor = vec4(mix(litGrass, uFogColor, clamp(fogFactor, 0.0, 0.82)), 1.0);
      }
    `
  });
  material.userData.highDensityLayer = Boolean(layer.highDensity);
  material.userData.highDensityTransition = Boolean(layer.followsHighDensity);
  return material;
}

function terrainNormal(x, z, target) {
  const step = 1;
  const heightLeft = terrainHeight(x - step, z);
  const heightRight = terrainHeight(x + step, z);
  const heightBack = terrainHeight(x, z - step);
  const heightForward = terrainHeight(x, z + step);

  return target.set(heightLeft - heightRight, step * 2, heightBack - heightForward).normalize();
}

function resizeScene() {
  const width = window.innerWidth;
  const height = window.innerHeight;

  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setPixelRatio(renderQuality.scale);
  renderer.setSize(width, height, false);
}

function updateDynamicResolution(frameTime) {
  renderQuality.sampleTime += frameTime;
  renderQuality.sampleFrames += 1;

  if (renderQuality.sampleTime < 0.75) {
    return;
  }

  const averageFrameTime = renderQuality.sampleTime / renderQuality.sampleFrames;
  let nextScale = renderQuality.scale;

  // A slow GPU gets an immediate 2x+ pixel-cost escape hatch; when there is
  // headroom, the renderer quietly restores full resolution.
  if (averageFrameTime > 1 / 50) {
    nextScale = Math.max(renderQuality.minScale, renderQuality.scale - 0.05);
  } else if (averageFrameTime < 1 / 66) {
    nextScale = Math.min(renderQuality.maxScale, renderQuality.scale + 0.025);
  }

  renderQuality.sampleTime = 0;
  renderQuality.sampleFrames = 0;

  if (nextScale === renderQuality.scale) {
    return;
  }

  renderQuality.scale = nextScale;
  renderer.setPixelRatio(renderQuality.scale);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  window.blissPerformance = { renderScale: renderQuality.scale, averageFrameTime };
}

function handleKeyDown(event) {
  if (isUiToggleKey(event)) {
    event.preventDefault();
    document.body.classList.toggle("ui-hidden");
    return;
  }

  const movementCode = normalizeMovementCode(event);

  if (isMovementKey(movementCode)) {
    event.preventDefault();
  }

  keys.add(movementCode);
}

function handleKeyUp(event) {
  keys.delete(normalizeMovementCode(event));
}

function isUiToggleKey(event) {
  if (event.repeat || event.ctrlKey || event.metaKey || event.altKey || isEditableTarget(event.target)) {
    return false;
  }

  return event.code === "KeyH" || (event.key || "").toLowerCase() === "h";
}

function isEditableTarget(target) {
  if (!target) {
    return false;
  }

  const tagName = target.tagName;
  return target.isContentEditable || tagName === "INPUT" || tagName === "TEXTAREA" || tagName === "SELECT";
}

function isMovementKey(code) {
  return [
    "KeyW",
    "KeyA",
    "KeyS",
    "KeyD",
    "ArrowUp",
    "ArrowLeft",
    "ArrowDown",
    "ArrowRight",
    "ShiftLeft",
    "ShiftRight"
  ].includes(code);
}

function normalizeMovementCode(event) {
  if (event.code && isMovementKey(event.code)) {
    return event.code;
  }

  const key = (event.key || "").toLowerCase();
  const keyMap = {
    w: "KeyW",
    a: "KeyA",
    s: "KeyS",
    d: "KeyD",
    arrowup: "ArrowUp",
    arrowleft: "ArrowLeft",
    arrowdown: "ArrowDown",
    arrowright: "ArrowRight",
    shift: "ShiftLeft"
  };

  return keyMap[key] || event.code || event.key || "";
}

async function lockPointer() {
  document.body.classList.add("scene-started");
  startBgm();

  if (window.sceneStartedTime === undefined) {
    window.sceneStartedTime = clock.elapsedTime;
  }

  if (!canvas.requestPointerLock || isTouchFirstDevice()) {
    return;
  }

  try {
    await canvas.requestPointerLock();
  } catch {
    document.body.classList.remove("is-locked");
  }
}

async function togglePointerLock() {
  if (isTouchFirstDevice() || !canvas.requestPointerLock) {
    return;
  }

  if (document.pointerLockElement === canvas) {
    document.exitPointerLock();
  } else {
    try {
      await canvas.requestPointerLock();
    } catch {
      document.body.classList.remove("is-locked");
    }
  }
}

function startBgm() {
  if (!bgm || !bgm.paused) {
    return;
  }

  bgm.volume = 0;
  bgm.play().then(() => {
    // Fade in over 3 seconds
    const targetVolume = 0.6;
    const duration = 3000;
    const startTime = performance.now();

    function fadeTick(now) {
      const elapsed = now - startTime;
      bgm.volume = Math.min(1, Math.max(0, (elapsed / duration) * targetVolume));
      if (elapsed < duration) {
        requestAnimationFrame(fadeTick);
      } else if (volumeSlider) {
        volumeSlider.value = String(targetVolume);
        updateVolumeIcon(targetVolume);
      }
    }
    requestAnimationFrame(fadeTick);
  }).catch(() => {
    // Autoplay blocked — silently ignore
  });
}

function isTouchFirstDevice() {
  return window.matchMedia("(pointer: coarse)").matches;
}

function syncPointerLockClass() {
  document.body.classList.toggle("is-locked", document.pointerLockElement === canvas);
}

function handleMouseLook(event) {
  if (document.pointerLockElement !== canvas) {
    return;
  }

  look(event.movementX, event.movementY);
}

function handleCameraZoom(event) {
  event.preventDefault();
  const wheelAmount = THREE.MathUtils.clamp(event.deltaY / 120, -2, 2);
  cameraZoom.targetDistance = THREE.MathUtils.clamp(
    cameraZoom.targetDistance + wheelAmount * 1.1,
    8,
    26
  );
  cameraZoom.targetFov = THREE.MathUtils.clamp(
    cameraZoom.targetFov + wheelAmount * 2.2,
    32,
    72
  );
}

function look(deltaX, deltaY) {
  player.camYawOffset -= deltaX * 0.0021;
  player.camPitchOffset -= deltaY * 0.0021;
  player.camPitchOffset = THREE.MathUtils.clamp(player.camPitchOffset, -1.35, 1.18);
}

function handleTouchStart(event) {
  event.preventDefault();
  document.body.classList.add("scene-started");

  for (const changedTouch of event.changedTouches) {
    const point = new THREE.Vector2(changedTouch.clientX, changedTouch.clientY);

    if (point.x < window.innerWidth * 0.48 && touch.moveId === null) {
      touch.moveId = changedTouch.identifier;
      touch.moveStart.copy(point);
      touch.moveVector.set(0, 0);
    } else if (touch.lookId === null) {
      touch.lookId = changedTouch.identifier;
      touch.lookLast.copy(point);
    }
  }
}

function handleTouchMove(event) {
  event.preventDefault();

  for (const changedTouch of event.changedTouches) {
    const point = new THREE.Vector2(changedTouch.clientX, changedTouch.clientY);

    if (changedTouch.identifier === touch.moveId) {
      touch.moveVector
        .copy(point)
        .sub(touch.moveStart)
        .divideScalar(86)
        .clampScalar(-1, 1);
    }

    if (changedTouch.identifier === touch.lookId) {
      const deltaX = point.x - touch.lookLast.x;
      const deltaY = point.y - touch.lookLast.y;
      touch.lookLast.copy(point);
      look(deltaX, deltaY);
    }
  }
}

function handleTouchEnd(event) {
  event.preventDefault();

  for (const changedTouch of event.changedTouches) {
    if (changedTouch.identifier === touch.moveId) {
      touch.moveId = null;
      touch.moveVector.set(0, 0);
    }

    if (changedTouch.identifier === touch.lookId) {
      touch.lookId = null;
    }
  }
}

function updatePhysics(delta) {
  if (!physicsWorld || !physicsReady) {
    updateFallbackCar(delta);
    updateChaseCamera(delta);
    updateFollowGrassLayers();
    return;
  }

  physicsAccumulator = Math.min(
    physicsAccumulator + delta,
    PHYSICS_FIXED_TIMESTEP * MAX_PHYSICS_STEPS_PER_FRAME
  );

  const vehicleInput = readVehicleInput();
  let physicsSteps = 0;
  while (physicsAccumulator >= PHYSICS_FIXED_TIMESTEP && physicsSteps < MAX_PHYSICS_STEPS_PER_FRAME) {
    if (carBody) {
      const pos = carBody.translation();
      const rot = carBody.rotation();
      previousCarPos.set(pos.x, pos.y, pos.z);
      previousCarQuat.set(rot.x, rot.y, rot.z, rot.w);
    }
    stepVehiclePhysics(vehicleInput, PHYSICS_FIXED_TIMESTEP);
    physicsAccumulator -= PHYSICS_FIXED_TIMESTEP;
    physicsSteps += 1;
  }

  if (physicsSteps === MAX_PHYSICS_STEPS_PER_FRAME) {
    physicsAccumulator = 0;
  }

  syncVehicleFromPhysics(delta, vehicleInput);
  updateChaseCamera(delta);
  updateFollowGrassLayers();
}

function readVehicleInput() {
  let forwardInput = -touch.moveVector.y;
  let sideInput = -touch.moveVector.x;
  let handbrake = false;

  if (keys.has("KeyW") || keys.has("ArrowUp")) forwardInput += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) forwardInput -= 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) sideInput += 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) sideInput -= 1;
  if (keys.has("Space") || keys.has(" ")) handbrake = true;

  return { forwardInput, sideInput, handbrake };
}

function stepVehiclePhysics(vehicleInput, fixedDelta) {
  if (vehicleController && carBody) {
    if (vehicleInput.forwardInput !== 0 || vehicleInput.sideInput !== 0) {
      carBody.wakeUp();
    }

    physicsThrottle += (vehicleInput.forwardInput - physicsThrottle) * Math.min(1, fixedDelta * 7.0);
    const engineForce = physicsThrottle * -4500.0;

    const isCoasting = vehicleInput.forwardInput === 0 && Math.abs(physicsThrottle) < 0.05;
    let brakeForce = isCoasting ? 16.0 : 0.0;
    if (vehicleInput.handbrake) {
      brakeForce = 200.0;
    }
    const steering = vehicleInput.sideInput * 0.4;
    
    updateBrakeLights(vehicleInput.handbrake || vehicleInput.forwardInput < -0.1);

    for (let i = 0; i < 4; i += 1) {
      vehicleController.setWheelEngineForce(i, engineForce);
      vehicleController.setWheelBrake(i, brakeForce);
    }
    vehicleController.setWheelSteering(0, steering);
    vehicleController.setWheelSteering(1, steering);
    vehicleController.setWheelSteering(2, 0);
    vehicleController.setWheelSteering(3, 0);

    vehicleController.updateVehicle(fixedDelta);
  }

  physicsWorld.step();
}

function syncVehicleFromPhysics(delta, vehicleInput) {
  if (!vehicleController || !carBody) {
    return;
  }

  const pos = carBody.translation();
  const rot = carBody.rotation();
  
  // Interpolate based on how much time is left in the accumulator
  const alpha = physicsAccumulator / PHYSICS_FIXED_TIMESTEP;
  
  const currentPos = new THREE.Vector3(pos.x, pos.y, pos.z);
  const currentQuat = new THREE.Quaternion(rot.x, rot.y, rot.z, rot.w);
  
  const visualPos = new THREE.Vector3().copy(previousCarPos).lerp(currentPos, alpha);
  const visualQuat = new THREE.Quaternion().copy(previousCarQuat).slerp(currentQuat, alpha);
  
  if (carGroup) {
    carGroup.position.copy(visualPos);
    carGroup.quaternion.copy(visualQuat);
  }
  
  player.position.copy(visualPos);
  if (typeof carBody.linvel === "function") {
    const velocity = carBody.linvel();
    player.velocity.set(velocity.x, velocity.y, velocity.z);
  }
  
  const euler = new THREE.Euler().setFromQuaternion(visualQuat, "YXZ");
  player.yaw = euler.y;

  if (visualWheels.length === 4) {
    const truckForward = new THREE.Vector3(0, 0, -1).applyQuaternion(carGroup.quaternion);
    const localForwardSpeed = player.velocity.dot(truckForward);
    const throttleSpin = physicsThrottle * 9.5;
    const visualSpinVelocity = -(localForwardSpeed / TRUCK_WHEEL_RADIUS) + throttleSpin;

    for (let i = 0; i < 4; i++) {
      const visualWheel = visualWheels[i];
      const suspensionLength = vehicleController.wheelSuspensionLength(i);
      const wheelSteering = vehicleController.wheelSteering(i);
      visualWheel.userData.spin = (visualWheel.userData.spin || 0) + visualSpinVelocity * delta;
      const minVisualSuspension = TRUCK_FRONT_WHEEL_INDICES.has(i)
        ? TRUCK_FRONT_MIN_VISUAL_SUSPENSION
        : TRUCK_REAR_MIN_VISUAL_SUSPENSION;
      const displayedSuspensionLength = Math.max(suspensionLength, minVisualSuspension);
      if (visualWheel.userData.authoredWheel) {
        const basePosition = visualWheel.userData.basePosition;
        const restLength = visualWheel.userData.restSuspensionLength;
        visualWheel.position.copy(basePosition);
        visualWheel.position.y -= (displayedSuspensionLength - restLength) / CAR_SCALE;
        visualWheel.rotation.set(0, wheelSteering, 0);
        // Tire, rim and disc rotate around the authored axle; brake calipers
        // share steering but remain stationary inside the outer pivot.
        visualWheel.userData.spinPivot.rotation.x = visualWheel.userData.spin;
      } else {
        const connectionPoint = vehicleController.wheelChassisConnectionPointCs(i);
        visualWheel.position.set(
          connectionPoint.x,
          connectionPoint.y - displayedSuspensionLength,
          connectionPoint.z
        );
        visualWheel.rotation.set(visualWheel.userData.spin, wheelSteering + (visualWheel.userData.baseYaw || 0), 0, "YXZ");
      }
    }
  }
}

function updateFallbackCar(delta) {
  if (!carGroup) {
    return;
  }

  let forwardInput = -touch.moveVector.y;
  let sideInput = -touch.moveVector.x;
  let handbrake = keys.has("Space") || keys.has(" ");

  if (keys.has("KeyW") || keys.has("ArrowUp")) forwardInput += 1;
  if (keys.has("KeyS") || keys.has("ArrowDown")) forwardInput -= 1;
  if (keys.has("KeyA") || keys.has("ArrowLeft")) sideInput += 1;
  if (keys.has("KeyD") || keys.has("ArrowRight")) sideInput -= 1;

  carSpeed += forwardInput * carAcceleration * delta;
  
  if (handbrake) {
    carSpeed *= Math.pow(0.1, delta * 60);
  } else {
    carSpeed *= Math.pow(carFriction, delta * 60);
  }
  
  carSpeed = THREE.MathUtils.clamp(carSpeed, -carMaxSpeed * 0.42, carMaxSpeed);
  carSteering += (sideInput * carMaxSteering - carSteering) * Math.min(1, delta * 8);

  updateBrakeLights(handbrake || forwardInput < -0.1);

  if (Math.abs(carSpeed) > 0.05) {
    player.yaw += carSteering * carSpeed * delta;
  }

  forward.set(Math.sin(player.yaw), 0, Math.cos(player.yaw));
  player.velocity.set(forward.x * carSpeed, 0, forward.z * carSpeed);
  player.position.addScaledVector(forward, carSpeed * delta);
  player.position.y = terrainHeight(player.position.x, player.position.z) + 1.2;
  carGroup.position.copy(player.position);
  carGroup.quaternion.setFromEuler(new THREE.Euler(0, player.yaw, 0, "YXZ"));

  visualWheels.forEach((wheel, index) => {
    const steering = index < 2 ? carSteering * 18 : 0;
    if (wheel.userData.authoredWheel) {
      wheel.rotation.set(0, steering, 0);
      wheel.userData.spin = (wheel.userData.spin || 0) - (carSpeed / TRUCK_WHEEL_RADIUS) * delta;
      wheel.userData.spinPivot.rotation.x = wheel.userData.spin;
    } else {
      wheel.rotation.set(clock.elapsedTime * carSpeed * 0.95, steering + (wheel.userData.baseYaw || 0), 0, "YXZ");
    }
  });
}

function updateChaseCamera(delta) {
  const chaseHeight = 4;
  const headingBlend = 1 - Math.exp(-10 * delta);
  const positionBlend = 1 - Math.exp(-7 * delta);
  const targetBlend = 1 - Math.exp(-8 * delta);
  const zoomBlend = 1 - Math.exp(-11 * delta);

  cameraZoom.distance += (cameraZoom.targetDistance - cameraZoom.distance) * zoomBlend;
  cameraZoom.fov += (cameraZoom.targetFov - cameraZoom.fov) * zoomBlend;
  if (Math.abs(camera.fov - cameraZoom.fov) > 0.001) {
    camera.fov = cameraZoom.fov;
    camera.updateProjectionMatrix();
  }
  const chaseDistance = cameraZoom.distance;

  if (carGroup) {
    // Project the interpolated vehicle orientation onto the ground plane.
    // Physics pitch/roll no longer leaks into a chase-camera wobble.
    cameraPlanarForward.set(0, 0, -1).applyQuaternion(carGroup.quaternion);
    cameraPlanarForward.y = 0;
    if (cameraPlanarForward.lengthSq() > 0.0001) {
      cameraPlanarForward.normalize();
      const desiredVehicleYaw = Math.atan2(-cameraPlanarForward.x, -cameraPlanarForward.z);
      if (!cameraFollow.initialized) {
        cameraFollow.vehicleYaw = desiredVehicleYaw;
      } else {
        const shortestTurn = Math.atan2(
          Math.sin(desiredVehicleYaw - cameraFollow.vehicleYaw),
          Math.cos(desiredVehicleYaw - cameraFollow.vehicleYaw)
        );
        cameraFollow.vehicleYaw += shortestTurn * headingBlend;
      }
    }
  } else {
    cameraFollow.vehicleYaw = player.yaw;
  }

  const orbitYaw = cameraFollow.vehicleYaw + player.camYawOffset;
  const horizontalDistance = Math.cos(player.camPitchOffset) * chaseDistance;
  const verticalOffset = Math.sin(player.camPitchOffset) * chaseDistance;

  // The car's origin is at the rear axle. Shift the camera's focus point 
  // forward by 1.8 meters so it rotates around the center of the vehicle.
  const carCenter = new THREE.Vector3().copy(player.position);
  const forwardX = Math.sin(cameraFollow.vehicleYaw);
  const forwardZ = Math.cos(cameraFollow.vehicleYaw);
  carCenter.x -= forwardX * 1.8;
  carCenter.z -= forwardZ * 1.8;

  if (!cameraFollow.lastPos) cameraFollow.lastPos = new THREE.Vector3().copy(player.position);
  if (!cameraFollow.velocity) cameraFollow.velocity = new THREE.Vector3();
  const currentVel = new THREE.Vector3().copy(player.position).sub(cameraFollow.lastPos).divideScalar(Math.max(delta, 0.001));
  cameraFollow.lastPos.copy(player.position);
  cameraFollow.velocity.lerp(currentVel, 1 - Math.exp(-4 * delta));
  
  const aspect = window.innerWidth / window.innerHeight;
  const isPortrait = aspect < 1.0;
  const lookFactor = isPortrait ? 0.08 : 0.12;
  const maxLook = isPortrait ? 4.0 : 6.0;
  
  const lookAhead = cameraFollow.velocity.clone().multiplyScalar(lookFactor);
  if (lookAhead.lengthSq() > maxLook * maxLook) {
    lookAhead.setLength(maxLook);
  }

  cameraDesiredTarget.set(carCenter.x + lookAhead.x, carCenter.y + 1.15, carCenter.z + lookAhead.z);
  cameraDesiredPosition.set(
    carCenter.x + Math.sin(orbitYaw) * horizontalDistance,
    carCenter.y + chaseHeight - verticalOffset,
    carCenter.z + Math.cos(orbitYaw) * horizontalDistance
  );

  const minCameraY = terrainHeight(cameraDesiredPosition.x, cameraDesiredPosition.z) + 0.5;
  if (cameraDesiredPosition.y < minCameraY) {
    cameraDesiredPosition.y = minCameraY;
  }

  if (!cameraFollow.initialized) {
    camera.position.copy(cameraDesiredPosition);
    cameraFollow.target.copy(cameraDesiredTarget);
    cameraFollow.initialized = true;
  } else {
    camera.position.lerp(cameraDesiredPosition, positionBlend);
    cameraFollow.target.lerp(cameraDesiredTarget, targetBlend);
  }

  camera.lookAt(cameraFollow.target);
}

function animateClouds(delta) {
  if (clouds.length > 0) {
    const cloudBox = clouds[0];
    const cloudMat = cloudBox.material;
    
    cloudBox.position.copy(camera.position);

    if (cloudMat && cloudMat.uniforms) {
      cloudMat.uniforms.uTime.value = clock.elapsedTime;
      cloudMat.uniforms.uCameraPos.value.copy(camera.position);
      
      if (cloudMat.uniforms.uTextProgress) {
        if (window.sceneStartedTime !== undefined) {
          cloudMat.uniforms.uTextProgress.value = Math.min(1.1, (clock.elapsedTime - window.sceneStartedTime) / 5.0);
        } else {
          cloudMat.uniforms.uTextProgress.value = 0.0;
        }
      }
      cloudMat.uniforms.uBaseColor.value.set(sceneSettings.fogColor);
      cloudMat.uniforms.uSkyColor.value.set(sceneSettings.skyColor);
    }
  }
}

function animateGrass(time) {
  updateCarDisplacementBasis();

  const grassFlatteningEnabled = sceneSettings.qualityLevel >= 4;

  const dx = player.position.x - lastTrailPoint.x;
  const dz = player.position.z - lastTrailPoint.z;
  
  if (grassFlatteningEnabled && Math.hypot(dx, dz) > TRAIL_STAMP_DISTANCE && carGroup) {
    lastTrailPoint.copy(player.position);
    trailStamps.push({
      x: player.position.x,
      z: player.position.z,
      rightX: carRight2D.x,
      rightZ: carRight2D.y,
      forwardX: carForward2D.x,
      forwardZ: carForward2D.y
    });

    if (trailStamps.length > MAX_SHADER_TRAIL_STAMPS) {
      trailStamps.splice(0, trailStamps.length - MAX_SHADER_TRAIL_STAMPS);
    }
  }

  updateTrailStampUniforms();

  if (terrainMaterial && terrainMaterial.userData.uPlayerPosition) {
    terrainMaterial.userData.uPlayerPosition.value.set(player.position.x, player.position.z);
    terrainMaterial.userData.uCarRight.value.copy(carRight2D);
    terrainMaterial.userData.uCarForward.value.copy(carForward2D);
  }

  grassMaterials.forEach((material) => {
    material.uniforms.uTime.value = time;
    material.uniforms.uPlayerPosition.value.set(player.position.x, player.position.z);
    material.uniforms.uCarRight.value.copy(carRight2D);
    material.uniforms.uCarForward.value.copy(carForward2D);
    material.uniforms.uGrassFlatteningEnabled.value = grassFlatteningEnabled ? 1 : 0;
    material.uniforms.uTrailStampCount.value = grassFlatteningEnabled ? trailStamps.length : 0;
  });
}

function updateCarDisplacementBasis() {
  if (carGroup) {
    carGroup.updateMatrixWorld(true);
    const elements = carGroup.matrixWorld.elements;
    carRight2D.set(elements[0], elements[2]);
    carForward2D.set(elements[8], elements[10]);
  } else {
    carRight2D.set(Math.cos(player.yaw), -Math.sin(player.yaw));
    carForward2D.set(Math.sin(player.yaw), Math.cos(player.yaw));
  }

  if (carRight2D.lengthSq() < 0.0001) {
    carRight2D.set(1, 0);
  } else {
    carRight2D.normalize();
  }

  if (carForward2D.lengthSq() < 0.0001) {
    carForward2D.set(-carRight2D.y, carRight2D.x);
  } else {
    carForward2D.normalize();
  }
}

function updateTrailStampUniforms() {
  const stampCount = trailStamps.length;
  window.blissTrailStats = {
    count: stampCount,
    newest: stampCount > 0 ? trailStamps[stampCount - 1] : null
  };

  for (let i = 0; i < MAX_SHADER_TRAIL_STAMPS; i += 1) {
    const sourceIndex = stampCount - 1 - i;

    if (sourceIndex < 0) {
      trailStampPositionRightUniforms[i].set(0, 0, 1, 0);
      trailStampForwardFadeUniforms[i].set(0, 1, 0, 0);
      continue;
    }

    const stamp = trailStamps[sourceIndex];
    const ageFactor = stampCount <= 1 ? 1 : 1 - i / (MAX_SHADER_TRAIL_STAMPS - 1);
    const fade = 0.28 + 0.72 * smoothstep(0, 1, ageFactor);
    trailStampPositionRightUniforms[i].set(stamp.x, stamp.z, stamp.rightX, stamp.rightZ);
    trailStampForwardFadeUniforms[i].set(stamp.forwardX, stamp.forwardZ, fade, 0);
  }
}

function updateBrakeLights(isBraking) {
  brakeLightMaterials.forEach((m) => {
    if (!m.userData.baseEmissive) {
      m.userData.baseEmissive = m.emissive.clone();
      m.userData.baseColor = m.color.clone();
    }
    if (isBraking) {
      m.emissive.setHex(0xff0000);
      m.color.setHex(0xff0000);
    } else {
      m.emissive.copy(m.userData.baseEmissive);
      m.color.copy(m.userData.baseColor);
    }
  });
}

function updateJoystickUI() {
  const joystickBase = document.getElementById("mobile-joystick-base");
  const joystickThumb = document.getElementById("mobile-joystick-thumb");
  if (!joystickBase || !joystickThumb) return;

  if (touch.moveId !== null) {
    joystickBase.style.display = "block";
    joystickBase.style.left = touch.moveStart.x + "px";
    joystickBase.style.top = touch.moveStart.y + "px";
    joystickBase.style.bottom = "auto";
    
    const thumbX = touch.moveVector.x * 86;
    const thumbY = touch.moveVector.y * 86;
    joystickThumb.style.transform = `translate(calc(-50% + ${thumbX}px), calc(-50% + ${thumbY}px))`;
  } else {
    joystickBase.style.display = "none";
  }
}

function animateCarFade() {
  if (!carVisualRoot) return;
  const progress = (window.sceneStartedTime !== undefined) ? Math.min(1.0, (clock.elapsedTime - window.sceneStartedTime) / 3.0) : 0.0;
  
  carVisualRoot.visible = (progress > 0.0);

  if (carVisualRoot.userData.lastFadeProgress === progress) return;
  carVisualRoot.userData.lastFadeProgress = progress;

  carVisualRoot.traverse((child) => {
    if (child.isMesh && child.material) {
      const materials = Array.isArray(child.material) ? child.material : [child.material];
      materials.forEach((mat) => {
        if (mat.userData.originalOpacity === undefined) {
          mat.userData.originalTransparent = mat.transparent;
          mat.userData.originalOpacity = mat.opacity;
        }

        if (progress < 1.0) {
          if (!mat.transparent) {
            mat.transparent = true;
            mat.needsUpdate = true;
          }
          mat.opacity = mat.userData.originalOpacity * progress;
        } else {
          if (mat.transparent !== mat.userData.originalTransparent) {
            mat.transparent = mat.userData.originalTransparent;
            mat.needsUpdate = true;
          }
          mat.opacity = mat.userData.originalOpacity;
        }
      });
    }
  });
}

function animate() {
  requestAnimationFrame(animate);

  const rawDelta = clock.getDelta();
  const delta = Math.min(rawDelta, 0.05);
  updateDynamicResolution(rawDelta);
  updateFpsMeter(rawDelta);
  updatePhysics(delta);
  updateTerrain();
  updateDistantGrass();
  updateGrassLayerVisibility();
  animateClouds(delta);
  animateGrass(clock.elapsedTime);
  animateCarFade();
  updateJoystickUI();
  renderer.render(scene, camera);
}

function updateFpsMeter(delta) {
  if (!fpsMeter || !fpsValue || !fpsBar) {
    return;
  }

  fpsStats.frames += 1;
  fpsStats.elapsed += delta;

  if (fpsStats.elapsed < 0.25) {
    return;
  }

  fpsStats.displayFps = Math.round(fpsStats.frames / fpsStats.elapsed);
  fpsStats.frames = 0;
  fpsStats.elapsed = 0;

  fpsValue.textContent = fpsStats.displayFps;
  const fpsRatio = Math.min(fpsStats.displayFps / 60, 1);
  fpsBar.style.transform = `scaleX(${fpsRatio})`;
  fpsBar.style.background = fpsStats.displayFps < 30 ? "#ff4444" : fpsStats.displayFps < 50 ? "#ffaa00" : "#44ff44";
}


