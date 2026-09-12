/**
 * Drawing the site.
 *
 * Raw WebGL2, no library. Four passes:
 *
 *   1. the sky, a gradient behind everything;
 *   2. the ground, one mesh, tinted by slope;
 *   3. contact shadows, one instanced disc per plant;
 *   4. the planting, one instanced draw per type.
 *
 * The reason it is instanced rather than one mesh per plant is simply scale: a
 * dense scheme is several thousand plants, and several thousand draw calls
 * costs more than the triangles do. This way the whole site is under a dozen
 * calls whatever is on it.
 *
 * The one piece of real subtlety is the normal transform. Every plant is
 * scaled by its spread in x and z and by its height in y — a non-uniform
 * scale — and normals transformed by that matrix come out skewed, which makes
 * tall plants look lit from the wrong direction. For a rotation R and a
 * diagonal scale S, the correct normal transform is R·S⁻¹, and since the
 * instance matrix already carries R·S, that is the instance matrix applied to
 * the normal divided componentwise by S². Hence the `invSq` attribute.
 */

import { terrainMesh } from '../engine/terrain.js';
import { buildForm, buildingMesh, instanceMatrix } from '../engine/geometry.js';

const SKY_VS = `#version 300 es
in vec2 aClip;
out vec2 vClip;
void main() {
  vClip = aClip;
  gl_Position = vec4(aClip, 0.999999, 1.0);
}`;

const SKY_FS = `#version 300 es
precision highp float;
in vec2 vClip;
uniform vec3 uHigh;
uniform vec3 uLow;
out vec4 oColor;
void main() {
  float t = clamp(vClip.y * 0.5 + 0.5, 0.0, 1.0);
  oColor = vec4(mix(uLow, uHigh, pow(t, 0.7)), 1.0);
}`;

const GROUND_VS = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in float aSlope;
uniform mat4 uViewProjection;
uniform vec4 uPad;          // x, z, width, depth — zero width means no building
out vec3 vNormal;
out float vSlope;
out float vPad;
out float vDepth;
out vec3 vWorld;
void main() {
  vNormal = aNormal;
  vSlope = aSlope;
  vWorld = aPosition;
  float onPad = 0.0;
  if (uPad.z > 0.0) {
    bool inX = aPosition.x >= uPad.x && aPosition.x <= uPad.x + uPad.z;
    bool inZ = aPosition.z >= uPad.y && aPosition.z <= uPad.y + uPad.w;
    onPad = (inX && inZ) ? 1.0 : 0.0;
  }
  vPad = onPad;
  vec4 clip = uViewProjection * vec4(aPosition, 1.0);
  vDepth = clip.w;
  gl_Position = clip;
}`;

const GROUND_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vSlope;
in float vPad;
in float vDepth;
in vec3 vWorld;
uniform vec3 uLightDir;
uniform vec3 uGrass;
uniform vec3 uSteep;
uniform vec3 uHardstanding;
uniform vec3 uSkyLight;
uniform vec3 uBounce;
uniform vec3 uFog;
uniform float uFogStart;
uniform float uFogEnd;
uniform float uSiteSize;
uniform float uSlopeLimit;   // degrees; above this the ground is marked
uniform float uShowSlope;
out vec4 oColor;

void main() {
  vec3 n = normalize(vNormal);

  // Steep ground reads as thinner, stonier cover.
  float steepMix = smoothstep(14.0, 34.0, vSlope);
  vec3 base = mix(uGrass, uSteep, steepMix);
  base = mix(base, uHardstanding, vPad);

  // Optional overlay: ground too steep to plant, marked so it can be seen
  // before painting rather than discovered by a stroke placing nothing.
  if (uShowSlope > 0.5 && vSlope > uSlopeLimit) {
    float edge = smoothstep(uSlopeLimit, uSlopeLimit + 3.0, vSlope);
    base = mix(base, vec3(0.62, 0.34, 0.28), 0.45 * edge);
  }

  // A faint 5 m grid, so slope and scale are readable on a flat site.
  vec2 g = abs(fract(vWorld.xz / 5.0 + 0.5) - 0.5) / max(fwidth(vWorld.xz / 5.0), 1e-5);
  float grid = 1.0 - min(min(g.x, g.y), 1.0);
  base = mix(base, base * 0.88, grid * 0.5);

  float key = max(dot(n, uLightDir), 0.0);
  float hemi = n.y * 0.5 + 0.5;
  vec3 lit = base * (uSkyLight * mix(uBounce / max(uSkyLight, vec3(0.001)), vec3(1.0), hemi) * 0.55 + key * 0.75);

  float fog = clamp((vDepth - uFogStart) / max(uFogEnd - uFogStart, 1.0), 0.0, 1.0);
  oColor = vec4(mix(lit, uFog, fog * 0.75), 1.0);
}`;

const PLANT_VS = `#version 300 es
in vec3 aPosition;
in vec3 aNormal;
in float aPart;
in vec4 aCol0;
in vec4 aCol1;
in vec4 aCol2;
in vec4 aCol3;      // xyz translation, w shade
in vec3 aInvSq;
uniform mat4 uViewProjection;
out vec3 vNormal;
out float vPart;
out float vShade;
out float vDepth;
out float vUp;
void main() {
  mat3 rs = mat3(aCol0.xyz, aCol1.xyz, aCol2.xyz);
  vec3 world = rs * aPosition + aCol3.xyz;
  // R * S^-1 * n, expressed through the matrix we already have.
  vNormal = normalize(rs * (aNormal * aInvSq));
  vPart = aPart;
  vShade = aCol3.w;
  vUp = aPosition.y;
  vec4 clip = uViewProjection * vec4(world, 1.0);
  vDepth = clip.w;
  gl_Position = clip;
}`;

const PLANT_FS = `#version 300 es
precision highp float;
in vec3 vNormal;
in float vPart;
in float vShade;
in float vDepth;
in float vUp;
uniform vec3 uLightDir;
uniform vec3 uCanopy;
uniform vec3 uTrunk;
uniform vec3 uSkyLight;
uniform vec3 uBounce;
uniform vec3 uFog;
uniform float uFogStart;
uniform float uFogEnd;
out vec4 oColor;

void main() {
  vec3 n = normalize(vNormal);
  vec3 base = mix(uCanopy, uTrunk, step(0.5, vPart));
  base *= vShade;
  // Foliage is darker toward the inside of the crown, which is most of what
  // makes a mass of blobs read as a plant rather than as a mass of blobs.
  base *= mix(0.72, 1.06, clamp(vUp, 0.0, 1.0));

  float key = max(dot(n, uLightDir), 0.0);
  float hemi = n.y * 0.5 + 0.5;
  vec3 ambient = mix(uBounce, uSkyLight, hemi);
  vec3 lit = base * (ambient * 0.6 + key * 0.85);

  float fog = clamp((vDepth - uFogStart) / max(uFogEnd - uFogStart, 1.0), 0.0, 1.0);
  oColor = vec4(mix(lit, uFog, fog * 0.75), 1.0);
}`;

const DISC_VS = `#version 300 es
in vec2 aDisc;
in vec4 aAt;        // x, y, z, radius
in vec4 aTint;      // rgb, alpha
uniform mat4 uViewProjection;
uniform float uLift;
uniform float uSoft;
out float vEdge;
out vec4 vTint;
void main() {
  vEdge = length(aDisc);
  vTint = aTint;
  vec3 world = vec3(aAt.x + aDisc.x * aAt.w, aAt.y + uLift, aAt.z + aDisc.y * aAt.w);
  gl_Position = uViewProjection * vec4(world, 1.0);
}`;

const DISC_FS = `#version 300 es
precision highp float;
in float vEdge;
in vec4 vTint;
uniform float uSoft;
out vec4 oColor;
void main() {
  // uSoft sets how far in from the rim the fade starts: a contact shadow is
  // soft all the way through, a planted bed only feathers at its edge.
  float a = (1.0 - smoothstep(uSoft, 1.0, vEdge)) * vTint.a;
  oColor = vec4(vTint.rgb, a);
}`;

const RIBBON_VS = `#version 300 es
in vec3 aPosition;
uniform mat4 uViewProjection;
void main() {
  gl_Position = uViewProjection * vec4(aPosition, 1.0);
}`;

const RIBBON_FS = `#version 300 es
precision highp float;
uniform vec4 uColor;
out vec4 oColor;
void main() { oColor = uColor; }`;

function compile(gl, type, source, label) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`${label} shader failed to compile: ${log}`);
  }
  return shader;
}

function program(gl, vs, fs, label) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, `${label} vertex`));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, `${label} fragment`));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    throw new Error(`${label} program failed to link: ${gl.getProgramInfoLog(p)}`);
  }
  // Every uniform and attribute location, looked up once.
  const uniforms = {};
  const attributes = {};
  const uCount = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < uCount; i += 1) {
    const info = gl.getActiveUniform(p, i);
    uniforms[info.name] = gl.getUniformLocation(p, info.name);
  }
  const aCount = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES);
  for (let i = 0; i < aCount; i += 1) {
    const info = gl.getActiveAttrib(p, i);
    attributes[info.name] = gl.getAttribLocation(p, info.name);
  }
  return { program: p, uniforms, attributes };
}

const hex = (value, fallback = [0.5, 0.5, 0.5]) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(value || '').trim());
  if (!m) return fallback;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

/** A flat disc as a triangle fan, for the contact shadows. */
function discGeometry(segments = 16) {
  const points = [0, 0];
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    points.push(Math.cos(a), Math.sin(a));
  }
  return new Float32Array(points);
}

/**
 * A ribbon along a polyline on the ground, so a line is visible at any zoom.
 * `lift` keeps it just above the surface instead of fighting with it.
 */
export function ribbon(points, width, heightAt, lift = 0.06) {
  const out = [];
  const half = width / 2;
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, z0] = points[i];
    const [x1, z1] = points[i + 1];
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz) || 1;
    const nx = (-dz / len) * half;
    const nz = (dx / len) * half;
    const corners = [
      [x0 + nx, z0 + nz], [x0 - nx, z0 - nz], [x1 - nx, z1 - nz],
      [x0 + nx, z0 + nz], [x1 - nx, z1 - nz], [x1 + nx, z1 + nz],
    ];
    for (const [x, z] of corners) out.push(x, heightAt(x, z) + lift, z);
  }
  return new Float32Array(out);
}

/** A closed ring of points on the ground, for the brush cursor. */
export function ringPoints(cx, cz, radius, segments = 48) {
  const points = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * Math.PI * 2;
    points.push([cx + Math.cos(a) * radius, cz + Math.sin(a) * radius]);
  }
  return points;
}

/**
 * The two palettes.
 *
 * The unplanted ground is deliberately a dry, neutral earth rather than lawn
 * green. It has to be: groundcover is a green almost identical to grass, so on
 * a green site a bed of it is invisible and the tool looks broken. Starting
 * from bare ground also matches what you are actually doing — the site is a
 * plot, and everything green on it is something you put there.
 */
export const PALETTES = {
  light: {
    skyHigh: '#b8cfe0', skyLow: '#e8e4d8',
    grass: '#a89d78', steep: '#bcae8c', hardstanding: '#b9b4aa',
    skyLight: '#cfe0ee', bounce: '#8a8062', fog: '#dcdccf',
    shadow: '#33302a', shadowStrength: 0.3,
    boundary: [0.16, 0.18, 0.14, 0.85], brush: [0.99, 0.98, 0.94, 0.95],
  },
  dark: {
    skyHigh: '#1b2430', skyLow: '#2c2f2c',
    grass: '#5d5741', steep: '#6d654c', hardstanding: '#6a6862',
    skyLight: '#4a5a6c', bounce: '#312d21', fog: '#232a2c',
    shadow: '#05070a', shadowStrength: 0.36,
    boundary: [0.85, 0.88, 0.8, 0.8], brush: [1.0, 0.98, 0.86, 0.95],
  },
};

/**
 * Set up a renderer on a canvas.
 * @returns {object|null} null when WebGL2 is unavailable, so the caller can say so
 */
export function createRenderer(canvas) {
  const gl = canvas.getContext('webgl2', {
    antialias: true,
    alpha: false,
    depth: true,
    preserveDrawingBuffer: true, // so a PNG can be taken after the frame
    powerPreference: 'high-performance',
  });
  if (!gl) return null;

  const programs = {
    sky: program(gl, SKY_VS, SKY_FS, 'sky'),
    ground: program(gl, GROUND_VS, GROUND_FS, 'ground'),
    plant: program(gl, PLANT_VS, PLANT_FS, 'plant'),
    disc: program(gl, DISC_VS, DISC_FS, 'disc'),
    ribbon: program(gl, RIBBON_VS, RIBBON_FS, 'ribbon'),
  };

  const buffer = (data, target = gl.ARRAY_BUFFER, usage = gl.STATIC_DRAW) => {
    const b = gl.createBuffer();
    gl.bindBuffer(target, b);
    gl.bufferData(target, data, usage);
    return b;
  };

  // ---- Static geometry ---------------------------------------------------

  const skyQuad = buffer(new Float32Array([-1, -1, 3, -1, -1, 3]));
  const disc = buffer(discGeometry());
  const discCount = discGeometry().length / 2;

  const forms = new Map();
  const formFor = (name) => {
    if (!forms.has(name)) {
      const mesh = buildForm(name);
      forms.set(name, {
        mesh,
        position: buffer(mesh.positions),
        normal: buffer(mesh.normals),
        part: buffer(mesh.parts),
        index: buffer(mesh.indices, gl.ELEMENT_ARRAY_BUFFER),
      });
    }
    return forms.get(name);
  };

  // ---- Mutable scene state ----------------------------------------------

  const scene = {
    terrain: null,
    ground: null,
    building: null,
    batches: [],
    shadows: null,
    shadowCount: 0,
    beds: null,
    bedCount: 0,
    boundary: null,
    boundaryCount: 0,
    brush: null,
    brushCount: 0,
  };

  let palette = PALETTES.light;
  let size = { width: 1, height: 1, dpr: 1 };

  function setPalette(name) {
    palette = PALETTES[name] || PALETTES.light;
  }

  function resize(cssWidth, cssHeight, dpr = 1) {
    // Capped: on a 3x display a full-window canvas is 25 megapixels, and the
    // cost is entirely wasted on a scene with no fine detail in it.
    const scale = Math.min(dpr, 2);
    const w = Math.max(1, Math.round(cssWidth * scale));
    const h = Math.max(1, Math.round(cssHeight * scale));
    if (canvas.width !== w) canvas.width = w;
    if (canvas.height !== h) canvas.height = h;
    size = { width: cssWidth, height: cssHeight, dpr: scale };
    return size;
  }

  function setTerrain(terrain, { buildingHeight = 7 } = {}) {
    scene.terrain = terrain;
    const mesh = terrainMesh(terrain);
    scene.ground = {
      count: mesh.indices.length,
      position: buffer(mesh.positions),
      normal: buffer(mesh.normals),
      slope: buffer(mesh.slopes),
      index: buffer(mesh.indices, gl.ELEMENT_ARRAY_BUFFER),
    };

    const bm = terrain.pad ? buildingMesh(terrain.pad, buildingHeight) : null;
    scene.building = bm
      ? {
        count: bm.indices.length,
        position: buffer(bm.positions),
        normal: buffer(bm.normals),
        part: buffer(bm.parts),
        index: buffer(bm.indices, gl.ELEMENT_ARRAY_BUFFER),
      }
      : null;

    // The site boundary, following the ground.
    const s = terrain.size;
    const edge = [];
    const step = s / 40;
    for (let x = 0; x <= s; x += step) edge.push([x, 0]);
    for (let z = 0; z <= s; z += step) edge.push([s, z]);
    for (let x = s; x >= 0; x -= step) edge.push([x, s]);
    for (let z = s; z >= 0; z -= step) edge.push([0, z]);
    edge.push([0, 0]);
    const strip = ribbon(edge, Math.max(0.12, s / 400), (x, z) => heightOf(terrain, x, z), 0.08);
    scene.boundary = buffer(strip);
    scene.boundaryCount = strip.length / 3;
  }

  const heightOf = (terrain, x, z) => {
    // Local copy of the bilinear read, to avoid importing it just for this.
    const { res, heights } = terrain;
    const st = terrain.size / res;
    const fx = Math.max(0, Math.min(res, x / st));
    const fz = Math.max(0, Math.min(res, z / st));
    const i = Math.min(res - 1, Math.floor(fx));
    const j = Math.min(res - 1, Math.floor(fz));
    const tx = fx - i;
    const tz = fz - j;
    const row = res + 1;
    const a = heights[j * row + i] + (heights[j * row + i + 1] - heights[j * row + i]) * tx;
    const b = heights[(j + 1) * row + i] + (heights[(j + 1) * row + i + 1] - heights[(j + 1) * row + i]) * tx;
    return a + (b - a) * tz;
  };

  /**
   * Rebuild the instance buffers.
   *
   * Called on every stroke, so it allocates once per type rather than once per
   * plant. A dense scheme is tens of thousands of plants and this still runs in
   * a few milliseconds.
   */
  function setInstances(instances, speciesOf) {
    for (const batch of scene.batches) gl.deleteBuffer(batch.instance);
    scene.batches = [];
    for (const layer of ['shadows', 'beds']) {
      if (scene[layer]) {
        gl.deleteBuffer(scene[layer]);
        scene[layer] = null;
      }
    }
    scene.shadowCount = 0;
    scene.bedCount = 0;
    if (!instances.length) return;

    const byKey = new Map();
    for (const inst of instances) {
      const list = byKey.get(inst.key);
      if (list) list.push(inst);
      else byKey.set(inst.key, [inst]);
    }

    // Two flat layers on the ground, both drawn as discs:
    //
    //  - beds, in the planting's own colour, for groundcover. Seven hundred
    //    tufts 0.3 m tall are sub-pixel from a site-wide view, so without this
    //    a lawn or a bed of groundcover is invisible at the only zoom most
    //    people will look at. A landscape plan draws these as areas too.
    //  - contact shadows, dark, under everything that stands up, which is what
    //    settles a plant onto the ground rather than leaving it hovering.
    const shadowData = [];
    const bedData = [];
    const shadowTint = hex(palette.shadow);
    for (const inst of instances) {
      const species = speciesOf(inst.key);
      if (!species) continue;
      if (species.category === 'ground') {
        const c = hex(species.canopy);
        bedData.push(
          inst.x, inst.y, inst.z, Math.max(0.3, inst.spread * 0.85),
          c[0], c[1], c[2], 0.9,
        );
      }
      if (species.category === 'hard') continue;
      shadowData.push(
        inst.x, inst.y, inst.z, Math.max(0.25, inst.spread * 0.62),
        shadowTint[0], shadowTint[1], shadowTint[2], palette.shadowStrength,
      );
    }
    if (bedData.length) {
      scene.beds = buffer(new Float32Array(bedData));
      scene.bedCount = bedData.length / 8;
    }
    if (shadowData.length) {
      scene.shadows = buffer(new Float32Array(shadowData));
      scene.shadowCount = shadowData.length / 8;
    }

    for (const [key, group] of byKey) {
      const species = speciesOf(key);
      if (!species) continue;
      // 19 floats per instance: three matrix columns, translation + shade,
      // and the inverse square scale for the normal transform.
      const stride = 19;
      const data = new Float32Array(group.length * stride);
      for (let i = 0; i < group.length; i += 1) {
        const inst = group[i];
        const m = instanceMatrix(inst);
        const at = i * stride;
        data[at] = m[0]; data[at + 1] = m[1]; data[at + 2] = m[2]; data[at + 3] = 0;
        data[at + 4] = m[4]; data[at + 5] = m[5]; data[at + 6] = m[6]; data[at + 7] = 0;
        data[at + 8] = m[8]; data[at + 9] = m[9]; data[at + 10] = m[10]; data[at + 11] = 0;
        data[at + 12] = m[12]; data[at + 13] = m[13]; data[at + 14] = m[14];
        data[at + 15] = inst.shade ?? 1;
        const sx = inst.spread || 1;
        const sy = inst.height || 1;
        data[at + 16] = 1 / (sx * sx);
        data[at + 17] = 1 / (sy * sy);
        data[at + 18] = 1 / (sx * sx);
      }
      scene.batches.push({
        key,
        form: species.form,
        canopy: hex(species.canopy),
        trunk: hex(species.trunk || species.canopy, hex(species.canopy)),
        count: group.length,
        instance: buffer(data, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW),
        stride,
      });
    }
  }

  /** The brush cursor: a ring following the ground. */
  function setBrush(at, radius) {
    if (scene.brush) {
      gl.deleteBuffer(scene.brush);
      scene.brush = null;
      scene.brushCount = 0;
    }
    if (!at || !scene.terrain || !(radius > 0)) return;
    const points = ringPoints(at[0], at[1], radius, 56);
    const strip = ribbon(points, Math.max(0.1, radius / 28), (x, z) => heightOf(scene.terrain, x, z), 0.1);
    scene.brush = buffer(strip, gl.ARRAY_BUFFER, gl.DYNAMIC_DRAW);
    scene.brushCount = strip.length / 3;
  }

  const maxAttributes = gl.getParameter(gl.MAX_VERTEX_ATTRIBS);

  /**
   * Clear the attribute state before a pass.
   *
   * Vertex attribute arrays are *global*, not per-program. Enable location 3
   * for the ground and it stays enabled when the sky program is used next —
   * and because the sky has nothing at location 3, the draw fails with
   * INVALID_OPERATION: "no buffer is bound to enabled attribute". Nothing
   * visibly breaks, which is what makes it worth being deliberate about:
   * every pass starts from a known-empty state.
   */
  const beginPass = () => {
    for (let i = 0; i < maxAttributes; i += 1) {
      gl.disableVertexAttribArray(i);
      gl.vertexAttribDivisor(i, 0);
    }
  };

  const bindAttribute = (location, buf, components, divisor = 0, stride = 0, offset = 0) => {
    if (location === undefined || location < 0) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, components, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(location, divisor);
  };

  /**
   * Draw a frame.
   * @param {object} view {viewProjection, near, far} from the camera
   * @param {object} options {sunAzimuth, sunElevation, slopeLimit, showSlope}
   */
  function render(view, options = {}) {
    const {
      sunAzimuth = 135, sunElevation = 45, slopeLimit = 25, showSlope = false,
    } = options;

    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.BACK);
    gl.disable(gl.BLEND);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    const az = (sunAzimuth * Math.PI) / 180;
    const el = (sunElevation * Math.PI) / 180;
    const light = [
      Math.sin(az) * Math.cos(el),
      Math.sin(el),
      Math.cos(az) * Math.cos(el),
    ];
    const fogStart = (scene.terrain?.size || 60) * 1.2;
    const fogEnd = (scene.terrain?.size || 60) * 5;

    // ---- Sky -------------------------------------------------------------
    {
      const p = programs.sky;
      beginPass();
      gl.useProgram(p.program);
      gl.depthMask(false);
      bindAttribute(p.attributes.aClip, skyQuad, 2);
      gl.uniform3fv(p.uniforms.uHigh, hex(palette.skyHigh));
      gl.uniform3fv(p.uniforms.uLow, hex(palette.skyLow));
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.depthMask(true);
    }

    if (!scene.ground) return;

    // ---- Ground ----------------------------------------------------------
    {
      const p = programs.ground;
      beginPass();
      gl.useProgram(p.program);
      bindAttribute(p.attributes.aPosition, scene.ground.position, 3);
      bindAttribute(p.attributes.aNormal, scene.ground.normal, 3);
      bindAttribute(p.attributes.aSlope, scene.ground.slope, 1);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, scene.ground.index);
      gl.uniformMatrix4fv(p.uniforms.uViewProjection, false, view.viewProjection);
      gl.uniform3fv(p.uniforms.uLightDir, light);
      gl.uniform3fv(p.uniforms.uGrass, hex(palette.grass));
      gl.uniform3fv(p.uniforms.uSteep, hex(palette.steep));
      gl.uniform3fv(p.uniforms.uHardstanding, hex(palette.hardstanding));
      gl.uniform3fv(p.uniforms.uSkyLight, hex(palette.skyLight));
      gl.uniform3fv(p.uniforms.uBounce, hex(palette.bounce));
      gl.uniform3fv(p.uniforms.uFog, hex(palette.fog));
      gl.uniform1f(p.uniforms.uFogStart, fogStart);
      gl.uniform1f(p.uniforms.uFogEnd, fogEnd);
      gl.uniform1f(p.uniforms.uSiteSize, scene.terrain.size);
      gl.uniform1f(p.uniforms.uSlopeLimit, slopeLimit);
      gl.uniform1f(p.uniforms.uShowSlope, showSlope ? 1 : 0);
      const pad = scene.terrain.pad;
      gl.uniform4f(
        p.uniforms.uPad,
        pad ? pad.x : 0, pad ? pad.z : 0, pad ? pad.width : 0, pad ? pad.depth : 0,
      );
      gl.drawElements(gl.TRIANGLES, scene.ground.count, gl.UNSIGNED_INT, 0);
    }

    // ---- Building --------------------------------------------------------
    if (scene.building) {
      const p = programs.plant;
      beginPass();
      gl.useProgram(p.program);
      bindAttribute(p.attributes.aPosition, scene.building.position, 3);
      bindAttribute(p.attributes.aNormal, scene.building.normal, 3);
      bindAttribute(p.attributes.aPart, scene.building.part, 1);
      // A single identity instance: the building is already in world space.
      const one = new Float32Array([
        1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 1, 1,
      ]);
      const b = buffer(one, gl.ARRAY_BUFFER, gl.STREAM_DRAW);
      const stride = 19 * 4;
      bindAttribute(p.attributes.aCol0, b, 4, 1, stride, 0);
      bindAttribute(p.attributes.aCol1, b, 4, 1, stride, 16);
      bindAttribute(p.attributes.aCol2, b, 4, 1, stride, 32);
      bindAttribute(p.attributes.aCol3, b, 4, 1, stride, 48);
      bindAttribute(p.attributes.aInvSq, b, 3, 1, stride, 64);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, scene.building.index);
      gl.uniformMatrix4fv(p.uniforms.uViewProjection, false, view.viewProjection);
      gl.uniform3fv(p.uniforms.uLightDir, light);
      gl.uniform3fv(p.uniforms.uCanopy, hex('#cdc8be'));
      gl.uniform3fv(p.uniforms.uTrunk, hex('#b5afa4'));
      gl.uniform3fv(p.uniforms.uSkyLight, hex(palette.skyLight));
      gl.uniform3fv(p.uniforms.uBounce, hex(palette.bounce));
      gl.uniform3fv(p.uniforms.uFog, hex(palette.fog));
      gl.uniform1f(p.uniforms.uFogStart, fogStart);
      gl.uniform1f(p.uniforms.uFogEnd, fogEnd);
      gl.drawElementsInstanced(gl.TRIANGLES, scene.building.count, gl.UNSIGNED_SHORT, 0, 1);
      gl.deleteBuffer(b);
    }

    // ---- Beds, then contact shadows over them ---------------------------
    const discLayer = (buf, count, lift, soft) => {
      if (!count) return;
      const p = programs.disc;
      beginPass();
      gl.useProgram(p.program);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.disable(gl.CULL_FACE);
      bindAttribute(p.attributes.aDisc, disc, 2, 0);
      const stride = 8 * 4;
      bindAttribute(p.attributes.aAt, buf, 4, 1, stride, 0);
      bindAttribute(p.attributes.aTint, buf, 4, 1, stride, 16);
      gl.uniformMatrix4fv(p.uniforms.uViewProjection, false, view.viewProjection);
      gl.uniform1f(p.uniforms.uLift, lift);
      gl.uniform1f(p.uniforms.uSoft, soft);
      gl.drawArraysInstanced(gl.TRIANGLE_FAN, 0, discCount, count);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
    };

    // The bed sits closest to the ground and is only feathered at its rim; the
    // shadow goes above it and is soft throughout.
    discLayer(scene.beds, scene.bedCount, 0.03, 0.82);
    discLayer(scene.shadows, scene.shadowCount, 0.06, 0.35);

    // ---- Planting --------------------------------------------------------
    if (scene.batches.length) {
      const p = programs.plant;
      beginPass();
      gl.useProgram(p.program);
      gl.uniformMatrix4fv(p.uniforms.uViewProjection, false, view.viewProjection);
      gl.uniform3fv(p.uniforms.uLightDir, light);
      gl.uniform3fv(p.uniforms.uSkyLight, hex(palette.skyLight));
      gl.uniform3fv(p.uniforms.uBounce, hex(palette.bounce));
      gl.uniform3fv(p.uniforms.uFog, hex(palette.fog));
      gl.uniform1f(p.uniforms.uFogStart, fogStart);
      gl.uniform1f(p.uniforms.uFogEnd, fogEnd);
      // Foliage is two-sided: a tuft is a flat blade and a thin crown edge
      // should not vanish when seen from behind.
      gl.disable(gl.CULL_FACE);

      for (const batch of scene.batches) {
        const form = formFor(batch.form);
        bindAttribute(p.attributes.aPosition, form.position, 3);
        bindAttribute(p.attributes.aNormal, form.normal, 3);
        bindAttribute(p.attributes.aPart, form.part, 1);
        const stride = batch.stride * 4;
        bindAttribute(p.attributes.aCol0, batch.instance, 4, 1, stride, 0);
        bindAttribute(p.attributes.aCol1, batch.instance, 4, 1, stride, 16);
        bindAttribute(p.attributes.aCol2, batch.instance, 4, 1, stride, 32);
        bindAttribute(p.attributes.aCol3, batch.instance, 4, 1, stride, 48);
        bindAttribute(p.attributes.aInvSq, batch.instance, 3, 1, stride, 64);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, form.index);
        gl.uniform3fv(p.uniforms.uCanopy, batch.canopy);
        gl.uniform3fv(p.uniforms.uTrunk, batch.trunk);
        gl.drawElementsInstanced(
          gl.TRIANGLES, form.mesh.indices.length, gl.UNSIGNED_SHORT, 0, batch.count,
        );
      }
      gl.enable(gl.CULL_FACE);
    }

    // ---- Boundary and brush ---------------------------------------------
    {
      const p = programs.ribbon;
      beginPass();
      gl.useProgram(p.program);
      gl.uniformMatrix4fv(p.uniforms.uViewProjection, false, view.viewProjection);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.CULL_FACE);

      if (scene.boundaryCount) {
        bindAttribute(p.attributes.aPosition, scene.boundary, 3);
        gl.uniform4fv(p.uniforms.uColor, palette.boundary);
        gl.drawArrays(gl.TRIANGLES, 0, scene.boundaryCount);
      }
      if (scene.brushCount) {
        bindAttribute(p.attributes.aPosition, scene.brush, 3);
        gl.uniform4fv(p.uniforms.uColor, palette.brush);
        gl.drawArrays(gl.TRIANGLES, 0, scene.brushCount);
      }
      gl.disable(gl.BLEND);
      gl.enable(gl.CULL_FACE);
    }
  }

  /** Anything the driver is unhappy about, for the interface to surface. */
  function lastError() {
    const code = gl.getError();
    if (code === gl.NO_ERROR) return null;
    const names = {
      [gl.INVALID_ENUM]: 'INVALID_ENUM',
      [gl.INVALID_VALUE]: 'INVALID_VALUE',
      [gl.INVALID_OPERATION]: 'INVALID_OPERATION',
      [gl.OUT_OF_MEMORY]: 'OUT_OF_MEMORY',
      [gl.INVALID_FRAMEBUFFER_OPERATION]: 'INVALID_FRAMEBUFFER_OPERATION',
      [gl.CONTEXT_LOST_WEBGL]: 'CONTEXT_LOST_WEBGL',
    };
    return names[code] || `0x${code.toString(16)}`;
  }

  function info() {
    const dbg = gl.getExtension('WEBGL_debug_renderer_info');
    return {
      renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
      samples: gl.getParameter(gl.SAMPLES),
      maxTexture: gl.getParameter(gl.MAX_TEXTURE_SIZE),
      size,
    };
  }

  return {
    gl, setPalette, resize, setTerrain, setInstances, setBrush, render, lastError, info,
  };
}
