// Every particle is an instanced quad. Its position is computed entirely on
// the GPU from (edge, t0, duration, kind) and the current simulated time, so
// the CPU never touches particles after uploading them once.
export const PARTICLE_SHADER = /* wgsl */ `
struct Uniforms {
  now: f32,          // simulated time, seconds
  minDur: f32,       // minimum visual travel time, seconds of sim time
  zoom: f32,
  size: f32,         // particle radius, CSS px
  translate: vec2f,  // viewport translation, CSS px
  resolution: vec2f, // canvas size, CSS px
};

struct Edge { p0: vec2f, c0: vec2f, c1: vec2f, p1: vec2f };

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> particles: array<vec4f>; // edge, t0, dur, kind (0 req, 1 ok, 2 err, 3 retry)
@group(0) @binding(2) var<storage, read> edges: array<Edge>;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) color: vec3f,
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
  let kind = u32(p.w);
  let isResponse = kind == 1u || kind == 2u;
  if (isResponse) { t = 1.0 - t; } // responses travel back to the caller

  let e = edges[u32(p.x)];
  let tan = bezierTangent(e, t);
  let len = max(length(tan), 1e-4);
  let normal = vec2f(-tan.y, tan.x) / len;
  // spread particles into a stream; requests and responses use opposite lanes
  let lane = select(-3.0, 3.0, isResponse);
  let world = bezier(e, t) + normal * (lane + (hash(ii) - 0.5) * 4.0);

  let corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(-1.0, 1.0),
    vec2f(-1.0, 1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0)
  );
  let c = corners[vi];
  let radius = u.size * clamp(u.zoom, 0.6, 1.6) * select(1.0, 1.6, kind == 2u);
  let screen = world * u.zoom + u.translate + c * radius;
  let ndc = vec2f(screen.x / u.resolution.x * 2.0 - 1.0, 1.0 - screen.y / u.resolution.y * 2.0);

  out.pos = vec4f(ndc, 0.0, 1.0);
  out.uv = c;
  if (kind == 0u) {
    out.color = vec3f(0.30, 0.70, 1.00);
  } else if (kind == 1u) {
    out.color = vec3f(0.30, 0.95, 0.55);
  } else if (kind == 2u) {
    out.color = vec3f(1.00, 0.28, 0.28);
  } else {
    out.color = vec3f(1.00, 0.62, 0.15); // retry
  }
  return out;
}

@fragment
fn fs(in: VSOut) -> @location(0) vec4f {
  let d = dot(in.uv, in.uv);
  if (d > 1.0) { discard; }
  let a = (1.0 - d) * (1.0 - d) * 0.85;
  return vec4f(in.color * a, a); // premultiplied, additive blending
}
`;
