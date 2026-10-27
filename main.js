// Secuencias 3D que avanzan con el scroll + etiquetas que siguen a cada pieza.
// Cuadros y anclas salen de blender/build_site_assets.py (assets/seq/<nombre>/).

const LABELS = {
  notebook: {
    hinge:   { title: "Bisagras",     problem: "La tapa quedó floja o se partió",    fix: "Cambio y reparación de bisagras", from: 52 },
    fan_l:   { title: "Ventilador",   problem: "Se calienta o se apaga sola",        fix: "Limpieza interna y pasta térmica", from: 98 },
    ssd:     { title: "Disco",        problem: "Tarda años en prender",              fix: "Pasamos a SSD: arranca en segundos", from: 102 },
    ram:     { title: "Memoria RAM",  problem: "Se traba con varias cosas abiertas", fix: "Ampliación de memoria", from: 106 },
    board:   { title: "Placa madre",  problem: "No prende o se mojó",                fix: "Diagnóstico y reparación de placa", from: 110 },
    battery: { title: "Batería",      problem: "No carga o dura poco",               fix: "Cambio de batería", from: 114 },
  },
  printer: {
    scanner_lid:  { title: "Escáner",             problem: "No escanea o sale manchado",       fix: "Diagnóstico y reparación", from: 42 },
    carriage:     { title: "Cabezal",             problem: "Imprime con rayas o falta un color", fix: "Limpieza de cabezales y purga", from: 55 },
    tank_cap:     { title: "Tanques de tinta",    problem: "Entra aire o la tinta no baja",    fix: "Carga y purga del sistema", from: 80 },
    sheet:        { title: "Papel",               problem: "Se atasca o toma varias hojas",    fix: "Limpieza de rodillos", from: 118 },
    warning_leds: { title: "Luces que parpadean", problem: "Se bloqueó y pide servicio técnico",fix: "Reset y cambio de almohadillas", from: 124 },
  },
};

const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
const mobile = matchMedia("(max-width: 760px)");
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const NAV_H = 78; // alto del menú flotante: la banda de tarjetas de arriba arranca debajo
const GUTTER_M = 12;
const GAP_M = 8;
const smooth = (t) => t * t * (3 - 2 * t);

class Sequence {
  constructor(section) {
    this.section = section;
    this.name = section.dataset.seq;
    this.stage = section.querySelector(".seq__stage");
    this.canvas = section.querySelector(".seq__canvas");
    this.ctx = this.canvas.getContext("2d");
    this.svg = section.querySelector(".seq__lines");
    this.labelsEl = section.querySelector(".seq__labels");
    this.steps = [...section.querySelectorAll(".seq__step")];
    this.frames = [];
    this.anchors = [];
    this.count = +section.dataset.frames;
    this.current = 0;
    this.drawn = -1;
    this.labels = [];
    this.pinned = null; // en celular: pieza tocada por el usuario
  }

  async init() {
    this.buildLabels();
    await this.load();
    this.resize();
    mobile.addEventListener("change", async () => {
      await this.load();
      this.resize();
    });
  }

  // En celular se usan los renders verticales (<nombre>_m, 900×1600); en compu los horizontales (1593×896).
  async load() {
    const variant = mobile.matches ? `${this.name}_m` : this.name;
    if (variant === this.variant) return;
    let base = `assets/seq/${variant}/`;
    let data = await fetch(base + "anchors.json").then((r) => (r.ok ? r.json() : null)).catch(() => null);
    if (!data && variant !== this.name) {
      base = `assets/seq/${this.name}/`; // sin versión vertical: se usa la horizontal
      data = await fetch(base + "anchors.json").then((r) => r.json()).catch(() => null);
    }
    this.variant = variant;
    this.portrait = base.includes("_m/");
    [this.imgW, this.imgH] = this.portrait ? [900, 1600] : [1593, 896];
    if (data) {
      this.count = data.count;
      this.anchors = data.anchors;
    }
    const src = (i) => `${base}f${String(i).padStart(4, "0")}.webp`;
    // Primero el cuadro inicial; el resto en orden, sin bloquear.
    this.frames = [];
    for (let i = 0; i < this.count; i++) {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => { if (i === Math.round(this.current) || this.drawn < 0) this.drawn = -1; };
      this.frames[i] = img;
    }
    this.frames[0].src = src(0);
    for (let i = 1; i < this.count; i++) this.frames[i].src = src(i);
    this.drawn = -1;
  }

  buildLabels() {
    const defs = LABELS[this.name] || {};
    let n = 0;
    for (const [key, d] of Object.entries(defs)) {
      n++;
      const dot = document.createElement("div");
      dot.className = "dot";
      dot.innerHTML = `<span>${n}</span>`;
      const tag = document.createElement("div");
      tag.className = "tag";
      tag.innerHTML = `<h3>${d.title}</h3><p class="problem">“${d.problem}”</p><p class="fix">→ ${d.fix}</p>`;
      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      this.labelsEl.append(dot, tag);
      this.svg.append(line);
      this.labels.push({ key, ...d, dot, tag, line, on: false });
    }
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = this.stage.clientWidth;
    const h = this.stage.clientHeight;
    this.w = w;
    this.h = h;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
    // El texto tiene su franja arriba y el render entra debajo, sin taparse. La franja se mide con la
    // altura real de los textos. El del inicio es más alto: arranca debajo de él y sube mientras se desvanece.
    const bottomOf = (st) => st.offsetTop + st.offsetHeight + 12;
    const hero = this.steps.find((st) => st.classList.contains("seq__step--hero"));
    const zone = Math.max(0, ...this.steps.filter((st) => st !== hero).map(bottomOf));
    // celular: las tarjetas van en dos bandas (arriba y abajo del objeto), 3 por fila
    this.cardW = (w - 2 * GUTTER_M - 2 * GAP_M) / 3;
    this.labels.forEach((l) => { l.tag.style.width = mobile.matches ? `${this.cardW}px` : ""; });
    this.bandH = mobile.matches ? Math.max(0, ...this.labels.map((l) => l.tag.offsetHeight)) : 0;
    this.zoneTop = mobile.matches ? Math.max(zone, NAV_H + this.bandH + 14) : zone;
    this.heroTop = hero ? Math.max(this.zoneTop, bottomOf(hero)) : this.zoneTop;
    this.heroEnd = hero ? +hero.dataset.to : 0;
    // al inicio no hay tarjetas: el render usa todo el alto; el lugar para la banda de abajo se abre al scrollear
    this.bottomStart = mobile.matches ? h - 16 : h;
    this.bottomEnd = mobile.matches ? h - this.bandH - 30 : h;
    this.setRegion(this.zoneTop, this.bottomEnd);
    this.layoutTags();
    this.setRegion(this.heroTop, this.bottomStart);
    this.drawn = -1;
  }

  setRegion(top, bottom) {
    this.regionBottom = bottom;
    const ar = this.imgW / this.imgH;
    let rw, rh, cy;
    if (this.portrait) {
      // vertical: el objeto ocupa la franja media del cuadro (~30%–75% del alto) y casi todo el ancho;
      // se ajusta al ancho de pantalla y el aire de arriba/abajo queda fuera de la región
      rw = Math.min(this.w * 1.06, (bottom - top) * ar * 2.1);
      rh = rw / ar;
      cy = 0.53; // centro vertical del objeto dentro del cuadro
    } else {
      // horizontal: ~6% de aire arriba y abajo, un poco de zoom lo recorta sin cortar la pieza
      rh = (bottom - top) * 1.1;
      rw = rh * ar;
      const maxW = this.w * 1.15;
      if (rw > maxW) {
        rw = maxW;
        rh = rw / ar;
      }
      cy = 0.5;
    }
    this.rect = { w: rw, h: rh, x: (this.w - rw) / 2, y: (top + bottom) / 2 - rh * cy };
    this.regionTop = top;
  }

  // Compu: tarjetas en dos columnas (izq/der) según de qué lado está la pieza, repartidas en altura.
  // Celular: dos bandas, arriba las piezas de más arriba y abajo el resto, ordenadas de izq a der
  // para que las líneas no se crucen. Cada tarjeta guarda dónde llega su línea (ex, ey).
  layoutTags() {
    const last = this.anchors[this.anchors.length - 1] || {};
    const pos = (l) => last[l.key] || [0.5, 0.5];
    if (mobile.matches) {
      const byY = [...this.labels].sort((a, b) => pos(a)[1] - pos(b)[1]);
      const k = Math.ceil(byY.length / 2);
      const bands = [byY.slice(0, k), byY.slice(k)];
      bands.forEach((band, bi) => {
        band.sort((a, b) => pos(a)[0] - pos(b)[0]);
        const total = band.length * this.cardW + (band.length - 1) * GAP_M;
        let x = (this.w - total) / 2;
        for (const l of band) {
          const th = l.tag.offsetHeight;
          l.tx = x;
          l.ty = bi === 0 ? NAV_H : this.h - 16 - th;
          l.ex = x + this.cardW / 2;
          l.ey = bi === 0 ? l.ty + th : l.ty;
          l.tag.style.left = `${l.tx}px`;
          l.tag.style.top = `${l.ty}px`;
          x += this.cardW + GAP_M;
        }
      });
      return;
    }
    const mid = this.labels.reduce((s, l) => s + pos(l)[0], 0) / Math.max(1, this.labels.length);
    const sides = { left: [], right: [] };
    for (const l of this.labels) sides[pos(l)[0] < mid ? "left" : "right"].push(l);
    const gutter = Math.max(24, this.w * 0.04);
    for (const [side, list] of Object.entries(sides)) {
      list.sort((a, b) => pos(a)[1] - pos(b)[1]);
      const gap = 14;
      const heights = list.map((l) => l.tag.offsetHeight || 90);
      const total = heights.reduce((s, h) => s + h, 0) + gap * (list.length - 1);
      let y = (this.regionTop + this.regionBottom) / 2 - total / 2;
      list.forEach((l, i) => {
        const tw = l.tag.offsetWidth || 240;
        l.side = side;
        l.tx = side === "left" ? gutter : this.w - gutter - tw;
        l.ty = y;
        l.th = heights[i];
        l.tw = tw;
        l.tag.style.left = `${l.tx}px`;
        l.tag.style.top = `${l.ty}px`;
        l.ex = side === "left" ? l.tx + tw : l.tx;
        l.ey = y + heights[i] / 2;
        y += heights[i] + gap;
      });
    }
  }

  progress() {
    const r = this.section.getBoundingClientRect();
    const total = r.height - window.innerHeight;
    return total > 0 ? clamp(-r.top / total, 0, 1) : 1;
  }

  update() {
    const p = reduced ? 1 : this.progress();
    const target = p * (this.count - 1);
    this.current += (target - this.current) * 0.25; // suavizado del scrub
    if (Math.abs(target - this.current) < 0.01) this.current = target;
    const idx = clamp(Math.round(this.current), 0, this.count - 1);

    // mientras se va el texto del inicio, el render sube y crece hasta su lugar final
    const t = this.heroEnd > 0 ? smooth(clamp(p / this.heroEnd, 0, 1)) : 1;
    const top = this.heroTop + (this.zoneTop - this.heroTop) * t;
    const bottom = this.bottomStart + (this.bottomEnd - this.bottomStart) * t;
    if (Math.abs(top - this.regionTop) > 0.5 || Math.abs(bottom - this.regionBottom) > 0.5) {
      this.setRegion(top, bottom);
      this.drawn = -1;
    }

    if (idx !== this.drawn) {
      // si el cuadro todavía no bajó, uso el más cercano ya cargado
      let k = idx;
      while (k > 0 && !(this.frames[k] && this.frames[k].complete && this.frames[k].naturalWidth)) k--;
      const img = this.frames[k];
      if (img && img.complete && img.naturalWidth) {
        this.ctx.clearRect(0, 0, this.w, this.h);
        this.ctx.drawImage(img, this.rect.x, this.rect.y, this.rect.w, this.rect.h);
        this.drawn = idx;
      }
    }

    for (const s of this.steps) {
      const a = +s.dataset.from;
      const b = +s.dataset.to;
      const f = 0.04;
      const o = a <= 0 ? smooth(clamp((b - p) / f, 0, 1)) : smooth(clamp((p - a) / f, 0, 1)) * smooth(clamp((b - p) / f, 0, 1));
      s.style.opacity = reduced && a > 0 ? 0 : o;
      s.style.transform = `translateY(${(1 - o) * 12}px)`;
      s.classList.toggle("is-on", o > 0.5);
    }

    const anc = this.anchors[idx] || {};
    for (const l of this.labels) {
      const a = anc[l.key];
      const on = !!a && idx >= l.from;
      if (on !== l.on) {
        l.on = on;
        l.dot.classList.toggle("is-on", on);
        l.tag.classList.toggle("is-on", on);
        l.line.classList.toggle("is-on", on);
      }
      if (!a) continue;
      const x = this.rect.x + a[0] * this.rect.w;
      const y = this.rect.y + a[1] * this.rect.h;
      l.dot.style.left = `${x}px`;
      l.dot.style.top = `${y}px`;
      if (l.ex === undefined) continue; // tarjetas todavía sin ubicar
      l.line.setAttribute("x1", x);
      l.line.setAttribute("y1", y);
      l.line.setAttribute("x2", l.ex);
      l.line.setAttribute("y2", l.ey);
    }
  }
}

const seqs = [...document.querySelectorAll(".seq")].map((s) => new Sequence(s));
Promise.all(seqs.map((s) => s.init())).then(() => {
  const loop = () => {
    for (const s of seqs) {
      const r = s.section.getBoundingClientRect();
      if (r.bottom > -100 && r.top < window.innerHeight + 100) s.update();
    }
    requestAnimationFrame(loop);
  };
  loop();
});
// Las tarjetas se miden con la tipografía final: re-armar cuando cargan las fuentes.
document.fonts.ready.then(() => seqs.forEach((s) => s.resize()));
let rz;
window.addEventListener("resize", () => {
  clearTimeout(rz);
  rz = setTimeout(() => seqs.forEach((s) => s.resize()), 120);
});

// Formulario -> WhatsApp
document.getElementById("wa-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const problema = new FormData(e.target).get("problema").trim();
  const msg = problema ? `Hola ADN, quería consultar: ${problema}` : "Hola ADN, quería hacer una consulta";
  window.open(`https://wa.me/5492613688606?text=${encodeURIComponent(msg)}`, "_blank", "noopener");
});

// Abierto / cerrado según la hora de Mendoza, y el día de hoy resaltado.
(function hours() {
  const HOURS = { 1: [9, 19], 2: [9, 19], 3: [9, 19], 4: [9, 19], 5: [9, 19], 6: [10, 13] };
  const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Mendoza", weekday: "short", hour: "numeric", minute: "numeric", hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  const now = (+get("hour") % 24) + +get("minute") / 60;
  const today = HOURS[day];
  const open = !!today && now >= today[0] && now < today[1];
  const pad = (n) => String(n).padStart(2, "0");
  const status = document.getElementById("open-status");
  const next = document.getElementById("open-next");
  status.textContent = open ? "Abierto" : "Cerrado";
  status.classList.add(open ? "is-open" : "is-closed");
  if (open) {
    next.textContent = `Cerramos hoy a las ${pad(today[1])}:00 hs`;
  } else {
    for (let k = 0; k < 7; k++) {
      const d = (day + k) % 7;
      const hrs = HOURS[d];
      if (hrs && (k > 0 || now < hrs[0])) {
        const when = k === 0 ? "hoy" : k === 1 ? "mañana" : `el ${DAYS[d]}`;
        next.textContent = `Abrimos ${when} a las ${pad(hrs[0])}:00 hs`;
        break;
      }
    }
  }
  document.querySelector(`.hours tr[data-day="${day}"]`)?.classList.add("is-today");
})();
