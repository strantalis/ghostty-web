/**
 * Pixel-perfect Box Drawing Character renderer (U+2500–U+257F).
 *
 * Draws box drawing characters using fillRect() instead of font glyphs
 * to eliminate sub-pixel gaps between adjacent cells — the same approach
 * used for Block Elements (U+2580–U+259F) in renderer.ts.
 */

// Thickness constants: 0 = none, 1 = light, 2 = heavy
type Thick = 0 | 1 | 2;
type Segments = [up: Thick, down: Thick, left: Thick, right: Thick];

/**
 * Lookup table for segment-based box drawing characters.
 * Each entry encodes [up, down, left, right] line thickness.
 */
const SEGMENTS: Record<number, Segments> = {
  // ─ ━ │ ┃  Light/heavy horizontal and vertical
  9472: [0, 0, 1, 1], // ─
  9473: [0, 0, 2, 2], // ━
  9474: [1, 1, 0, 0], // │
  9475: [2, 2, 0, 0], // ┃

  // ┌ ┍ ┎ ┏  Down-right corners
  9484: [0, 1, 0, 1], // ┌
  9485: [0, 1, 0, 2], // ┍
  9486: [0, 2, 0, 1], // ┎
  9487: [0, 2, 0, 2], // ┏

  // ┐ ┑ ┒ ┓  Down-left corners
  9488: [0, 1, 1, 0], // ┐
  9489: [0, 1, 2, 0], // ┑
  9490: [0, 2, 1, 0], // ┒
  9491: [0, 2, 2, 0], // ┓

  // └ ┕ ┖ ┗  Up-right corners
  9492: [1, 0, 0, 1], // └
  9493: [1, 0, 0, 2], // ┕
  9494: [2, 0, 0, 1], // ┖
  9495: [2, 0, 0, 2], // ┗

  // ┘ ┙ ┚ ┛  Up-left corners
  9496: [1, 0, 1, 0], // ┘
  9497: [1, 0, 2, 0], // ┙
  9498: [2, 0, 1, 0], // ┚
  9499: [2, 0, 2, 0], // ┛

  // ├ ┝ ┞ ┟ ┠ ┡ ┢ ┣  Right T-junctions
  9500: [1, 1, 0, 1], // ├
  9501: [1, 1, 0, 2], // ┝
  9502: [2, 1, 0, 1], // ┞
  9503: [1, 2, 0, 1], // ┟
  9504: [2, 2, 0, 1], // ┠
  9505: [2, 1, 0, 2], // ┡
  9506: [1, 2, 0, 2], // ┢
  9507: [2, 2, 0, 2], // ┣

  // ┤ ┥ ┦ ┧ ┨ ┩ ┪ ┫  Left T-junctions
  9508: [1, 1, 1, 0], // ┤
  9509: [1, 1, 2, 0], // ┥
  9510: [2, 1, 1, 0], // ┦
  9511: [1, 2, 1, 0], // ┧
  9512: [2, 2, 1, 0], // ┨
  9513: [2, 1, 2, 0], // ┩
  9514: [1, 2, 2, 0], // ┪
  9515: [2, 2, 2, 0], // ┫

  // ┬ ┭ ┮ ┯ ┰ ┱ ┲ ┳  Down T-junctions
  9516: [0, 1, 1, 1], // ┬
  9517: [0, 1, 2, 1], // ┭
  9518: [0, 1, 1, 2], // ┮
  9519: [0, 1, 2, 2], // ┯
  9520: [0, 2, 1, 1], // ┰
  9521: [0, 2, 2, 1], // ┱
  9522: [0, 2, 1, 2], // ┲
  9523: [0, 2, 2, 2], // ┳

  // ┴ ┵ ┶ ┷ ┸ ┹ ┺ ┻  Up T-junctions
  9524: [1, 0, 1, 1], // ┴
  9525: [1, 0, 2, 1], // ┵
  9526: [1, 0, 1, 2], // ┶
  9527: [1, 0, 2, 2], // ┷
  9528: [2, 0, 1, 1], // ┸
  9529: [2, 0, 2, 1], // ┹
  9530: [2, 0, 1, 2], // ┺
  9531: [2, 0, 2, 2], // ┻

  // ┼ ┽ ┾ ┿ ╀ ╁ ╂ ╃ ╄ ╅ ╆ ╇ ╈ ╉ ╊ ╋  Crosses
  9532: [1, 1, 1, 1], // ┼
  9533: [1, 1, 2, 1], // ┽
  9534: [1, 1, 1, 2], // ┾
  9535: [1, 1, 2, 2], // ┿
  9536: [2, 1, 1, 1], // ╀
  9537: [1, 2, 1, 1], // ╁
  9538: [2, 2, 1, 1], // ╂
  9539: [2, 1, 2, 1], // ╃
  9540: [2, 1, 1, 2], // ╄
  9541: [1, 2, 2, 1], // ╅
  9542: [1, 2, 1, 2], // ╆
  9543: [2, 1, 2, 2], // ╇
  9544: [1, 2, 2, 2], // ╈
  9545: [2, 2, 2, 1], // ╉
  9546: [2, 2, 1, 2], // ╊
  9547: [2, 2, 2, 2], // ╋

  // ╴ ╵ ╶ ╷  Light half-lines
  9588: [0, 0, 1, 0], // ╴
  9589: [1, 0, 0, 0], // ╵
  9590: [0, 0, 0, 1], // ╶
  9591: [0, 1, 0, 0], // ╷

  // ╸ ╹ ╺ ╻  Heavy half-lines
  9592: [0, 0, 2, 0], // ╸
  9593: [2, 0, 0, 0], // ╹
  9594: [0, 0, 0, 2], // ╺
  9595: [0, 2, 0, 0], // ╻

  // ╼ ╽ ╾ ╿  Mixed half-lines
  9596: [0, 0, 1, 2], // ╼
  9597: [1, 2, 0, 0], // ╽
  9598: [0, 0, 2, 1], // ╾
  9599: [2, 1, 0, 0], // ╿
};

// Double line encoding: 0 = none, 1 = single, 2 = double
type DThick = 0 | 1 | 2;
type DSegments = [up: DThick, down: DThick, left: DThick, right: DThick];

const DOUBLE_SEGMENTS: Record<number, DSegments> = {
  9552: [0, 0, 2, 2], // ═
  9553: [2, 2, 0, 0], // ║

  // Down-right corners
  9554: [0, 1, 0, 2], // ╒
  9555: [0, 2, 0, 1], // ╓
  9556: [0, 2, 0, 2], // ╔

  // Down-left corners
  9557: [0, 1, 2, 0], // ╕
  9558: [0, 2, 1, 0], // ╖
  9559: [0, 2, 2, 0], // ╗

  // Up-right corners
  9560: [1, 0, 0, 2], // ╘
  9561: [2, 0, 0, 1], // ╙
  9562: [2, 0, 0, 2], // ╚

  // Up-left corners
  9563: [1, 0, 2, 0], // ╛
  9564: [2, 0, 1, 0], // ╜
  9565: [2, 0, 2, 0], // ╝

  // Right T-junctions
  9566: [1, 1, 0, 2], // ╞
  9567: [2, 2, 0, 1], // ╟
  9568: [2, 2, 0, 2], // ╠

  // Left T-junctions
  9569: [1, 1, 2, 0], // ╡
  9570: [2, 2, 1, 0], // ╢
  9571: [2, 2, 2, 0], // ╣

  // Down T-junctions
  9572: [0, 1, 2, 2], // ╤
  9573: [0, 2, 1, 1], // ╥
  9574: [0, 2, 2, 2], // ╦

  // Up T-junctions
  9575: [1, 0, 2, 2], // ╧
  9576: [2, 0, 1, 1], // ╨
  9577: [2, 0, 2, 2], // ╩

  // Crosses
  9578: [1, 1, 2, 2], // ╪
  9579: [2, 2, 1, 1], // ╫
  9580: [2, 2, 2, 2], // ╬
};

function thicknessPx(t: Thick | DThick, cellDim: number): number {
  if (t === 0) return 0;
  if (t === 1) return Math.max(1, Math.round(cellDim / 8));
  return Math.max(2, Math.round(cellDim / 4));
}

/**
 * Draw box drawing segments using fillRect.
 * Each segment extends from the cell edge to the cell center.
 */
function drawSegments(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  w: number,
  h: number,
  up: Thick,
  down: Thick,
  left: Thick,
  right: Thick
): void {
  const cx = Math.round(cellX + w / 2);
  const cy = Math.round(cellY + h / 2);

  // For the horizontal bar through center: use max vertical thickness of left/right
  // For the vertical bar through center: use max horizontal thickness of up/down
  const hThick = Math.max(thicknessPx(left, h), thicknessPx(right, h));
  const vThick = Math.max(thicknessPx(up, w), thicknessPx(down, w));

  // Left segment
  if (left) {
    const t = thicknessPx(left, h);
    const y0 = cy - Math.floor(t / 2);
    ctx.fillRect(cellX, y0, cx - cellX, t);
  }

  // Right segment
  if (right) {
    const t = thicknessPx(right, h);
    const y0 = cy - Math.floor(t / 2);
    ctx.fillRect(cx, y0, cellX + w - cx, t);
  }

  // Up segment
  if (up) {
    const t = thicknessPx(up, w);
    const x0 = cx - Math.floor(t / 2);
    ctx.fillRect(x0, cellY, t, cy - cellY);
  }

  // Down segment
  if (down) {
    const t = thicknessPx(down, w);
    const x0 = cx - Math.floor(t / 2);
    ctx.fillRect(x0, cy, t, cellY + h - cy);
  }

  // Fill center junction if we have perpendicular segments
  const hasH = left || right;
  const hasV = up || down;
  if (hasH && hasV) {
    const x0 = cx - Math.floor(vThick / 2);
    const y0 = cy - Math.floor(hThick / 2);
    ctx.fillRect(x0, y0, vThick, hThick);
  }
}

/**
 * Draw double-line box drawing segments.
 * Double directions get two parallel lines with a gap; single directions get one centered line.
 */
function drawDoubleSegments(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  w: number,
  h: number,
  up: DThick,
  down: DThick,
  left: DThick,
  right: DThick
): void {
  const cx = Math.round(cellX + w / 2);
  const cy = Math.round(cellY + h / 2);
  const lt = Math.max(1, Math.round(w / 8)); // light/single line thickness
  // Gap between double lines — equal to single line thickness
  const gap = lt;
  // Offset from center for each line of a double pair
  const dOff = lt + Math.floor(gap / 2);

  // Helper: draw a horizontal rect
  const hRect = (x: number, y: number, width: number) => {
    ctx.fillRect(x, y - Math.floor(lt / 2), width, lt);
  };

  // Helper: draw a vertical rect
  const vRect = (x: number, y: number, height: number) => {
    ctx.fillRect(x - Math.floor(lt / 2), y, lt, height);
  };

  // Determine if any horizontal or vertical direction is present
  const hasLeft = left > 0;
  const hasRight = right > 0;
  const hasUp = up > 0;
  const hasDown = down > 0;
  const hasH = hasLeft || hasRight;
  const hasV = hasUp || hasDown;

  // --- Horizontal lines ---
  if (hasLeft && left === 2) {
    // Double left
    const endX = hasV ? cx - dOff : cx;
    hRect(cellX, cy - dOff, endX - cellX + Math.floor(lt / 2));
    const endX2 = hasV ? cx + dOff : cx;
    hRect(cellX, cy + dOff, endX2 - cellX + Math.floor(lt / 2));
  } else if (hasLeft && left === 1) {
    // Single left
    const endX = hasV ? cx : cx;
    hRect(cellX, cy, endX - cellX + Math.floor(lt / 2));
  }

  if (hasRight && right === 2) {
    // Double right
    const startX = hasV ? cx + dOff : cx;
    hRect(startX - Math.floor(lt / 2), cy - dOff, cellX + w - startX + Math.floor(lt / 2));
    const startX2 = hasV ? cx - dOff : cx;
    hRect(startX2 - Math.floor(lt / 2), cy + dOff, cellX + w - startX2 + Math.floor(lt / 2));
  } else if (hasRight && right === 1) {
    hRect(cx - Math.floor(lt / 2), cy, cellX + w - cx + Math.floor(lt / 2));
  }

  // --- Vertical lines ---
  if (hasUp && up === 2) {
    // Double up
    const endY = hasH ? cy - dOff : cy;
    vRect(cx - dOff, cellY, endY - cellY + Math.floor(lt / 2));
    const endY2 = hasH ? cy + dOff : cy;
    vRect(cx + dOff, cellY, endY2 - cellY + Math.floor(lt / 2));
  } else if (hasUp && up === 1) {
    vRect(cx, cellY, cy - cellY + Math.floor(lt / 2));
  }

  if (hasDown && down === 2) {
    // Double down
    const startY = hasH ? cy + dOff : cy;
    vRect(cx - dOff, startY - Math.floor(lt / 2), cellY + h - startY + Math.floor(lt / 2));
    const startY2 = hasH ? cy - dOff : cy;
    vRect(cx + dOff, startY2 - Math.floor(lt / 2), cellY + h - startY2 + Math.floor(lt / 2));
  } else if (hasDown && down === 1) {
    vRect(cx, cy - Math.floor(lt / 2), cellY + h - cy + Math.floor(lt / 2));
  }
}

/**
 * Draw dashed box drawing lines.
 */
function drawDashedLine(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  w: number,
  h: number,
  horizontal: boolean,
  heavy: boolean,
  dashCount: number
): void {
  const cx = Math.round(cellX + w / 2);
  const cy = Math.round(cellY + h / 2);
  const lt = heavy
    ? Math.max(2, Math.round(horizontal ? h / 4 : w / 4))
    : Math.max(1, Math.round(horizontal ? h / 8 : w / 8));

  if (horizontal) {
    // dashCount dashes evenly spaced across the cell
    const totalSegments = dashCount * 2 - 1; // dashes + gaps
    const segW = w / totalSegments;
    const y0 = cy - Math.floor(lt / 2);
    for (let i = 0; i < dashCount; i++) {
      const sx = cellX + Math.round(i * 2 * segW);
      const ex = cellX + Math.round((i * 2 + 1) * segW);
      ctx.fillRect(sx, y0, ex - sx, lt);
    }
  } else {
    const totalSegments = dashCount * 2 - 1;
    const segH = h / totalSegments;
    const x0 = cx - Math.floor(lt / 2);
    for (let i = 0; i < dashCount; i++) {
      const sy = cellY + Math.round(i * 2 * segH);
      const ey = cellY + Math.round((i * 2 + 1) * segH);
      ctx.fillRect(x0, sy, lt, ey - sy);
    }
  }
}

/**
 * Draw rounded corners using quadratic curves.
 */
function drawRoundedCorner(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  w: number,
  h: number,
  cp: number
): void {
  const cx = Math.round(cellX + w / 2);
  const cy = Math.round(cellY + h / 2);
  const lt = Math.max(1, Math.round(w / 8));

  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = lt;
  ctx.lineCap = 'square';
  ctx.beginPath();

  switch (cp) {
    case 0x256d: // ╭ down and right
      ctx.moveTo(cx, cellY + h);
      ctx.quadraticCurveTo(cx, cy, cellX + w, cy);
      break;
    case 0x256e: // ╮ down and left
      ctx.moveTo(cx, cellY + h);
      ctx.quadraticCurveTo(cx, cy, cellX, cy);
      break;
    case 0x256f: // ╯ up and left
      ctx.moveTo(cx, cellY);
      ctx.quadraticCurveTo(cx, cy, cellX, cy);
      break;
    case 0x2570: // ╰ up and right
      ctx.moveTo(cx, cellY);
      ctx.quadraticCurveTo(cx, cy, cellX + w, cy);
      break;
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * Draw diagonal lines.
 */
function drawDiagonal(
  ctx: CanvasRenderingContext2D,
  cellX: number,
  cellY: number,
  w: number,
  h: number,
  cp: number
): void {
  const lt = Math.max(1, Math.round(w / 8));

  ctx.save();
  ctx.strokeStyle = ctx.fillStyle;
  ctx.lineWidth = lt;
  ctx.lineCap = 'square';
  ctx.beginPath();

  if (cp === 0x2571 || cp === 0x2573) {
    // ╱ or ╳
    ctx.moveTo(cellX + w, cellY);
    ctx.lineTo(cellX, cellY + h);
  }
  if (cp === 0x2572 || cp === 0x2573) {
    // ╲ or ╳
    ctx.moveTo(cellX, cellY);
    ctx.lineTo(cellX + w, cellY + h);
  }

  ctx.stroke();
  ctx.restore();
}

/**
 * Try to render a Unicode Box Drawing character (U+2500–U+257F) using
 * precise canvas primitives instead of font glyphs.
 * Returns true if handled, false otherwise.
 */
export function renderBoxDrawing(
  ctx: CanvasRenderingContext2D,
  codepoint: number,
  cellX: number,
  cellY: number,
  cellWidth: number,
  cellHeight: number
): boolean {
  if (codepoint < 0x2500 || codepoint > 0x257f) return false;

  // 1. Segment-based characters (light/heavy single lines)
  const seg = SEGMENTS[codepoint];
  if (seg) {
    drawSegments(ctx, cellX, cellY, cellWidth, cellHeight, seg[0], seg[1], seg[2], seg[3]);
    return true;
  }

  // 2. Double/mixed line characters
  const dseg = DOUBLE_SEGMENTS[codepoint];
  if (dseg) {
    drawDoubleSegments(
      ctx,
      cellX,
      cellY,
      cellWidth,
      cellHeight,
      dseg[0],
      dseg[1],
      dseg[2],
      dseg[3]
    );
    return true;
  }

  // 3. Dashed lines
  switch (codepoint) {
    case 0x2504:
      drawDashedLine(ctx, cellX, cellY, cellWidth, cellHeight, true, false, 3);
      return true; // ┄
    case 0x2505:
      drawDashedLine(ctx, cellX, cellY, cellWidth, cellHeight, true, true, 3);
      return true; // ┅
    case 0x2506:
      drawDashedLine(ctx, cellX, cellY, cellWidth, cellHeight, false, false, 3);
      return true; // ┆
    case 0x2507:
      drawDashedLine(ctx, cellX, cellY, cellWidth, cellHeight, false, true, 3);
      return true; // ┇
    case 0x2508:
      drawDashedLine(ctx, cellX, cellY, cellWidth, cellHeight, true, false, 4);
      return true; // ┈
    case 0x2509:
      drawDashedLine(ctx, cellX, cellY, cellWidth, cellHeight, true, true, 4);
      return true; // ┉
    case 0x250a:
      drawDashedLine(ctx, cellX, cellY, cellWidth, cellHeight, false, false, 4);
      return true; // ┊
    case 0x250b:
      drawDashedLine(ctx, cellX, cellY, cellWidth, cellHeight, false, true, 4);
      return true; // ┋
    case 0x254c:
      drawDashedLine(ctx, cellX, cellY, cellWidth, cellHeight, true, false, 2);
      return true; // ╌
    case 0x254d:
      drawDashedLine(ctx, cellX, cellY, cellWidth, cellHeight, true, true, 2);
      return true; // ╍
    case 0x254e:
      drawDashedLine(ctx, cellX, cellY, cellWidth, cellHeight, false, false, 2);
      return true; // ╎
    case 0x254f:
      drawDashedLine(ctx, cellX, cellY, cellWidth, cellHeight, false, true, 2);
      return true; // ╏
  }

  // 4. Rounded corners
  if (codepoint >= 0x256d && codepoint <= 0x2570) {
    drawRoundedCorner(ctx, cellX, cellY, cellWidth, cellHeight, codepoint);
    return true;
  }

  // 5. Diagonals
  if (codepoint >= 0x2571 && codepoint <= 0x2573) {
    drawDiagonal(ctx, cellX, cellY, cellWidth, cellHeight, codepoint);
    return true;
  }

  // Unhandled codepoint in range — fall through to font rendering
  return false;
}
