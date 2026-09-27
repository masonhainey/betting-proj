// Draws a shareable ticket image (1080×1350, 4:5 — fits iMessage and group chats) on a
// canvas. Browser only.

import { drawLogo } from "./brand.js";

const W = 1080, H = 1350, PAD = 84;
const C = {
  bg: "#09080c", card: "#141119", line: "#2a2535", text: "#f3f1f8", muted: "#9b96aa",
  accent: "#a78bfa", win: "#3ddc97", red: "#ff5d73", gold: "#f7c948",
};
const FONT = '"Inter Tight", "Inter", -apple-system, "Segoe UI", Roboto, sans-serif';

function fit(ctx, text, max) {
  if (ctx.measureText(text).width <= max) return text;
  let s = text;
  while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
  return `${s}…`;
}

function pill(ctx, x, y, label, color) {
  ctx.font = `800 30px ${FONT}`;
  const w = ctx.measureText(label).width + 44;
  ctx.fillStyle = `${color}26`;
  ctx.beginPath();
  ctx.roundRect(x - w, y, w, 54, 27);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = "center";
  ctx.fillText(label, x - w / 2, y + 38);
  ctx.textAlign = "left";
}

/**
 * card = { kind, title, price, from, status, legs: [{ pick, meta, odds, status }],
 *          money: "…", footer: "…" }
 */
export async function drawShareCard(card) {
  try {
    await Promise.all([document.fonts.load(`800 60px "Inter Tight"`), document.fonts.load(`600 30px "Inter Tight"`)]);
  } catch {}
  const cv = document.createElement("canvas");
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext("2d");

  // Background with a soft purple glow.
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
  const glow = ctx.createRadialGradient(160, 120, 0, 160, 120, 900);
  glow.addColorStop(0, "rgba(167,139,250,0.28)");
  glow.addColorStop(1, "rgba(167,139,250,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, W, H);

  // Brand.
  drawLogo(ctx, PAD, 80, 72);
  ctx.fillStyle = C.text;
  ctx.font = `900 54px ${FONT}`;
  ctx.fillText("hedgehog", PAD + 96, 136);

  const statusColor = { won: C.win, lost: C.red, push: C.muted, cashout: C.gold }[card.status] || C.accent;
  const statusLabel = { won: "CASHED", lost: "LOST", push: "PUSH", cashout: "CASHED OUT" }[card.status] || (card.kind === "slip" ? "THINKING ABOUT IT" : "OPEN");
  pill(ctx, W - PAD, 92, statusLabel, statusColor);

  // Headline. With only a few legs, center the whole block instead of leaving a hole.
  const shown = Math.min(card.legs.length, 6);
  const blockH = 150 + (card.from ? 58 : 0) + 104 + shown * 118 + (card.legs.length > 6 ? 70 : 0) + 30 + (card.money ? 120 : 0);
  const top = 230, bottom = H - 140;
  let y = 270 + Math.max(0, (bottom - top - blockH) / 2);
  ctx.fillStyle = C.accent;
  ctx.font = `800 34px ${FONT}`;
  ctx.fillText(card.title.toUpperCase(), PAD, y);
  y += 150;
  ctx.fillStyle = card.status === "won" ? C.win : C.text;
  ctx.font = `900 150px ${FONT}`;
  ctx.fillText(card.price, PAD - 6, y);
  if (card.from) {
    ctx.fillStyle = C.muted;
    ctx.font = `600 34px ${FONT}`;
    ctx.fillText(`from ${card.from}`, PAD, y + 58);
  }

  // Legs panel.
  const legs = card.legs.slice(0, 6);
  const rowH = 118;
  const panelY = y + 104;
  const panelH = legs.length * rowH + (card.legs.length > 6 ? 70 : 0) + 30;
  ctx.fillStyle = C.card;
  ctx.beginPath();
  ctx.roundRect(PAD - 24, panelY, W - 2 * PAD + 48, panelH, 36);
  ctx.fill();
  let ly = panelY + 30;
  legs.forEach((l, i) => {
    if (i) {
      ctx.fillStyle = C.line;
      ctx.fillRect(PAD, ly - 2, W - 2 * PAD, 2);
    }
    const dot = { won: C.win, lost: C.red }[l.status];
    ctx.beginPath();
    ctx.arc(PAD + 16, ly + 48, 13, 0, Math.PI * 2);
    if (dot) {
      ctx.fillStyle = dot;
      ctx.fill();
    } else {
      ctx.strokeStyle = C.muted;
      ctx.lineWidth = 4;
      ctx.stroke();
    }
    ctx.font = `700 30px ${FONT}`;
    const oddsW = ctx.measureText(l.odds).width;
    ctx.fillStyle = C.muted;
    ctx.textAlign = "right";
    ctx.fillText(l.odds, W - PAD, ly + 58);
    ctx.textAlign = "left";
    ctx.fillStyle = l.status === "lost" ? C.muted : C.text;
    ctx.font = `800 44px ${FONT}`;
    ctx.fillText(fit(ctx, l.pick, W - 2 * PAD - 70 - oddsW - 24), PAD + 54, ly + 60);
    if (l.meta) {
      ctx.fillStyle = C.muted;
      ctx.font = `500 28px ${FONT}`;
      ctx.fillText(fit(ctx, l.meta, W - 2 * PAD - 70), PAD + 54, ly + 100);
    }
    ly += rowH;
  });
  if (card.legs.length > 6) {
    ctx.fillStyle = C.muted;
    ctx.font = `600 30px ${FONT}`;
    ctx.fillText(`+ ${card.legs.length - 6} more legs`, PAD + 54, ly + 36);
  }

  // Money line right under the legs, footer pinned to the bottom.
  if (card.money) {
    ctx.fillStyle = card.status === "won" ? C.win : C.text;
    ctx.font = `800 52px ${FONT}`;
    ctx.fillText(fit(ctx, card.money, W - 2 * PAD), PAD, Math.min(panelY + panelH + 96, H - 150));
  }
  ctx.fillStyle = C.muted;
  ctx.font = `600 30px ${FONT}`;
  ctx.fillText(card.footer || "Tail it on hedgehog", PAD, H - 84);
  return cv;
}

export const canvasToBlob = (cv) => new Promise((resolve) => cv.toBlob(resolve, "image/png"));
