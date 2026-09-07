/* ============================================================
   make-validation-summary.mjs — ใบสรุปผลการสำรวจ หนึ่งหน้า
   ------------------------------------------------------------
   node tools/make-validation-summary.mjs
     → validation/CareSignal-ValidationSummary.pdf  (A4 หนึ่งหน้า)

   อ่านข้อมูลดิบจาก validation/results.json แล้วนับเอง ไม่มีตัวเลขไหนพิมพ์มือ
   เหตุผล: ถ้าพิมพ์ใบสรุปด้วยมือ ตัวเลขจะค่อย ๆ เพี้ยนจากข้อมูลดิบโดยไม่มีใครรู้
   และถ้ากรรมการขอดูข้อมูลดิบแล้วไม่ตรงกับใบสรุป เสียมากกว่าได้

   ทุกเปอร์เซ็นต์บอกตัวหารเสมอ เพราะ n ระดับ 3–8 คนไม่ใช่สถิติ
   ถ้ายังไม่ได้กรอกข้อมูลจริง ใบสรุปจะขึ้นแถบแดงว่าห้ามส่ง
   ============================================================ */
import { writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { readTTF } from "./ttf.mjs";
import { DocPage, buildDoc, C, MM } from "./doc.mjs";
import { FEATURES } from "./make-validation-kit.mjs";

const REG = process.env.CS_FONT || "C:/Windows/Fonts/leelawad.ttf";
const BOLD = process.env.CS_FONT_BOLD || "C:/Windows/Fonts/leelawdb.ttf";
const DIR = new URL("../validation/", import.meta.url);
const DATA = new URL("./results.json", DIR);
const OUT = new URL("./CareSignal-ValidationSummary.pdf", DIR);

const M = 12, W = 210 - 2 * M;
const mm = (v) => v * MM;
const GROUP_NM = { elder: "ผู้สูงอายุ 60 ปีขึ้นไป", family: "ลูกหลานหรือผู้ดูแล", staff: "บุคลากรสุขภาพหรือฝั่งประกัน" };
const METHOD_NM = { interview: "สัมภาษณ์ตัวต่อตัว", survey: "แบบสอบถามตอบเอง", phone: "สัมภาษณ์ทางโทรศัพท์" };

export function load(url) {
  return JSON.parse(readFileSync(url || DATA, "utf8"));
}

/* ---------- นับจากข้อมูลดิบ ตัวหารคือจำนวนคนที่ถูกถามข้อนั้นจริง ---------- */
export function analyse(d) {
  const people = Array.isArray(d.people) ? d.people : [];
  const n = people.length;
  const asked = (k) => people.filter((p) => p[k] === true || p[k] === false).length;
  const yes = (k) => people.filter((p) => p[k] === true).length;
  const groups = {};
  people.forEach((p) => {
    const g = p.group || "other";
    groups[g] = groups[g] || { n: 0, methods: {} };
    groups[g].n++;
    const m = p.method || "interview";
    groups[g].methods[m] = (groups[g].methods[m] || 0) + 1;
  });
  /* คะแนนฟีเจอร์: อันดับ 1 ได้ 3 · อันดับ 2 ได้ 2 · อันดับ 3 ได้ 1 */
  const score = {}, picks = {};
  FEATURES.forEach((f) => { score[f.id] = 0; picks[f.id] = 0; });
  let ranked = 0;
  people.forEach((p) => {
    const t = Array.isArray(p.top3) ? p.top3.filter(Boolean) : [];
    if (t.length) ranked++;
    t.slice(0, 3).forEach((id, i) => {
      if (score[id] == null) return;
      score[id] += 3 - i;
      picks[id]++;
    });
  });
  const ladder = FEATURES.map((f) => ({ id: f.id, nm: f.nm, score: score[f.id], picks: picks[f.id] }))
    .sort((a, b) => b.score - a.score || b.picks - a.picks);
  return {
    n, groups, ladder, ranked,
    problem: { fell: yes("fell12m"), fellAsked: asked("fell12m"),
               near: yes("nearFall"), nearAsked: asked("nearFall"),
               never: yes("neverAssessed"), neverAsked: asked("neverAssessed") },
    solution: { understood: yes("understood"), understoodAsked: asked("understood"),
                tryWith: yes("wouldTryWithHelp"), tryAsked: asked("wouldTryWithHelp"),
                contact: yes("gaveContact"), contactAsked: asked("gaveContact"),
                selfSetup: yes("setsUpAppsSelf"), selfAsked: asked("setsUpAppsSelf") },
    quotes: people.filter((p) => p.quote && String(p.quote).trim()).map((p) => ({ code: p.code, group: p.group, quote: String(p.quote).trim() })),
    concerns: people.filter((p) => p.concern && String(p.concern).trim()).map((p) => ({ code: p.code, concern: String(p.concern).trim() })),
    actions: (Array.isArray(d.actions) ? d.actions : []).filter((a) => (a.finding || "").trim() && (a.change || "").trim()),
    ready: d.filled === true && n > 0
  };
}

const frac = (a, b) => b > 0 ? a + " จาก " + b + " คน" : "ยังไม่ได้ถาม";

/* ---------- ชิ้นส่วนของใบสรุป ---------- */
function sec(p, y, no, t) {
  p.rect(mm(M), mm(y - 5.2), mm(W), mm(5.8), C.brandt);
  p.text(no, mm(M + 2.5), mm(y - 4), 8.5, C.white, "l", true);
  p.rect(mm(M), mm(y - 5.2), mm(6), mm(5.8), C.brand);
  p.text(no, mm(M + 3), mm(y - 4), 8.5, C.white, "c", true);
  p.text(t, mm(M + 9), mm(y - 4), 9.5, C.brand2, "l", true);
  return y - 8.4;
}

function stat(p, x, y, w, big, label, color) {
  p.text(String(big), mm(x), mm(y - 4.6), 13, color || C.brand2, "l", true);
  const ls = p.wrap(label, 7.5, mm(w));
  ls.forEach((ln, i) => p.text(ln, mm(x), mm(y - 8.6 - i * 3.2), 7.5, C.ink2));
  return 8.6 + ls.length * 3.2;
}

function line(p, y, t, size, color, bold) {
  const s = size || 8.5;
  const ls = p.wrap(t, s, mm(W));
  ls.forEach((ln, i) => p.text(ln, mm(M), mm(y - 3 - i * 3.9), s, color || C.ink2, "l", bold));
  return y - ls.length * 3.9 - 1;
}

export function build(d) {
  const a = analyse(d);
  const fonts = { reg: readTTF(REG), bold: readTTF(BOLD) };
  const p = new DocPage(fonts);

  /* ---- หัวกระดาษ ---- */
  p.rect(0, mm(297 - 17), mm(210), mm(17), C.brand2);
  p.text("สรุปผลการสำรวจผู้ใช้ · " + (d.team || "CareSignal"), mm(M), mm(297 - 10.5), 13, C.white, "l", true);
  p.text("ภารกิจที่ 3 Idea Validation · OIC InsurTech Award 2026", mm(M), mm(297 - 15), 8, [0.78, 0.85, 0.95]);
  p.text("ผู้ให้ข้อมูล " + a.n + " คน", mm(210 - M), mm(297 - 10.5), 9.5, C.white, "r", true);
  p.rect(0, mm(297 - 17.7), mm(210), mm(0.7), C.c3);
  let y = 297 - 21;

  if (!a.ready) {
    p.rect(mm(M), mm(y - 9), mm(W), mm(9), C.c1t);
    p.rect(mm(M), mm(y - 9), mm(1.6), mm(9), C.c1);
    p.text("ยังไม่ใช่ข้อมูลจริง ห้ามส่งใบนี้", mm(M + 5), mm(y - 3.6), 9.5, C.c1, "l", true);
    p.text("กรอก validation/results.json ให้ครบ แล้วตั้ง filled เป็น true จากนั้นสร้างไฟล์นี้ใหม่", mm(M + 5), mm(y - 7.4), 8, C.ink2);
    y -= 11;
  }

  p.text((d.product || "") + (d.period ? " · เก็บข้อมูล " + d.period : "") + (d.where ? " · " + d.where : ""),
         mm(M), mm(y - 3), 8.5, C.ink2);
  y -= 6;

  /* ---- 1 กลุ่มเป้าหมาย ---- */
  y = sec(p, y, "1", "กลุ่มเป้าหมายและจำนวนผู้ให้ข้อมูล");
  const gkeys = Object.keys(a.groups);
  if (!gkeys.length) y = line(p, y, "ยังไม่มีผู้ให้ข้อมูลในไฟล์");
  else {
    gkeys.forEach((g) => {
      const gg = a.groups[g];
      const how = Object.keys(gg.methods).map((m) => (METHOD_NM[m] || m) + " " + gg.methods[m] + " คน").join(" · ");
      p.text("• " + (GROUP_NM[g] || g), mm(M + 1), mm(y - 3), 8.5, C.ink, "l", true);
      p.text(gg.n + " คน", mm(M + 62), mm(y - 3), 8.5, C.brand2, "l", true);
      p.text(how, mm(M + 78), mm(y - 3), 8.5, C.ink2);
      y -= 4.4;
    });
  }
  y = line(p, y, "เลือกแบบเจาะจงจากคนที่เข้าถึงได้ ไม่ใช่การสุ่มตัวอย่าง จึงใช้ตอบว่าปัญหามีอยู่จริงหรือไม่ ไม่ใช่ใช้ประมาณสัดส่วนของประชากร", 7.5, C.ink3);
  y -= 2;

  /* ---- 2 ปัญหาจริงไหม ---- */
  y = sec(p, y, "2", "ปัญหาที่ทีมกำลังแก้ เป็นปัญหาที่ผู้ใช้พบจริงหรือไม่");
  const pr = a.problem;
  const h1 = stat(p, M, y, 42, frac(pr.fell, pr.fellAsked), "เคยล้มใน 12 เดือนที่ผ่านมา", pr.fell ? C.c2 : C.ink3);
  stat(p, M + 48, y, 42, frac(pr.near, pr.nearAsked), "เคยเกือบล้ม", C.c3);
  stat(p, M + 96, y, 42, frac(pr.never, pr.neverAsked), "ไม่เคยมีใครวัดการทรงตัวหรือกำลังขาให้", C.c1);
  stat(p, M + 144, y, 42, a.n ? a.solution.selfAsked - a.solution.selfSetup + " จาก " + a.solution.selfAsked + " คน" : "—", "ต้องมีคนช่วยตั้งแอปให้", C.brand2);
  y -= Math.max(h1, 14) + 1;
  if (a.quotes.length) {
    a.quotes.slice(0, 2).forEach((q) => {
      y = line(p, y, "“" + q.quote + "”  — " + q.code + " (" + (GROUP_NM[q.group] || q.group) + ")", 8.5, C.ink);
    });
  } else y = line(p, y, "ยังไม่มีคำพูดจริงในไฟล์ ให้ใส่ช่อง quote ของแต่ละคน", 8, C.ink3);
  y -= 1;

  /* ---- 3 Solution ---- */
  y = sec(p, y, "3", "Solution ที่นำเสนอช่วยแก้ปัญหาได้หรือไม่");
  const so = a.solution;
  const h2 = stat(p, M, y, 42, frac(so.understood, so.understoodAsked), "อธิบายได้เองว่าโปรแกรมทำอะไร หลังดู 60–90 วินาที", C.c4);
  stat(p, M + 48, y, 42, frac(so.tryWith, so.tryAsked), "บอกว่าจะลองใช้ ถ้ามีคนช่วยตั้งครั้งแรก", C.brand2);
  stat(p, M + 96, y, 42, frac(so.contact, so.contactAsked), "ให้ช่องทางติดต่อกลับไว้ ซึ่งเป็นการกระทำ ไม่ใช่คำพูด", C.c4);
  stat(p, M + 144, y, 42, a.ranked + " จาก " + a.n + " คน", "จัดลำดับฟีเจอร์ครบ 3 ใบ", C.ink2);
  y -= Math.max(h2, 14) + 1;
  if (a.concerns.length) {
    y = line(p, y, "ข้อกังวลที่พบซ้ำ: " + a.concerns.slice(0, 3).map((c) => c.concern + " (" + c.code + ")").join(" · "), 8.5);
  } else y = line(p, y, "ยังไม่มีข้อกังวลในไฟล์ ให้ใส่ช่อง concern ของแต่ละคน", 8, C.ink3);
  y -= 1;

  /* ---- 4 ฟีเจอร์ ---- */
  y = sec(p, y, "4", "ฟีเจอร์ที่ผู้ใช้ต้องการหรือมองว่ามีประโยชน์มากที่สุด");
  y = line(p, y, "ให้เลือก 3 ใบจาก " + FEATURES.length + " ใบ แล้วเรียงลำดับ · อันดับ 1 ได้ 3 คะแนน อันดับ 2 ได้ 2 อันดับ 3 ได้ 1 · คะแนนเต็มที่เป็นไปได้คือ " + (a.ranked * 3) + " คะแนน", 7.5, C.ink3);
  const top = a.ladder.slice(0, 4), maxS = Math.max(1, a.ladder[0] ? a.ladder[0].score : 1);
  top.forEach((f, i) => {
    /* ผังแนวนอนของแถวนี้: ชื่อฟีเจอร์ถึง M+119 · แถบ M+122 ถึง M+148 · ตัวเลขชิดขวาที่ M+W
       แถบยาวได้มากสุด 26 มม. ถ้ายาวกว่านี้จะไปทับตัวเลขคะแนน */
    const bw = (f.score / maxS) * 26;
    p.text(String(i + 1), mm(M + 1), mm(y - 3.4), 8.5, C.ink3, "l", true);
    p.text(f.id, mm(M + 6), mm(y - 3.4), 8.5, C.brand2, "l", true);
    const ls = p.wrap(f.nm, 8.5, mm(104));
    ls.forEach((ln, j) => p.text(ln, mm(M + 15), mm(y - 3.4 - j * 3.6), 8.5, C.ink));
    p.rect(mm(M + 122), mm(y - 4.2), mm(Math.max(bw, 0.6)), mm(3), i === 0 ? C.brand : C.line);
    p.text(f.score + " คะแนน · " + f.picks + " คนเลือก", mm(M + W), mm(y - 3.4), 8, C.ink2, "r");
    y -= Math.max(ls.length * 3.6, 4.6) + 1.2;
  });
  const zero = a.ladder.filter((f) => f.picks === 0).map((f) => f.id);
  y = line(p, y, zero.length ? "ไม่มีใครเลือกเลย: " + zero.join(" ") + " — ตีความว่ายังไม่ใช่สิ่งที่ผู้ใช้ให้ค่า ไม่ใช่ว่าต้องอธิบายให้ดีขึ้น"
                             : "ทุกฟีเจอร์มีคนเลือกอย่างน้อยหนึ่งคน", 7.5, C.ink3);
  y -= 1;

  /* ---- 5 จะนำ Feedback ไปใช้อย่างไร ---- */
  y = sec(p, y, "5", "ทีมจะนำ Feedback ไปใช้ใน Solution หรือ Feature อย่างไร");
  if (!a.actions.length) y = line(p, y, "ยังไม่ได้กรอกช่อง actions ในไฟล์ results.json", 8, C.c1);
  else a.actions.slice(0, 5).forEach((x) => {
    const t = "สิ่งที่ได้ยิน: " + x.finding + "  ›  สิ่งที่จะเปลี่ยน: " + x.change;
    const ls = p.wrap(t, 8.5, mm(W - 4));
    ls.forEach((ln, j) => p.text(ln, mm(M + 4), mm(y - 3 - j * 3.9), 8.5, C.ink));
    p.ellipse(mm(M + 1.4), mm(y - 2.2), mm(0.8), mm(0.8), 0, null, C.brand);
    y -= ls.length * 3.9 + 1.2;
  });

  /* ---- ข้อจำกัด ---- */
  y -= 1;
  p.line(mm(M), mm(y), mm(M + W), mm(y), 0.4, C.line);
  y -= 1;
  const limit = "ข้อจำกัดของข้อมูลชุดนี้: ผู้ให้ข้อมูล " + a.n + " คน เลือกแบบเจาะจงจากคนที่ทีมเข้าถึงได้ ไม่ใช่กลุ่มตัวอย่างที่สุ่มมา " +
    "จึงใช้ยืนยันว่าปัญหามีอยู่จริงและใช้จัดลำดับสิ่งที่ควรทำก่อนได้ แต่ใช้ประมาณสัดส่วนของประชากรไม่ได้ " +
    "และผู้ให้ข้อมูลยังไม่ได้ใช้ระบบจริง จึงยังตอบไม่ได้ว่าใช้แล้วจะเกิดผลอย่างไร" + (d.note ? " · " + d.note : "");
  y = line(p, y, limit, 7.5, C.ink3);

  return { pdf: buildDoc([p], fonts, { title: "สรุปผลการสำรวจผู้ใช้ CareSignal" }), stats: a, height: y };
}

const norm = (s) => String(s).replace(/\\/g, "/").toLowerCase();
if (process.argv[1] && norm(fileURLToPath(import.meta.url)) === norm(process.argv[1])) {
  const d = load();
  const r = build(d);
  mkdirSync(DIR, { recursive: true });
  writeFileSync(OUT, r.pdf);
  console.log("เขียน validation/CareSignal-ValidationSummary.pdf · 1 หน้า · " + (r.pdf.length / 1024).toFixed(0) + " KB");
  console.log("ผู้ให้ข้อมูล " + r.stats.n + " คน · " + (r.stats.ready ? "พร้อมส่ง" : "ยังเป็นแบบเปล่า ตั้ง filled เป็น true เมื่อกรอกจริงแล้ว"));
  if (r.height < 12) console.log("เตือน: เนื้อหาเกินหนึ่งหน้า ให้ตัดคำพูดหรือ actions ออกบ้าง (เหลือขอบล่าง " + r.height.toFixed(1) + " มม.)");
}
