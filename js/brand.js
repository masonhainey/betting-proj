// The hedgehog mark: a hedgehog on a purple tile. One source for the header, favicon,
// home-screen icons (scripts/icons.mjs) and share images, so they always match.

const T = { x: 32, y: 32.5, s: 0.8474, cx: 31.598, cy: 34.215 }; // centers the drawing in the 64×64 tile
const BODY = "9.66,46.13 2.10,43.97 9.08,40.51 3.00,35.73 10.91,35.09 7.16,28.37 14.88,30.65 14.00,22.95 20.43,27.83 22.54,20.23 26.76,27.02 31.57,20.60 32.99,28.33 39.81,24.01 38.23,31.58 38.00,44.50 18.00,47.50 9.50,46.00";
const FACE = "M30.5 26 C40 20.5 50.5 26.5 57 34.5 C60.1 38.4 58.9 42.6 53.9 43.6 L41 46.4 C32.5 48.2 26.7 43.6 27.1 36.6 C27.4 31.8 28.4 28 30.5 26 Z";
const INK = "#1b1330";

/**
 * The logo as an SVG string. `rounded`: tile corners (off for home-screen icons, which
 * iOS and Android round themselves). `inset` shrinks the hedgehog (maskable icons need a
 * safe margin).
 */
export function logoSvg({ size = 32, rounded = true, id = "hh", inset = 1 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" aria-hidden="true">
<defs><linearGradient id="${id}-g" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#b9a1ff"/><stop offset="1" stop-color="#8b6cf6"/></linearGradient></defs>
<rect width="64" height="64" rx="${rounded ? 15 : 0}" fill="url(#${id}-g)"/>
<g transform="translate(${T.x} ${T.y}) scale(${T.s * inset}) translate(${-T.cx} ${-T.cy})">
<polygon points="${BODY}" fill="${INK}" stroke="${INK}" stroke-width="3.4" stroke-linejoin="round"/>
<path d="${FACE}" fill="#fff"/>
<circle cx="57.9" cy="37.6" r="3.2" fill="${INK}"/>
<circle cx="43.7" cy="33.2" r="2.7" fill="${INK}"/>
<circle cx="44.6" cy="32.3" r="0.9" fill="#fff"/>
<ellipse cx="39.3" cy="39.8" rx="3.1" ry="1.9" fill="#f7a8c4" opacity=".9"/>
</g></svg>`;
}

/** Draw the logo on a canvas (share images), top-left at x,y. */
export function drawLogo(ctx, x, y, size) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 64, size / 64);
  const g = ctx.createLinearGradient(0, 0, 0, 64);
  g.addColorStop(0, "#b9a1ff");
  g.addColorStop(1, "#8b6cf6");
  ctx.fillStyle = g;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(0, 0, 64, 64, 15);
  else ctx.rect(0, 0, 64, 64);
  ctx.fill();
  ctx.translate(T.x, T.y);
  ctx.scale(T.s, T.s);
  ctx.translate(-T.cx, -T.cy);
  const pts = BODY.split(" ").map((p) => p.split(",").map(Number));
  const body = new Path2D(`M${pts.map((p) => p.join(" ")).join(" L")} Z`);
  ctx.fillStyle = INK;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 3.4;
  ctx.lineJoin = "round";
  ctx.fill(body);
  ctx.stroke(body);
  ctx.fillStyle = "#fff";
  ctx.fill(new Path2D(FACE));
  const dot = (cx, cy, r, c) => {
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
  };
  dot(57.9, 37.6, 3.2, INK);
  dot(43.7, 33.2, 2.7, INK);
  dot(44.6, 32.3, 0.9, "#fff");
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = "#f7a8c4";
  ctx.beginPath();
  ctx.ellipse(39.3, 39.8, 3.1, 1.9, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}
