// Intro con el Sharingan en WebGL (un shader a pantalla completa), estilo
// anime (dibujo plano):
//   0,0 s  el ojo aparece de golpe y se llena de rojo desde la pupila
//   0,4 s  los tres tomoe: salen de la pupila como un punto, vuelan en
//          espiral hasta el anillo, golpean (onda, destello, líneas de
//          velocidad y temblor) y se les dibuja la cola
//   1,3 s  gira mientras carga la app
//   fin    Intro.finish(): los tomoe se meten girando hacia la pupila, se
//          funden y sale el Mangekyō de Itachi; gira, remolino, zoom
//          hacia dentro y la app aparece desde el centro.
// Se carga justo detrás de #intro-screen para empezar cuanto antes. Sin
// WebGL (o con "reducir movimiento") se queda el logo girando de siempre.
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
uniform float uAng;    // giro del dibujo
uniform float uSpd;    // velocidad de giro (para la estela)

const float PI = 3.14159265;
const float TAU = 6.2831853;
const float RING = .58;

float sq(float x){ return x * x; }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float easeOutBack(float x){ float c1 = 1.70158, c3 = c1 + 1., y = x - 1.; return 1. + c3 * y * y * y + c1 * y * y; }
float easeOutCubic(float x){ float y = 1. - x; return 1. - y * y * y; }
float wrapPi(float a){ return mod(a + PI, TAU) - PI; }

// Momentos (en segundos)
const float BORN0 = .38;   // sale el primer tomoe
const float BORN_GAP = .24;
const float FLY = .26;

// Tomoe: cabeza en (rho, th) y cola detrás siguiendo el círculo de radio
// rho, que se afina y se curva hacia dentro. L = largo de la cola (rad).
float tomoeSDF(vec2 p, float rho, float th, float hr, float L, float thin){
  float dHead = length(p - rho * vec2(cos(th), sin(th))) - hr;
  if (L < .002) return dHead;
  float r = length(p);
  float del = mod(th - atan(p.y, p.x), TAU);
  if (del > L + .5) return dHead;
  float s = clamp(del / L, 0., 1.);
  float rc = rho - .075 * s * s * min(L / .55, 1.6);
  float w = hr * thin * pow(1. - s, .95);
  float dTail = del <= L ? abs(r - rc) - w : length(vec2((del - L) * rho, r - rc));
  return min(dHead, dTail);
}

// Mangekyō de Itachi: disco central y tres aspas curvas que se afinan.
float mangekyoSDF(vec2 p, float ang, float Rb, float core){
  float r = length(p);
  float phi = atan(p.y, p.x);
  float d = r - core;
  for (int k = 0; k < 3; k++) {
    float th = ang + float(k) * TAU / 3.;
    float t = clamp(r / Rb, 0., 1.);
    float c = th + 1.4 * t * t;                        // el aspa se curva
    float dl = wrapPi(phi - c);
    float hw = .38 * pow(1. - t, .8) * (dl > 0. ? .5 : 1.);    // un lado más afilado
    float db = r < Rb ? abs(dl) * r - hw * r * 1.6 : r - Rb;
    d = min(d, max(db, -r + .01));
  }
  return d;
}

// El dibujo negro del ojo en un momento (tomoe, fusión o Mangekyō)
float pattern(vec2 p, float ang, float aa, float go, float going){
  float cov = 0.;
  // fusión: los tomoe se van hacia la pupila
  float m = going * smoothstep(.0, .42, go);
  float mIn = m * m;
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float born = BORN0 + BORN_GAP * fk;
    if (uT < born) continue;
    float fly = clamp((uT - born) / FLY, 0., 1.);
    float thF = ang + fk * TAU / 3. + PI / 2.;
    float e = easeOutCubic(fly);
    float rho = mix(.2, RING, e);
    float th = thF - (1. - e) * PI * 1.15;
    float hr, L, thin;
    if (fly < 1.) {
      hr = mix(.04, .1, e);
      L = .9 * sin(fly * PI) + .05;
      thin = .55;
    } else {
      float ink = clamp((uT - born - FLY) / .18, 0., 1.);
      hr = .1 * (1. + .35 * sin(ink * PI) * (1. - ink));
      L = .62 * easeOutBack(ink);
      thin = 1.02;
    }
    rho = mix(rho, .24, mIn);
    L = L + 1.2 * m;
    hr = hr * (1. - .25 * m);
    float d = tomoeSDF(p, rho, th, hr, L, thin);
    cov = max(cov, (1. - smoothstep(-aa, aa, d)) * (1. - smoothstep(.85, 1., m)));
  }
  // la mancha que se forma al juntarse
  float blob = going * smoothstep(.2, .45, go);
  cov = max(cov, (1. - smoothstep(-aa, aa, length(p) - mix(.2, .3, blob))) * step(.001, blob));
  // Mangekyō que crece desde la mancha
  float g2 = going * clamp((go - .34) / .32, 0., 1.);
  if (g2 > 0.) {
    float Rb = mix(.3, .92, easeOutBack(g2));
    float dm = mangekyoSDF(p, ang + .6, Rb, .3);
    cov = max(cov, 1. - smoothstep(-aa, aa, dm));
  }
  return cov;
}

void main(){
  vec2 frag = gl_FragCoord.xy;
  vec2 uv0 = (frag - .5 * uRes) / uRes.y;
  float px = 1. / uRes.y;

  float go = max(uGo, 0.);
  float going = step(0., uGo);

  // Golpes: al llegar cada tomoe al anillo y al salir el Mangekyō
  float hit = 0.;
  for (int k = 0; k < 3; k++) {
    float a = uT - (BORN0 + BORN_GAP * float(k) + FLY);
    if (a > 0.) hit += exp(-a * 9.);
  }
  float msHit = going * (go > .34 ? exp(-(go - .34) * 7.) : 0.);
  hit += msHit * 1.5;
  vec2 uv = uv0 + (vec2(hash(vec2(floor(uT * 60.), 1.)), hash(vec2(floor(uT * 60.), 2.))) - .5) * .012 * min(hit, 1.5);

  // Zoom hacia dentro del jutsu (con remolino)
  float zoom = going * pow(smoothstep(.8, 1.3, go), 2.);
  float pop = easeOutBack(clamp(uT / .34, 0., 1.));
  float scale = max(pop, .001) * (1. + zoom * 46.);
  float R = .19;
  vec2 p = uv / (R * scale);
  float swirl = going * smoothstep(.75, 1.35, go) * 2.6 / (.35 + length(p));
  p = mat2(cos(swirl), -sin(swirl), sin(swirl), cos(swirl)) * p;
  float r = length(p);
  float aa = 1.5 * px / (R * scale);

  // ---------------------------------------------------- fondo
  float rs = length(uv0);
  vec3 col = vec3(.03, .022, .03);
  col += vec3(.35, .02, .05) * exp(-rs * 2.6) * smoothstep(.0, .5, uT);
  float a0 = atan(uv0.y, uv0.x) / TAU * 160.;
  float line = step(.8, hash(vec2(floor(a0), floor(uT * 14.))));
  float lineW = smoothstep(.0, .5, fract(a0)) * smoothstep(1., .5, fract(a0));
  float speed = clamp(hit * .9 + going * smoothstep(.0, .3, go) * 1.3 + (1. - smoothstep(.0, .45, uT)) * .8, 0., 1.6);
  col += vec3(1., .5, .5) * line * lineW * smoothstep(.3, 1., rs) * speed * .22;

  // ---------------------------------------------------- iris (dibujo plano)
  float fill = easeOutCubic(clamp((uT - .06) / .34, 0., 1.)) * 1.08;
  vec3 red = vec3(.9, .06, .1);
  vec3 iris = mix(vec3(.12, .0, .02), red, step(r, fill));
  iris += vec3(1., .6, .55) * (1. - smoothstep(0., .03, abs(r - fill))) * (1. - step(1., fill));
  // anillos finos de dibujo
  iris *= 1. - .18 * (1. - smoothstep(.0, .006, abs(r - .8))) - .12 * (1. - smoothstep(.0, .005, abs(r - .7)));
  // sombra arriba
  float shade = step(.5 - .22 * p.x * p.x, p.y);
  iris = mix(iris, iris * vec3(.62, .45, .5), shade * .85);
  // anillo de los tomoe: fino y discontinuo, se borra con el Mangekyō
  float phi = atan(p.y, p.x);
  float dash = .55 + .45 * step(.45, fract((phi - uAng * .5) * 28. / TAU));
  float ringA = (1. - smoothstep(.01 - aa, .01 + aa, abs(r - RING))) * dash * (1. - going * smoothstep(.3, .6, go));
  iris = mix(iris, vec3(.02, 0., .01), ringA);
  // borde negro
  iris = mix(iris, vec3(.02, 0., .01), smoothstep(.915 - aa, .915 + aa, r));

  // dibujo negro (con estela según la velocidad)
  float cov = 0.;
  float trail = clamp(uSpd * .014, 0., .8);
  for (int j = 0; j < 6; j++) {
    float off = float(j) / 5. * trail;
    float c = pattern(p, uAng - off, aa, go, going);
    cov = max(cov, c * (j == 0 ? 1. : .55 * (1. - float(j) / 6.)));
    if (trail < .02) break;
  }
  iris = mix(iris, vec3(.02, 0., .01), cov);

  // pupila del Sharingan (un poco ovalada); en el Mangekyō, punto rojo
  float pupil = 1. - smoothstep(.2 - aa, .2 + aa, length(p * vec2(1.12, .94)));
  iris = mix(iris, vec3(.01, 0., .005), pupil);
  float rdot = going * smoothstep(.45, .6, go) * (1. - smoothstep(.055 - aa, .055 + aa, r));
  iris = mix(iris, red * 1.05, rdot);

  // brillos
  vec2 h1 = (p - vec2(-.44, .42)) * mat2(.8, -.6, .6, .8);
  float hl = 1. - smoothstep(1. - aa * 12., 1. + aa * 12., length(h1 / vec2(.15, .085)));
  float hd = 1. - smoothstep(.045 - aa, .045 + aa, length(p - vec2(.36, -.42)));
  iris = mix(iris, vec3(1.), (hl * .92 + hd * .8) * step(.18, uT) * (1. - zoom));

  float inside = 1. - smoothstep(1. - aa, 1. + aa, r);
  col += vec3(.95, .05, .1) * exp(-max(r - 1., 0.) * 4.5) * (.35 + hit * .5 + going * smoothstep(0., .5, go) * .9) * smoothstep(0., .3, uT);
  col = mix(col, iris, inside);

  // ---------------------------------------------------- impactos
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float a = uT - (BORN0 + BORN_GAP * fk + FLY);
    if (a < 0. || a > .5) continue;
    float th = uAng + fk * TAU / 3. + PI / 2.;
    vec2 d = p - RING * vec2(cos(th), sin(th));
    float wave = 1. - smoothstep(.0, .012 + .02 * (1. - a * 2.), abs(length(d) - (.06 + a * 1.1)));
    col += vec3(1., .85, .85) * wave * (1. - a * 2.) * .9;
    float st = exp(-abs(d.x) * 70.) * exp(-abs(d.y) * 9.) + exp(-abs(d.y) * 70.) * exp(-abs(d.x) * 9.);
    col += vec3(1.) * st * exp(-a * 10.);
  }
  // aro blanco al aparecer el ojo y al salir el Mangekyō
  if (uT < .5) col += vec3(1., .8, .8) * (1. - smoothstep(0., .015, abs(r - 1. - uT * 2.5))) * (1. - uT * 2.) * .8;
  float mw = go - .34;
  if (going > .5 && mw > 0. && mw < .45) col += vec3(1., .85, .85) * (1. - smoothstep(0., .02, abs(r - 1. - mw * 3.))) * (1. - mw / .45);
  // destello del Mangekyō
  col += vec3(1., .4, .35) * msHit * .35 * exp(-length(uv0) * 2.) * (1. - cov * inside * .8);

  // ---------------------------------------------------- la app por el centro
  float hole = going * smoothstep(1.2, 1.55, go);
  float holeR = hole * 1.25;
  float alpha = smoothstep(holeR - .02, holeR + .03, length(uv0));
  col += vec3(1., .2, .2) * (1. - smoothstep(0., .035, abs(length(uv0) - holeR))) * hole * (1. - hole) * 3.;
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
    const target = go < 0 ? 1.5 * smooth(1.2, 1.8, t) : 1.5 + 30 * smooth(0, 0.4, go) - 18 * smooth(0.45, 0.8, go);
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
  const OUT_MS = 1600;
  const REVEAL_MS = 1200; // se empieza a ver la app (uGo = 1,2 s)
  window.Intro = {
    // onReveal: cuando la app empieza a verse por la pupila
    finish(onReveal) {
      return new Promise((resolve) => {
        // Como pronto cuando ya han salido los tres tomoe
        const wait = Math.max(0, 1350 - (performance.now() - start));
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
