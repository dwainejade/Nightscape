// Auto-extracted verbatim from the legacy index.html (lines 283-1666). Shader strings
// are split into per-pass modules in a later step; kept together here for parity first.
/* eslint-disable */
// @ts-nocheck
const DBG: any = (typeof window !== 'undefined' && (window as any).__cloudDebug) || null
export const VERT = `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

export const COMMON = `
float hash12(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
vec4 hash42(vec2 p){ vec4 p4 = fract(vec4(p.xyxy) * vec4(.1031, .1030, .0973, .1099)); p4 += dot(p4, p4.wzxy + 33.33); return fract((p4.xxyz + p4.yzzw) * p4.zywx); }
vec3 hash33(vec3 p3){ p3 = fract(p3 * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yxz + 33.33); return fract((p3.xxy + p3.yxx) * p3.zyx); }
float ign(vec2 p){ return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715)))); }
float pathX(float z){ return 4.5 * sin(z * 0.019634954) + 1.6 * sin(z * 0.039269908 + 1.3); }

// Night sky without moon disk or stars: gradient, warm horizon glow, moon halo.
vec3 skyBase(vec3 rd, vec3 m){
  float y = rd.y;
  vec3 zen = vec3(0.0003, 0.0008, 0.0034);
  vec3 mid = vec3(0.0012, 0.0031, 0.0098);
  vec3 hor = vec3(0.0060, 0.0112, 0.0245);
  vec3 col = mix(hor, mid, smoothstep(-0.02, 0.22, y));
  col = mix(col, zen, smoothstep(0.18, 0.85, y));
  vec2 hd = normalize(rd.xz + 1e-5);
  vec2 md = normalize(m.xz);
  float az = max(dot(hd, md), 0.0);
  float band = exp(-abs(y + 0.015) * 16.0);
  float wide = exp(-abs(y + 0.015) * 5.0);
  col += vec3(0.34, 0.19, 0.09) * band * (0.03 + 0.97 * pow(az, 6.0)) * 0.20;
  col += vec3(0.10, 0.10, 0.12) * wide * pow(az, 3.0) * 0.08;
  float a = 2.0 * asin(clamp(length(rd - m) * 0.5, 0.0, 1.0));
  col += vec3(0.30, 0.46, 0.90) * 0.0035 * exp(-a * 2.4);
  col += vec3(0.55, 0.66, 0.88) * 0.0150 * exp(-a * 8.5);
  col += vec3(1.00, 0.90, 0.74) * 0.1100 * exp(-a * 28.0);
  col += vec3(1.00, 0.93, 0.80) * 0.4500 * exp(-a * 90.0);
  return col;
}
`;

export const WORLD = `
// The world is one 320 x 320 tile repeated forever: every noise frequency is a
// whole number of cycles per tile, and the tower grid has 13 cells per tile.
const float FAR_LO = 560.0, FAR_HI = 800.0;  // how far the cloud march reaches (world units)
const float TILE = 320.0;
const float CELL = TILE / 13.0;
const float SEA_TOP = 8.2;
const float Y_MIN = -8.5;
const float Y_MAX = 52.0;
const float CLOUD_BASE = -1.75;
const float OCEAN_Y = -85.0;
const float F_A = 3.0 / TILE, F_B = 11.0 / TILE, F_COV = 2.0 / TILE;
const float F_DECK = 2.0 / TILE, F_DECK2 = 6.0 / TILE, F_BIL = 26.0 / TILE, F_DET = 42.0 / TILE, F_LOB = 9.0 / TILE;
const float CB_CELL = TILE / 4.0;
// user-controlled cloud shape (see engine cloud settings; defaults reproduce the original look)
uniform float uCover, uCumulus, uStorm, uDeckH;
uniform vec2 uWindV;   // upper-level wind that drags the anvils out (default 0.8, -0.6)
#define WIND uWindV

float pdist(float a){ return abs(mod(a + 0.5 * TILE, TILE) - 0.5 * TILE); }

// Top of the cloud deck. A large-scale coverage field pulls the top below the
// cloud base in places, opening breaks of every size down to the ocean.
float coverageAt(vec2 xz, float a){
  float c = texture(uNoise, vec3(xz * F_COV + 0.21, 0.713)).b;
  return 0.6 * c + 0.4 * a;
}
float seaHeight(vec2 xz){
  float a = texture(uNoise, vec3(xz * F_A, 0.137)).b;
  float b = texture(uNoise, vec3(xz.yx * F_B + 0.31, 0.583)).b;
  float h = -1.05 + a * 1.75 + b * 0.85;
  float k = smoothstep(0.43, 0.57, coverageAt(xz, a) + (b - 0.5) * 0.24 + (uCover - 0.5) * 0.6);
  return mix(-4.2, h, k);
}
// Altitude of the deck itself: broad basins sink well below the camera while
// banks and ridges swell up past it. The flight corridor is kept clear.
float deckOffset(vec2 xz){
  float o = texture(uNoise, vec3(xz * F_DECK + 0.47, 0.391)).b;
  float o2 = texture(uNoise, vec3(xz.yx * F_DECK2 + 0.13, 0.857)).b;
  float off = mix(-5.2, 4.6, smoothstep(0.16, 0.84, o)) + (o2 - 0.5) * 2.8;
  float dx = pdist(xz.x - pathX(xz.y));
  float allow = mix(-1.2, 5.5, smoothstep(6.0, 20.0, dx));
  float h = clamp(0.5 + 0.5 * (allow - off) / 1.4, 0.0, 1.0);
  return mix(allow, off, h) - 1.4 * h * (1.0 - h);
}
float seaSD(vec3 p, float bil){
  float off = deckOffset(p.xz);
  float top = seaHeight(p.xz) + off + uDeckH + (bil - 0.5) * 2.0 - p.y;
  float bottom = p.y - (CLOUD_BASE + off * 0.8 + uDeckH - (bil - 0.5) * 0.9);
  return min(top, bottom);
}
float billow(vec3 p){
  vec3 q = p * F_BIL;
  vec3 q2 = vec3(2.0 * q.x + q.z, 2.0 * q.y, 2.0 * q.z - q.x);   // integer "rotation" keeps it tileable
  return 0.64 * texture(uNoise, q).r + 0.36 * texture(uNoise, q2 + 0.37).r;
}
float detailN(vec3 p){ return texture(uNoise, p * F_DET).g; }

float smax(float a, float b, float k){ float h = clamp(0.5 + 0.5 * (a - b) / k, 0.0, 1.0); return mix(b, a, h) + k * h * (1.0 - h); }

// big, slow undulation that gives towers their cauliflower turrets
// two scales of rounded bulges, so big turrets carry smaller turrets of their own
float lobes(vec3 p){
  return 0.62 * texture(uNoise, p * F_LOB + vec3(0.53, 0.11, 0.29)).r
       + 0.38 * texture(uNoise, p * (2.0 * F_LOB) + vec3(0.17, 0.71, 0.41)).r;
}

vec2 rot2(vec2 v, float a){ float sn = sin(a), cs = cos(a); return vec2(cs * v.x - sn * v.y, sn * v.x + cs * v.y); }

// Cumulus heaps, built the way real cumulus grows: a cluster of rounded thermal
// bubbles, big and spread out at the base, smaller and higher toward the top, each
// pushed a little downwind. Two layers of grid cells (small heaps, and fewer big towering ones) so sizes
// really differ; a slow "cluster" field groups heaps into banks with clear gaps between; and every heap
// has its own bubble count, elongation, heading, height and bubble sizes. (A cloud must stay within 0.7
// of a cell, which is what the 2x2 neighbour lookup covers: hence the two grids.)
float cumulusLayer(vec3 p, float bil, float lob, float cell, float nc, float rMin, float rVar, float dens, float seed, float hMul){
  vec2 g = p.xz / cell - 0.5;
  vec2 i0 = floor(g);
  float best = -8.0;
  for (int j = 0; j < 2; j++){
    for (int i = 0; i < 2; i++){
      vec2 id = i0 + vec2(float(i), float(j));
      vec2 idw = mod(id, nc);
      vec4 h = hash42(idw + seed + 31.7);
      vec2 c = (id + 0.2 + 0.6 * h.yz) * cell;
      float cf = smoothstep(0.30, 0.70, texture(uNoise, vec3(c * (3.0 / TILE) + seed * 0.013, 0.45)).b);
      if (h.x < 1.0 - clamp(uCumulus * dens * (0.15 + 1.7 * cf), 0.0, 1.0)) continue;
      float h5 = hash12(idw * 1.37 + 7.1 + seed);
      float Rb = (rMin + rVar * h.w) * (0.85 + 0.15 * cf);
      float H = Rb * hMul * (0.4 + 1.7 * h5 * h5);                       // from low and flat to tall
      if (pdist(c.x - pathX(c.y)) < Rb * 2.0 + 3.0) continue;
      vec2 dc = p.xz - c;
      float reach = Rb * 2.9 + 2.0;
      if (dot(dc, dc) > reach * reach || p.y > H + Rb + 2.0) continue;
      float nb = 5.0 + floor(3.99 * fract(h5 * 9.1));                    // 5 to 8 bubbles
      float a0 = fract(h5 * 17.3) * 6.2832, el = 1.0 + 0.7 * fract(h5 * 5.7);   // heap elongated along a0
      float cl = -1e3;
      for (int k = 0; k < 8; k++){
        if (float(k) >= nb) break;
        vec4 hk = hash42(idw * 3.7 + float(k) * 11.3 + 5.1 + seed);
        float tk = float(k) / (nb - 1.0);
        float rk = Rb * mix(1.0, 0.45, tk) * (0.6 + 0.8 * hk.x);
        float ang = hk.y * 6.2832;
        float off = Rb * 0.7 * (1.0 - 0.6 * tk) * sqrt(hk.z);
        vec2 o = vec2(cos(ang), sin(ang)) * off;
        o = rot2(vec2(o.x * el, o.y / el), a0);
        vec2 cxz = c + o + WIND * tk * Rb * 0.4;
        vec3 d = p - vec3(cxz.x, -0.5 + tk * H + rk * 0.2, cxz.y);
        d.y *= 1.15;
        cl = smax(cl, rk - length(d), rk * 0.45);
      }
      cl = min(cl, p.y - (CLOUD_BASE - 0.4));
      cl += (lob - 0.5) * Rb * 0.7 + (bil - 0.5) * (2.4 + 0.2 * Rb);
      best = max(best, cl);
    }
  }
  return best;
}
float towers(vec3 p, float bil, float lob){
  float small = cumulusLayer(p, bil, lob, CELL, 13.0, 2.6, 2.6, 1.0, 0.0, 1.0);
  float big = cumulusLayer(p, bil, lob, TILE / 5.0, 5.0, 7.0, 7.0, 0.5, 57.3, 0.85);   // fewer, much bigger
  return max(small, big);
}

// Cumulonimbus: a broad, lumpy updraft column climbing to 35-55 units, flattening
// into a wind-dragged anvil, with an overshooting dome punching through the top.
// Each one differs: height, girth, how it bulges or tapers, how far and which way the
// wind shears it, and many have a smaller second updraft growing beside the main one.
float cumulonimbus(vec3 p, float bil, float lob){
  vec2 g = p.xz / CB_CELL - 0.5;
  vec2 i0 = floor(g);
  float best = -40.0;
  for (int j = 0; j < 2; j++){
    for (int i = 0; i < 2; i++){
      vec2 id = i0 + vec2(float(i), float(j));
      vec2 idw = mod(id, 4.0);
      vec4 h = hash42(idw * 7.31 + 113.7);
      if (h.x < 1.0 - uStorm * 0.6) continue;
      vec2 c = (id + 0.3 + 0.4 * h.yz) * CB_CELL;
      float R0 = 8.0 + 8.0 * h.w;
      if (pdist(c.x - pathX(c.y)) < R0 * 2.2 + 9.0) continue;
      float h2 = hash12(idw * 3.17 + 41.3);
      float h3 = fract(h2 * 7.13), h4 = fract(h2 * 13.7), h6 = fract(h2 * 29.1), h7 = fract(h2 * 43.9);
      float H = 14.0 + 34.0 * h2 * h2;                  // mostly mid-sized, a few giants
      float anvil = smoothstep(24.0, 34.0, H);          // only the tall ones spread an anvil
      float A = 3.0 + 5.0 * h3;
      float Ra = R0 * (1.5 + 1.0 * h4);
      vec2 W = rot2(WIND, (h6 - 0.5) * 1.5) * (0.5 + 1.0 * h7);   // each sheared its own way
      float tt = clamp((p.y - CLOUD_BASE) / (H - CLOUD_BASE), 0.0, 1.0);
      vec2 col = c + W * tt * tt * R0 * 0.7;
      float bulge = (h6 - 0.35) * 0.9;                  // some taper, some swell in the middle
      float colR = R0 * (0.85 + bulge * sin(tt * 3.1416) * 0.5 + 0.25 * tt + 0.15 * exp(-tt * 7.0));
      float an = smoothstep(H - A - 4.0, H - A + 1.0, p.y) * anvil;
      vec2 ctr = mix(col, c + W * (Ra - R0) * 0.6, an);
      float rad = mix(colR, Ra * (0.7 + 0.6 * lob), an);
      float sd = min(rad - length(p.xz - ctr), H - p.y);
      vec3 ov = vec3(p.x - col.x, (p.y - (H + 0.5)) * 1.6, p.z - col.y);
      sd = max(sd, R0 * (0.6 + 0.4 * h3) - length(ov));
      if (h7 > 0.35){
        // a second, lower updraft beside it
        float H2 = H * (0.45 + 0.35 * h4), R2 = R0 * (0.55 + 0.3 * h3);
        float t2 = clamp((p.y - CLOUD_BASE) / (H2 - CLOUD_BASE), 0.0, 1.0);
        vec2 c2 = c + rot2(vec2(R0 * 1.15, 0.0), h2 * 6.2832) + W * t2 * t2 * R2 * 0.7;
        float s2 = min(R2 * (0.9 + 0.3 * t2) - length(p.xz - c2), H2 - p.y);
        sd = smax(sd, s2, 3.0);
      }
      sd = min(sd, p.y - (CLOUD_BASE - 1.0));
      float lump = mix(R0 * 0.55, 1.2, an);
      sd += (lob - 0.5) * 2.0 * lump + (bil - 0.5) * (4.0 - 2.6 * an);
      best = max(best, sd);
    }
  }
  return best;
}

float sceneSD(vec3 p){
  float bil = billow(p);
  float lob = lobes(p);
  float sea = (p.y > SEA_TOP) ? min(SEA_TOP - p.y, -0.4) : seaSD(p, bil);
  float tw = towers(p, bil, lob);
  float cb = cumulonimbus(p, bil, lob);
  return smax(smax(sea, tw, 0.9), cb, 1.2);
}
// Same field without the above-the-deck shortcut, which is only a bound for skipping
// and must not be baked as if it were real cloud.
float sceneSDFull(vec3 p){
  float bil = billow(p);
  float lob = lobes(p);
  return smax(smax(seaSD(p, bil), towers(p, bil, lob), 0.9), cumulonimbus(p, bil, lob), 1.2);
}
float densLight(float sd){ return clamp((sd + 0.1) * 1.3, 0.0, 1.0); }
`;

// Cloud shape at render time: the baked field (deck, heaps and cumulonimbus with their
// large billows) plus one octave of finer live billowing for the small cauliflower detail.
export const BAKED = `
uniform sampler3D uBake, uBake2;   // cloud shape field: the one we are leaving and the one we are growing into
uniform float uMorph;               // 0 = all uBake, 1 = all uBake2
// Patches change at different moments (a smooth noise offsets the start of each), so some
// clouds build or melt away before others instead of everything fading together.
float morphAt(vec3 p){
  float n = texture(uNoise, vec3(p.xz * F_COV + 0.5, 0.31)).b;
  float m = clamp(uMorph * 1.5 - 0.5 * n, 0.0, 1.0);
  return m * m * (3.0 - 2.0 * m);
}
float bakeAt(vec3 uvw, vec3 p){
  float a = texture(uBake, uvw).r;
  if (uMorph <= 0.0) return a;
  return mix(a, texture(uBake2, uvw).r, morphAt(p));
}
// Large-scale variety. The baked field repeats every TILE, so on a long flight the same clouds come round
// again; a slow noise of the ABSOLUTE position (Mercator, so it is unchanged by re-anchoring and by moving to
// another window) swells or thins the cloud from region to region. Two octaves (uBigK, cycles per world unit,
// with their phase uBigO already reduced in double precision on the CPU); amplitudes uBigAmp in distance units.
uniform vec4 uBigO;
uniform vec2 uBigK;
uniform vec2 uBigAmp;
float gBias = 0.0;   // set once per march step (cloud pass), read by every shape lookup near that point
float bigBias(vec2 xz){
  float a = texture(uNoise, vec3(uBigO.xy + xz * uBigK.x, 0.29)).b - 0.5;
  float b = texture(uNoise, vec3(uBigO.zw + xz * uBigK.y, 0.71)).b - 0.5;
  return a * uBigAmp.x + b * uBigAmp.y;
}
float bakedSD(vec3 p){
  float w = (p.y - Y_MIN) / (Y_MAX - Y_MIN);
  if (w >= 1.0) return -4.0 - (p.y - Y_MAX);
  if (w < 0.0) return -6.0;                  // below the deck: clear air down to the sea
  return bakeAt(vec3(p.x / TILE, p.z / TILE, w), p) * 16.0 - 10.0 + gBias;
}
float shapeSD(vec3 p){
  float sd = bakedSD(p);
  if (sd < -1.2) return sd + 0.6;            // well clear of cloud: a safe bound, no detail needed
  vec3 q = p * F_BIL;
  q = vec3(2.0 * q.x + q.z, 2.0 * q.y, 2.0 * q.z - q.x) + 0.37;   // the billow octave the bake can only half resolve
  return sd + (texture(uNoise, q).r - 0.5) * 0.9;
}
`;

// Lightning as light: each flash is two line lights along the channel. Light from a
// line inside a cloud is scattered many times before it escapes, so it is attenuated far
// more gently than direct moonlight; three baked samples estimate the cloud in between.
export const LIGHTNING = `
uniform float uFlash, uLR2;
uniform vec3 uLa0, uLb0, uLa1, uLb1, uGround;
uniform float uLi0, uLi1, uGroundI;
const vec3 LCOL = vec3(0.80, 0.84, 1.00);
vec3 segPoint(vec3 p, vec3 a, vec3 b){
  vec3 ab = b - a;
  return a + ab * clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
}
float boltLight(vec3 p, vec3 a, vec3 b, float I){
  if (I <= 0.0) return 0.0;
  vec3 v = segPoint(p, a, b) - p;
  float d2 = dot(v, v);
  if (d2 > uLR2) return 0.0;
  float d = sqrt(d2);
  float od = densLight(bakedSD(p + v * 0.12)) * 0.25 + densLight(bakedSD(p + v * 0.4)) * 0.35
           + densLight(bakedSD(p + v * 0.75)) * 0.4;
  return I * exp(-od * d * 0.2 - d * 0.03) / (1.0 + d2 * 0.06);
}
vec3 lightningAt(vec3 p){
  return LCOL * (boltLight(p, uLa0, uLb0, uLi0) + boltLight(p, uLa1, uLb1, uLi1));
}
`;

// Baked lighting: for every point of the tile, how much cloud lies between it
// and the moon (R) and between it and the open sky above (G).
// The cloud volume is baked in two parts, each rendered one layer at a time straight into a
// 3D render target (no CPU round trip):
//   shape: the signed distance field (cheap: one evaluation per voxel), at full resolution
//   light: optical depth toward the moon and the sky (expensive: a long march per voxel),
//          which is smooth, so it is baked at a much lower resolution
export const SHAPE_N = 256, SHAPE_NY = 96;
export const LIGHT_N = 128, LIGHT_NY = 64;
export const BAKE_SHAPE_FRAG = `
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform float uLayer;
varying vec2 vUv;
${COMMON}
${WORLD}
void main(){
  vec3 p = vec3(gl_FragCoord.x / ${SHAPE_N}.0 * TILE, Y_MIN + (uLayer + 0.5) / ${SHAPE_NY}.0 * (Y_MAX - Y_MIN), gl_FragCoord.y / ${SHAPE_N}.0 * TILE);
  gl_FragColor = vec4(clamp((sceneSDFull(p) + 10.0) / 16.0, 0.0, 1.0), 0.0, 0.0, 1.0);
}
`;
export const BAKE_LIGHT_FRAG = `
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform vec3 uMoonDir;
uniform float uLayer;
varying vec2 vUv;
${COMMON}
${WORLD}
void main(){
  vec3 p = vec3(gl_FragCoord.x / ${LIGHT_N}.0 * TILE, Y_MIN + (uLayer + 0.5) / ${LIGHT_NY}.0 * (Y_MAX - Y_MIN), gl_FragCoord.y / ${LIGHT_N}.0 * TILE);
  float od = 0.0, ds = 0.12, tt = 0.0;
  for (int i = 0; i < 150; i++){
    vec3 q = p + uMoonDir * (tt + ds * 0.5);
    if (q.y > Y_MAX) break;
    od += densLight(sceneSD(q)) * ds * exp(-tt * 0.02);   // far shadows fill in with scattered light
    tt += ds; ds = min(ds * 1.07, 3.0);
  }
  float up = 0.0; ds = 0.3; tt = 0.0;
  for (int i = 0; i < 14; i++){
    vec3 q = p + vec3(0.0, tt + ds * 0.5, 0.0);
    up += densLight(sceneSD(q)) * ds;
    tt += ds; ds *= 1.15;
  }
  gl_FragColor = vec4(1.0 - exp(-od * 0.25), 1.0 - exp(-up * 0.4), 0.0, 1.0);
}
`;

/* ---------------------------------------------------------------------------
   Terrain: flooded mountains below the deck. Baked once into tiling textures,
   since the terrain never changes and the moon never moves:
     TER_H  R surface height (ground + tree canopy), G forest, B bare ground, A rock grain
     TER_A  R moonlight (N.L x soft shadow; shadow alone on water), G sky visibility, B forest
     TER_B  albedo (stored as its square root)
     TER_C  horizon heights toward +x, +z, -x, -z (tan of the angle / 2), for reflections
--------------------------------------------------------------------------- */
export const TER_N = 1024;
export const TERRAIN_COMMON = `
const float TER_LO = -100.0, TER_RANGE = 52.0;   // heights stored as (y - TER_LO) / TER_RANGE
uniform float uTT;                          // world size of the terrain tile: 320 (invented mountains) or 640 (real places)
#define TER_TEXEL (uTT / ${TER_N}.0)
// Satellite colour (sRGB, 0..1) -> open water / tree cover. Rough, but it follows real lakes, rivers and forests.
float imgWater(vec3 c){
  float lum = dot(c, vec3(0.30, 0.59, 0.11));
  return smoothstep(0.0, 0.05, c.b - c.r - 0.01) * smoothstep(0.0, 0.03, c.b - 0.8 * c.g) * smoothstep(0.42, 0.28, lum);
}
float imgForest(vec3 c){
  float lum = dot(c, vec3(0.30, 0.59, 0.11));
  return smoothstep(0.0, 0.04, c.g - c.r) * smoothstep(0.34, 0.20, lum);
}
const float WATER_Y = -85.0;
`;
export const TERRAIN_GEN = `
// Periodic gradient noise with analytic derivatives, period 'per' cells, so every
// octave wraps with the world tile.
vec2 tgrad(vec2 i, float per){
  i = mod(i, per);
  float a = hash12(i + vec2(per * 7.13, per * 3.71)) * 6.2831853;
  return vec2(cos(a), sin(a));
}
vec3 gnoised(vec2 x, float per){
  vec2 i = floor(x), f = x - i;
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  vec2 du = 30.0 * f * f * (f * (f - 2.0) + 1.0);
  vec2 ga = tgrad(i, per), gb = tgrad(i + vec2(1.0, 0.0), per);
  vec2 gc = tgrad(i + vec2(0.0, 1.0), per), gd = tgrad(i + vec2(1.0, 1.0), per);
  float va = dot(ga, f), vb = dot(gb, f - vec2(1.0, 0.0));
  float vc = dot(gc, f - vec2(0.0, 1.0)), vd = dot(gd, f - vec2(1.0, 1.0));
  float k = va - vb - vc + vd;
  float v = va + u.x * (vb - va) + u.y * (vc - va) + u.x * u.y * k;
  vec2 d = ga + u.x * (gb - ga) + u.y * (gc - ga) + u.x * u.y * (ga - gb - gc + gd)
         + du * (u.yx * k + vec2(vb, vc) - va);
  return vec3(v, d);
}
float pnoise(vec2 p, float per){ return gnoised(p * per, per).x; }   // p in tile units
float pfbm(vec2 p, float per){
  float a = 0.0, b = 0.5;
  for (int i = 0; i < 3; i++){ a += b * pnoise(p, per); per *= 2.0; b *= 0.5; }
  return a;
}
// Ground height (no trees) at p in tile units. Broad basins and ranges, then
// derivative-damped fBm: octaves fade where the slope is already steep, which
// gives sharp ridges, gullies down the flanks and smooth valley floors, like
// eroded mountains. The water floods the basins between the ranges.
float groundY(vec2 p){
  vec2 q = p + 0.05 * vec2(pfbm(p + 0.13, 3.0), pfbm(p + 0.71, 3.0));
  float base = pfbm(q, 2.0);
  float a = 0.0, b = 0.5, per = 6.0;
  vec2 d = vec2(0.0);
  for (int i = 0; i < 8; i++){
    vec3 n = gnoised(q * per + float(i) * 1.7, per);
    d += n.yz;
    a += b * n.x / (1.0 + dot(d, d));
    b *= 0.5; per *= 2.0;
  }
  float ridge = 1.0 - abs(pnoise(q + 0.37, 9.0));
  float m = smoothstep(-0.3, 0.3, base);              // more relief on the ranges
  float h = base * 1.1 + a * mix(0.5, 1.25, m) + (ridge * ridge - 0.45) * 0.35 * m;
  return clamp(WATER_Y + (h + 0.04) * 34.0, TER_LO + 0.5, TER_LO + TER_RANGE - 1.0);
}
`;
export const TER_H_FRAG = `
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;   // (the shared world code refers to it)
uniform sampler2D uReal;    // real elevation for one place, already converted to the stored height scale
uniform sampler2D uImg;     // satellite colour for the same window
uniform float uUseReal;     // 1: use uReal and uImg, 0: the invented mountains
uniform vec2 uOrigin;       // where the window's centre sits, in terrain-tile coordinates
varying vec2 vUv;
${COMMON}
${WORLD}
${TERRAIN_COMMON}
${TERRAIN_GEN}
// Real terrain: the elevation and satellite window sits in the tile with its centre at uOrigin
// (the engine re-centres it as the flight goes on). A little invented detail goes on top,
// because the elevation data is far coarser than the cloud-top view needs, and lakes and
// rivers found in the satellite colour are sunk below the water level.
vec2 winUV(vec2 p){ return fract(p - uOrigin + 0.5); }
float realY(vec2 p){
  float K = uTT / 320.0;
  vec2 w = winUV(p);
  float y = TER_LO + textureLod(uReal, w, 0.0).r * TER_RANGE;
  float wat = imgWater(textureLod(uImg, w, 0.0).rgb);
  float fine = 0.5 * pnoise(p, 60.0 * K) + 0.25 * pnoise(p + 0.3, 130.0 * K);
  y += fine * 1.4 * smoothstep(0.3, 3.0, y - WATER_Y) * (1.0 - wat);
  y = mix(y, min(y, WATER_Y - 0.5), wat);
  return clamp(y, TER_LO + 0.5, TER_LO + TER_RANGE - 1.0);
}
float gY(vec2 p){ return uUseReal > 0.5 ? realY(p) : groundY(p); }
void main(){
  vec2 p = gl_FragCoord.xy / ${TER_N}.0;
  float e = 1.0 / ${TER_N}.0;
  float K = uTT / 320.0;          // the noise below is per tile, so a larger tile needs more of it
  float h0 = gY(p);
  float slope = length(vec2(gY(p + vec2(e, 0.0)) - h0, gY(p + vec2(0.0, e)) - h0)) / TER_TEXEL;
  float hw = h0 - WATER_Y;
  // Forest: off the cliffs, above the shore, below a ragged tree line, in patches (or, for a real
  // place, wherever the satellite colour is dark green).
  float patchN = pfbm(p + 0.29, 22.0 * K);
  float forest = smoothstep(1.2, 0.65, slope) * smoothstep(0.1, 0.7, hw)
               * smoothstep(15.0, 10.0, hw + patchN * 8.0) * smoothstep(-0.28, -0.02, patchN);
  if (uUseReal > 0.5) forest = imgForest(textureLod(uImg, winUV(p), 0.0).rgb) * smoothstep(1.2, 0.65, slope) * smoothstep(0.1, 0.7, hw);
  // Tree crowns grouped in clumps about a unit and a half across, up to ~0.35 high.
  float cl = 0.5 + 0.35 * pnoise(p, 210.0 * K) + 0.25 * pnoise(p + 0.5, 430.0 * K);
  float canopy = forest * (0.1 + 0.25 * clamp(cl, 0.0, 1.0));
  float grain = 0.5 + 0.5 * pnoise(p + 0.61, 70.0 * K) * 0.7 + 0.3 * pnoise(p, 260.0 * K);
  gl_FragColor = vec4((h0 + canopy - TER_LO) / TER_RANGE, forest, (h0 - TER_LO) / TER_RANGE, clamp(grain, 0.0, 1.0));
}
`;
export const TER_L_FRAG = `
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform sampler2D uTerH;
uniform vec3 uMoonDir;
uniform float uMode;
uniform sampler2D uImg;
uniform float uUseReal;
uniform vec2 uOrigin;
vec2 winUV(vec2 p){ return fract(p - uOrigin + 0.5); }
varying vec2 vUv;
${COMMON}
${WORLD}
${TERRAIN_COMMON}
float tH(vec2 xz){ return textureLod(uTerH, xz / uTT, 0.0).r * TER_RANGE + TER_LO; }
// highest horizon (as the tangent of its angle) from height y0 looking along dir
float horizonTan(vec2 xz, float y0, vec2 dir){
  float m = 0.0, s = 0.35;
  for (int i = 0; i < 30; i++){
    m = max(m, (tH(xz + dir * s) - y0) / s);
    s *= 1.19;
  }
  return m;
}
void main(){
  vec2 xz = gl_FragCoord.xy / ${TER_N}.0 * uTT;
  vec4 H = textureLod(uTerH, gl_FragCoord.xy / ${TER_N}.0, 0.0);
  float hs = H.r * TER_RANGE + TER_LO, hg = H.b * TER_RANGE + TER_LO;
  bool water = hg < WATER_Y;
  float y0 = max(hs, WATER_Y) + 0.04;
  float e = TER_TEXEL;
  vec3 n = normalize(vec3(tH(xz - vec2(e, 0.0)) - tH(xz + vec2(e, 0.0)), 2.0 * e,
                          tH(xz - vec2(0.0, e)) - tH(xz + vec2(0.0, e))));
  if (uMode < 0.5){
    // soft shadow toward the (fixed) moon
    float sh = 1.0, s = 0.2;
    for (int i = 0; i < 56; i++){
      vec3 q = vec3(xz.x, y0, xz.y) + uMoonDir * s;
      if (q.y > TER_LO + TER_RANGE) break;
      sh = min(sh, 7.0 * (q.y - tH(q.xz)) / s);
      if (sh < 0.0) break;
      s = s * 1.07 + 0.08;
    }
    sh = smoothstep(0.0, 1.0, clamp(sh, 0.0, 1.0));
    float ndl = water ? 1.0 : max(dot(n, uMoonDir), 0.0);
    // sky visibility: how much of the sky the horizon leaves open, over 8 directions
    float vis = 0.0;
    for (int k = 0; k < 8; k++){
      float a = float(k) * 0.785398 + 0.39;
      float m = horizonTan(xz, y0, vec2(cos(a), sin(a)));
      vis += 1.0 - m / sqrt(1.0 + m * m);
    }
    vis /= 8.0;
    vis *= mix(1.0, 0.75, H.g);   // under the canopy
    gl_FragColor = vec4(ndl * sh, vis, H.g, water ? 1.0 : 0.0);
  } else if (uMode < 1.5){
    float hw = hg - WATER_Y;
    float steep = smoothstep(0.22, 0.5, 1.0 - n.y);
    vec3 rock = vec3(0.150, 0.145, 0.138) * (0.65 + 0.7 * H.a);
    vec3 meadow = mix(vec3(0.085, 0.095, 0.055), vec3(0.12, 0.115, 0.09), H.a);
    vec3 alb = mix(meadow, rock, max(steep, smoothstep(16.0, 24.0, hw + H.a * 4.0)));
    float crown = clamp((hs - hg) / 0.35, 0.0, 1.0);
    vec3 trees = mix(vec3(0.020, 0.032, 0.020), vec3(0.040, 0.058, 0.034), crown);
    alb = mix(alb, trees, H.g);
    alb = mix(alb, vec3(0.060, 0.056, 0.050), smoothstep(0.7, 0.05, hw) * (1.0 - H.g));   // wet shore
    if (uUseReal > 0.5) alb = pow(textureLod(uImg, winUV(xz / uTT), 0.0).rgb, vec3(2.2)) * (0.75 + 0.5 * H.a);   // the real colour of the land
    if (water) alb = mix(vec3(0.07, 0.065, 0.055), alb, 0.4);                                // lake bed
    gl_FragColor = vec4(sqrt(alb), 1.0);
  } else {
    gl_FragColor = vec4(horizonTan(xz, y0, vec2(1.0, 0.0)), horizonTan(xz, y0, vec2(0.0, 1.0)),
                        horizonTan(xz, y0, vec2(-1.0, 0.0)), horizonTan(xz, y0, vec2(0.0, -1.0))) * 0.5;
  }
}
`;

// Town lights, baked once: R the warm light the lamps throw on the ground around them,
// G the lamps themselves as small soft points. Towns sit on dry, gentle ground (valley
// floors and lake shores), about one candidate site in three of a 7 x 7 grid per tile;
// lamps lie on a fine grid (580 per tile, about every half unit), dense along each
// town's rotated street grid, thinning toward a ragged edge, with a few lone lights
// scattered across the valleys.
export const TER_T_FRAG = `
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform sampler2D uTerH;
// Always 0. It only keeps the loop bounds below from being compile-time constants: with constant
// bounds the Windows (D3D) shader compiler unrolls these nested loops into a huge program and
// takes minutes to compile it.
uniform int uZ;
varying vec2 vUv;
${COMMON}
${WORLD}
${TERRAIN_COMMON}
#define TOWN_N (7.0 * uTT / 320.0)    // the same density of towns and lamps on a larger tile
#define LAMP_N (580.0 * uTT / 320.0)
#define LC (uTT / LAMP_N)
vec2 wrapd(vec2 v){ return mod(v + 0.5 * uTT, uTT) - 0.5 * uTT; }
float gH(vec2 xz){ return textureLod(uTerH, xz / uTT, 0.0).b * TER_RANGE + TER_LO; }
// a town in grid cell 'cell': centre, radius and street angle (radius 0: no town)
vec4 townAt(vec2 cell){
  vec4 h = hash42(mod(cell, TOWN_N) * 1.31 + 7.7);
  if (h.x > 0.36) return vec4(0.0);
  return vec4((cell + 0.2 + 0.6 * h.yz) * (uTT / TOWN_N), 2.5 + 5.5 * h.w * h.w, h.x * 23.0);
}
void main(){
  vec2 xz = gl_FragCoord.xy / ${TER_N}.0 * uTT;
  vec2 tc = floor(xz / (uTT / TOWN_N));
  vec4 T[9];
  for (int k = 0; k < 9 + uZ; k++) T[k] = townAt(tc + vec2(float(k % 3) - 1.0, float(k / 3) - 1.0));
  float irr = 0.0, dots = 0.0;
  vec2 lc0 = floor(xz / LC);
  for (int j = -3; j <= 3 + uZ; j++) for (int i = -3; i <= 3 + uZ; i++){
    vec2 lc = lc0 + vec2(float(i), float(j));
    vec3 lh = hash33(vec3(mod(lc, LAMP_N), 3.7));
    vec2 lp = (lc + 0.15 + 0.7 * lh.xy) * LC;
    // how likely a lamp is here: the towns' streets and houses, or a lone farmhouse
    float dens = 0.0015;
    for (int k = 0; k < 9 + uZ; k++){
      if (T[k].z <= 0.0) continue;
      vec2 d = wrapd(lp - T[k].xy);
      float r = length(d);
      if (r > T[k].z) continue;
      float ca = cos(T[k].w), sa = sin(T[k].w);
      vec2 g = abs(fract(vec2(ca * d.x + sa * d.y, -sa * d.x + ca * d.y) / 1.1) - 0.5);
      float street = min(g.x, g.y) < 0.12 ? 0.95 : 0.3;
      float edge = smoothstep(T[k].z, T[k].z * 0.3, r * (0.85 + 0.3 * lh.z));
      dens = max(dens, edge * street);
    }
    if (lh.z > dens) continue;
    // only on dry, gentle ground
    float hg = gH(lp);
    if (hg - WATER_Y < 0.25) continue;
    float sl = length(vec2(gH(lp + vec2(0.3, 0.0)) - hg, gH(lp + vec2(0.0, 0.3)) - hg)) / 0.3;
    if (sl > 0.45) continue;
    float P = 0.6 + 0.8 * fract(lh.z * 13.7 + lh.x * 7.1);
    vec2 dv = wrapd(xz - lp);
    float d2 = dot(dv, dv);
    irr += P * 0.03 / (0.03 + d2) * exp(-sqrt(d2) * 0.9);   // its pool of light on the ground
    dots += P * exp(-d2 / 0.026);                              // the lamp itself, about a texel across
  }
  // Roads: each town links to any town in the cells ahead of it and diagonally beside it
  // (so each pair once), within 80 units. A road bows gently and wanders; its lamps,
  // about every 0.9 units with a few missing, stop over water and on steep ground, so a
  // road breaks where it crosses a lake or climbs a ridge.
  for (int b = 0; b < 25 + uZ; b++){
    vec2 cb = tc + vec2(float(b % 5) - 2.0, float(b / 5) - 2.0);
    vec4 TA = townAt(cb);
    if (TA.z <= 0.0) continue;
    for (int e = 0; e < 4 + uZ; e++){
      vec2 off = e == 0 ? vec2(1.0, -1.0) : e == 1 ? vec2(1.0, 0.0) : e == 2 ? vec2(1.0, 1.0) : vec2(0.0, 1.0);
      vec4 TB = townAt(cb + off);
      if (TB.z <= 0.0) continue;
      vec2 ab = TB.xy - TA.xy;
      float L = length(ab);
      if (L > 80.0) continue;
      vec2 dir = ab / L, nrm = vec2(-dir.y, dir.x);
      vec2 pa = wrapd(xz - TA.xy);
      float sp = dot(pa, dir);
      if (sp < -2.0 || sp > L + 2.0) continue;
      float h = hash12(mod(cb, TOWN_N) * 3.1 + float(e) * 1.7 + 0.3);
      float bow = (h - 0.5) * 0.3 * L;
      float c0 = bow * sin(3.14159 * clamp(sp / L, 0.0, 1.0)) + 1.2 * sin(sp * 0.21 + h * 20.0);
      if (abs(dot(pa, nrm) - c0) > 2.6) continue;               // too far from this road
      const float SP = 0.9;
      float i0 = floor((sp - 1.8) / SP);
      for (int q = 0; q < 6 + uZ; q++){
        float ls = (i0 + float(q)) * SP;
        if (ls < TA.z * 0.8 || ls > L - TB.z * 0.8) continue;   // inside a town the town's own lamps take over
        float hl = hash12(vec2(i0 + float(q), h * 91.0));
        if (hl < 0.18) continue;
        vec2 lp = TA.xy + dir * ls + nrm * (bow * sin(3.14159 * ls / L) + 1.2 * sin(ls * 0.21 + h * 20.0));
        float hg = gH(lp);
        if (hg - WATER_Y < 0.25) continue;
        float sl = length(vec2(gH(lp + vec2(0.3, 0.0)) - hg, gH(lp + vec2(0.0, 0.3)) - hg)) / 0.3;
        if (sl > 0.6) continue;
        float P = 0.45 + 0.35 * hl;
        vec2 dv = wrapd(xz - lp);
        float d2 = dot(dv, dv);
        irr += P * 0.03 / (0.03 + d2) * exp(-sqrt(d2) * 0.9);
        dots += P * exp(-d2 / 0.026);
      }
    }
  }
  gl_FragColor = vec4(irr, dots, 0.0, 1.0);
}
`;

// Daytime sky colour (no sun disc, no dimming at night), shared by the sky and the ground.
export const DAY_SKY = `
vec3 daySkyBase(vec3 rd, vec3 s, float twi){
  float y = max(rd.y, 0.0);
  vec3 col = mix(vec3(0.60, 0.76, 0.98), vec3(0.09, 0.26, 0.72), pow(y, 0.45));
  float cs = dot(rd, s);
  col += vec3(1.0, 0.82, 0.55) * (0.30 * pow(max(cs, 0.0), 6.0) + 0.9 * pow(max(cs, 0.0), 64.0));
  vec2 hd = normalize(rd.xz + 1e-5), sd = normalize(s.xz + 1e-5);
  float az = max(dot(hd, sd), 0.0);
  vec3 warm = mix(vec3(0.95, 0.40, 0.14), vec3(0.30, 0.20, 0.45), smoothstep(0.0, 0.5, y));
  col = mix(col, warm * (0.25 + 0.75 * az * az), twi * 0.8 * exp(-y * 3.0) * (0.35 + 0.65 * az));
  col = mix(col, col * vec3(0.45, 0.5, 0.75), twi * 0.4);
  return col;
}
float daySkyScale(vec3 s){ return 0.04 + 0.96 * smoothstep(-0.15, 0.25, s.y); }
`;
export const CLOUD_FRAG = `
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform float uDensity;   // cloud thickness (extinction); default 4.0
uniform vec3 uCamPos, uCamR, uCamU, uCamF, uMoonDir;
uniform float uTanHalf, uAspect, uTime, uFrame;
uniform float uNoClouds;
uniform vec3 uSunDir, uDayLift;   // shared with the composite: the sun, and what it multiplies the baked light by in daytime
uniform float uDayAmt, uTwi;
varying vec2 vUv;
${COMMON}
${DAY_SKY}

const vec3 MOON_COOL = vec3(0.74, 0.84, 1.00);
const vec3 MOON_WARM = vec3(1.00, 0.88, 0.70);
const vec3 AMB_LO = vec3(0.0060, 0.0085, 0.0170);
const vec3 AMB_HI = vec3(0.040, 0.060, 0.118);
${WORLD}
${BAKED}
${LIGHTNING}
// optical depth toward the moon (x) and toward the sky above (y), from the bake
uniform sampler3D uLight, uLight2;   // baked lighting (R: toward the moon, G: toward the sky), from / to
vec2 baked(vec3 p){
  vec3 uvw = vec3(p.x / TILE, p.z / TILE, (p.y - Y_MIN) / (Y_MAX - Y_MIN));
  vec2 b = texture(uLight, uvw).rg;
  if (uMorph > 0.0) b = mix(b, texture(uLight2, uvw).rg, morphAt(p));
  return vec2(-log(max(1.0 - b.x, 2e-3)) * 4.0, -log(max(1.0 - b.y, 2e-3)) * 2.5);
}
// light reaching p: two crisp local samples, then the baked shadow beyond them.
// Far away only the bake is read; between 55 and 80 units the two are blended.
vec2 lightAt(vec3 p, float t){
  float f = smoothstep(55.0, 80.0, t);
  vec2 farL = f > 0.0 ? baked(p + uMoonDir * 0.3) : vec2(0.0);
  if (f >= 1.0) return farL;
  float od = densLight(shapeSD(p + uMoonDir * 0.15)) * 0.3 + densLight(shapeSD(p + uMoonDir * 0.45)) * 0.3;
  vec2 b = baked(p + uMoonDir * 0.6);
  return mix(vec2(od + b.x, b.y), farL, f);
}
// Optical depth toward the sun. The bake only knows the moon's fixed direction, but the sun moves,
// so this is read live from the baked shape: two crisp samples near the point (with the fine
// detail), then six coarse ones out to ~36 units. (Same units and far-shadow fill-in as the bake.)
float sunOd(vec3 p, float t){
  vec3 d = uSunDir;
  float od = 0.0;
  if (t < 80.0) od += (densLight(shapeSD(p + d * 0.15)) + densLight(shapeSD(p + d * 0.45))) * 0.3;
  else od += (densLight(bakedSD(p + d * 0.15)) + densLight(bakedSD(p + d * 0.45))) * 0.3;
  od += densLight(bakedSD(p + d * 1.1)) * 1.00 * 0.978;
  od += densLight(bakedSD(p + d * 2.4)) * 1.60 * 0.953;
  od += densLight(bakedSD(p + d * 4.8)) * 3.20 * 0.908;
  od += densLight(bakedSD(p + d * 9.2)) * 5.60 * 0.832;
  od += densLight(bakedSD(p + d * 16.0)) * 8.00 * 0.726;
  od += densLight(bakedSD(p + d * 28.0)) * 16.0 * 0.571;
  return od;
}

float planeSpacing(float dz){
  return 0.06 * exp2(max(0.0, floor(log2(max(dz, 1e-3) / 5.0)) + 1.0));
}
float nextPlaneSp(float roz, float rz, float t, float sp){
  float zp = roz - t * rz;
  float zn = (ceil(zp / sp) - 1.0) * sp;
  if (zn > zp - 1e-4) zn -= sp;
  return (roz - zn) / rz;
}
// The next regular sample after t, on spacing sp (spB is this band's spacing). The band
// edges move with the camera, so if that sample falls past this band's far edge it must
// be on the next band's grid: a plane from the finer grid there would carry the coarser
// band's weight and exist only until the edge moved past it, flickering cloud in and out.
// (Band b spans dz up to 5 * 2^b with spacing 0.06 * 2^b, so its far edge is spB * 5 / 0.06.)
float nextSampleT(float roz, float rz, float t, float sp, float spB, bool refine){
  float tn = nextPlaneSp(roz, rz, t, sp);
  if (tn * rz >= spB * (5.0 / 0.06)) tn = nextPlaneSp(roz, rz, t, refine ? spB : 2.0 * spB);
  return tn;
}
// ray distance to the next world-anchored z-plane beyond distance t
float nextPlaneT(float roz, float rz, float t){
  float sp = planeSpacing(t * rz);
  float zp = roz - t * rz;
  float zn = (ceil(zp / sp) - 1.0) * sp;
  if (zn > zp - 1e-4) zn -= sp;
  return (roz - zn) / rz;
}
float hg(float c, float g){ float g2 = g * g; return (1.0 - g2) / (12.566 * pow(1.0 + g2 - 2.0 * g * c, 1.5)); }

void main(){
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamF + uCamR * ndc.x * uTanHalf * uAspect + uCamU * ndc.y * uTanHalf);
  vec3 ro = uCamPos;

  // How far the march reaches: further for rays rising over the horizon, blended by
  // height so neighbouring rays never switch between two limits from one frame to the next.
  float tFar = mix(FAR_LO, FAR_HI, smoothstep(0.0, 0.04, rd.y));
  float tMax = tFar;
  // (rays that leave through the base of the deck see the ocean far below)
  if (rd.y > 0.0) tMax = min(tMax, (Y_MAX - ro.y) / rd.y);
  else tMax = min(tMax, (Y_MIN - ro.y) / rd.y);

  float cosT = dot(rd, uMoonDir);
  float ph0 = mix(hg(cosT, -0.22), hg(cosT, 0.80), 0.70);
  float ph1 = mix(hg(cosT, -0.11), hg(cosT, 0.42), 0.70);
  float ph2 = mix(hg(cosT, -0.05), hg(cosT, 0.20), 0.70);
  float backlit = smoothstep(0.35, 0.97, cosT);
  // Daytime: the same shading with the sun as the light. The composite multiplies everything by
  // uDayLift in daytime, so the day colours below are divided by it here.
  vec3 invL = 1.0 / uDayLift;
  float cosS = dot(rd, uSunDir);
  float sph0 = mix(hg(cosS, -0.22), hg(cosS, 0.80), 0.70);
  float sph1 = mix(hg(cosS, -0.11), hg(cosS, 0.42), 0.70);
  float sph2 = mix(hg(cosS, -0.05), hg(cosS, 0.20), 0.70);
  float backlitS = smoothstep(0.35, 0.97, cosS);
  float sunUp = smoothstep(0.0, 0.4, uSunDir.y);
  float skyS = daySkyScale(uSunDir);
  vec3 sunCol = mix(vec3(1.0, 0.45, 0.2), vec3(1.0, 0.96, 0.88), sunUp) * smoothstep(0.0, 0.12, uSunDir.y);
  vec3 ambLoD = vec3(0.16, 0.20, 0.30) * skyS;   // under a cloud: the dim light bounced up from the land
  vec3 ambHiD = vec3(0.80, 0.98, 1.30) * skyS;   // on top: the open sky
  vec3 fogC = mix(skyBase(rd, uMoonDir) * 0.94, daySkyBase(rd, uSunDir, uTwi) * skyS * 0.94 * invL, uDayAmt);
  vec3 AIR_C = mix(vec3(0.0060, 0.0112, 0.0245) * 0.94,   // the sky's plain horizon blue
                   daySkyBase(normalize(vec3(-uSunDir.x, 0.1, -uSunDir.z)), uSunDir, uTwi) * skyS * 0.94 * invL, uDayAmt);

  float jit = ign(gl_FragCoord.xy + mod(uFrame, 64.0) * 5.588238);
  vec3 S = vec3(0.0);
  float T = 1.0;
  float dSum = 0.0, wSum = 0.0;
  // Samples sit on planes fixed in the world (constant z, spacing doubling with
  // distance), so flying forward never slides the sample slices through a cloud.
  // (planes are perpendicular to whichever horizontal axis the ray runs along most, mirrored so that the march always
  // goes toward smaller coordinates: the grid is symmetric, so every heading gets the stable planar sampling)
  bool alongX = abs(rd.x) > abs(rd.z);
  float rcomp = alongX ? rd.x : rd.z;
  float rz = abs(rcomp);
  float roz = (rcomp > 0.0 ? -1.0 : 1.0) * (alongX ? ro.x : ro.z);
  bool planar = rz > 0.25;
  float t = planar ? nextPlaneT(roz, rz, 0.05) : 0.05 + jit * 0.22;
  float SIG = uDensity;   // extinction; live setting
  const float MOON_I = 3.1;
  const float SUN_D = 44.0;   // the sun, as it should look on screen (the moonlit clouds were 3.1 x 14 = 43)
  const float RAMP_K = 0.5;   // how strongly distant cloud edges soften (0 = not at all)
  vec3 lightCol = mix(MOON_COOL, MOON_WARM, smoothstep(0.55, 0.985, cosT));

  if (uNoClouds > 0.5) t = tMax + 1.0;   // debug view (?noclouds): the ground alone
  for (int i = 0; i < 300; i++){
    if (t > tMax || T < 0.012) break;
    vec3 p = ro + rd * t;
    gBias = bigBias(p.xz);
    float sd = shapeSD(p);
    float spB = planar ? planeSpacing(t * rz) : 0.0;
    // Near a cloud surface, step on a 4x finer set of (still world-fixed) planes so
    // small puffs and wisps are always caught rather than slipping between samples.
    bool refine = planar && spB > 0.13 && sd > -1.5 * spB;
    float sp = refine ? spB * 0.5 : spB;
    float dt = planar ? sp / rz : 0.08 + t * 0.016;
    float dtW = dt;
    if (planar){
      // Over the far half of each spacing band, every other plane (refined or not)
      // fades out and its neighbours take over its share, so the step to the next,
      // coarser spacing happens gradually instead of all at once.
      float lam = log2(max(t * rz, 1e-3) / 5.0) + 1.0;
      float f = lam > 0.0 ? smoothstep(0.5, 1.0, fract(lam)) : 0.0;
      bool odd = mod(floor((roz - t * rz) / sp + 0.5), 2.0) > 0.5;
      dtW = dt * (odd ? 1.0 - f : 1.0 + f);
    }
    if (sd < -0.32){
      // The baked field is not a true distance: near some surfaces (anvils, turrets) it
      // changes up to ~6.7x faster than distance, so a long skip can jump right over a
      // cloud, and whether it does flips as the camera moves. Skip only a fifth of it.
      float sk = min(-sd * 0.2, 2.0);
      if (!planar) t += max(dt, sk);
      // no further than one regular step: take exactly that step (t may sit on a finer
      // grid than sp, so stepping a full dt from it could pass over the next plane)
      else if (sk <= dt) t = nextSampleT(roz, rz, t, sp, spB, refine);
      else {
        // land on the grid of the band (and refinement) where the skip ends; a skip of
        // at most 2 units never crosses more than one band edge
        float ts = t + sk;
        float spL = ts * rz >= spB * (5.0 / 0.06) ? 2.0 * spB : spB;
        t = nextPlaneSp(roz, rz, ts - 1e-3, refine ? 0.5 * spL : spL);
      }
      continue;
    }
    float d = 0.0;
    if (sd > -0.3){
      float er = (1.0 - detailN(p)) * 0.36 * smoothstep(170.0, 100.0, t);
      // Far out one sample stands for a thick slab, so with a sharp density ramp a thin
      // wisp's tiny shift on its sample plane becomes a big jump in opacity from one frame
      // to the next. The ramp widens with distance to keep those changes gradual.
      float ramp = 2.0 / max(1.0, RAMP_K * 0.096 * t * rz);
      d = clamp((sd + 0.14 - er * (1.0 - clamp(sd * 0.4, 0.0, 0.7))) * ramp, 0.0, 1.0);
      // Fade cloud out before the far limit. A hard stop there adds or drops a whole
      // sample slab of distant cloud whenever a plane crosses it as the camera moves.
      d *= 1.0 - smoothstep(tFar - 45.0, tFar - 4.0, t);
    }
    if (d > 0.004){
      // by day only the sky-above part of the bake is needed; the moon's shadows are skipped
      vec2 lt = uDayAmt < 0.999 ? lightAt(p, t) : vec2(0.0, baked(p).y);
      float powder = 1.0 - exp(-max(sd, 0.0) * 2.6 - d * 0.5);
      float hgt = clamp((p.y + 6.0) / 15.0, 0.0, 1.0);
      float occ = exp(-max(sd, 0.0) * 0.5) * mix(0.15, 1.0, exp(-lt.y * 0.5));
      vec3 Lm = vec3(0.0), Ls = vec3(0.0);
      if (uDayAmt < 0.999){
        float od = lt.x;
        float e = ph0 * exp(-od * SIG) + 0.34 * ph1 * exp(-od * SIG * 0.40) + 0.14 * ph2 * exp(-od * SIG * 0.17);
        float pf = mix(mix(0.42, 1.0, powder), 1.0, backlit);
        vec3 amb = mix(AMB_LO, AMB_HI, sqrt(hgt)) * (0.28 + 0.72 * occ);
        Lm = lightCol * (MOON_I * e * pf) + amb;
      }
      if (uDayAmt > 0.001){
        float odS = sunOd(p, t);
        float eS = sph0 * exp(-odS * SIG) + 0.34 * sph1 * exp(-odS * SIG * 0.40) + 0.14 * sph2 * exp(-odS * SIG * 0.17);
        float pfS = mix(mix(0.42, 1.0, powder), 1.0, backlitS);
        vec3 ambS = mix(ambLoD, ambHiD, sqrt(hgt)) * (0.28 + 0.72 * occ);
        Ls = (sunCol * (SUN_D * eS * pfS) + ambS) * invL;
      }
      vec3 L = mix(Lm, Ls, uDayAmt);
      if (uFlash > 0.0) L += lightningAt(p);
      float fogA = 1.0 - exp(-t * 0.016 * mix(1.0, 0.3, smoothstep(4.0, 30.0, p.y)));
      // Up close the air is a plain night blue. The sky's colour in this direction (its
      // warm horizon band, the moon's halo) comes from a long path of air, so only
      // distant cloud takes it on; otherwise near clouds wear a stripe of horizon glow.
      L = mix(L, mix(AIR_C, fogC, smoothstep(100.0, 250.0, t)), fogA);
      float tr = exp(-d * SIG * dtW);
      S += T * L * (1.0 - tr);
      float w = T * (1.0 - tr); dSum += w * t; wSum += w;
      T *= tr;
    }
    t = planar ? nextSampleT(roz, rz, t, sp, spB, refine) : t + dt * (0.85 + 0.3 * fract(jit + float(i) * 0.754878));
  }
  // Through a break in the deck the ray goes on down to the flooded mountains, which
  // the ground pass draws next (keeping that work out of this heavy shader): it gets
  // the transmittance left here, and no horizon haze.
  bool ground = rd.y < 0.0 && t >= tMax && T > 0.003 && ((Y_MIN - ro.y) / rd.y <= 200.0 || uNoClouds > 0.5);
  // The cloud sea continues past the march distance: fill the far horizon with haze.
  float far = ground ? 0.0 : smoothstep(-0.002, -0.03, rd.y);
  vec3 farC = mix(fogC * mix(vec3(0.40, 0.44, 0.52), vec3(0.85, 0.90, 0.96), uDayAmt), fogC * 0.8, smoothstep(-0.05, -0.002, rd.y));   // (the dark band low on the horizon is much lighter by day)
  S += T * farC * far;
  dSum += T * far * 250.0; wSum += T * far;
  T *= 1.0 - far;
#ifdef PACK
  // alpha carries depth (integer part, 1/32 unit steps) and transmittance (fraction)
  float depth = wSum > 0.02 ? dSum / wSum : 250.0;
  gl_FragColor = vec4(S, floor(clamp(depth, 0.0, 250.0) * 32.0) + clamp(T, 0.0, 1.0) * 0.999);
#else
  gl_FragColor = vec4(S, T);
#endif
}
`;

// Ground pass: the flooded mountains, for the pixels where the cloud pass's ray left
// through the base of the deck with light to spare. Every other pixel passes straight through.
export const GROUND_FRAG = `
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform sampler2D tCloud;
uniform vec3 uCamPos, uCamR, uCamU, uCamF, uMoonDir;
uniform float uTanHalf, uAspect, uTime;
uniform sampler2D uTerH, uTerA, uTerB, uTerC, uTerL;
uniform float uLamps;   // panel: how bright the town lights are
uniform vec4 uMast[4];  // radio masts on summits: x, z, base height, flash phase
uniform float uMastN;
uniform float uTerTop, uPixAngC, uNoClouds;
uniform vec3 uSunDir, uDayLift;   // shared with the composite
uniform float uDayAmt, uTwi;
varying vec2 vUv;
${COMMON}
${TERRAIN_COMMON}
const vec3 MOON_COOL = vec3(0.74, 0.84, 1.00);
const vec3 MOON_WARM = vec3(1.00, 0.88, 0.70);
${WORLD}
${BAKED}
${LIGHTNING}
${DAY_SKY}
// The flooded mountains below the deck. Everything that doesn't change is baked
// (height, canopy, moonlight and its shadows, sky visibility, colour, horizons), so a
// frame only finds where the ray meets the ground or a lake and adds the live parts:
// the deck's shadow, the moon's glitter on the lakes, and fine texture up close.
float terLod(float t){ return clamp(log2(max(t * uPixAngC, 1e-4) / TER_TEXEL), 0.0, 6.0); }
float terY(vec2 xz, float lod){ return textureLod(uTerH, xz / uTT, lod).r * TER_RANGE + TER_LO; }
vec3 groundView(vec3 ro, vec3 rd, float cosT, out float tHit){
  float tW = (WATER_Y - ro.y) / rd.y;
  float t = max((uTerTop - ro.y) / rd.y, 0.0);
  // a safe step from the height above the ground, for slopes up to ~1.4
  float kS = 1.0 / (-rd.y + 1.4 * length(rd.xz));
  bool land = false;
  float tPrev = t;
  for (int i = 0; i < 90; i++){
    if (t >= tW) break;
    vec3 p = ro + rd * t;
    float dy = p.y - terY(p.xz, terLod(t));
    if (dy < 0.0){ land = true; break; }
    tPrev = t;
    t += max(dy * kS, t * 0.0012);
  }
  if (land){
    float a = tPrev, b = min(t, tW);
    for (int i = 0; i < 6; i++){
      float m = 0.5 * (a + b);
      vec3 p = ro + rd * m;
      if (p.y < terY(p.xz, terLod(m))) b = m; else a = m;
    }
    t = 0.5 * (a + b);
  } else t = tW;
  tHit = t;
  vec3 po = ro + rd * t;
  vec2 uv = po.xz / uTT;
  float lod = terLod(t);
  vec4 A = textureLod(uTerA, uv, lod);
  // is the moon hidden from this spot by the deck above?
  vec3 pc = po + uMoonDir * ((CLOUD_BASE + 1.0 - po.y) / uMoonDir.y);
  float aC = texture(uNoise, vec3(pc.xz * F_A, 0.137)).b;
  float open = 1.0 - smoothstep(0.42, 0.52, coverageAt(pc.xz, aC) + bigBias(pc.xz) * 0.03);
  float lit = mix(0.12, 1.0, open);
  const vec3 MOON_G = vec3(1.10, 1.22, 1.42);       // moonlight on the ground
  const vec3 SKY_G = vec3(0.0050, 0.0068, 0.0120);   // what the night sky adds
  const vec3 LAMP_C = vec3(1.00, 0.44, 0.13);         // warm sodium-orange street lights
  vec3 alb = textureLod(uTerB, uv, lod).rgb;
  alb *= alb;
  vec3 col;
  // Daylight. The baked light is the moon's, so by day the ground is lit here instead: the sun on
  // the slope, shadowed by the land itself and by the cloud deck, plus the sky as ambient light.
  // (The composite multiplies everything by uDayLift in daytime, so that is divided out below.)
  vec3 dayCol = vec3(0.0);
  float sunUp = smoothstep(0.0, 0.4, uSunDir.y);
  float skyS = daySkyScale(uSunDir);
  vec3 sunC = mix(vec3(1.0, 0.45, 0.2), vec3(1.0, 0.95, 0.84), sunUp) * 3.2 * smoothstep(0.0, 0.12, uSunDir.y);
  vec3 amb = vec3(0.0);
  float sOpen = 1.0;
  if (uDayAmt > 0.001){
    amb = mix(daySkyBase(vec3(0.0, 1.0, 0.0), uSunDir, uTwi),
              daySkyBase(normalize(vec3(-uSunDir.x, 0.15, -uSunDir.z)), uSunDir, uTwi), 0.4) * skyS * 0.9;
    if (uSunDir.y > 0.05){
      vec3 pcs = po + uSunDir * ((CLOUD_BASE + 1.0 - po.y) / uSunDir.y);
      float aS = texture(uNoise, vec3(pcs.xz * F_A, 0.137)).b;
      sOpen = 1.0 - smoothstep(0.42, 0.52, coverageAt(pcs.xz, aS) + bigBias(pcs.xz) * 0.03);
    }
  }
  if (land){
    // tree crowns and rock grain finer than the bake, fading out with distance
    float fine = texture(uNoise, vec3(po.xz * 0.8, 0.37)).g;
    alb *= mix(1.0, 0.5 + fine, smoothstep(420.0, 140.0, t) * mix(0.3, 1.0, A.b));
    col = alb * (MOON_G * A.r * lit + SKY_G * A.g);
    // the towns' warm street lights and the pools of light they throw (baked)
    vec2 L = textureLod(uTerL, uv, lod).rg;
    col += LAMP_C * uLamps * (alb * L.x * 1.3 + L.y * 0.6);
    if (uDayAmt > 0.001){
      float e = TER_TEXEL * 1.5;
      vec3 nrm = normalize(vec3(terY(po.xz - vec2(e, 0.0), lod) - terY(po.xz + vec2(e, 0.0), lod), 2.0 * e,
                                terY(po.xz - vec2(0.0, e), lod) - terY(po.xz + vec2(0.0, e), lod)));
      float ndl = max(dot(nrm, uSunDir), 0.0);
      float sh = 1.0;
      if (uSunDir.y > 0.02 && ndl > 0.0){
        float s = 0.4;
        for (int i = 0; i < 26; i++){
          vec3 q = po + uSunDir * s;
          if (q.y > uTerTop) break;
          sh = min(sh, 6.0 * (q.y - terY(q.xz, lod + 1.5)) / s);
          if (sh < 0.0) break;
          s = s * 1.16 + 0.3;
        }
        sh = smoothstep(0.0, 1.0, clamp(sh, 0.0, 1.0));
      }
      dayCol = alb * (sunC * ndl * sh * mix(0.12, 1.0, sOpen) + amb * A.g);
    }
  } else {
    // A lake. From this high up the ripples are far smaller than a pixel, so the water
    // is shaded as a smooth mirror that is slightly rough: the moon's reflection spreads
    // into a soft glitter path, broader where wind patches roughen the surface.
    vec3 r = reflect(rd, vec3(0.0, 1.0, 0.0));
    float cv = max(-rd.y, 1e-3);
    float fres = 0.02 + 0.98 * pow(1.0 - cv, 5.0);
    // a mountain fills the reflection where the baked horizon in that direction is higher
    vec2 az = normalize(r.xz + 1e-5);
    vec4 wgt = max(vec4(az.x, az.y, -az.x, -az.y), 0.0);
    float hT = dot(wgt, textureLod(uTerC, uv, lod) * 2.0) / max(dot(wgt, vec4(1.0)), 1e-3);
    float rT = r.y / max(length(r.xz), 1e-3);
    float mtn = smoothstep(rT - 0.04, rT + 0.04, hT);
    // the reflected sky without the moon's bright halo (the glitter below is the moon's reflection)
    float am = 2.0 * asin(clamp(length(r - uMoonDir) * 0.5, 0.0, 1.0));
    vec3 skyR = skyBase(r, uMoonDir) - vec3(1.00, 0.90, 0.74) * 0.1100 * exp(-am * 28.0) - vec3(1.00, 0.93, 0.80) * 0.4500 * exp(-am * 90.0);
    vec3 refl = mix(skyR, vec3(0.0009, 0.0012, 0.0016), mtn);
    float wind = smoothstep(0.3, 0.75, texture(uNoise, vec3(po.xz * 0.011 + 0.3, 0.61)).b);
    float a2 = pow(mix(0.045, 0.14, wind), 2.0);
    vec3 hv = normalize(uMoonDir - rd);
    float nh = hv.y;
    float D = a2 / (3.14159 * pow(nh * nh * (a2 - 1.0) + 1.0, 2.0));
    float fh = 0.02 + 0.98 * pow(1.0 - max(dot(hv, -rd), 0.0), 5.0);
    float moonSeen = A.r * lit * (1.0 - mtn);
    float depth = WATER_Y - (textureLod(uTerH, uv, lod).b * TER_RANGE + TER_LO);
    vec3 below = vec3(0.0010, 0.0017, 0.0026)
               + alb * (MOON_G * A.r * lit * 0.5 + SKY_G) * 0.4 * exp(-max(depth, 0.0) * 1.6);   // the bed shows in the shallows
    col = below * (1.0 - fres) + refl * fres + MOON_WARM * 0.0035 * D * fh / cv * moonSeen;
    // a lake beside a lit town catches its warm glow (the lamps' light, blurred out)
    col += LAMP_C * uLamps * textureLod(uTerL, uv, lod + 3.0).x * 0.10 * (0.35 + fres);
    if (uDayAmt > 0.001){
      // by day the water mirrors the sky, with the sun's glitter path, over a dark body of water
      vec3 skyD = daySkyBase(r, uSunDir, uTwi) * skyS;
      vec3 reflD = mix(skyD, vec3(0.020, 0.032, 0.028) * (0.3 + 0.7 * sunUp), mtn);
      vec3 hvS = normalize(uSunDir - rd);
      float nhS = hvS.y;
      float DS = a2 / (3.14159 * pow(nhS * nhS * (a2 - 1.0) + 1.0, 2.0));
      float fhS = 0.02 + 0.98 * pow(1.0 - max(dot(hvS, -rd), 0.0), 5.0);
      float sunSeen = sOpen * (1.0 - mtn) * step(0.0, uSunDir.y);
      vec3 bodyD = vec3(0.012, 0.040, 0.060) * (0.25 + 0.75 * sunUp) + alb * (sunC * 0.35 * sunUp + amb) * 0.45 * exp(-max(depth, 0.0) * 1.6);
      dayCol = bodyD * (1.0 - fres) + reflD * fres + sunC * 0.0045 * DS * fhS / cv * sunSeen;
    }
  }
  // Radio masts on a few summits: a thin dark lattice with red aircraft warning lights,
  // a flashing beacon on top and a steady light halfway up. A handful of analytic tests
  // per ground pixel, so the lights sit at the real top of the mast and can blink.
  const vec3 WARN_C = vec3(1.00, 0.05, 0.02);
  const float MAST_H = 1.8, MAST_W = 0.07;
  vec3 beacons = vec3(0.0);
  float rxz = max(dot(rd.xz, rd.xz), 1e-6);
  for (int m = 0; m < 4; m++){
    if (float(m) >= uMastN) break;
    vec4 M = uMast[m];
    // the copy of this mast nearest where the ray passes it
    vec2 mp = po.xz + mod(M.xy - po.xz + 0.5 * uTT, uTT) - 0.5 * uTT;
    vec2 q = ro.xz + rd.xz * clamp(dot(mp - ro.xz, rd.xz) / rxz, 0.0, t);
    mp = q + mod(M.xy - q + 0.5 * uTT, uTT) - 0.5 * uTT;
    float sH = dot(mp - ro.xz, rd.xz) / rxz;          // where the ray passes the mast's line
    if (sH <= 0.0 || sH > t + 2.0) continue;          // behind the camera, or hidden by the ground
    float on = smoothstep(0.0, 0.04, fract(uTime * 0.5 + M.w)) * smoothstep(0.36, 0.26, fract(uTime * 0.5 + M.w));
    float px = uPixAngC * sH;                         // a pixel's width out there
    // the mast itself, at most a pixel wide
    float hgt = ro.y + rd.y * sH - M.z;
    if (hgt > -0.3 && hgt < MAST_H){
      float dh = length(ro.xz + rd.xz * sH - mp), w = max(px, MAST_W);
      float cov = MAST_W / w * max(1.0 - dh / w, 0.0);
      vec3 steel = 0.10 * (MOON_G * 0.5 * lit + SKY_G) + WARN_C * 0.04 * on;
      col = mix(col, steel, cov * 0.85);
    }
    // the two lights: a sharp core about a pixel across and a faint glow in the air
    for (int k = 0; k < 2; k++){
      vec3 v = vec3(mp.x, M.z + MAST_H * (k == 0 ? 1.0 : 0.5), mp.y) - ro;
      float s = dot(v, rd);
      if (s > t + 2.0) continue;
      float r = length(v - rd * s) / (uPixAngC * s);   // in pixels
      float I = k == 0 ? 3.0 * on : 0.7;
      beacons += WARN_C * I * (exp(-r * r * 1.4) + 0.04 * exp(-r * 0.5)) * exp(-s * 0.0028 * 0.8);
    }
    // a flash faintly reddens the summit around the mast's foot
    if (land){
      vec2 dg = po.xz - mp;
      col += WARN_C * on * alb * 0.25 / (1.0 + dot(dg, dg) * 2.0);
    }
  }
  // the dim air between deck and ground
  float haze = 1.0 - exp(-(t - (Y_MIN - ro.y) / rd.y) * mix(0.0028, 0.0009, uDayAmt));   // clearer air by day
  vec3 hazeC = vec3(0.0030, 0.0052, 0.0115) + MOON_COOL * 0.010 * pow(max(cosT, 0.0), 6.0);
  vec3 glow = vec3(0.0);
  if (uFlash > 0.0){
    // a ground strike lights the land and water around it and the rainy air under the deck
    float dg = length(po.xz - uGround.xz);
    col += LCOL * uGroundI * 0.006 / (1.0 + dg * dg * 0.006);
    vec3 pm = ro + rd * ((0.5 * (WATER_Y + Y_MIN) - ro.y) / rd.y);
    vec3 v = segPoint(pm, uLa1, uLb1) - pm;
    glow = LCOL * uLi1 * 0.03 / (1.0 + dot(v, v) * 0.008);
  }
  // by day, the ground and its haze are lit here: divide out what the composite will multiply back
  vec3 invL = 1.0 / uDayLift;
  col = mix(col, dayCol * invL, uDayAmt);
  hazeC = mix(hazeC, daySkyBase(normalize(vec3(rd.x, 0.02, rd.z)), uSunDir, uTwi) * skyS * invL, uDayAmt);
  return mix(col, hazeC, haze * 0.8) + glow + beacons;
}

void main(){
  vec4 c = texelFetch(tCloud, ivec2(gl_FragCoord.xy), 0);
#ifdef PACK
  float dq = floor(c.a), depthC = dq / 32.0, T = (c.a - dq) / 0.999;
#else
  float depthC = 250.0, T = c.a;
#endif
  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamF + uCamR * ndc.x * uTanHalf * uAspect + uCamU * ndc.y * uTanHalf);
  vec3 ro = uCamPos;
  if (!(rd.y < 0.0 && T > 0.003 && ((Y_MIN - ro.y) / rd.y <= 200.0 || uNoClouds > 0.5))){ gl_FragColor = c; return; }
  float tG;
  vec3 S = c.rgb + T * groundView(ro, rd, dot(rd, uMoonDir), tG);
#ifdef PACK
  gl_FragColor = vec4(S, floor(clamp(mix(depthC, tG, T), 0.0, 250.0) * 32.0));
#else
  gl_FragColor = vec4(S, 0.0);
#endif
}
`;

export const RAYS_FRAG = `
precision highp float;
precision highp sampler3D;
uniform sampler2D tCloud;
uniform vec2 uMoonUV;
uniform float uAspect, uMoonRuv, uFrame, uFade, uLumW;
varying vec2 vUv;
${COMMON}
void main(){
  if (uFade <= 0.0){ gl_FragColor = vec4(0.0); return; }
  const int N = 64;
  vec2 delta = (uMoonUV - vUv) / float(N);
  float j = ign(gl_FragCoord.xy);
  vec2 s = vUv + delta * j;
  float decay = 1.0, sum = 0.0;
  for (int i = 0; i < N; i++){
    vec4 c = texture2D(tCloud, s);
    float r = length((s - uMoonUV) * vec2(uAspect, 1.0)) / uMoonRuv;
    float src = c.a * (smoothstep(1.25, 0.75, r) + 0.32 * exp(-r * 0.75) + 0.025 * exp(-r * 0.28));
    float lum = dot(c.rgb, vec3(0.3, 0.5, 0.2));
    src += max(lum - 0.42, 0.0) * uLumW;   // silver linings (muted during a lightning flash)
    sum += src * decay;
    decay *= 0.974;
    s += delta;
  }
  gl_FragColor = vec4(vec3(sum / float(N) * uFade), 1.0);
}
`;

export const TAA_FRAG = `
precision highp float;
uniform sampler2D tCur, tHist;
uniform vec2 uSize;
uniform vec3 uCamPos, uCamR, uCamU, uCamF;
uniform vec3 uPrevPos, uPrevR, uPrevU, uPrevF;
uniform float uTanHalf, uAspect, uPrevTanHalf, uPrevAspect, uReset;
varying vec2 vUv;
vec4 unpack(vec4 c, out float depth){
  float dq = floor(c.a);
  depth = dq / 32.0;
  return vec4(c.rgb, (c.a - dq) / 0.999);
}
void main(){
  ivec2 ip = ivec2(gl_FragCoord.xy);
  ivec2 mx = ivec2(uSize) - 1;
  vec4 m1 = vec4(0.0), m2 = vec4(0.0), cur = vec4(0.0);
  float dMin = 1e9;
  for (int j = -1; j <= 1; j++){
    for (int i = -1; i <= 1; i++){
      float d;
      vec4 c = unpack(texelFetch(tCur, clamp(ip + ivec2(i, j), ivec2(0), mx), 0), d);
      if (i == 0 && j == 0) cur = c;
      dMin = min(dMin, d);
      m1 += c; m2 += c * c;
    }
  }
  m1 /= 9.0; m2 /= 9.0;
  vec4 sig = sqrt(max(m2 - m1 * m1, 0.0));
  vec4 lo = m1 - 1.7 * sig, hi = m1 + 1.7 * sig;

  // where was this surface last frame?
  vec2 uv = (vec2(ip) + 0.5) / uSize;
  vec2 ndc = uv * 2.0 - 1.0;
  vec3 rd = normalize(uCamF + uCamR * ndc.x * uTanHalf * uAspect + uCamU * ndc.y * uTanHalf);
  vec3 v = dMin > 240.0 ? rd : (uCamPos + rd * dMin - uPrevPos);
  float z = dot(v, uPrevF);
  vec4 outc = cur;
  if (uReset < 0.5 && z > 1e-4){
    vec2 pu = 0.5 + 0.5 * vec2(dot(v, uPrevR) / (z * uPrevTanHalf * uPrevAspect), dot(v, uPrevU) / (z * uPrevTanHalf));
    if (pu.x >= 0.0 && pu.y >= 0.0 && pu.x <= 1.0 && pu.y <= 1.0){
      vec4 h = clamp(texture2D(tHist, pu), lo, hi);
      float motion = length((pu - uv) * uSize);
      float a = mix(0.06, 0.18, clamp(motion / 8.0, 0.0, 1.0));
      outc = mix(h, cur, a);
    }
  }
  gl_FragColor = max(outc, vec4(0.0));
}
`;

// A few bright "hero" stars low over the horizon ahead: [degrees right of straight
// ahead (-z), degrees above the horizon, brightness, colour, twinkle]. They sit clear
// of the moon (15 degrees left, 12 up). Low down they are dimmed and reddened by the
// long path through the air. The lowest is a planet like Mars, which barely twinkles.
export const HERO_STARS = [
  [1, 2.5, 6.0, [1.00, 0.56, 0.36], 0.3],   // the lowest, near the middle: reddish and steadier, like Mars
  [16, 5.5, 7.0, [0.82, 0.89, 1.00], 1],    // blue-white, like Vega
  [27, 9.0, 5.5, [1.00, 0.93, 0.80], 1],    // warm white
  [-28, 6.0, 5.0, [0.94, 0.96, 1.00], 1]    // white
];
export const HERO_GLSL = HERO_STARS.map(([az, el, b, c, twk]) => {
  const A = az * Math.PI / 180, E = el * Math.PI / 180;
  const d = [Math.sin(A) * Math.cos(E), Math.sin(E), -Math.cos(A) * Math.cos(E)];
  const ext = 0.35 + 0.65 * Math.min(Math.max(el / 14, 0), 1);          // extinction near the horizon
  const warm = 1 - Math.min(Math.max(el / 12, 0), 1);
  const col = [c[0], c[1] * (1 - 0.15 * warm), c[2] * (1 - 0.35 * warm)].map(v => (v * b * ext).toFixed(3));
  const f = (v) => v.toFixed(5);
  return `  col += heroStar(rd, vec3(${f(d[0])}, ${f(d[1])}, ${f(d[2])}), vec3(${col.join(', ')}), ${((0.18 + 0.25 * warm) * twk).toFixed(3)}, ${(az * 0.37).toFixed(2)});`;
}).join('\n');

export const COMPOSITE_FRAG = `
precision highp float;
precision highp sampler3D;
uniform sampler2D tCloud, tRays, tBolt;
uniform sampler3D uNoise;
uniform float uBoltOn;
uniform vec3 uSkyFlash, uFlashDir;
uniform vec2 uCloudTexel, uRes;
uniform vec3 uCamR, uCamU, uCamF, uMoonDir;
uniform float uTanHalf, uAspect, uTime, uFrame, uPixAng, uMoonR, uExposure, uMoonReady;
uniform float uTwinkle, uStarLow;   // Sky panel: how much stars twinkle, how low they reach
uniform vec3 uMetA, uMetB;   // a shooting star: where it starts and where it would end on the sky
uniform vec4 uMet;           // progress 0..1, brightness, trail length (fraction of the path), 1 while one is up
uniform vec4 uFar;           // a storm beyond the horizon: its direction (level) and how bright it is flashing now
uniform vec3 uFarShape;      // the glow's half-width (radians across), centre height and height scale (radians)
uniform vec4 uFarCol;        // the glow's colour, and how much it lights the nearer clouds
uniform float uAirOn;        // 1 while an aircraft or its contrail is in the sky
uniform vec3 uAirW, uAirR, uAirG;   // directions to its white light and its red and green wingtip lights
uniform vec3 uAirI;          // how bright each of those is now
uniform vec3 uConA, uConB;   // its contrail as a straight segment, oldest end to newest, relative to the camera
uniform vec4 uCon;           // the contrail's age at A and at B (seconds), its fade time, its brightness
uniform float uGlitter;      // how much the contrail's ice crystals glint
uniform sampler2D uMoonMap;
uniform float uMoonPhase;   // 0 new, 0.25 first quarter, 0.5 full, 0.75 last quarter
uniform vec3 uBalance, uShadowTint, uHighTint, uSunDir;
uniform float uDayAmt, uNightAmt, uTwi;
uniform vec3 uDayLift;   // what the baked light is multiplied by in daytime (the ground divides this out)   // day/night cycle: how much day, how much night (stars, moon), how much twilight
uniform float uShadowAmt, uHighAmt, uLift, uSat, uContrast, uVignette, uGrain, uRays;
varying vec2 vUv;
${COMMON}

// Film grain: soft value noise on a lattice a little over a pixel across (scaled with
// the screen, as grain is a fixed size on the film frame).
float grainN(vec2 p, float s){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 o = vec2(s * 37.0, s * 91.0);
  return mix(mix(hash12(i + o), hash12(i + o + vec2(1.0, 0.0)), f.x),
             mix(hash12(i + o + vec2(0.0, 1.0)), hash12(i + o + vec2(1.0, 1.0)), f.x), f.y) - 0.5;
}

// Twinkling: the air's turbulence flickers a star a few times a second, irregularly.
// amp is how deep the flicker goes.
float twinkle(float seed, float amp){
  float n = 0.5 * sin(uTime * (11.0 + 7.0 * fract(seed * 1.37)) + seed * 40.0)
          + 0.3 * sin(uTime * (17.0 + 9.0 * fract(seed * 2.11)) + seed * 13.0)
          + 0.2 * sin(uTime * (5.0 + 3.0 * fract(seed * 3.70)) + seed * 7.0);
  return 1.0 - amp * (0.5 + 0.5 * n);
}
vec3 stars(vec3 rd){
  vec3 col = vec3(0.0);
  for (int l = 0; l < 2; l++){
    float sc = l == 0 ? 150.0 : 330.0;
    float thr = l == 0 ? 0.9935 : 0.9915;
    thr -= (1.0 - smoothstep(0.0, 0.3, rd.y)) * (l == 0 ? 0.0065 : 0.0085);   // twice as many low over the horizon
    float w = max(0.045, uPixAng * sc * 0.85);
    vec3 p = rd * sc;
    vec3 c0 = floor(p);
    vec3 fp = fract(p);
    vec3 s = step(0.5, fp) * 2.0 - 1.0;   // toward the nearer neighbour on each axis
    // a neighbour's star only reaches this pixel across a face closer than 2.5 widths
    // (further out its glow is under 0.2% of its peak)
    vec3 skipAx = step(2.5 * w, min(fp, 1.0 - fp));
    // Each star sits on the sky sphere inside the cell that owns it, and every pixel
    // checks its own cell and the nearest neighbours a star could reach it from.
    // Checking only its own cell cut stars off at cell faces, so they vanished in one
    // frame as the view turned.
    for (int k = 0; k < 8; k++){
      vec3 o = vec3(mod(float(k), 2.0), mod(floor(float(k) * 0.5), 2.0), floor(float(k) * 0.25));
      if (dot(o, skipAx) > 0.0) continue;
      vec3 id = c0 + o * s;
      vec3 h = hash33(id + float(l) * 71.3);
      if (h.x < thr) continue;
      vec3 h2 = hash33(id * 1.7 + 11.0);
      vec3 pt = normalize(id + 0.5 + (h2 - 0.5) * 0.55) * sc;
      if (any(notEqual(floor(pt), id))) continue;
      vec3 v = pt - rd * dot(pt, rd);
      float d = length(v);
      float mag = (l == 0 ? 1.0 : 0.45) * (0.18 + 2.6 * pow(h2.y, 7.0));
      // twinkling, deeper low down where the starlight crosses more air
      float tw = twinkle(h.y + h2.x * 3.1, min(mix(0.6, 0.32, smoothstep(0.05, 0.45, rd.y)) * uTwinkle, 1.0));
      vec3 tint = mix(vec3(0.70, 0.80, 1.00), vec3(1.00, 0.88, 0.72), h.z);
      col += tint * mag * tw * exp(-d * d / (w * w)) * (0.045 * 0.045) / (w * w);
    }
  }
  return col;
}

// one bright star at a fixed direction: a pixel-sized core, a faint glow, and twinkling
// that grows stronger toward the horizon (tw: how much)
vec3 heroStar(vec3 rd, vec3 dir, vec3 col, float tw, float ph){
  vec3 v = rd - dir;
  float th2 = dot(v, v);
  float wr = max(uPixAng * 0.9, 3.0e-4);
  if (th2 > 900.0 * wr * wr) return vec3(0.0);
  float core = exp(-th2 / (wr * wr)) * (9.0e-8 / (wr * wr));
  float glow = 0.025 * exp(-sqrt(th2) / (wr * 3.0)) * (3.0e-4 / wr);
  return col * (core + glow) * twinkle(ph * 0.137 + 0.5, min(tw * 1.6 * uTwinkle, 1.0));
}
vec3 heroStars(vec3 rd){
  vec3 col = vec3(0.0);
${HERO_GLSL}
  return col;
}

// A shooting star: a streak along a great circle whose bright head runs from A toward B,
// leaving a trail that fades behind it. It flares up, then burns out before reaching B.
// The head is a hot blue-green white, the trail cooler and warmer.
vec3 meteor(vec3 rd){
  vec3 n = normalize(cross(uMetA, uMetB));
  float dn = dot(rd, n);
  float w = max(uPixAng * 0.7, 2.0e-4);
  if (abs(dn) > 6.0 * w) return vec3(0.0);
  float ang = acos(clamp(dot(uMetA, uMetB), -1.0, 1.0));
  vec3 q = rd - n * dn;
  float s = atan(dot(cross(uMetA, q), n), dot(uMetA, q)) / ang;   // 0 at A, 1 at B
  float p = uMet.x, tl = max(uMet.z, 1e-3);
  float k = (s - (p - tl)) / tl;                                   // 0 at the trail's end, 1 at the head
  if (s < 0.0 || k < 0.0 || s > p + 6.0 * w / ang) return vec3(0.0);
  float across = exp(-dn * dn / (w * w));
  float trail = k < 1.0 ? k * k : 0.0;
  float ds = (s - p) * ang;
  float head = 2.2 * exp(-(ds * ds + dn * dn) / (w * w * 2.0));
  float env = smoothstep(0.0, 0.12, p) * smoothstep(1.0, 0.72, p) * (0.6 + 0.6 * p);
  vec3 c = mix(vec3(1.00, 0.80, 0.55), vec3(0.85, 1.00, 0.92), k) * trail * across + vec3(0.88, 1.00, 0.95) * head;
  return c * env * uMet.y;
}

// An aircraft far off: three pin-point lights, a steady white one and blinking red and
// green ones at the wingtips (spaced a pixel or two apart so they can be told apart).
vec3 airLight(vec3 rd, vec3 d, vec3 col){
  vec3 v = rd - d;
  float th2 = dot(v, v), wr = max(uPixAng * 1.0, 2.0e-4);
  if (th2 > 100.0 * wr * wr) return vec3(0.0);
  return col * (exp(-th2 / (wr * wr)) + 0.06 * exp(-sqrt(th2) / (wr * 2.5)));
}
// Its contrail: a straight line in the world from where the trail is oldest to the
// aircraft. Each pixel finds the point on the line nearest its view ray; the trail there
// has spread wider and faded with age, and starts a little way behind the aircraft.
// It is lit by the moon, so it is brighter toward the moon.
vec3 contrail(vec3 rd){
  vec3 A = uConA, d = uConB - uConA;
  float b = dot(rd, d), cc = dot(d, d), dp = -dot(rd, A), e = -dot(d, A);
  float D = cc - b * b;
  float u = clamp(D > 1e-6 ? (e - b * dp) / D : 0.0, 0.0, 1.0);
  vec3 q = A + u * d;
  float s = dot(q, rd);
  if (s <= 0.0) return vec3(0.0);
  float age = mix(uCon.x, uCon.y, u);
  float w = 1.0 + 0.08 * age;                      // width in world units: it spreads as it ages
  float wa = max(w / s, uPixAng * 0.9);            // angular width, never under a pixel
  float r = length(q - s * rd) / s / wa;
  if (r > 3.0) return vec3(0.0);
  float k = uCon.w * exp(-age / uCon.z) * smoothstep(1.5, 5.0, age) * min(1.5 / w, 1.0) * (w / s) / wa;
  float ph = 1.0 + 1.5 * pow(max(dot(rd, uMoonDir), 0.0), 6.0);
  vec3 col = vec3(0.60, 0.66, 0.78) * 0.035 * k * ph * exp(-r * r);
  // Glitter: now and then an ice crystal in the trail catches the moon, as a pin-point
  // of light. The trail is cut into short cells; about two in five hold a crystal at a
  // random spot along and across the trail, which glints for about a second at its own
  // slow, random moments. Each pixel checks its own cell and the two beside it, so a
  // glint is never cut off at a cell edge.
  if (uGlitter > 0.0){
    vec3 dn = d / sqrt(cc), sv = cross(dn, rd);
    float sinT = max(length(sv), 1e-4);
    float across = dot(q - s * rd, sv / sinT) / s;       // angle across the trail
    float along = u * sqrt(cc) / 4.0;                     // in cells of 4 world units
    float gp = uPixAng * 0.6, gsum = 0.0;
    for (int j = -1; j <= 1; j++){
      float id = floor(along) + float(j);
      if (hash12(vec2(id, 3.3)) > 0.4) continue;
      float h1 = hash12(vec2(id, 7.1)), h3 = hash12(vec2(id, 5.7)), h4 = hash12(vec2(id, 9.9));
      float da = (along - id - 0.2 - 0.6 * h3) * 4.0 * sinT / s;
      float dc = across - (h4 - 0.5) * 1.2 * wa;
      float tw = pow(max(sin(uTime * (0.25 + 0.5 * h1) + h1 * 60.0), 0.0), 30.0);
      gsum += tw * exp(-(da * da + dc * dc) / (gp * gp));
    }
    col += vec3(0.92, 0.96, 1.0) * 0.1 * uGlitter * gsum * uCon.w * exp(-age / uCon.z) * smoothstep(1.5, 5.0, age) * ph;
  }
  return col;
}
vec3 aircraft(vec3 rd){
  vec3 col = contrail(rd);
  col += airLight(rd, uAirW, vec3(1.0, 0.95, 0.88)) * uAirI.x;
  col += airLight(rd, uAirR, vec3(1.0, 0.10, 0.06)) * uAirI.y;
  col += airLight(rd, uAirG, vec3(0.12, 1.0, 0.35)) * uAirI.z;
  return col * mix(0.5, 1.0, smoothstep(0.02, 0.15, rd.y));   // dimmer low down, through more air
}

// How much of the disc point with surface normal n (x right, z toward us) the sun lights;
// a wide, soft falloff, since the terminator on the real Moon is gradual.
float moonLit(vec3 n){
  float pa = uMoonPhase * 6.2831853;
  vec3 L = vec3(sin(pa), 0.0, -cos(pa));
  float d = dot(n, L);
  float t = smoothstep(-0.04, 0.55, d);
  return t * t * (1.0 + 0.5 * (1.0 - t));   // eases in at the terminator
}

// 0 on the dark side of the disc, 1 on the lit side (for letting the sky show through the dark part)
float moonLitAt(vec3 rd, vec3 m){
  vec3 mr = normalize(cross(m, vec3(0.0, 1.0, 0.0)));
  vec3 mu = cross(mr, m);
  vec2 uv = vec2(dot(rd, mr), dot(rd, mu)) / uMoonR;
  float r = min(length(uv), 1.0);
  return clamp(moonLit(vec3(uv, sqrt(1.0 - r * r))), 0.0, 1.0);
}

vec3 moonDisk(vec3 rd, vec3 m){
  float c = dot(rd, m);
  if (c < 0.9) return vec3(0.0);
  vec3 mr = normalize(cross(m, vec3(0.0, 1.0, 0.0)));
  vec3 mu = cross(mr, m);
  vec2 uv = vec2(dot(rd, mr), dot(rd, mu)) / uMoonR;
  float r = length(uv);
  float aa = uPixAng / uMoonR;
  float edge = 1.0 - smoothstep(1.0 - aa * 1.2, 1.0 + aa * 0.6, r);
  if (edge <= 0.0) return vec3(0.0);
  vec3 n = vec3(uv, sqrt(max(1.0 - r * r, 0.0)));
  // the Moon's actual near side (NASA LRO albedo map), north up, as seen from Earth
  float lon = atan(n.x, n.z), lat = asin(clamp(n.y, -1.0, 1.0));
  float m0 = texture2D(uMoonMap, vec2(0.5 + lon / 6.2831853, 0.5 + lat / 3.1415927)).r;
  float alb = mix(0.85, pow(m0, 1.2) * 1.75, uMoonReady);
  float limb = 0.88 + 0.12 * pow(n.z, 0.6);
  vec3 tint = mix(vec3(1.00, 0.82, 0.60), vec3(1.0, 0.93, 0.80), n.z);
  // phase: the sun's direction in the disc's frame (x right, z toward us); waxing is lit on the right
  float pa = uMoonPhase * 6.2831853;
  vec3 L = vec3(sin(pa), 0.0, -cos(pa));
  float lit = moonLit(n);
  // the unlit side shows only a faint, cool earthshine, close to the sky around it
  vec3 earth = vec3(0.55, 0.68, 1.0) * alb * 0.004;
  return mix(earth * edge, tint * alb * limb * edge * 1.3, lit);
}

// Daytime sky: blue gradient, sun glow and disc, and a warm band toward the sun at dawn and dusk.
${DAY_SKY}
vec3 daySky(vec3 rd, vec3 s){
  vec3 col = daySkyBase(rd, s, uTwi);
  float cs = dot(rd, s);
  float a = acos(clamp(cs, -1.0, 1.0));
  col += vec3(1.0, 0.95, 0.85) * 40.0 * (1.0 - smoothstep(0.0085, 0.0105, a));   // the sun's disc
  return col * daySkyScale(s);
}

vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }

void main(){
  vec2 o = uCloudTexel * 0.75;
  vec4 c = texture2D(tCloud, vUv) * 0.5
         + texture2D(tCloud, vUv + vec2( o.x,  o.y)) * 0.125
         + texture2D(tCloud, vUv + vec2(-o.x,  o.y)) * 0.125
         + texture2D(tCloud, vUv + vec2( o.x, -o.y)) * 0.125
         + texture2D(tCloud, vUv + vec2(-o.x, -o.y)) * 0.125;

  vec2 ndc = vUv * 2.0 - 1.0;
  vec3 rd = normalize(uCamF + uCamR * ndc.x * uTanHalf * uAspect + uCamU * ndc.y * uTanHalf);
  vec3 m = uMoonDir;

  float am = 2.0 * asin(clamp(length(rd - m) * 0.5, 0.0, 1.0));
  // stars reach almost to the horizon, a little dimmer low down where the air is thickest
  // (uStarLow: the height, as sin of the angle, where they have fully faded in)
  float starVis = uNightAmt * smoothstep(max(uStarLow - 0.035, 0.0), uStarLow, rd.y) * mix(0.7, 1.0, smoothstep(0.0, 0.2, rd.y)) * smoothstep(0.06, 0.45, am);
  float diskMask = 1.0 - smoothstep(uMoonR * 0.92, uMoonR * 0.99, am);
  // (stars only where they can show: above the horizon, clear of the moon and the clouds)
  vec3 st = starVis * c.a > 0.0 ? stars(rd) * starVis : vec3(0.0);
  // the hero stars low over the horizon (the regular field has faded out there)
  if (rd.y > 0.0 && rd.y < 0.3 && c.a > 0.0) st += heroStars(rd) * smoothstep(0.0, 0.015, rd.y) * smoothstep(0.03, 0.2, am);
  if (uMet.w > 0.0 && rd.y > 0.0 && c.a > 0.0) st += meteor(rd) * smoothstep(0.0, 0.03, rd.y);
  if (uAirOn > 0.0 && rd.y > 0.0 && c.a > 0.0) st += aircraft(rd) * smoothstep(0.0, 0.02, rd.y);
  // the halo is hidden behind the lit part of the disc only; the dark part lets the sky through
  float hide = diskMask > 0.0 ? diskMask * mix(0.3, 0.82, moonLitAt(rd, m)) : 0.0;
  // the glow around the moon is the light of its lit part, so it fades as the moon thins
  float illumH = 0.5 - 0.5 * cos(uMoonPhase * 6.2831853);
  float haloK = mix(0.10, 1.0, illumH * illumH);
  vec3 halo = vec3(0.30, 0.46, 0.90) * 0.0035 * exp(-am * 2.4) + vec3(0.55, 0.66, 0.88) * 0.0150 * exp(-am * 8.5)
            + vec3(1.00, 0.90, 0.74) * 0.1100 * exp(-am * 28.0) + vec3(1.00, 0.93, 0.80) * 0.4500 * exp(-am * 90.0);
  vec3 night = (skyBase(rd, m) - halo * (1.0 - haloK)) * (1.0 - hide) + st + moonDisk(rd, m) * uNightAmt;
  vec3 sky = mix(night, daySky(rd, uSunDir), uDayAmt);
  // the clouds and ground are lit by the baked moonlight; in daytime lift and warm them toward the sun
  vec3 lit = c.rgb * uDayLift;
  // less light on the clouds and ground around a new moon
  float illum = 0.5 - 0.5 * cos(uMoonPhase * 6.2831853);
  vec3 cn = c.rgb * mix(1.0, mix(0.3, 1.0, illum), uNightAmt);
  vec3 col = mix(cn, lit, uDayAmt) + sky * c.a;
  // lightning: the bolt itself (already hidden by the clouds in front of it), and a
  // faint brightening of the open air around the flash
  if (uBoltOn > 0.0) col += texture2D(tBolt, vUv).rgb * 32.0;
  float fa = max(dot(rd, uFlashDir), 0.0);
  col += uSkyFlash * c.a * (0.2 + 0.8 * fa * fa * fa * fa);
  // A storm far beyond the horizon: its flashes light the air above it as a soft, warm
  // glow low in the sky. Distant clouds stand out against it, their thin edges catch
  // a little of the light, and the clouds in front pick up a faint wash.
  if (uFar.w > 0.0){
    float daz = acos(clamp(dot(normalize(rd.xz + 1e-5), normalize(uFar.xz)), -1.0, 1.0)) / uFarShape.x;
    float up = asin(clamp(rd.y, -1.0, 1.0)) - uFarShape.y;
    float g = exp(-daz * daz) * (up > 0.0 ? exp(-up / uFarShape.z) : exp(-4.0 * up * up / (uFarShape.z * uFarShape.z)));
    col += uFarCol.rgb * uFar.w * g * (c.a + uFarCol.w * (2.5 * c.a * (1.0 - c.a) + 0.06));
  }
  float rays = texture2D(tRays, vUv).r;
  col += rays * vec3(0.74, 0.80, 0.95) * 0.6 * uRays * uNightAmt * (1.0 - 0.8 * diskMask * c.a);

  // ---- colour grade (all of it driven from the panel) ----
  const vec3 LW = vec3(0.2126, 0.7152, 0.0722);
  col *= uExposure * uBalance;                       // exposure + white balance, in linear light
  col = aces(col);
  float lum = dot(col, LW);
  vec3 sT = uShadowTint / max(dot(uShadowTint, LW), 1e-3);
  vec3 hT = uHighTint / max(dot(uHighTint, LW), 1e-3);
  col *= mix(vec3(1.0), sT, (1.0 - smoothstep(0.0, 0.5, lum)) * uShadowAmt);   // split toning
  col *= mix(vec3(1.0), hT, smoothstep(0.3, 1.0, lum) * uHighAmt);
  col += uShadowTint * uLift * 0.012 * (1.0 - lum);  // tinted night glow in the blacks
  float l2 = dot(col, LW);
  col = max(mix(vec3(l2), col, uSat), 0.0);
  col = pow(col, vec3(uContrast));
  vec2 vq = (vUv - 0.5) * vec2(uAspect, 1.0);
  col *= mix(1.0 - uVignette, 1.0, smoothstep(1.15, 0.30, length(vq)));
  col = pow(max(col, 0.0), vec3(1.0 / 2.2));
  // Film grain, new 24 times a second like a film frame: clumps a little over a pixel
  // across plus a finer sparkle, mostly neutral with a hint of colour, strongest in the
  // shadows and midtones and gentler in the deepest blacks and the highlights.
  float fr = fract(floor(uTime * 24.0) * 0.6180339) * 97.0;
  vec2 gp = gl_FragCoord.xy / (1.5 * max(uRes.y / 1080.0, 0.6));
  float gm = grainN(gp, fr) + 0.45 * (hash12(gl_FragCoord.xy + fr * 13.0) - 0.5);
  vec3 g = vec3(gm) + 0.30 * vec3(grainN(gp + 17.3, fr + 1.0), 0.0, grainN(gp + 41.7, fr + 2.0));
  float gl = dot(col, LW);
  float gw = (0.4 + 0.6 * smoothstep(0.0, 0.2, gl)) * (1.0 - 0.6 * smoothstep(0.45, 1.0, gl));
  col += g * uGrain * 7.0 * gw;
  col += (hash12(gl_FragCoord.xy + fract(uTime * 7.31) * 513.0) - 0.5) / 255.0;   // dither against banding
  gl_FragColor = vec4(col, 1.0);
}
`;

// Lightning channels, drawn at full resolution as strips that face the screen. Each
// vertex marches the baked cloud field back to the camera, so cloud in front hides
// the bolt and thin cloud only veils it.
export const BOLT_VERT = `
precision highp float;
precision highp sampler3D;
uniform sampler3D uNoise;
uniform vec3 uCamPos, uCamR, uCamU, uCamF;
uniform float uTanHalf, uAspect, uPx;
uniform vec2 uRes;
attribute vec3 aA, aB;
attribute vec4 aInfo;     // path time at A, path time at B, weight, 1 for a branch
attribute vec2 aCorner;   // x: side (-1 / +1), y: 0 at A, 1 at B
varying vec2 vSA, vSB;
varying vec4 vInfo;
varying float vTr, vHW;
${COMMON}
${WORLD}
${BAKED}
vec3 proj(vec3 X){
  vec3 v = X - uCamPos;
  float z = dot(v, uCamF);
  return vec3(dot(v, uCamR) / (z * uTanHalf * uAspect), dot(v, uCamU) / (z * uTanHalf), z);
}
float sight(vec3 P){
  vec3 v = P - uCamPos;
  float dist = length(v);
  vec3 rd = v / dist;
  float t = 0.3, od = 0.0;
  bool done = false;
  for (int i = 0; i < 240; i++){
    if (t >= dist || od > 2.5){ done = true; break; }
    vec3 p = uCamPos + rd * t;
    if ((p.y < Y_MIN && rd.y < 0.0) || (p.y > Y_MAX && rd.y > 0.0)){ done = true; break; }
    float sd = shapeSD(p);
    if (sd < -0.32){ t += max(-sd * 0.5, 0.25); continue; }
    float st = 0.3 + t * 0.002;
    od += clamp((sd + 0.14) * 2.0, 0.0, 1.0) * min(st, dist - t);
    t += st;
  }
  if (!done) return 0.0;                     // ran out of steps inside cloud: treat as hidden
  return exp(-od * 4.0) * exp(-dist * 0.006);
}
void main(){
  vec3 pa = proj(aA), pb = proj(aB);
  if (pa.z < 0.3 || pb.z < 0.3){ gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec2 sa = (pa.xy * 0.5 + 0.5) * uRes, sb = (pb.xy * 0.5 + 0.5) * uRes;
  vec2 d = sb - sa;
  float l = length(d);
  d = l > 1e-3 ? d / l : vec2(1.0, 0.0);
  vec2 n = vec2(-d.y, d.x);
  float hw = (5.0 + 9.0 * aInfo.z) * uPx;       // half width in device pixels: room for the glow
  vec2 s = mix(sa, sb, aCorner.y) + n * aCorner.x * hw + d * (aCorner.y * 2.0 - 1.0) * hw;
  gl_Position = vec4(s / uRes * 2.0 - 1.0, 0.0, 1.0);
  vSA = sa; vSB = sb; vInfo = aInfo; vHW = hw;
  vTr = sight(aCorner.y > 0.5 ? aB : aA);
}
`;
export const BOLT_FRAG = `
precision highp float;
uniform float uProg, uMainE, uBranchE, uLeaderE, uPx;
varying vec2 vSA, vSB;
varying vec4 vInfo;
varying float vTr, vHW;
void main(){
  vec2 ab = vSB - vSA;
  vec2 fp = gl_FragCoord.xy - vSA;
  float h = clamp(dot(fp, ab) / max(dot(ab, ab), 1e-4), 0.0, 1.0);
  float dpx = length(fp - ab * h);
  if (dpx > vHW) discard;
  float s = mix(vInfo.x, vInfo.y, h);
  if (s > uProg) discard;                       // the leader hasn't got this far yet
  float w = vInfo.z;
  float e = (vInfo.w > 0.5 ? uBranchE : uMainE) * w;
  e += uLeaderE * (0.15 + 1.6 * exp(-(uProg - s) * 25.0)) * mix(0.4, 1.0, w);   // faint stepped leader, brightest at its tip
  float cw = (0.45 + 0.75 * w) * uPx;
  float core = exp(-dpx * dpx / (cw * cw));
  float halo = exp(-dpx / ((1.2 + 2.6 * w) * uPx)) * (1.0 - dpx / vHW);
  vec3 col = vec3(1.0, 0.97, 1.0) * core * 24.0 + vec3(0.42, 0.50, 1.0) * halo * 1.4;
  gl_FragColor = vec4(col * e * vTr / 32.0, 1.0);
}
`;
