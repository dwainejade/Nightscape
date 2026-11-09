// @ts-nocheck
// Tileable 3D noise, ported verbatim from the legacy index.html (lines 185-278).
import * as THREE from 'three'

function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }

export function buildNoise(N) {
  const rnd = mulberry32(90210);
  const gradCache = {}, ptCache = {};
  function grads(P) {
    if (gradCache[P]) return gradCache[P];
    const g = new Float32Array(P * P * P * 3);
    for (let i = 0; i < P * P * P; i++) {
      let x, y, z, l;
      do { x = rnd() * 2 - 1; y = rnd() * 2 - 1; z = rnd() * 2 - 1; l = x * x + y * y + z * z; } while (l > 1 || l < 1e-4);
      l = Math.sqrt(l); g[i * 3] = x / l; g[i * 3 + 1] = y / l; g[i * 3 + 2] = z / l;
    }
    return (gradCache[P] = g);
  }
  function points(P) {
    if (ptCache[P]) return ptCache[P];
    const p = new Float32Array(P * P * P * 3);
    for (let i = 0; i < p.length; i++) p[i] = rnd();
    return (ptCache[P] = p);
  }
  const fade = t => t * t * t * (t * (t * 6 - 15) + 10);
  function perlin(x, y, z, P) {
    const g = grads(P);
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const xf = x - xi, yf = y - yi, zf = z - zi;
    const x0 = ((xi % P) + P) % P, y0 = ((yi % P) + P) % P, z0 = ((zi % P) + P) % P;
    const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P, z1 = (z0 + 1) % P;
    const u = fade(xf), v = fade(yf), w = fade(zf);
    function d(a, b, c, dx, dy, dz) { const k = 3 * (a + P * (b + P * c)); return g[k] * dx + g[k + 1] * dy + g[k + 2] * dz; }
    const n000 = d(x0, y0, z0, xf, yf, zf), n100 = d(x1, y0, z0, xf - 1, yf, zf);
    const n010 = d(x0, y1, z0, xf, yf - 1, zf), n110 = d(x1, y1, z0, xf - 1, yf - 1, zf);
    const n001 = d(x0, y0, z1, xf, yf, zf - 1), n101 = d(x1, y0, z1, xf - 1, yf, zf - 1);
    const n011 = d(x0, y1, z1, xf, yf - 1, zf - 1), n111 = d(x1, y1, z1, xf - 1, yf - 1, zf - 1);
    const nx00 = n000 + u * (n100 - n000), nx10 = n010 + u * (n110 - n010);
    const nx01 = n001 + u * (n101 - n001), nx11 = n011 + u * (n111 - n011);
    const nxy0 = nx00 + v * (nx10 - nx00), nxy1 = nx01 + v * (nx11 - nx01);
    return nxy0 + w * (nxy1 - nxy0);
  }
  function worley(x, y, z, P) {
    const pts = points(P);
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    let md = 1e9;
    for (let dz = -1; dz <= 1; dz++) {
      const cz = zi + dz, wz = ((cz % P) + P) % P;
      for (let dy = -1; dy <= 1; dy++) {
        const cy = yi + dy, wy = ((cy % P) + P) % P;
        for (let dx = -1; dx <= 1; dx++) {
          const cx = xi + dx, wx = ((cx % P) + P) % P;
          const k = 3 * (wx + P * (wy + P * wz));
          const px = cx + pts[k] - x, py = cy + pts[k + 1] - y, pz = cz + pts[k + 2] - z;
          const d2 = px * px + py * py + pz * pz;
          if (d2 < md) md = d2;
        }
      }
    }
    return Math.min(Math.sqrt(md), 1);
  }
  const T = N * N * N;
  const R = new Float32Array(T), G = new Float32Array(T), B = new Float32Array(T);
  let idx = 0;
  for (let iz = 0; iz < N; iz++) for (let iy = 0; iy < N; iy++) for (let ix = 0; ix < N; ix++, idx++) {
    const x = (ix + 0.5) / N, y = (iy + 0.5) / N, z = (iz + 0.5) / N;
    const p = (perlin(x * 4, y * 4, z * 4, 4) + 0.5 * perlin(x * 8, y * 8, z * 8, 8) + 0.25 * perlin(x * 16, y * 16, z * 16, 16)) / 1.75;
    const w4 = 1 - worley(x * 4, y * 4, z * 4, 4);
    const w8 = 1 - worley(x * 8, y * 8, z * 8, 8);
    const w16 = 1 - worley(x * 16, y * 16, z * 16, 16);
    const w32 = 1 - worley(x * 32, y * 32, z * 32, 32);
    R[idx] = 0.6 * (0.625 * w4 + 0.25 * w8 + 0.125 * w16) + 0.4 * (p * 0.5 + 0.5);
    G[idx] = 0.5 * w8 + 0.3 * w16 + 0.2 * w32;
    B[idx] = perlin(x * 2, y * 2, z * 2, 2) + 0.5 * perlin(x * 4, y * 4, z * 4, 4) + 0.25 * perlin(x * 8, y * 8, z * 8, 8) + 0.125 * perlin(x * 16, y * 16, z * 16, 16);
  }
  function range(a) { // robust 0.5% – 99.5% range
    const s = Float32Array.from(a).sort();
    return [s[Math.floor(s.length * 0.005)], s[Math.floor(s.length * 0.995)]];
  }
  const rr = range(R), gr = range(G), br = range(B);
  const data = new Uint8Array(T * 4);
  const q = (v, r) => Math.max(0, Math.min(255, Math.round((v - r[0]) / (r[1] - r[0]) * 255)));
  for (let i = 0; i < T; i++) {
    data[i * 4] = q(R[i], rr); data[i * 4 + 1] = q(G[i], gr); data[i * 4 + 2] = q(B[i], br); data[i * 4 + 3] = 255;
  }
  const Tex3D = THREE.Data3DTexture;
  const tex = new Tex3D(data, N, N, N);
  tex.format = THREE.RGBAFormat;
  tex.type = THREE.UnsignedByteType;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.generateMipmaps = false;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}
