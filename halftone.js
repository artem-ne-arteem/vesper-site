// Точечный LED / halftone-фон vesper на WebGL. Тот же шейдер, что в iOS-версии (Halftone.metal).

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform vec2 uSize;
uniform float uTime;
uniform float uCell;
uniform float uEnergy;
uniform float uDim;
uniform float uAA;

float band(vec2 p, float angle, float offset, float wobble, float freq, float phase, float width) {
  vec2 dir = vec2(cos(angle), sin(angle));
  vec2 nrm = vec2(-dir.y, dir.x);
  float along = dot(p, dir);
  float across = dot(p, nrm) - offset - wobble * sin(along * freq + phase);
  return exp(-(across * across) / (width * width));
}

void main() {
  vec2 position = vec2(gl_FragCoord.x, uSize.y - gl_FragCoord.y);
  vec2 idx = floor(position / uCell);
  vec2 center = (idx + 0.5) * uCell;
  vec2 p = (center - 0.5 * uSize) / uSize.y;

  float t = uTime;
  float e = clamp(uEnergy, 0.0, 1.0);

  float b1 = band(p, -0.55 + 0.05 * sin(t * 0.11), -0.30 + 0.06 * sin(t * 0.17), 0.10, 3.0, t * 0.35, 0.07 + 0.04 * e);
  float b2 = band(p, 2.55 + 0.04 * sin(t * 0.13), 0.05 + 0.08 * sin(t * 0.09 + 1.3), 0.12, 2.4, -t * 0.28 + 2.0, 0.09 + 0.04 * e);
  float b3 = band(p, 0.90 + 0.06 * sin(t * 0.07), 0.32 + 0.05 * cos(t * 0.12), 0.08, 3.6, t * 0.22 + 4.0, 0.06 + 0.03 * e);
  float haze = band(p, -0.20, -0.05 + 0.10 * sin(t * 0.10), 0.15, 2.0, t * 0.20, 0.20);

  float light = b1 + 0.8 * b2 + 0.6 * b3;
  float vignette = 1.0 - smoothstep(0.35, 0.95, length(p * vec2(0.8, 1.0)));
  light *= mix(0.55, 1.0, vignette);
  light *= 0.85 + 0.7 * e;
  light = clamp(light, 0.0, 1.2);

  vec3 warm = vec3(1.00, 0.95, 0.88);
  vec3 steel = vec3(0.32, 0.45, 0.62);
  float base = 0.05 + 0.20 * haze;
  float level = max(light, base);
  vec3 tint = mix(steel, warm, smoothstep(0.15, 0.70, light));

  float radius = uCell * 0.5 * clamp(sqrt(level), 0.12, 0.95);
  float d = length(position - center);
  float mask = 1.0 - smoothstep(radius - uAA, radius + uAA, d);
  vec3 rgb = tint * mask * (0.30 + 0.90 * clamp(level, 0.0, 1.0));

  gl_FragColor = vec4(rgb * (1.0 - uDim), 1.0);
}
`;

export function createHalftone(canvas, { getLevel = () => 0 } = {}) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha: false, powerPreference: 'high-performance' });
  if (!gl) return { setCell() {}, setDim() {} };

  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.error(gl.getShaderInfoLog(s));
    return s;
  };
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(program);
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const aPos = gl.getAttribLocation(program, 'aPos');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

  const u = (name) => gl.getUniformLocation(program, name);
  const uSize = u('uSize'), uTime = u('uTime'), uCell = u('uCell'), uEnergy = u('uEnergy'), uDim = u('uDim'), uAA = u('uAA');

  let cell = 7, targetCell = 7, dim = 0, targetDim = 0, energy = 0;
  const start = performance.now();
  const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    gl.viewport(0, 0, w, h);
    return dpr;
  }

  function frame(now) {
    const dpr = resize();
    const target = getLevel();
    energy += (target - energy) * (target > energy ? 0.5 : 0.1);
    cell += (targetCell - cell) * 0.08;
    dim += (targetDim - dim) * 0.08;

    gl.uniform2f(uSize, canvas.width, canvas.height);
    gl.uniform1f(uTime, reduceMotion ? 0 : (now - start) / 1000);
    gl.uniform1f(uCell, cell * dpr);
    gl.uniform1f(uEnergy, energy);
    gl.uniform1f(uDim, dim);
    gl.uniform1f(uAA, 0.75 * dpr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setCell(v) { targetCell = v; },
    setDim(v) { targetDim = v; },
  };
}
