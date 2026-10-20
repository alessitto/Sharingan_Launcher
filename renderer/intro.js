// Intro con el Sharingan en WebGL (un shader a pantalla completa).
//   0,0 s  una rendija roja: los párpados se abren
//   0,4 s  el iris (fibras, brillo, anillo y pupila)
//   1,0 s  los tres tomoe, uno tras otro, cada uno con su onda
//   1,9 s  gira despacio mientras carga la app (ascuas y humo detrás)
//   fin    Intro.finish(): giro rapidísimo con estela, destello, zoom
//          dentro de la pupila y la app aparece a través de ella.
// Se carga justo detrás de #intro-screen para empezar cuanto antes. Sin
// WebGL (o con "reducir movimiento") se queda la intro de CSS.
(() => {
  const screen = document.getElementById("intro-screen");
  if (!screen || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  const canvas = document.createElement("canvas");
  canvas.className = "intro-gl";
  const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false, depth: false, stencil: false });
  if (!gl) return;

  const VERT = `attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}`;
  const FRAG = `
precision highp float;
uniform vec2 uRes;
uniform float uT;      // segundos desde el inicio
uniform float uGo;     // segundos desde finish() (-1 antes)
uniform float uAng;    // giro de los tomoe
uniform float uSpd;    // velocidad de giro (para la estela)

const float PI = 3.14159265;

float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 17.1; a *= .5; }
  return v;
}
float sq(float x){ return x * x; }
float easeOutBack(float x){ float c1 = 1.70158, c3 = c1 + 1., y = x - 1.; return 1. + c3 * y * y * y + c1 * y * y; }

// Tomoe: la "coma" del yin-yang. Cabeza en (-s/2, 0), cola que acaba en (s, 0).
float tomoeSDF(vec2 q, float s){
  float big = max(length(q) - s, q.y);
  float head = length(q - vec2(-.5 * s, 0.)) - .5 * s;
  float cut = length(q - vec2(.5 * s, 0.)) - .5 * s;
  return max(min(big, head), -cut);
}

// Los tres tomoe (cobertura 0..1) con el giro "ang"; cada uno crece desde un punto
float tomoes(vec2 p, float ang, float aa, out float waves){
  float cov = 0.;
  waves = 0.;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float born = 1.0 + .27 * fk;
    float g = clamp((uT - born) / .38, 0., 1.);
    float s = .19 * (g > 0. ? easeOutBack(g) : 0.);
    float th = ang + fk * 2. * PI / 3. + PI / 2.;
    vec2 c = .58 * vec2(cos(th), sin(th));
    vec2 t = vec2(-sin(th), cos(th));
    vec2 n = vec2(cos(th), sin(th));
    vec2 d = p - c;
    vec2 q = vec2(-dot(d, t), dot(d, n)) + vec2(-.5 * s, 0.);
    if (s > .001) cov = max(cov, 1. - smoothstep(-aa, aa, tomoeSDF(q, s)));
    // Onda al nacer
    float w = uT - born;
    if (w > 0. && w < .7) {
      float r = w * .9;
      waves += (1. - w / .7) * (1. - smoothstep(0., .02 + w * .03, abs(length(d) - r)));
    }
  }
  return cov;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv = (frag - .5 * uRes) / uRes.y;
  float px = 1. / uRes.y;

  // ---------------------------------------------------- tiempos
  float go = max(uGo, 0.);
  float going = step(0., uGo);
  float zoom = going * pow(smoothstep(.5, 1.0, go), 2.);
  float scale = 1. + zoom * 46.;              // zoom hasta dentro de la pupila
  float R = .19;                               // radio del iris (en alto de pantalla)
  vec2 p = uv / (R * scale);                   // iris = radio 1
  float r = length(p);
  float aa = 1.6 * px / (R * scale);

  // ---------------------------------------------------- fondo
  vec3 bg = vec3(.035, .03, .036);
  float smoke = fbm(uv * 2.2 + vec2(uT * .05, -uT * .08));
  bg += vec3(.22, .02, .03) * smoke * smoke * smoothstep(1.3, .0, length(uv)) * smoothstep(.2, 1.5, uT);
  bg *= 1. - .55 * smoothstep(.45, 1.1, length(uv * vec2(.8, 1.)));
  // ascuas que suben
  for (int i = 0; i < 22; i++) {
    float fi = float(i);
    vec2 seed = vec2(fi * 7.31, fi * 1.93);
    float life = fract(uT * (.08 + .07 * hash(seed)) + hash(seed + 3.1));
    vec2 ep = vec2((hash(seed + 1.7) - .5) * 1.9, -.6 + life * 1.3);
    ep.x += .04 * sin(uT * 1.3 + fi);
    float e = smoothstep(.006, .0, length(uv - ep)) * sin(life * PI);
    bg += vec3(1., .35, .15) * e * .9 * smoothstep(.4, 1.6, uT);
  }

  // ---------------------------------------------------- párpados
  float open = smoothstep(.12, .95, uT);
  float lid = pow(open, 1.6) * 3.2;            // se abre y luego desaparece
  float W = 2.3;
  float lens = lid * 1.25 * sqrt(max(0., 1. - sq(p.x / W)));
  float eyeMask = smoothstep(lens + aa * 2., lens - aa * 2., abs(p.y));
  float slit = exp(-sq(abs(p.y) - lens) * 900.) * smoothstep(W, 0., abs(p.x)) * (1. - smoothstep(.35, 1.1, lid));

  // ---------------------------------------------------- iris
  float a = atan(p.y, p.x);
  float fib = fbm(vec2(a * 9., r * 2.5 - uT * .05)) * .6 + fbm(vec2(a * 31., r * 7.)) * .4;
  vec3 iris = mix(vec3(.30, .0, .02), vec3(.93, .05, .09), smoothstep(1., .25, r));
  iris *= .62 + .55 * fib;
  iris += vec3(1., .3, .22) * exp(-sq(r - .34) * 70.) * .35;             // brillo junto a la pupila
  iris *= mix(1., .45, 1. - smoothstep(0., .014, abs(r - .58)));              // anillo
  iris *= smoothstep(1.02, .86, r) * .85 + .15;                               // borde oscuro
  float limbus = smoothstep(.93, 1., r);
  iris = mix(iris, vec3(.02, 0., .0), limbus);

  // pupila que respira (y se abre del todo al final)
  float pr = .2 + .012 * sin(uT * 2.2) + going * smoothstep(.2, .6, go) * .05;
  float pupil = 1. - smoothstep(pr - aa, pr + aa, r);

  // tomoe (con estela según la velocidad)
  float waves = 0.;
  float cov = 0.;
  float trail = clamp(uSpd * .016, 0., .9);
  for (int j = 0; j < 7; j++) {
    float off = float(j) / 6. * trail;
    float w;
    float c = tomoes(p, uAng - off, aa, w);
    cov += c * (j == 0 ? 1. : .55 * (1. - float(j) / 7.));
    if (j == 0) waves = w;
  }
  cov = clamp(cov, 0., 1.);

  vec3 eye = iris;
  eye = mix(eye, vec3(.015, .0, .005), cov);
  eye = mix(eye, vec3(.01, .0, .0), pupil);
  // brillo especular y reflejo
  vec2 hl = p - vec2(-.38, .42);
  eye += vec3(1., .92, .9) * exp(-dot(hl, hl) * 26.) * .55;
  eye += vec3(1., .6, .55) * exp(-sq(length(p - vec2(.35, -.3)) - .1) * 400.) * .12;
  eye += vec3(1., .2, .2) * smoothstep(.75, 1., r) * smoothstep(1., .95, r) * .25 * (.5 + .5 * sin(a * 2. + uT));

  float irisIn = smoothstep(.25, .95, uT);
  float inside = (1. - smoothstep(1. - aa, 1. + aa, r)) * irisIn;

  // ---------------------------------------------------- composición
  vec3 col = bg;
  // halo rojo alrededor del ojo
  float glow = .35 + going * smoothstep(0., .5, go) * .9;
  col += vec3(.9, .05, .08) * exp(-max(r - 1., 0.) * 5.) * .35 * glow * irisIn * eyeMask;
  col = mix(col, eye, inside * eyeMask);
  col += vec3(1., .25, .2) * slit * 1.4;
  col += vec3(1., .3, .25) * waves * .6 * inside;

  // "pum": destello y onda al final del giro
  float fl = going * exp(-sq((go - .52) * 14.));
  col += vec3(1., .35, .3) * fl * .5 * exp(-length(uv) * 2.2);

  // grano de película
  col += (hash(frag + fract(uT) * 91.) - .5) * .025;

  // ---------------------------------------------------- se ve la app por la pupila
  float hole = going * smoothstep(.95, 1.3, go);
  float holeR = hole * 1.25;
  float alpha = smoothstep(holeR - .02, holeR + .03, length(uv));
  col += vec3(1., .2, .2) * (1. - smoothstep(0., .035, abs(length(uv) - holeR))) * hole * (1. - hole) * 3.;
  alpha = going > .5 ? alpha : 1.;
  gl_FragColor = vec4(col * alpha, alpha);
}`;

  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
      console.warn("intro:", gl.getShaderInfoLog(s));
      return null;
    }
    return s;
  };
  const vs = sh(gl.VERTEX_SHADER, VERT);
  const fs = sh(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return console.warn("intro:", gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = Object.fromEntries(["uRes", "uT", "uGo", "uAng", "uSpd"].map((n) => [n, gl.getUniformLocation(prog, n)]));

  screen.prepend(canvas);
  screen.classList.add("has-gl");

  const resize = () => {
    const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    canvas.width = Math.round(innerWidth * dpr);
    canvas.height = Math.round(innerHeight * dpr);
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  resize();
  addEventListener("resize", resize);

  const start = performance.now();
  let last = start;
  let ang = 0;
  let spd = 0;
  let goAt = -1;
  let raf = 0;
  const smooth = (a, b, x) => {
    const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  function frame(now) {
    const t = (now - start) / 1000;
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    const go = goAt < 0 ? -1 : (now - goAt) / 1000;
    // Despacio mientras carga; al terminar, acelera muchísimo
    const target = go < 0 ? 1.4 * smooth(1.7, 2.4, t) : 1.4 + 34 * smooth(0, 0.55, go);
    spd += (target - spd) * Math.min(1, dt * (go < 0 ? 3 : 9));
    ang += spd * dt;
    gl.uniform2f(U.uRes, canvas.width, canvas.height);
    gl.uniform1f(U.uT, t);
    gl.uniform1f(U.uGo, go);
    gl.uniform1f(U.uAng, ang);
    gl.uniform1f(U.uSpd, spd);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    raf = requestAnimationFrame(frame);
  }
  frame(start);

  // Lo que dura el final (giro, destello, zoom y la app por la pupila)
  const OUT_MS = 1350;
  const REVEAL_MS = 950; // la pupila empieza a abrirse (uGo = 0,95 s)
  window.Intro = {
    // onReveal: cuando la app empieza a verse por la pupila
    finish(onReveal) {
      return new Promise((resolve) => {
        // Como pronto cuando ya han salido los tres tomoe
        const wait = Math.max(0, 1900 - (performance.now() - start));
        setTimeout(() => {
          goAt = performance.now();
          screen.classList.add("is-go");
          setTimeout(() => onReveal?.(), REVEAL_MS);
          setTimeout(() => {
            cancelAnimationFrame(raf);
            removeEventListener("resize", resize);
            gl.getExtension("WEBGL_lose_context")?.loseContext();
            resolve();
          }, OUT_MS);
        }, wait);
      });
    },
  };
})();
