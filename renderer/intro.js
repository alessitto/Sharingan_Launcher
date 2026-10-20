// Intro con el Sharingan en WebGL (un shader a pantalla completa), en
// dibujo plano como el anime:
//   0,0 s  el ojo aparece y se enciende de rojo desde la pupila
//   0,45 s los tres tomoe salen de la pupila uno tras otro, se colocan en
//          el anillo y les crece la cola
//   1,3 s  giran mientras carga la app
//   fin    Intro.finish(): los tomoe aceleran y se meten en la pupila, crece
//          el Mangekyō de Itachi y se queda quieto un momento; luego gira,
//          remolino, zoom hacia dentro y la app aparece desde el centro.
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
uniform float uAng;    // giro del dibujo (lo lleva intro.js)
uniform float uSpd;    // velocidad de giro (para la estela)

const float PI = 3.14159265;
const float TAU = 6.2831853;
// Medidas del ojo (radio exterior = 1)
const float BORDER = .925;  // borde interior del aro negro
const float RING = .6;      // anillo de los tomoe
const float H = .082;       // radio de la cabeza del tomoe
const float PUPIL = .17;
// Tiempos de la formación
const float B0 = .45;       // sale el primer tomoe de la pupila
const float GAP = .22;
const float FLY = .26;
// Tiempos del final (segundos desde finish)
const float MS0 = .38;      // empieza a crecer el Mangekyō
const float MSD = .5;       // lo que tarda en crecer

float sq(float x){ return x * x; }
float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
float easeOutCubic(float x){ float y = 1. - x; return 1. - y * y * y; }
float wrapPi(float a){ return mod(a + PI, TAU) - PI; }
float smin(float a, float b, float k){ float h = clamp(.5 + .5 * (b - a) / k, 0., 1.); return mix(b, a, h) - k * h * (1. - h); }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }

// Tomoe en coordenadas propias (cabeza de radio 1 en el origen, x = hacia
// donde apunta la cola, y = hacia fuera del ojo): cabeza redonda y cola en
// media luna que sale por fuera y acaba en punta. grow = cuánta cola hay.
float tomoeLocal(vec2 q, float grow){
  float d = length(q) - 1.;
  if (grow <= 0.) return d;
  const float PT = 1.18;    // ángulo de la punta
  const float PIN = 1.66;   // donde empieza el borde interior
  float rho = length(q);
  float psi = atan(q.y, q.x);
  float s = (PI - psi) / (PI - PT);
  float dt;
  if (psi >= PT && s <= grow) {
    float ro = 1. + 1.27 * pow(s, 1.5);
    float ri = psi >= PIN ? 0. : 1. + 1.27 * pow((PIN - psi) / (PIN - PT), .75);
    dt = max(ri - rho, rho - ro);
  } else {
    // más allá de lo dibujado: hasta el final de la cola
    float se = min(grow, 1.);
    float pe = PI - se * (PI - PT);
    float ro = 1. + 1.27 * pow(se, 1.5);
    float ri = pe >= PIN ? 1. : 1. + 1.27 * pow((PIN - pe) / (PIN - PT), .75);
    dt = length(q - .5 * (ro + ri) * vec2(cos(pe), sin(pe))) - .5 * (ro - ri);
  }
  return min(d, dt);
}

float tomoeAt(vec2 p, float rho, float th, float h, float grow){
  vec2 n = vec2(cos(th), sin(th));
  vec2 t = vec2(sin(th), -cos(th));        // sentido de las agujas del reloj
  vec2 d = p - rho * n;
  return tomoeLocal(vec2(dot(d, t), dot(d, n)) / h, grow) * h;
}

// Mangekyō de Itachi (medido sobre el anime): núcleo hasta 0,47 y tres aspas
// que se afinan y se curvan hasta tocar el borde. gs = tamaño (0..1).
float mangekyo(vec2 p, float ang, float gs){
  float sc = BORDER * gs;
  vec2 q = p / sc;
  float r = length(q);
  float phi = atan(q.y, q.x);
  float d = r - .47;
  for (int k = 0; k < 3; k++) {
    float th = ang + float(k) * TAU / 3.;
    float e = th - .75 * (r - .6);
    float db;
    if (r < .985) {
      float lw = .415 * pow((.985 - r) / .385, 1.35);
      float wa = min(lw / max(r, .05), 2.4);
      float del = wrapPi(phi - e);
      db = max(-del, del - wa) * r;
    } else {
      db = length(q - .985 * vec2(cos(e), sin(e)));
    }
    d = smin(d, db, .07);
  }
  return d * sc;
}

// Lo negro del ojo en un momento: tomoe (salen, giran, se funden) y Mangekyō
float pattern(vec2 p, float ang, float aa, float go, float going){
  float cov = 0.;
  float m = going * smoothstep(0., MS0 + .07, go);   // fusión hacia la pupila
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float born = B0 + GAP * fk;
    if (uT < born) continue;
    float e = easeOutCubic(clamp((uT - born) / FLY, 0., 1.));
    float grow = clamp((uT - born - FLY) / .2, 0., 1.);
    grow = 1. - sq(1. - grow);
    float th = ang + fk * TAU / 3. + PI / 2. - (1. - e) * 1.7;
    float rho = mix(PUPIL, RING, e);
    float h = H * mix(.45, 1., e);
    rho = mix(rho, .2, m * m);
    h *= 1. - .4 * m;
    float d = tomoeAt(p, rho, th, h, grow);
    cov = max(cov, (1. - smoothstep(-aa, aa, d)) * (1. - smoothstep(.75, 1., m)));
  }
  float g = going * clamp((go - MS0) / MSD, 0., 1.);
  if (g > 0.) {
    float dm = mangekyo(p, ang - .4, mix(.3, 1., easeOutCubic(g)));
    cov = max(cov, 1. - smoothstep(-aa, aa, dm));
  }
  return cov;
}

void main(){
  vec2 uv0 = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  float px = 1. / uRes.y;
  float go = max(uGo, 0.);
  float going = step(0., uGo);

  // Final: giro, remolino y zoom hasta dentro del jutsu
  float spin = going * smoothstep(1.3, 1.8, go);
  float zoom = going * pow(smoothstep(1.6, 2.1, go), 2.);
  float appear = easeOutCubic(clamp(uT / .45, 0., 1.));
  float scale = mix(.88, 1., appear) * (1. + zoom * 46.);
  float R = .2;
  vec2 p = uv0 / (R * scale);
  float swirl = going * smoothstep(1.5, 2.15, go) * 2.6 / (.35 + length(p));
  p = rot(swirl) * p;
  float r = length(p);
  float aa = 1.25 * px / (R * scale);

  // ---------------------------------------------------- fondo
  float rs = length(uv0);
  vec3 col = vec3(.022, .018, .024);
  col += vec3(.26, .012, .03) * exp(-rs * 2.8) * appear;
  float a0 = atan(uv0.y, uv0.x) / TAU * 150.;
  float lines = step(.8, hash(vec2(floor(a0), floor(uT * 16.)))) * smoothstep(.0, .5, fract(a0)) * smoothstep(1., .5, fract(a0));
  col += vec3(1., .45, .45) * lines * smoothstep(.32, 1., rs) * spin * .16;

  // ---------------------------------------------------- iris
  vec3 cDark = vec3(.42, .0, .015);
  vec3 cMid = vec3(.86, .035, .05);
  vec3 cRim = vec3(.58, .0, .02);
  vec3 ink = vec3(.012, .0, .004);
  vec3 iris = mix(cDark, cMid, smoothstep(.14, .56, r));
  iris = mix(iris, cRim, smoothstep(.62, BORDER, r) * .6);
  // se enciende de rojo desde la pupila
  float fill = easeOutCubic(clamp((uT - .08) / .42, 0., 1.)) * 1.05;
  iris = mix(iris, vec3(.07, .0, .012), smoothstep(fill - .02, fill + .02, r));
  iris += vec3(1., .35, .3) * exp(-sq((r - fill) * 30.)) * (1. - smoothstep(.85, 1.05, fill)) * .5;
  // anillo de los tomoe (rojo oscuro, se va con la fusión)
  float ring = 1. - smoothstep(.0095 - aa, .0095 + aa, abs(r - RING));
  ring *= smoothstep(.55, .7, fill) * (1. - going * smoothstep(.08, .38, go));
  iris = mix(iris, vec3(.3, .0, .01), ring);

  // lo negro, con estela según la velocidad
  float cov = 0.;
  float trail = clamp(uSpd * .012, 0., .7);
  for (int j = 0; j < 6; j++) {
    float off = float(j) / 5. * trail;
    float c = pattern(p, uAng - off, aa, go, going);
    cov = max(cov, c * (j == 0 ? 1. : .5 * (1. - float(j) / 6.)));
    if (trail < .015) break;
  }
  iris = mix(iris, ink, cov);
  iris = mix(iris, ink, 1. - smoothstep(PUPIL - aa, PUPIL + aa, r));

  // punto rojo del centro del Mangekyō
  float g = going * clamp((go - MS0) / MSD, 0., 1.);
  float dotR = .08 * BORDER * mix(.3, 1., easeOutCubic(g)) * smoothstep(.2, .55, g);
  iris = mix(iris, cMid, (1. - smoothstep(dotR - aa, dotR + aa, r)) * step(.001, dotR));

  // aro negro gordo
  iris = mix(iris, ink, smoothstep(BORDER - aa, BORDER + aa, r));
  float inside = (1. - smoothstep(1. - aa, 1. + aa, r)) * appear;

  // halo
  float msHit = going * step(MS0, go) * exp(-(go - MS0) * 5.);
  col += vec3(.9, .04, .08) * exp(-max(r - 1., 0.) * 5.) * (.3 + msHit * .6 + spin * .9) * appear;
  col = mix(col, iris, inside);

  // ondas suaves al colocarse cada tomoe
  for (int k = 0; k < 3; k++) {
    float fk = float(k);
    float a = uT - (B0 + GAP * fk + FLY);
    if (a < 0. || a > .45) continue;
    float th = uAng + fk * TAU / 3. + PI / 2.;
    vec2 d = p - RING * vec2(cos(th), sin(th));
    float w = 1. - smoothstep(.0, .01, abs(length(d) - (.04 + a * .6)));
    col += vec3(1., .75, .72) * w * (1. - a / .45) * .4 * inside;
  }
  // aro que sale al formarse el Mangekyō
  float mw = go - MS0 - .1;
  if (going > .5 && mw > 0. && mw < .5) col += vec3(1., .7, .68) * (1. - smoothstep(0., .02, abs(r - 1. - mw * 2.6))) * (1. - mw / .5) * .7;

  // ---------------------------------------------------- la app desde el centro
  float hole = going * smoothstep(1.9, 2.25, go);
  float holeR = hole * 1.25;
  float alpha = smoothstep(holeR - .02, holeR + .03, rs);
  col += vec3(1., .2, .2) * (1. - smoothstep(0., .035, abs(rs - holeR))) * hole * (1. - hole) * 3.;
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
    // Despacio mientras carga; al terminar: rápido mientras se funden los
    // tomoe, casi quieto con el Mangekyō formado y luego a toda velocidad.
    let target, rate;
    if (go < 0) [target, rate] = [1.1 * smooth(1.3, 1.9, t), 3];
    else if (go < 0.42) [target, rate] = [16, 7];
    else if (go < 1.25) [target, rate] = [0.15, 5];
    else [target, rate] = [0.15 + 34 * smooth(1.25, 1.85, go), 4];
    spd += (target - spd) * Math.min(1, dt * rate);
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
  const OUT_MS = 2300;
  const REVEAL_MS = 1900; // se empieza a ver la app (uGo = 1,9 s)
  window.Intro = {
    // onReveal: cuando la app empieza a verse por la pupila
    finish(onReveal) {
      return new Promise((resolve) => {
        // Como pronto cuando ya han salido los tres tomoe
        const wait = Math.max(0, 1450 - (performance.now() - start));
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
