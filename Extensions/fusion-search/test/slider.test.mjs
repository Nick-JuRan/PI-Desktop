import assert from "node:assert/strict";
import test from "node:test";
import { PNG } from "../vendor/pngjs/lib/png.js";

import { locateSliderNotch, sliderJudgePayload } from "../src/auth/slider.mjs";
import { aesEcbDecrypt, b64decode } from "../src/auth/crypto.mjs";

// The real service's piece image shares the background's height but is only
// the tile strip wide (the python original slices lum[:, x : x + tile_width]),
// so the piece canvas here is W_px tall x 40 wide with alpha only on the disc.

const WIDTH = 300;
const HEIGHT = 100;
const TILE_SIZE = 40;
const TILE_Y = 20;

function makeCaptcha(notchX) {
  // Dark plate with one bright notch.
  const background = new PNG({ width: WIDTH, height: HEIGHT });
  for (let i = 0; i < background.data.length; i += 4) {
    background.data[i] = 40;
    background.data[i + 1] = 40;
    background.data[i + 2] = 40;
    background.data[i + 3] = 255;
  }
  for (let y = TILE_Y; y < TILE_Y + TILE_SIZE; y += 1) {
    for (let x = notchX; x < notchX + TILE_SIZE; x += 1) {
      const i = (y * WIDTH + x) * 4;
      // Real notches are a cut-out: bright at the left edge of the cut,
      // fading right. A uniformly bright block would tie every window.
      const fade = 230 - Math.floor(((x - notchX) / TILE_SIZE) * 180);
      background.data[i] = fade;
      background.data[i + 1] = fade;
      background.data[i + 2] = fade;
    }
  }
  // Piece: tile-strip width, full height, alpha only inside the disc. The
  // visible disc starts at the strip's left edge, as the real tiles do —
  // the judged x is the strip's slide offset.
  const piece = new PNG({ width: TILE_SIZE, height: HEIGHT });
  for (let y = TILE_Y; y < TILE_Y + TILE_SIZE; y += 1) {
    for (let x = 0; x < TILE_SIZE; x += 1) {
      const inDisc = (x - 1) ** 2 + (y - TILE_Y - TILE_SIZE / 2) ** 2 <= (TILE_SIZE / 2 - 1) ** 2;
      const i = (y * TILE_SIZE + x) * 4;
      piece.data[i] = 90;
      piece.data[i + 1] = 120;
      piece.data[i + 2] = 150;
      piece.data[i + 3] = inDisc ? 255 : 0;
    }
  }
  return {
    backgroundBase64: PNG.sync.write(background).toString("base64"),
    pieceBase64: PNG.sync.write(piece).toString("base64"),
  };
}

test("locateSliderNotch finds the bright notch", () => {
  for (const notchX of [0, 57, 150, 259]) {
    const captcha = makeCaptcha(notchX);
    const notch = locateSliderNotch(captcha.backgroundBase64, captcha.pieceBase64);
    assert.equal(notch.x, notchX, `notch at ${notchX}`);
    assert.equal(notch.y, 5);
    assert.ok(notch.score > 40, `score separates the notch (${notch.score})`);
  }
});

test("locateSliderNotch rejects mismatched image heights", () => {
  const captcha = makeCaptcha(100);
  assert.throws(
    () => locateSliderNotch(captcha.backgroundBase64, PNG.sync.write(new PNG({ width: 10, height: 11 })).toString("base64")),
    /heights differ/,
  );
});

test("sliderJudgePayload is AES-encrypted x/y JSON", () => {
  const secretKey = "0123456789abcdef";
  const payload = sliderJudgePayload({ x: 137, y: 5 }, secretKey);
  const plain = aesEcbDecrypt(b64decode(payload), secretKey).toString("utf8");
  assert.equal(JSON.parse(plain).x, 137);
  assert.equal(JSON.parse(plain).y, 5);
});
