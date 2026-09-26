/**
 * Utility for rendering, exporting, and parsing ICICI Bank-style Emergency Grid Cards.
 *
 * Provides:
 * 1. High-DPI HTML5 canvas rendering of luxury dark-mode metallic card.
 * 2. Embedded PNG tEXt chunk metadata for instant 1-click drag-and-drop password recovery.
 * 3. Text backup export.
 */

export interface GridCardData {
  card_id: string;
  cells: Record<string, string>;
  card_token: string;
  grid_salt: string;
  challenge_hashes: Record<string, string>;
}

// ── CRC32 Table for PNG Chunk Generation ──────────────────────────────────────

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) {
    c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  CRC_TABLE[n] = c;
}

function calculateCrc(buf: Uint8Array, offset: number, len: number): number {
  let crc = 0xffffffff;
  for (let i = 0; i < len; i++) {
    crc = CRC_TABLE[(crc ^ buf[offset + i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Injects a standard PNG `tEXt` chunk right before the `IEND` chunk.
 */
export function injectPngMetadata(pngBuffer: ArrayBuffer, keyword: string, text: string): Blob {
  const bytes = new Uint8Array(pngBuffer);

  // Verify PNG signature (first 8 bytes: 137, 80, 78, 71, 13, 10, 26, 10)
  if (
    bytes[0] !== 0x89 ||
    bytes[1] !== 0x50 ||
    bytes[2] !== 0x4e ||
    bytes[3] !== 0x47
  ) {
    return new Blob([pngBuffer], { type: "image/png" });
  }

  // Find IEND chunk index (last 12 bytes of standard PNG)
  let iendIndex = -1;
  for (let i = bytes.length - 12; i >= 8; i--) {
    if (
      bytes[i + 4] === 0x49 && // 'I'
      bytes[i + 5] === 0x45 && // 'E'
      bytes[i + 6] === 0x4e && // 'N'
      bytes[i + 7] === 0x44    // 'D'
    ) {
      iendIndex = i;
      break;
    }
  }

  if (iendIndex === -1) {
    return new Blob([pngBuffer], { type: "image/png" });
  }

  // Build tEXt chunk: length (4) + 'tEXt' (4) + keyword + null-byte (1) + text + crc (4)
  const enc = new TextEncoder();
  const keyBytes = enc.encode(keyword);
  const textBytes = enc.encode(text);
  const dataLen = keyBytes.length + 1 + textBytes.length;

  const chunk = new Uint8Array(4 + 4 + dataLen + 4);
  const view = new DataView(chunk.buffer);

  // Set Length
  view.setUint32(0, dataLen, false);

  // Set Chunk Type 'tEXt'
  chunk[4] = 0x74; // 't'
  chunk[5] = 0x45; // 'E'
  chunk[6] = 0x58; // 'X'
  chunk[7] = 0x74; // 't'

  // Set Data: keyword + \0 + text
  chunk.set(keyBytes, 8);
  chunk[8 + keyBytes.length] = 0;
  chunk.set(textBytes, 8 + keyBytes.length + 1);

  // Calculate CRC over Chunk Type + Data (dataLen + 4 bytes)
  const crc = calculateCrc(chunk, 4, 4 + dataLen);
  view.setUint32(8 + dataLen, crc, false);

  // Assemble new PNG: before IEND + new tEXt chunk + IEND to end
  const beforeIend = bytes.slice(0, iendIndex);
  const iendSlice = bytes.slice(iendIndex);

  return new Blob([beforeIend, chunk, iendSlice], { type: "image/png" });
}

/**
 * Extracts embedded JSON metadata from a PNG file if present.
 */
export async function extractGridCardFromPng(file: File, keyword = "SecurePhotosGridCard"): Promise<GridCardData | null> {
  try {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const view = new DataView(buffer);

    let offset = 8; // skip signature
    while (offset < bytes.length - 8) {
      const len = view.getUint32(offset, false);
      const type = String.fromCharCode(
        bytes[offset + 4],
        bytes[offset + 5],
        bytes[offset + 6],
        bytes[offset + 7]
      );

      if (type === "tEXt") {
        const chunkData = bytes.slice(offset + 8, offset + 8 + len);
        const nullIdx = chunkData.indexOf(0);
        if (nullIdx !== -1) {
          const dec = new TextDecoder();
          const key = dec.decode(chunkData.slice(0, nullIdx));
          if (key === keyword) {
            const rawVal = dec.decode(chunkData.slice(nullIdx + 1));
            return JSON.parse(rawVal);
          }
        }
      }

      if (type === "IEND") break;
      offset += 8 + len + 4; // len + type + data + crc
    }
  } catch (err) {
    console.warn("Failed to extract Grid Card metadata from PNG:", err);
  }
  return null;
}

/**
 * Draws the high-aesthetic luxury metallic Emergency Grid Card on an HTML5 canvas.
 */
export function renderGridCardCanvas(canvas: HTMLCanvasElement, card: GridCardData): void {
  const width = 1050;
  const height = 620;
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  // 1. Dark Luxury Metallic Background
  const bgGrad = ctx.createLinearGradient(0, 0, width, height);
  bgGrad.addColorStop(0, "#0b0f19");
  bgGrad.addColorStop(0.5, "#111827");
  bgGrad.addColorStop(1, "#070a10");
  ctx.fillStyle = bgGrad;
  ctx.roundRect(0, 0, width, height, 32);
  ctx.fill();

  // Outer Border Glow
  ctx.strokeStyle = "rgba(56, 189, 248, 0.35)";
  ctx.lineWidth = 3;
  ctx.roundRect(0, 0, width, height, 32);
  ctx.stroke();

  // Subtle ambient radial glow behind grid
  const radialGlow = ctx.createRadialGradient(width / 2, height / 2, 50, width / 2, height / 2, 500);
  radialGlow.addColorStop(0, "rgba(56, 189, 248, 0.08)");
  radialGlow.addColorStop(0.7, "rgba(99, 102, 241, 0.04)");
  radialGlow.addColorStop(1, "transparent");
  ctx.fillStyle = radialGlow;
  ctx.fillRect(0, 0, width, height);

  // 2. Card Header
  ctx.fillStyle = "#38bdf8";
  ctx.font = "bold 20px 'Plus Jakarta Sans', system-ui, sans-serif";
  ctx.fillText("🛡️ SECUREPHOTOS", 50, 60);

  ctx.fillStyle = "#94a3b8";
  ctx.font = "600 13px 'Plus Jakarta Sans', system-ui, sans-serif";
  ctx.fillText("ZERO-TRUST VAULT EMERGENCY GRID CARD", 50, 84);

  // Card Serial Badge on Top-Right
  const serialText = `CARD ID: ${card.card_id}`;
  ctx.font = "bold 16px 'Courier New', monospace";
  ctx.fillStyle = "#facc15";
  const serialWidth = ctx.measureText(serialText).width;
  ctx.fillText(serialText, width - 50 - serialWidth, 64);

  // Decorative Golden Chip graphic
  const chipX = 50;
  const chipY = 120;
  const chipW = 70;
  const chipH = 50;
  const chipGrad = ctx.createLinearGradient(chipX, chipY, chipX + chipW, chipY + chipH);
  chipGrad.addColorStop(0, "#fbbf24");
  chipGrad.addColorStop(0.5, "#d97706");
  chipGrad.addColorStop(1, "#b45309");
  ctx.fillStyle = chipGrad;
  ctx.roundRect(chipX, chipY, chipW, chipH, 8);
  ctx.fill();

  ctx.strokeStyle = "rgba(0,0,0,0.4)";
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(chipX + 24, chipY);
  ctx.lineTo(chipX + 24, chipY + chipH);
  ctx.moveTo(chipX + 46, chipY);
  ctx.lineTo(chipX + 46, chipY + chipH);
  ctx.moveTo(chipX, chipY + 25);
  ctx.lineTo(chipX + chipW, chipY + 25);
  ctx.stroke();

  // 3. The 4x4 Grid (16 boxes: A to P)
  const gridStartX = 160;
  const gridStartY = 110;
  const boxW = 190;
  const boxH = 95;
  const gapX = 18;
  const gapY = 14;

  const letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];

  for (let row = 0; row < 4; row++) {
    for (let col = 0; col < 4; col++) {
      const idx = row * 4 + col;
      const letter = letters[idx];
      const code = card.cells[letter] || "--";

      const x = gridStartX + col * (boxW + gapX);
      const y = gridStartY + row * (boxH + gapY);

      // Cell Box Container
      ctx.fillStyle = "rgba(15, 23, 42, 0.75)";
      ctx.roundRect(x, y, boxW, boxH, 12);
      ctx.fill();

      ctx.strokeStyle = "rgba(56, 189, 248, 0.28)";
      ctx.lineWidth = 1.5;
      ctx.roundRect(x, y, boxW, boxH, 12);
      ctx.stroke();

      // Letter Tag (Top Left of cell)
      ctx.fillStyle = "#38bdf8";
      ctx.font = "bold 15px 'Plus Jakarta Sans', system-ui, sans-serif";
      ctx.fillText(letter, x + 16, y + 28);

      // Box Divider
      ctx.strokeStyle = "rgba(255, 255, 255, 0.08)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(x + 14, y + 38);
      ctx.lineTo(x + boxW - 14, y + 38);
      ctx.stroke();

      // Number Value (Large Centered Monospace)
      ctx.fillStyle = "#f8fafc";
      ctx.font = "bold 34px 'Courier New', monospace";
      const codeWidth = ctx.measureText(code).width;
      ctx.fillText(code, x + (boxW - codeWidth) / 2, y + 78);
    }
  }

  // 4. Bottom Security Notice & Recovery Key Strip
  ctx.fillStyle = "rgba(148, 163, 184, 0.7)";
  ctx.font = "12px 'Plus Jakarta Sans', system-ui, sans-serif";
  ctx.fillText(
    "To reset password: Upload this card image OR enter requested box numbers + your 4-digit PIN.",
    50,
    height - 35
  );

  const tokenDisplay = `KEY: ${card.card_token.slice(0, 16)}••••••••${card.card_token.slice(-8)}`;
  ctx.font = "bold 12px 'Courier New', monospace";
  ctx.fillStyle = "rgba(56, 189, 248, 0.85)";
  const tokenWidth = ctx.measureText(tokenDisplay).width;
  ctx.fillText(tokenDisplay, width - 50 - tokenWidth, height - 35);
}

/**
 * Downloads the card as a high-resolution PNG with embedded metadata.
 */
export async function downloadGridCardImage(card: GridCardData, filename = "SecurePhotos_Emergency_Grid_Card.png"): Promise<void> {
  const canvas = document.createElement("canvas");
  renderGridCardCanvas(canvas, card);

  return new Promise((resolve, reject) => {
    canvas.toBlob(async (blob) => {
      if (!blob) {
        reject(new Error("Failed to generate canvas blob."));
        return;
      }
      try {
        const arrayBuf = await blob.arrayBuffer();
        const jsonPayload = JSON.stringify(card);
        const enrichedBlob = injectPngMetadata(arrayBuf, "SecurePhotosGridCard", jsonPayload);

        const url = URL.createObjectURL(enrichedBlob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        resolve();
      } catch (e) {
        reject(e);
      }
    }, "image/png");
  });
}

/**
 * Downloads a plaintext backup of the Emergency Grid Card.
 */
export function downloadGridCardText(card: GridCardData): void {
  const letters = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O", "P"];
  let gridStr = "";
  for (let r = 0; r < 4; r++) {
    const rowLetters = letters.slice(r * 4, r * 4 + 4);
    gridStr += rowLetters.map((l) => `[ ${l}: ${card.cells[l]} ]`).join("  ") + "\n";
  }

  const content = `=====================================================
SECUREPHOTOS ZERO-TRUST EMERGENCY GRID CARD
=====================================================
Card ID: ${card.card_id}
Generated: ${new Date().toISOString()}

-----------------------------------------------------
4x4 EMERGENCY RECOVERY GRID:
-----------------------------------------------------
${gridStr}
-----------------------------------------------------
RECOVERY KEY TOKEN (64-HEX):
${card.card_token}
-----------------------------------------------------

INSTRUCTIONS FOR RESETTING YOUR PASSWORD:
1. In SecurePhotos, click "Forgot Master Password? Reset with Grid Card".
2. Choice A (Fastest): Select your SecurePhotos_Emergency_Grid_Card.png image.
3. Choice B (ICICI Challenge): Enter the 3 requested box numbers + your 4-digit PIN.
4. Keep this file in a safe place (USB drive or phone).
=====================================================
`;

  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `SecurePhotos_Grid_Card_${card.card_id}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
