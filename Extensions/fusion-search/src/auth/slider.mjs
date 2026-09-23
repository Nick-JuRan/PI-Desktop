import { PNG } from "../../vendor/pngjs/lib/png.js";
import { aesEcbEncryptBase64, b64decode } from "./crypto.mjs";

/**
 * Port of find_x() from the legacy auth_http_login.py: locate the jigsaw
 * notch by comparing background luminance under the tile's outline pixels.
 * The cut-out notch reads brighter than the surrounding plate, so the offset
 * whose outline-aligned pixels have the highest mean luminance is the answer.
 */

const JUDGE_Y = 5;

function parsePng(base64) {
  return PNG.sync.read(b64decode(base64));
}

/**
 * Compute the x offset of the slider piece inside the background image.
 * Returns { x, score, y }.
 */
export function locateSliderNotch(backgroundBase64, pieceBase64) {
  const background = parsePng(backgroundBase64);
  const piece = parsePng(pieceBase64);
  if (background.height !== piece.height) {
    throw new Error(`captcha image heights differ: ${background.height} / ${piece.height}`);
  }

  const bgLuminance = luminanceGrid(background);
  const { edgeMask, edgeCount } = pieceOutline(piece);
  if (edgeCount === 0) {
    throw new Error("captcha piece has no visible pixels");
  }
  const maxWidth = background.width - piece.width + 1;
  if (maxWidth <= 0) {
    throw new Error("captcha piece is wider than the background");
  }

  let bestX = 0;
  let bestScore = -Infinity;
  for (let x = 0; x < maxWidth; x += 1) {
    let sum = 0;
    for (let row = 0; row < piece.height; row += 1) {
      const maskRow = edgeMask[row];
      const base = row * background.width + x;
      for (let col = 0; col < piece.width; col += 1) {
        if (maskRow[col]) sum += bgLuminance[base + col];
      }
    }
    const score = sum / edgeCount;
    if (score > bestScore) {
      bestScore = score;
      bestX = x;
    }
  }
  return { x: bestX, score: bestScore, y: JUDGE_Y };
}

function luminanceGrid(image) {
  const { data, width, height } = image;
  const out = new Float32Array(width * height);
  for (let px = 0, i = 0; px < out.length; px += 1, i += 4) {
    out[px] = (data[i] + data[i + 1] + data[i + 2]) / 3;
  }
  return out;
}

/** Alpha>0 pixels that touch a transparent neighbor: the piece's outline. */
function pieceOutline(piece) {
  const { data, width, height } = piece;
  const solid = (x, y) =>
    x >= 0 && x < width && y >= 0 && y < height && data[(y * width + x) * 4 + 3] > 0;
  const mask = Array.from({ length: height }, () => new Uint8Array(width));
  let count = 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (!solid(x, y)) continue;
      if (solid(x - 1, y) && solid(x + 1, y) && solid(x, y - 1) && solid(x, y + 1)) continue;
      mask[y][x] = 1;
      count += 1;
    }
  }
  return { edgeMask: mask, edgeCount: count };
}

/** The judge payload the server expects: AES-encrypted {x, y} JSON. */
export function sliderJudgePayload(notch, secretKey) {
  return aesEcbEncryptBase64(JSON.stringify({ x: notch.x, y: notch.y }), secretKey);
}
