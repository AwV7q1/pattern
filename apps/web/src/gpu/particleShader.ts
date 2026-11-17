// Every particle is an instanced quad. Its position is computed entirely on
// the GPU from (edge, t0, duration, kind) and the current simulated time, so
// the CPU never touches particles after uploading them once.
//
// Visual language (same in the Canvas2D fallback):
//   request  = blue arrowhead pointing where it travels (caller -> callee)
//   retry    = orange arrowhead
//   response = green dot travelling back on the other lane
//   error    = red cross, larger
//   size     = payload of the edge in that direction (edge style)
//   traced   = kind + 4: twice as big with a white ring (one followed request)
export const PARTICLE_SHADER = /* wgsl */ `
struct Uniforms {
  now: f32,          // simulated time, seconds
  minDur: f32,       // minimum visual travel time, seconds of sim time
  zoom: f32,
  size: f32,         // particle radius, CSS px
  translate: vec2f,  // viewport translation, CSS px
  resolution: vec2f, // canvas size, CSS px
};

// style: request size, response size, fire-and-forget, unused
struct Edge { p0: vec2f, c0: vec2f, c1: vec2f, p1: vec2f, style: vec4f };

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> particles: array<vec4f>; // edge, t0, dur, kind
@group(0) @binding(2) var<storage, read> edges: array<Edge>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
  @location(2) @interpolate(flat) shape: u32, // 0 dot, 1 arrow, 2 cross
  @location(3) @interpolate(flat) traced: u32,
};

fn bezier(e: Edge, t: f32) -> vec2f {
  let it = 1.0 - t;
  return it * it * it * e.p0 + 3.0 * it * it * t * e.c0 + 3.0 * it * t * t * e.c1 + t * t * t * e.p1;
}

fn bezierTangent(e: Edge, t: f32) -> vec2f {
  let it = 1.0 - t;
  return 3.0 * it * it * (e.c0 - e.p0) + 6.0 * it * t * (e.c1 - e.c0) + 3.0 * t * t * (e.p1 - e.c1);
}

fn hash(i: u32) -> f32 {
  var x = i * 747796405u + 2891336453u;
  x = ((x >> ((x >> 28u) + 4u)) ^ x) * 277803737u;
  x = (x >> 22u) ^ x;
  return f32(x) / 4294967295.0;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VSOut {
  var out: VSOut;
  let p = particles[ii];
  let dur = max(p.z, u.minDur);
  var t = (u.now - p.y) / dur;
  if (p.y < 0.0 || t < 0.0 || t > 1.0 || u32(p.x) >= arrayLength(&edges)) {
    out.pos = vec4f(2.0, 2.0, 2.0, 1.0); // outside clip space: culled
    return out;
  }
  let raw = u32(p.w);
  let kind = raw % 4u;
  let traced = raw >= 4u;
  let isResponse = kind == 1u || kind == 2u;
  if (isResponse) { t = 1.0 - t; } // responses travel back to the caller

  let e = edges[u32(p.x)];
  let tan = bezierTangent(e, t);
  let len = max(length(tan), 1e-4);
  let dir = tan / len * select(1.0, -1.0, isResponse); // direction of travel
  let normal = vec2f(-tan.y, tan.x) / len;
  // spread particles into a stream; requests and responses use opposite lanes
  let jitter = select((hash(ii) - 0.5) * 4.0, 0.0, traced);
  let lane = select(-3.0, 3.0, isResponse);
  let world = bezier(e, t) + normal * (lane + jitter);

  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let c = corners[vi];
  let payload = select(e.style.x, e.style.y, isResponse);
  var radius = u.size * clamp(u.zoom, 0.6, 1.6) * max(payload, 1.0);
  if (kind == 2u) { radius *= 1.5; }
  if (kind == 0u || kind == 3u) { radius *= 1.25; }
  if (traced) { radius *= 2.2; }
  // rotate the quad so uv.x points along the direction of travel
  let offset = (dir * c.x + vec2f(-dir.y, dir.x) * c.y) * radius;
  let screen = world * u.zoom + u.translate + offset;
  let ndc = vec2f(screen.x / u.resolution.x * 2.0 - 1.0, 1.0 - screen.y / u.resolution.y * 2.0);

  out.pos = vec4f(ndc, 0.0, 1.0);
  out.uv = c;
  out.traced = select(0u, 1u, traced);
  if (kind == 0u) {
    out.color = vec3f(0.30, 0.70, 1.00);
    out.shape = 1u;
  } else if (kind == 1u) {
    out.color = vec3f(0.30, 0.95, 0.55);
    out.shape = 0u;
  } else if (kind == 2u) {
    out.color = vec3f(1.00, 0.28, 0.28);
    out.shape = 2u;
  } else {
    out.color = vec3f(1.00, 0.62, 0.15); // retry
    out.shape = 1u;
  }
  if (e.style.z > 0.5 && !isResponse) {
    out.color = mix(out.color, vec3f(0.75, 0.55, 1.0), 0.6); // fire-and-forget: violet tint
  }
  return out;
}

// Coverage of the shape at uv in [-1, 1]^2, soft edges.
fn shapeAlpha(shape: u32, uv: vec2f) -> f32 {
  if (shape == 1u) {
    // arrowhead pointing +x: tip (0.95, 0), back corners (-0.75, +-0.7), notch at -0.35
    let x = uv.x;
    let y = abs(uv.y);
    let edge = (0.95 - x) * 0.41 - y;          // distance-ish to the slanted side
    let notch = x - (-0.35 - y * 0.57);         // concave back
    let d = min(edge, notch);
    return smoothstep(0.0, 0.12, d) * step(-0.8, x);
  }
  if (shape == 2u) {
    let a = abs(uv.x - uv.y);
    let b = abs(uv.x + uv.y);
    let d = min(a, b) * 0.7071;
    return (1.0 - smoothstep(0.16, 0.26, d)) * (1.0 - smoothstep(0.85, 1.0, length(uv)));
  }
  let d = dot(uv, uv);
  return select((1.0 - d) * (1.0 - d), 0.0, d > 1.0);
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  var a = 0.0;
  var color = in.color;
  if (in.traced == 1u) {
    // shape in the middle half, white ring around it
    let r = length(in.uv);
    let ring = (1.0 - smoothstep(0.06, 0.12, abs(r - 0.82)));
    let inner = shapeAlpha(in.shape, in.uv * 2.0) * step(max(abs(in.uv.x), abs(in.uv.y)), 0.5);
    a = max(inner, ring);
    color = mix(in.color, vec3f(1.0), ring * (1.0 - inner));
  } else {
    a = shapeAlpha(in.shape, in.uv);
  }
  if (a <= 0.003) { discard; }
  a *= 0.9;
  return vec4f(color * a, a); // premultiplied, additive blending
}
`;
