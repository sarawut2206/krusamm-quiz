/* ============================================================
   form.mjs — ชิ้นส่วนของแบบฟอร์มที่พิมพ์ไปกรอกด้วยมือ
   ------------------------------------------------------------
   ใช้ร่วมกันระหว่างชุดทดสอบภาคสนามกับชุดสัมภาษณ์ผู้ใช้
   เดิมชิ้นส่วนพวกนี้อยู่ในไฟล์เดียว พอต้องทำเล่มที่สองจึงต้องแยกออกมา
   ไม่งั้นสองเล่มจะเพี้ยนจากกันทีละนิดจนดูไม่เหมือนชุดเดียวกัน

   ทุกฟังก์ชันคืนค่า y ของบรรทัดถัดไป (หน่วยมิลลิเมตร วัดจากขอบล่างหน้ากระดาษ)
   และเก็บข้อความทุกชิ้นลง SINK ให้ชุดทดสอบตรวจได้ว่าเนื้อหาตรงกับระบบจริง
   ============================================================ */
import { DocPage, C, MM } from "./doc.mjs";

export const M = 12;                 /* ขอบกระดาษ มม. */
export const W = 210 - 2 * M;        /* ความกว้างใช้งาน 186 มม. */
export const mm = (v) => v * MM;

export const SINK = {
  lines: [],
  reset() { this.lines = []; return this; },
  add(s) { if (s) this.lines.push(String(s)); return s; },
  text() { return this.lines.join("\n"); }
};
const rec = (s) => SINK.add(s);

export function newPage(fonts, title, sub, nOf, footer) {
  const p = new DocPage(fonts);
  p.rect(0, mm(297 - 20), mm(210), mm(20), C.brand2);
  p.text(title, mm(M), mm(297 - 12.5), 14, C.white, "l", true);
  if (sub) p.text(sub, mm(M), mm(297 - 17.5), 8.5, [0.78, 0.85, 0.95]);
  if (nOf) p.text(nOf, mm(210 - M), mm(297 - 12.5), 9, [0.78, 0.85, 0.95], "r");
  p.rect(0, mm(297 - 20.8), mm(210), mm(0.8), C.c3);
  if (footer) p.text(footer, mm(105), mm(8), 7.5, C.ink3, "c");
  rec(title); rec(sub);
  return p;
}

/** หัวข้อย่อยพร้อมแถบสีน้ำเงินด้านหน้า */
export function h2(p, y, t) {
  p.rect(mm(M), mm(y - 5.6), mm(1.4), mm(6.4), C.brand);
  p.text(t, mm(M + 4), mm(y - 4.3), 11.5, C.brand2, "l", true);
  rec(t);
  return y - 10;
}

/** ข้อความธรรมดา ตัดบรรทัดเอง */
export function para(p, y, t, size, color, width) {
  const s = size || 9.5, w = width == null ? W : width;
  const lines = p.wrap(t, s, mm(w));
  lines.forEach((ln, i) => p.text(ln, mm(M), mm(y - 3.4 - i * 4.6), s, color || C.ink2));
  rec(t);
  return y - lines.length * 4.6 - 2;
}

/** ช่องเขียนแบบเส้นบรรทัด: [ป้ายกำกับ] ______ (หน่วย) */
export function field(p, x, y, w, label, unit, labelW) {
  const lw = labelW == null ? p.textWidth(label, 9, false) / MM + 2 : labelW;
  p.text(label, mm(x), mm(y), 9, C.ink2);
  const x0 = x + lw, x1 = x + w - (unit ? p.textWidth(unit, 9) / MM + 2 : 0);
  p.line(mm(x0), mm(y - 1.2), mm(x1), mm(y - 1.2), 0.5, C.ink3);
  if (unit) p.text(unit, mm(x1 + 1.5), mm(y), 9, C.ink2);
  rec(label);
}

/** ช่องติ๊ก — สี่เหลี่ยมเปล่า ไม่ใช้เครื่องหมายถูกเพราะฟอนต์ไทยไม่มีอักขระนั้น
    คืนความกว้างที่ใช้ไป เพื่อให้ผู้เรียกวางช่องถัดไปต่อกันได้ */
export function tick(p, x, y, label, size) {
  const s = size || 3.6;
  p.frame(mm(x), mm(y - 0.6), mm(s), mm(s), 0.5, C.ink3);
  if (label) { p.text(label, mm(x + s + 2), mm(y), 9, C.ink2); rec(label); }
  return p.textWidth(label || "", 9) / MM + s + 4;
}

/** แถวช่องติ๊กที่ขึ้นบรรทัดใหม่เองเมื่อชนขอบขวา */
export function tickRow(p, y, items, label) {
  let dx = M;
  if (label) { p.text(label, mm(M), mm(y), 9, C.ink2); rec(label); dx = M + p.textWidth(label, 9) / MM + 4; }
  let row = 0;
  items.forEach((t) => {
    const w = tick(p, dx, y - row * 7, t);
    dx += w;
    if (dx > M + W - 24) { dx = M; row++; }
  });
  return y - (row + 1) * 7;
}

/** ตารางฟอร์ม: หัวเทา แถวว่างให้เขียน
    cols = [{t, w}] · rows = จำนวนแถวว่าง หรืออาเรย์ข้อความของคอลัมน์แรก
    cell(r, c) เติมข้อความในช่องอื่นได้ ถ้าไม่ส่งมาก็เว้นว่างไว้ให้เขียนเอง */
export function grid(p, y, cols, rows, rowH, opts) {
  const o = opts || {};
  const hh = o.headH || 7, rh = rowH || 8;
  const n = Array.isArray(rows) ? rows.length : rows;
  const total = cols.reduce((a, c) => a + c.w, 0);
  const x0 = o.x == null ? M : o.x;
  p.rect(mm(x0), mm(y - hh), mm(total), mm(hh), C.surf2);
  let x = x0;
  cols.forEach((c) => {
    const lines = p.wrap(c.t, 8, mm(c.w - 3), true);
    lines.forEach((ln, i) => p.text(ln, mm(x + 1.6), mm(y - 3.2 - i * 3.4 - (lines.length > 1 ? 0 : 1)), 8, C.ink2, "l", true));
    rec(c.t);
    x += c.w;
  });
  for (let r = 0; r < n; r++) {
    const yy = y - hh - r * rh;
    if (Array.isArray(rows) && rows[r]) {
      const lines = p.wrap(String(rows[r]), 8.5, mm(cols[0].w - 3));
      lines.forEach((ln, i) => p.text(ln, mm(x0 + 1.6), mm(yy - 3.4 - i * 3.6), 8.5, C.ink));
      rec(rows[r]);
    }
    if (o.cell) {
      let cx = x0;
      cols.forEach((c, ci) => {
        if (ci > 0) {
          const v = o.cell(r, ci);
          if (v != null && v !== "") {
            const lines = p.wrap(String(v), 8.5, mm(c.w - 3));
            lines.forEach((ln, i) => p.text(ln, mm(cx + 1.6), mm(yy - 3.4 - i * 3.6), 8.5, C.ink2));
            rec(v);
          }
        }
        cx += c.w;
      });
    }
    p.line(mm(x0), mm(yy - rh), mm(x0 + total), mm(yy - rh), 0.4, C.line);
  }
  let cx = x0;
  const bot = y - hh - n * rh;
  [0].concat(cols.map((c) => (cx += c.w) - x0)).forEach((dx) =>
    p.line(mm(x0 + dx), mm(y), mm(x0 + dx), mm(bot), 0.4, C.line));
  p.line(mm(x0), mm(y), mm(x0 + total), mm(y), 0.4, C.line);
  p.line(mm(x0), mm(y - hh), mm(x0 + total), mm(y - hh), 0.5, C.ink3);
  return bot - 4;
}

/** กล่องเขียนอิสระพร้อมเส้นบรรทัดจาง */
export function writeBox(p, y, h, label, lines, width) {
  const w = width == null ? W : width;
  if (label) { p.text(label, mm(M), mm(y), 9.5, C.ink2, "l", true); rec(label); y -= 4.5; }
  p.frame(mm(M), mm(y - h), mm(w), mm(h), 0.5, C.line);
  const n = lines || Math.floor(h / 8);
  for (let i = 1; i < n; i++)
    p.line(mm(M + 3), mm(y - (h / n) * i), mm(M + w - 3), mm(y - (h / n) * i), 0.3, C.line2);
  return y - h - 4;
}

export function callout(p, y, kind, title, body, width) {
  const w = width == null ? W : width;
  const bg = { warn: C.c3t, stop: C.c1t, ok: C.c4t, note: C.brandt }[kind] || C.brandt;
  const bar = { warn: C.c3, stop: C.c1, ok: C.c4, note: C.brand }[kind] || C.brand;
  const lines = p.wrap(body, 9, mm(w - 10));
  const h = 7 + lines.length * 4.4 + 3;
  p.rect(mm(M), mm(y - h), mm(w), mm(h), bg);
  p.rect(mm(M), mm(y - h), mm(1.6), mm(h), bar);
  p.text(title, mm(M + 5), mm(y - 5.4), 10, bar, "l", true);
  lines.forEach((ln, i) => p.text(ln, mm(M + 5), mm(y - 10.4 - i * 4.4), 9, C.ink));
  rec(title); rec(body);
  return y - h - 5;
}

/** รายการมีเลขลำดับในวงกลม */
export function steps(p, y, items, size) {
  const s = size || 9.5;
  items.forEach((t, i) => {
    p.ellipse(mm(M + 3), mm(y - 2.2), mm(3), mm(3), 0, null, C.brand);
    p.text(String(i + 1), mm(M + 3), mm(y - 3.3), 7, C.white, "c", true);
    const lines = p.wrap(t, s, mm(W - 10));
    lines.forEach((ln, j) => p.text(ln, mm(M + 8), mm(y - 3.4 - j * 4.4), s, C.ink2));
    rec(t);
    y -= lines.length * 4.4 + 2.2;
  });
  return y;
}

/** รายการหัวข้อย่อยแบบจุด */
export function bullets(p, y, items, size) {
  const s = size || 9.5;
  items.forEach((t) => {
    p.ellipse(mm(M + 1.6), mm(y - 2.4), mm(0.9), mm(0.9), 0, null, C.brand);
    const lines = p.wrap(t, s, mm(W - 6));
    lines.forEach((ln, j) => p.text(ln, mm(M + 5), mm(y - 3.4 - j * 4.4), s, C.ink2));
    rec(t);
    y -= lines.length * 4.4 + 1.4;
  });
  return y;
}
