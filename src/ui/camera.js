/**
 * The camera.
 *
 * An orbit rig: a target on the ground, a bearing, an elevation and a
 * distance. That is the right model for looking at a site — it is how every
 * CAD viewport works, and it means "north is up there" stays true while you
 * move around.
 *
 * The important function here is `rayThrough`, which turns a pointer position
 * into a world-space ray. Everything about painting depends on it being right,
 * and it is pure, so it is tested rather than eyeballed.
 */

import {
  perspective, lookAt, multiply, invert, transformPoint, normalize, subtract,
} from './mat4.js';

export const LIMITS = Object.freeze({
  elevation: [4, 88],
  distance: [4, 600],
  fov: [20, 75],
});

const clamp = (v, [lo, hi]) => Math.max(lo, Math.min(hi, v));

/**
 * @param {object} options
 * @param {number[]} options.target [x, y, z] the point orbited, in metres
 * @param {number} options.bearing  degrees clockwise from north (+Z is south)
 * @param {number} options.elevation degrees above the horizon
 * @param {number} options.distance  metres from the target
 * @param {number} options.fov       vertical field of view, degrees
 */
export function createCamera({
  target = [30, 0, 30], bearing = 215, elevation = 28, distance = 90, fov = 40,
} = {}) {
  return {
    target: [...target],
    bearing,
    elevation: clamp(elevation, LIMITS.elevation),
    distance: clamp(distance, LIMITS.distance),
    fov: clamp(fov, LIMITS.fov),
  };
}

/** Where the eye is, derived from the orbit parameters. */
export function eyeOf(camera) {
  const b = (camera.bearing * Math.PI) / 180;
  const e = (camera.elevation * Math.PI) / 180;
  const horizontal = Math.cos(e) * camera.distance;
  return [
    camera.target[0] + Math.sin(b) * horizontal,
    camera.target[1] + Math.sin(e) * camera.distance,
    camera.target[2] + Math.cos(b) * horizontal,
  ];
}

/** View and projection for a viewport of the given pixel size. */
export function matrices(camera, width, height) {
  const aspect = width > 0 && height > 0 ? width / height : 1;
  // Near and far track the distance, so a close-up keeps depth precision and a
  // wide view still reaches the far corner of a large site.
  const near = Math.max(0.1, camera.distance / 200);
  const far = camera.distance * 8 + 400;
  const view = lookAt(eyeOf(camera), camera.target, [0, 1, 0]);
  const projection = perspective((camera.fov * Math.PI) / 180, aspect, near, far);
  return { view, projection, viewProjection: multiply(projection, view), near, far };
}

/**
 * A world-space ray through a pointer position.
 *
 * @param {object} camera
 * @param {number} px  pointer x in CSS pixels from the canvas' left edge
 * @param {number} py  pointer y in CSS pixels from the canvas' top edge
 * @param {number} width  canvas width in CSS pixels
 * @param {number} height canvas height in CSS pixels
 * @returns {{origin: number[], dir: number[]} | null}
 */
export function rayThrough(camera, px, py, width, height) {
  if (!(width > 0) || !(height > 0)) return null;
  const { viewProjection } = matrices(camera, width, height);
  const inverse = invert(viewProjection);
  if (!inverse) return null;

  // Clip space: x right, y UP — which is why the y term is flipped, since
  // pointer coordinates run downward.
  const cx = (px / width) * 2 - 1;
  const cy = 1 - (py / height) * 2;

  const nearPoint = transformPoint(inverse, [cx, cy, -1]);
  const farPoint = transformPoint(inverse, [cx, cy, 1]);
  if (Math.abs(nearPoint.w) < 1e-12 || Math.abs(farPoint.w) < 1e-12) return null;

  const origin = nearPoint.point;
  const dir = normalize(subtract(farPoint.point, origin));
  if (Math.hypot(...dir) < 0.5) return null;
  return { origin, dir };
}

/** Orbit by a pointer drag, in pixels. */
export function orbit(camera, dx, dy, speed = 0.3) {
  camera.bearing = (camera.bearing - dx * speed) % 360;
  if (camera.bearing < 0) camera.bearing += 360;
  camera.elevation = clamp(camera.elevation + dy * speed, LIMITS.elevation);
  return camera;
}

/** Zoom by a wheel notch or a pinch. `factor` above 1 moves away. */
export function zoom(camera, factor) {
  camera.distance = clamp(camera.distance * factor, LIMITS.distance);
  return camera;
}

/**
 * Pan across the ground.
 *
 * The target slides in the camera's own screen plane, projected onto the
 * horizontal, so dragging right always moves the site right on screen
 * whichever way the camera is facing. Scaled by distance so panning feels the
 * same whether you are zoomed in on one corner or looking at the whole plot.
 */
export function pan(camera, dx, dy, width, height) {
  const b = (camera.bearing * Math.PI) / 180;
  // Screen right and screen "into the distance", both flattened onto the ground.
  const rightX = Math.cos(b);
  const rightZ = -Math.sin(b);
  const inX = -Math.sin(b);
  const inZ = -Math.cos(b);

  const scale = (camera.distance * 2 * Math.tan((camera.fov * Math.PI) / 360))
    / Math.max(1, height);
  camera.target[0] -= (dx * rightX + dy * inX) * scale;
  camera.target[2] -= (dx * rightZ + dy * inZ) * scale;
  return camera;
}

/** Keep the camera looking at somewhere useful on the site. */
export function clampToSite(camera, size, margin = 0.5) {
  const lo = -size * margin;
  const hi = size * (1 + margin);
  camera.target[0] = Math.max(lo, Math.min(hi, camera.target[0]));
  camera.target[2] = Math.max(lo, Math.min(hi, camera.target[2]));
  return camera;
}

/** A view that frames the whole site. */
export function frameSite(camera, terrain) {
  const mid = (terrain.lowest + terrain.highest) / 2;
  camera.target = [terrain.size / 2, mid, terrain.size / 2];
  // Far enough back that the site's diagonal fits the vertical field of view.
  const radius = (terrain.size * Math.SQRT2) / 2;
  camera.distance = clamp(radius / Math.tan((camera.fov * Math.PI) / 360) * 0.95, LIMITS.distance);
  return camera;
}

/** The compass bearing the camera is looking along, for a north indicator. */
export function northOnScreen(camera) {
  // North is -Z. Its angle on screen, measured clockwise from screen up.
  return ((camera.bearing + 180) % 360);
}
