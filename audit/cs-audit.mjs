/* ============================================================
   CareSignal — AI-assisted Requirements, Workflow and
   Prototype Compliance Auditor
   ------------------------------------------------------------
   บทบาท: ตรวจว่า "โปรแกรมตรงกับแผนงานหรือไม่"
   ไม่ใช่ผู้รับรองทางคลินิก และไม่ใช่ผู้ยืนยันว่าระบบพร้อมใช้จริง

   หลักที่ยึด 4 ข้อ
   1. ตัวตรวจอยู่ "นอก" ระบบหลัก — อ่านอย่างเดียว ไม่แก้ ไม่เปลี่ยน
      ระดับความเสี่ยง ไม่แตะฐานข้อมูล
   2. ทุกข้อสรุปต้องมีหลักฐานชี้ได้ (ไฟล์ + รูปแบบที่ค้นเจอ หรือ
      ผลรันเอนจินจริง) — ห้ามสรุปจากความจำ
   3. สิ่งที่ตรวจด้วยการอ่านโค้ดไม่ได้ ต้องรายงานว่า
      "ไม่สามารถตรวจยืนยันได้" ห้ามนับเป็นผ่าน
   4. ห้ามสรุปว่าผ่าน clinical validation โดยเด็ดขาด
      เพราะยังไม่มีผลการศึกษาในระบบนี้

   วิธีรัน:  node audit/cs-audit.mjs
   ผลลัพธ์:  audit/report-latest.md  และสรุปบนหน้าจอ
   ============================================================ */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const LF = String.fromCharCode(10);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cache = new Map();
/* ตรวจว่ามีไฟล์อยู่จริง โดยไม่ต้องอ่านเนื้อ — ใช้กับไฟล์ไบนารีอย่าง PDF */
const exists = (f) => fs.existsSync(path.join(ROOT, f));
const read = (f) => {
  if (!cache.has(f)) {
    const p = path.join(ROOT, f);
    cache.set(f, fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null);
  }
  return cache.get(f);
};
const lineOf = (f, re) => {
  const s = read(f); if (!s) return null;
  const m = s.match(re); if (!m) return null;
  return s.slice(0, m.index).split("\n").length;
};
/* หาว่ารูปแบบนี้อยู่ในไฟล์ไหนบ้าง คืนหลักฐานเป็น file:line */
function findIn(files, re) {
  const hits = [];
  for (const f of files) {
    const ln = lineOf(f, re);
    if (ln) hits.push(`${f}:${ln}`);
  }
  return hits;
}

const APPS   = ["CareSignal-App.html", "CareSignal-Vision.html"];
const STAFF  = ["CareSignal-Staff.html"];
/* Web.html และ Flow.html เหลือเป็นหน้าเปลี่ยนเส้นทาง — เนื้อหารวมอยู่ใน index.html แล้ว */
const WEBS   = ["index.html", "CareSignal-Portfolio-Dashboard.html"];
const BACK   = ["cs-backend.js", "cs-meds.js"];
const SQL    = fs.readdirSync(path.join(ROOT, "supabase"))
                 .filter(f => f.endsWith(".sql")).map(f => "supabase/" + f);
const ALL    = [...APPS, ...STAFF, ...WEBS, ...BACK, ...SQL];

/* ---------- โครงผลลัพธ์ ---------- */
const F = [];   /* findings */
const R = [];   /* requirement rows */
const SEV = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };

function req(layer, id, requirement, status, evidence, note = "") {
  R.push({ layer, id, requirement, status, evidence, note });
}
function finding(sev, id, title, detail, evidence, fix) {
  F.push({ sev, id, title, detail, evidence, fix });
}

/* ============================================================
   ชั้นที่ 1 — ความครบถ้วนของฟีเจอร์ (requirement traceability)
   ============================================================ */
function layer1() {
  const items = [
    ["F-01", "Consent — มีหน้าขอความยินยอมและบันทึกเวลา",
      () => {
        const ui = findIn(APPS, /ยินยอม/);
        const store = findIn(BACK, /grantConsent/);
        const ts = findIn(SQL, /create table[\s\S]{0,200}consents[\s\S]{0,400}granted_at|consents[\s\S]{0,300}created_at/);
        return { ok: ui.length && store.length, ev: [...ui, ...store, ...ts].slice(0, 3) };
      }],
    ["F-02", "Falls history — บันทึกย้อนหลัง 12 เดือน",
      () => {
        const ui = findIn(APPS, /12 เดือน/);
        const col = findIn(SQL, /falls_detail/);
        return { ok: ui.length && col.length, ev: [...ui, ...col].slice(0, 3) };
      }],
    ["F-03", "Medication risk — OCR + ผู้ใช้ยืนยัน + ส่งเภสัชกร",
      () => {
        const ocr = findIn(APPS, /ocrLoad/);
        const confirm = findIn(APPS, /confirmBox/);
        const queue = findIn(BACK, /medReviewQueue/);
        return { ok: ocr.length && confirm.length && queue.length,
                 ev: [...ocr, ...confirm, ...queue].slice(0, 3) };
      }],
    ["F-04", "FTSST / TUG — มี safety gate ก่อนทดสอบ และบันทึกผล",
      () => {
        const gate = findIn(APPS, /safetyVerdict|SAFETY_Q/);
        const cols = findIn(SQL, /ftsst_seconds/);
        const tug = findIn(SQL, /tug_seconds/);
        return { ok: gate.length && cols.length && tug.length,
                 ev: [...gate, ...cols, ...tug].slice(0, 3) };
      }],
    ["F-05", "Barthel ADL — คำนวณและแสดงแนวโน้ม",
      () => {
        const calc = findIn(APPS, /BARTHEL/);
        const trend = findIn(APPS, /lineChart|trendSummary/);
        return { ok: calc.length && trend.length, ev: [...calc, ...trend].slice(0, 3) };
      }],
    ["F-06", "Risk engine — Green/Yellow/Red ตามกฎที่ประกาศ",
      () => {
        const eng = findIn(APPS, /function trajectory/);
        const rules = findIn(APPS, /baselineRisk/);
        const sig = findIn(APPS, /SIGNAL_DEFS/);
        return { ok: eng.length && rules.length && sig.length,
                 ev: [...eng, ...rules, ...sig].slice(0, 3) };
      }],
    ["F-07", "Case workflow — สถานะเปลี่ยนตามลำดับที่กำหนด",
      () => {
        const ui = findIn(STAFF, /CASE_STEPS/);
        const db = findIn(SQL, /cs_case_status/);
        return { ok: ui.length && db.length, ev: [...ui, ...db].slice(0, 3) };
      }],
    ["F-08", "Referral — บันทึกผู้รับผิดชอบและสถานะส่งต่อ",
      () => {
        const who = findIn(SQL, /decided_by/);
        const st = findIn(SQL, /cs_referral_status/);
        const upd = findIn(BACK, /updateReferral/);
        return { ok: who.length && st.length && upd.length,
                 ev: [...who, ...st, ...upd].slice(0, 3) };
      }],
    ["F-09", "Follow-up — มี due date และการเตือนเมื่อเกินกำหนด",
      () => {
        const due = findIn(SQL, /due_at/);
        const over = findIn(STAFF, /overdue/);
        return { ok: due.length && over.length, ev: [...due, ...over].slice(0, 3) };
      }],
    ["F-10", "Audit log — ตรวจย้อนได้ว่าใครทำอะไรเมื่อใด",
      () => {
        const tbl = findIn(SQL, /audit_logs/);
        const fn = findIn(BACK, /async function audit\(/);
        const immutable = findIn(SQL, /audit[\s\S]{0,600}(no update|ห้ามแก้|แก้ไม่ได้)/i);
        return { ok: tbl.length && fn.length, ev: [...tbl, ...fn, ...immutable].slice(0, 3) };
      }],
    ["F-11", "Insurer dashboard — aggregate / de-identified เท่านั้น",
      () => {
        const view = findIn(SQL, /insurer_outcomes/);
        const supp = findIn(SQL, /cs_min_cell/);
        /* ต้องไม่มีคอลัมน์คลินิกรายคนใน view ของบริษัทประกัน */
        const sql = SQL.map(read).join("\n");
        const block = sql.split("create or replace view public.insurer_portfolio").pop() || "";
        const leak = /ftsst_seconds|tug_seconds|\bscore\b/.test(block.slice(0, 1200));
        return { ok: view.length && supp.length && !leak,
                 ev: [...view, ...supp].slice(0, 3),
                 note: leak ? "พบคอลัมน์คลินิกรายคนใน insurer_portfolio" : "" };
      }],
    ["F-12", "Case ownership — บันทึกว่าใครรับผิดชอบเคส",
      () => {
        const col = findIn(SQL, /assigned_to/);
        const set = findIn(BACK, /assigned_to:\s*u\.id/);
        return { ok: col.length && set.length, ev: [...col, ...set].slice(0, 3) };
      }],
  ];
  for (const [id, name, fn] of items) {
    const r = fn();
    const status = r.ok ? "PASS" : (r.ev.length ? "PARTIAL" : "MISSING");
    req(1, id, name, status, r.ev.join(" · "), r.note || "");
    if (status !== "PASS") {
      finding(r.ev.length ? "MEDIUM" : "HIGH", id, "ฟีเจอร์ไม่ครบ: " + name,
        r.note || "ตรวจไม่พบหลักฐานครบทุกส่วนของข้อกำหนดนี้",
        r.ev.join(" · ") || "(ไม่พบหลักฐาน)",
        "เพิ่มส่วนที่ขาด หรือแก้ข้อกำหนดให้ตรงกับสิ่งที่ระบบทำจริง");
    }
  }
}

/* ============================================================
   ชั้นที่ 2 — Workflow แบบ End-to-End
   ตรวจว่า "เคสเดินได้จริงตั้งแต่ต้นจนจบ" ไม่ใช่แค่มีปุ่ม
   ============================================================ */
function layer2() {
  const staff = read("CareSignal-Staff.html") || "";
  const back  = read("cs-backend.js") || "";
  const sql   = SQL.map(read).join("\n");

  const steps = [
    ["W-01", "ระบบรับข้อมูลครบ (safety gate → falls → meds → FTSST → TUG → ADL)",
      /safety_gate/.test(sql) && /falls_detail/.test(sql) && /meds_detail/.test(sql)],
    ["W-02", "สร้าง Red signal จากเอนจิน", /out\.level\s*=/.test(read("CareSignal-Vision.html") || "")],
    ["W-03", "เปิดเคสให้ Care Manager อัตโนมัติ", /open_case_on_signal/.test(sql)],
    ["W-04", "แสดงเหตุผลของระดับ (อธิบายได้)", /why/.test(staff) && /SIGNAL_DEFS/.test(read("CareSignal-Vision.html") || "")],
    ["W-05", "มีผู้รับผิดชอบเคส", /assigned_to/.test(sql)],
    ["W-06", "มีวันครบกำหนดติดต่อ (SLA)", /sla_hours/.test(sql) && /due_at/.test(sql)],
    ["W-07", "ส่งต่อเภสัชกร/แพทย์ได้", /createReferralFor/.test(back) && /destination/.test(sql)],
    ["W-08", "แจ้งครอบครัวตาม consent", /notify_family|family_notifications/.test(sql)],
    ["W-09", "บันทึกผลการตรวจโดยผู้เชี่ยวชาญ", /closeMedReview/.test(back) && /outcome/.test(sql)],
    ["W-10", "สร้างงานติดตาม (follow-up)", /follow_ups/.test(sql) && /scheduleFollowUps/.test(back)],
    ["W-11", "ปิดเคสต้องมีคนกด ไม่ปิดอัตโนมัติ", null],  /* ตรวจแยกด้านล่าง */
    ["W-12", "มี audit log ทุกขั้นตอนสำคัญ",
      /case\.update/.test(back) && /contact\.log/.test(back) && /referral\.update/.test(back)],
  ];

  for (const [id, name, ok] of steps) {
    if (ok === null) continue;
    req(2, id, name, ok ? "PASS" : "MISSING", ok ? "ตรวจพบในซอร์ส" : "(ไม่พบ)");
    if (!ok) finding("HIGH", id, "สายงานขาดตอน: " + name,
      "ขั้นตอนนี้จำเป็นต่อการเดินเคสจนจบ แต่ตรวจไม่พบในระบบ",
      "(ไม่พบ)", "เพิ่มขั้นตอนนี้ หรือระบุในแผนว่าจงใจไม่ทำในรุ่นนี้");
  }

  /* W-11: ช่องโหว่ที่ผู้ใช้ระบุว่าสำคัญ — ปิดเคสอัตโนมัติโดยไม่ผ่านคน */
  const autoCloseTrigger = /update\s+care_cases[\s\S]{0,300}status\s*=\s*'(stable|closed)'/i.test(sql);
  const closers = [];
  for (const m of back.matchAll(/status\s*[:=]\s*["'](stable|closed)["']/g)) {
    const ln = back.slice(0, m.index).split("\n").length;
    closers.push(`cs-backend.js:${ln}`);
  }
  /* ทุกจุดที่ปิดเคสต้องอยู่ในฟังก์ชันที่ต้องมี session ของเจ้าหน้าที่ */
  const guarded = /async function updateCase[\s\S]{0,260}currentUser\(\)/.test(back)
               && /async function logContact[\s\S]{0,260}currentUser\(\)/.test(back);
  const rlsGuard = /create policy cases_staff[\s\S]{0,160}cs_is_staff\(\)/.test(sql);
  const ok11 = !autoCloseTrigger && guarded && rlsGuard;
  req(2, "W-11", "ปิดเคสต้องผ่านคน ไม่มีทางปิดอัตโนมัติ",
      ok11 ? "PASS" : "VIOLATION",
      `จุดที่เปลี่ยนเป็น stable/closed: ${closers.join(" · ") || "(ไม่พบ)"} · RLS cases_staff: ${rlsGuard}`);
  if (!ok11) finding("CRITICAL", "W-11", "เคสถูกปิดได้โดยไม่ผ่านการตัดสินของคน",
    autoCloseTrigger ? "พบทริกเกอร์ในฐานข้อมูลที่ตั้งสถานะเป็น stable/closed เอง"
                     : "จุดปิดเคสไม่ได้บังคับว่าต้องมี session ของเจ้าหน้าที่ หรือ RLS ไม่ได้จำกัดบทบาท",
    closers.join(" · "), "บังคับให้ทุกการปิดเคสมาจากการกระทำของเจ้าหน้าที่ และตรวจสิทธิ์ที่ฐานข้อมูล");

  /* ลำดับสถานะต้องตรงกันระหว่าง UI กับฐานข้อมูล */
  /* ต้องอ่านเฉพาะบล็อก CASE_STEPS — ในไฟล์เดียวกันมี CONTACT_RESULTS
     ที่ใช้รูปแบบ {k:"...",nm:...} เหมือนกัน ถ้าไม่แยกจะปนกันจนรายงานเท็จ */
  const stepBlock = (staff.match(/var CASE_STEPS=\[([\s\S]*?)\];/) || [])[1] || "";
  const uiSteps = [...stepBlock.matchAll(/\{k:"([a-z_]+)"/g)].map(m => m[1]);
  /* ค่า enum มาจากสองที่: create type ตอนแรก และ alter type ... add value ที่เพิ่มภายหลัง */
  const enumBlock = (sql.match(/create type cs_case_status as enum \(([\s\S]*?)\);/) || [])[1] || "";
  const dbSteps = [
    ...[...enumBlock.matchAll(/'([a-z_]+)'/g)].map(m => m[1]),
    ...[...sql.matchAll(/alter type cs_case_status add value if not exists '([a-z_]+)'/g)].map(m => m[1]),
  ];
  const extraInDb = dbSteps.filter(s => !uiSteps.includes(s) && s !== "closed");
  const extraInUi = uiSteps.filter(s => !dbSteps.includes(s));
  const sync = extraInUi.length === 0;
  req(2, "W-13", "สถานะใน UI ต้องมีอยู่จริงในฐานข้อมูล",
      sync ? "PASS" : "VIOLATION",
      `UI: ${uiSteps.join(",")} · DB: ${dbSteps.join(",")}`,
      extraInDb.length ? "สถานะที่มีใน DB แต่ UI ไม่ใช้: " + extraInDb.join(",") : "");
  if (!sync) finding("HIGH", "W-13", "UI ใช้สถานะที่ฐานข้อมูลไม่รู้จัก",
    "การบันทึกจะล้มเหลวตอนรันจริง", extraInUi.join(","), "เพิ่มค่าใน enum หรือแก้ UI");
}

/* ============================================================
   ชั้นที่ 3 — ตรวจว่าโปรแกรมทำเกินขอบเขตหรือไม่
   ============================================================ */
function layer3() {
  /* รูปแบบที่ "ห้ามมี" — เขียนให้จับพฤติกรรมจริง ไม่ใช่จับคำในประโยคปฏิเสธ */
  const banned = [
    ["S-01", "CRITICAL", "ระบบวินิจฉัยโรค",
      /(?:คุณ|ท่าน|ผู้ป่วย)(?:เป็น|มีภาวะ|ป่วยเป็น)(?:โรค)/, ALL],
    ["S-02", "CRITICAL", "ระบบยืนยันว่าจะหกล้มแน่นอน",
      /จะหกล้มแน่|หกล้มแน่นอน|ทำนายว่าจะล้ม/, ALL],
    ["S-03", "CRITICAL", "ระบบสั่งหยุดยา",
      /(?:ให้|กรุณา|ควร|จง)หยุดยา(?!เอง)/, ALL],
    ["S-04", "CRITICAL", "ระบบสั่งปรับขนาดยาเอง",
      /(?:ให้|ควร)(?:ลด|เพิ่ม)ขนาดยา/, ALL],
    ["S-05", "CRITICAL", "ระบบอนุมัติหรือปฏิเสธเคลม",
      /(?:อนุมัติ|ปฏิเสธ)(?:การ)?(?:เคลม|สินไหม)(?!.{0,40}ไม่)/, ALL],
    ["S-06", "CRITICAL", "ระบบคำนวณเบี้ยจากความเสี่ยง",
      /ageMult\s*:|sexMult\s*:|premium\s*=\s*[a-z0-9]/i, ALL],
    ["S-07", "HIGH", "ระบบให้ส่วนลดหรือปรับสิทธิประโยชน์",
      /discount\s*:\s*\{|ส่วนลดปีต่ออายุ\s*(?:สูงสุด|=)/, ALL],
    ["S-08", "HIGH", "ระบบกำหนดหรือปรับระยะรอคอย",
      /waitChronic|waitAcute|chronicCutPerAssess/, ALL],
    ["S-09", "CRITICAL", "เปิดเผยข้อมูลสุขภาพรายคนให้บริษัทประกันเกินความยินยอม",
      null, null],   /* ตรวจแยก */
    ["S-10", "CRITICAL", "AI ตัดสิน balance pass/fail เองโดยไม่ผ่านคน",
      null, null],   /* ตรวจแยก */
  ];

  for (const [id, sev, name, re, files] of banned) {
    if (!re) continue;
    const hits = [];
    for (const f of files) {
      const s = read(f); if (!s) continue;
      for (const m of s.matchAll(new RegExp(re.source, "g"))) {
        const before = s.slice(Math.max(0, m.index - 110), m.index).replace(/\s+/g, " ");
        const after  = s.slice(m.index, m.index + 110).replace(/\s+/g, " ");
        /* ข้าม 3 กรณีที่ไม่ใช่การละเมิด:
           1. ประโยคปฏิเสธ ("ระบบไม่อนุมัติสินไหม")
           2. ประโยคที่ระบุว่าคนเป็นผู้ตัดสิน ("การอนุมัติสินไหมตัดสินโดยผู้เชี่ยวชาญ")
           3. คอมเมนต์ที่อธิบายว่าถอดออกแล้ว */
        if (/ไม่|ห้าม|เลิก|ถอด|ตัด(?!สิน)|ออกแล้ว|removed|no longer/i.test(before)) continue;
        if (/ตัดสินโดย|เป็นของ|ทำโดย|เป็นหน้าที่ของ|ผู้เชี่ยวชาญ|บริษัทประกัน|แพทย์/.test(after)) continue;
        const ln = s.slice(0, m.index).split("\n").length;
        hits.push(`${f}:${ln} «${m[0]}»`);
      }
    }
    req(3, id, "ต้องไม่มี: " + name, hits.length ? "VIOLATION" : "PASS",
        hits.slice(0, 3).join(" · ") || "ไม่พบ");
    if (hits.length) finding(sev, id, "ทำเกินขอบเขต: " + name,
      "พบรูปแบบที่บ่งชี้ว่าระบบทำสิ่งที่ประกาศไว้ว่าไม่ทำ",
      hits.slice(0, 5).join(" · "), "ลบพฤติกรรมนี้ หรือแก้คำประกาศขอบเขตให้ตรงความจริง");
  }

  /* S-09 — บริษัทประกันต้องไม่เห็นค่าคลินิกรายคน */
  const sql = SQL.map(read).join("\n");
  const pf = sql.split("create or replace view public.insurer_portfolio").pop() || "";
  const head = pf.slice(0, 1400);
  const leaks = ["ftsst_seconds", "tug_seconds", "score", "display_name", "phone", "meds_detail"]
    .filter(c => new RegExp("\\b" + c + "\\b").test(head));
  req(3, "S-09", "ต้องไม่มี: เปิดเผยข้อมูลรายคนให้บริษัทประกันเกินจำเป็น",
      leaks.length ? "VIOLATION" : "PASS",
      leaks.length ? "พบใน insurer_portfolio: " + leaks.join(",") : "insurer_portfolio ไม่มีคอลัมน์คลินิก/ระบุตัวตน");
  if (leaks.length) finding("CRITICAL", "S-09", "บริษัทประกันเห็นข้อมูลรายคนเกินจำเป็น",
    "คอลัมน์เหล่านี้เป็นข้อมูลสุขภาพหรือระบุตัวบุคคล", leaks.join(","),
    "ถอดคอลัมน์ออกจาก view หรือย้ายไปมุมมองของทีมดูแลเท่านั้น");

  /* S-10 — balance ต้องให้คนยืนยัน และต้องไม่อยู่ในคะแนนหลัก */
  const vis = read("CareSignal-Vision.html") || "";
  const app = read("CareSignal-App.html") || "";
  const humanConfirm = /bcPass/.test(vis) && /bcPass/.test(app);
  const notInScore = !/parts\.ftsst\s*\+\s*parts\.balance/.test(vis.replace(/\s/g, " "))
                  && !/s\+=parts\.balance/.test(app.replace(/\s/g, ""));
  const noTorsoFail = !/ตัวเลื่อนจากตำแหน่งเดิมมาก/.test(vis) && !/ตัวเลื่อนจากตำแหน่งเดิมมาก/.test(app);
  const ok10 = humanConfirm && notInScore && noTorsoFail;
  req(3, "S-10", "ต้องไม่มี: AI ตัดสิน balance pass/fail เอง",
      ok10 ? "PASS" : "VIOLATION",
      `ปุ่มยืนยันโดยคน: ${humanConfirm} · ไม่อยู่ในคะแนนหลัก: ${notInScore} · ไม่ใช้ลำตัวตัดสิน: ${noTorsoFail}`);
  if (!ok10) finding("CRITICAL", "S-10", "AI ตัดสินผลการทรงตัวเองทั้งที่ยังไม่ผ่าน validation",
    "ต้องให้ผู้ดูแลเป็นผู้ยืนยัน และผลนี้ต้องไม่เข้าคะแนนหลัก",
    `human=${humanConfirm} score=${notInScore} torso=${noTorsoFail}`,
    "คืนการตัดสินให้คน และถอดออกจากคะแนนหลัก");
}

/* ============================================================
   ชั้นที่ 4 — Rules Engine (รันเอนจินจริง เทียบ expected vs actual)
   ============================================================ */
function grab(src, marker) {
  const i = src.indexOf(marker);
  if (i < 0) throw new Error("ไม่พบ " + marker);
  let d = 0, started = false;
  for (let j = i; j < src.length; j++) {
    const c = src[j];
    if (c === "{" || c === "[" || c === "(") { d++; started = true; }
    else if (c === "}" || c === "]" || c === ")") {
      d--;
      if (started && d === 0) {
        if (marker.includes("function") && c === ")") continue;
        return src.slice(i, j + 1) + ";";
      }
    }
  }
  throw new Error("วงเล็บไม่ปิด: " + marker);
}
function loadEngine() {
  const src = read("CareSignal-Vision.html");
  const code = [
    "var S={data:{assessments:[],profile:null},draft:{}};",
    "function daysBetween(a,b){return Math.max(0,Math.round((new Date(b)-new Date(a))/864e5))}",
    "function nowISO(){return new Date().toISOString()}",
    grab(src, "var CFG={"), grab(src, "var ENGINE={"), grab(src, "var BAL_STAGES="),
    grab(src, "function ftsstPoints("), grab(src, "function scoreOf("),
    grab(src, "var FRID_GROUPS="), grab(src, "function fridScore("),
    grab(src, "function baselineRisk("), grab(src, "var SIGNAL_DEFS="),
    grab(src, "function toSignals("), grab(src, "function hasADLFlag("),
    grab(src, "function trajectory("),
  ].join("\n");
  return new Function(code +
    "\nreturn {trajectory, scoreOf, setA:a=>S.data.assessments=a, setP:p=>S.data.profile=p};")();
}

function layer4() {
  let E;
  try { E = loadEngine(); }
  catch (e) {
    req(4, "E-00", "โหลดเอนจินเพื่อทดสอบ", "UNVERIFIABLE", "-", "โหลดไม่สำเร็จ: " + e.message);
    finding("HIGH", "E-00", "ตรวจเอนจินไม่ได้", e.message, "-", "แก้โครงสร้างให้ดึงมาทดสอบได้");
    return;
  }
  /* tier ต้องคำนวณจากคะแนนจริง ไม่ใช่ตั้งค่าตายตัว
     เอนจินใช้ last.tier ตัดสินระดับด้วย ถ้า mock ตั้ง tier ไม่ตรงคะแนน
     ผลที่ได้จะสะท้อนข้อมูลทดสอบที่ผิด ไม่ใช่พฤติกรรมของเอนจิน */
  const tierOf = (s) => (s >= 8 ? 4 : s >= 6 ? 3 : s >= 4 ? 2 : 1);
  const mk = (o) => {
    const pf = o.pf ?? 3, pfa = o.pfa ?? 2, pm = o.pm ?? 1, pa = o.pa ?? 2;
    const sc = o.score ?? (pf + pfa + pm + pa);
    return {
    at: o.at || "2026-08-01", score: sc, max: 9, tier: o.tier ?? tierOf(sc),
    ftsst: o.ftsst ?? 11, tug: o.tug ?? null, tugDistanceOk: o.tug ? true : null,
    balPassed: o.bal ?? 3, barthelTotal: o.bar ?? 20, cv: o.cv ?? 0.1,
    parts: { ftsst: pf, balance: o.pb ?? 2, falls: pfa, meds: pm, adl: pa },
    fallsDetail: o.falls || { count: 0 }, medsDetail: o.meds || {},
    steadi: o.steadi || {}, notTested: o.notTested || false,
  };};
  /* กรณีทดสอบ: input → expected (มาจากกฎที่ประกาศไว้ ไม่ใช่จากผลที่ระบบให้) */
  const cases = [
    ["E-01", "ไม่เคยหกล้ม ผลคงที่ → เขียว", 70,
      [mk({}), mk({ at: "2026-08-20" })], (r) => r.level === "stable"],
    ["E-02", "หกล้ม 1 ครั้ง ไม่มีสัญญาณอื่น → อย่างน้อยเฝ้าสังเกต", 70,
      [mk({ falls: { count: 1 } })], (r) => ["watch", "decline", "urgent"].includes(r.level)],
    ["E-03", "หกล้ม 2 ครั้งใน 12 เดือน → เร่งด่วน (ตั้งแต่ครั้งแรก)", 70,
      [mk({ falls: { count: 2 } })], (r) => r.level === "urgent"],
    ["E-04", "ล้มแล้วลุกเองไม่ได้ → เร่งด่วน", 70,
      [mk({ falls: { count: 1, getup: 3 } })], (r) => r.level === "urgent"],
    ["E-05", "TUG ≥ 12 วินาที → เปิดสัญญาณการเดิน (S5)", 70,
      [mk({ tug: 14 })], (r) => r.signals.some(s => s.k === "S5")],
    ["E-06", "ยากลุ่มเสี่ยงสูง 2 กลุ่ม + ทรงตัวบกพร่อง → S3 ส่งเภสัชกร", 70,
      [mk({ meds: { count: 2, purposes: ["sleep", "anx"] }, pb: 1 })],
      (r) => r.signals.some(s => s.k === "S3" && s.dest === "pharmacist")],
    ["E-07", "Safety gate หยุดทดสอบ → S7 ธงแดงความปลอดภัย", 70,
      [mk({ notTested: true })], (r) => r.signals.some(s => s.k === "S7") && r.level === "urgent"],
    ["E-08", "ADL ลดลงจากครั้งก่อน → S6 ส่งพยาบาล", 70,
      [mk({ pa: 2 }), mk({ at: "2026-08-20", pa: 1 })],
      (r) => r.signals.some(s => s.k === "S6" && s.dest === "nurse")],
    ["E-09", "ทุกระดับที่ไม่ใช่เขียว ต้องเปิดเคส", 70,
      [mk({ falls: { count: 2 } })], (r) => r.opensCase === true],
    ["E-10", "การทรงตัวไม่มีผลต่อคะแนนรวม", 70, null,
      () => E.scoreOf({ ftsst: 10, balance: 0, falls: 2, meds: 1, adl: 2 }, 70).score
         === E.scoreOf({ ftsst: 10, balance: 3, falls: 2, meds: 1, adl: 2 }, 70).score],
  ];

  for (const [id, name, age, hist, expect] of cases) {
    let actual = null, pass = false, detail = "";
    try {
      if (hist) {
        E.setP({ age }); E.setA(hist);
        actual = E.trajectory();
        pass = expect(actual);
        detail = `level=${actual.level} signals=[${actual.signals.map(s => s.k).join(",")}] rules=[${actual.flags.map(f => f.id).join(",")}]`;
      } else {
        pass = expect();
        detail = "score(balance=0) === score(balance=3)";
      }
    } catch (e) { detail = "error: " + e.message; }
    req(4, id, name, pass ? "PASS" : "VIOLATION", detail);
    if (!pass) finding("HIGH", id, "เอนจินให้ผลไม่ตรงกฎที่ประกาศ: " + name,
      "ผลจริงต่างจากที่กฎกำหนดไว้", detail,
      "แก้กฎในเอนจิน หรือแก้ข้อกำหนดให้ตรงกับพฤติกรรมที่ต้องการ");
  }
}

/* ============================================================
   ชั้นที่ 5 — สิทธิ์และข้อมูลส่วนบุคคล
   ============================================================ */
function layer5() {
  const sql = SQL.map(read).join("\n");
  const back = read("cs-backend.js") || "";

  const checks = [
    ["P-01", "ทุกตารางข้อมูลส่วนบุคคลเปิด RLS",
      () => {
        const tables = ["profiles", "assessments", "risk_signals", "referrals", "care_cases",
                        "medications", "med_reviews", "contact_log", "care_events", "care_plans", "follow_ups"];
        /* ไฟล์จริงจัดคอลัมน์ด้วยช่องว่างหลายตัว เช่น
           "alter table public.profiles      enable row level security;"
           regex เดิมบังคับช่องว่างเดียว จึงรายงานเท็จว่าไม่มี RLS */
        const missing = tables.filter(t =>
          !new RegExp(`alter table\\s+public\\.${t}\\s+enable row level security`).test(sql));
        return { ok: !missing.length, ev: missing.length ? "ขาด: " + missing.join(",") : `ครบ ${tables.length} ตาราง` };
      }],
    ["P-02", "บริษัทประกันเข้าไม่ถึงคิวงานรายเคส",
      () => {
        const ok = /create or replace view public\.cm_worklist[\s\S]{0,3000}cs_is_staff\(\)/.test(sql)
                && /cs_is_staff[\s\S]{0,200}care_manager','admin'/.test(sql);
        return { ok, ev: "cm_worklist มี cs_is_staff() และ cs_is_staff ไม่รวม insurer" };
      }],
    ["P-03", "ครอบครัวเห็นข้อมูลเฉพาะที่ได้รับอนุญาตรายข้อ",
      () => {
        const ok = /permissions->>'meds'/.test(sql) && /permissions->>'status'/.test(sql)
                && /l\.status='approved'/.test(sql);
        return { ok, ev: "policy ตรวจ permissions รายคีย์ + ต้อง approved" };
      }],
    ["P-04", "รูปซองยาเก็บใน bucket ส่วนตัว path ผูกกับเจ้าของ",
      () => {
        const ok = /'med-photos'[\s\S]{0,200}false/.test(sql)
                && /storage\.foldername\(name\)\)\[1\] = auth\.uid\(\)::text/.test(sql);
        return { ok, ev: "bucket private + path ขึ้นต้นด้วย user_id" };
      }],
    ["P-05", "การแยกกลุ่มระดับพอร์ตกดตัวเลขเมื่อกลุ่มเล็ก",
      () => {
        const ok = /cs_min_cell\(\)/.test(sql) && /suppressed/.test(sql);
        return { ok, ev: "insurer_strata ใช้ cs_min_cell() และมีธง suppressed" };
      }],
    ["P-06", "ทุกการเปิดดูข้อมูลผู้อื่นเขียน audit log",
      () => {
        const acts = ["portfolio.view", "case.open", "worklist.view", "case.queue"];
        const found = acts.filter(a => back.includes(a));
        return { ok: found.length >= 3, ev: "พบ: " + found.join(",") };
      }],
    ["P-07", "ความยินยอมถอนได้และมีบันทึกเวลา",
      () => {
        const ok = /revokeConsent|withdrawConsent/.test(back) || /granted:\s*false/.test(back);
        return { ok, ev: ok ? "พบเส้นทางถอนความยินยอม" : "ไม่พบ" };
      }],
  ];
  for (const [id, name, fn] of checks) {
    const r = fn();
    req(5, id, name, r.ok ? "PASS" : "VIOLATION", r.ev);
    if (!r.ok) finding("CRITICAL", id, "ช่องโหว่ด้านสิทธิ์ข้อมูล: " + name,
      "อาจทำให้ข้อมูลไปถึงคนที่ไม่ควรเห็น", r.ev, "แก้ policy หรือ view ให้ปิดช่องนี้");
  }
}

/* ============================================================
   ชั้นที่ 6 — สิ่งที่ "ตรวจด้วยการอ่านโค้ดไม่ได้"
   ต้องประกาศตรง ๆ ห้ามนับเป็นผ่าน
   ============================================================ */
function layer6() {
  const unverifiable = [
    ["U-01", "ความแม่นยำของ OCR กับฉลากยาไทยของจริง",
      "ทดสอบกับภาพสังเคราะห์เท่านั้น ยังไม่มีชุดภาพฉลากจริงที่มีเฉลย"],
    ["U-02", "ความแม่นยำของการตรวจจับท่าทางเทียบผู้เชี่ยวชาญ",
      "ยังไม่มีการวัดคู่ขนานกับนักกายภาพบำบัด"],
    ["U-03", "ความถูกต้องของการจัดระดับความเสี่ยงในทางคลินิก",
      "กฎมาจากวรรณกรรม แต่ยังไม่ได้ validate กับผลลัพธ์จริงในประชากรไทย"],
    ["U-04", "ประสิทธิผลในการลดการหกล้มหรือลดการเคลม",
      "ยังไม่มีข้อมูลนำร่องและไม่มีกลุ่มเปรียบเทียบ"],
    ["U-05", "ความปลอดภัยของการให้ผู้สูงอายุทดสอบเองที่บ้าน",
      "มี Safety Gate แต่ยังไม่มีข้อมูลเหตุการณ์ไม่พึงประสงค์จากการใช้จริง"],
    ["U-06", "ความทนทานของระบบรู้จำเสียงกับสำเนียงและเสียงรบกวนจริง",
      "ทดสอบด้วยข้อความจำลอง ยังไม่มีการทดสอบภาคสนาม"],
  ];
  for (const [id, name, why] of unverifiable) {
    req(6, id, name, "UNVERIFIABLE", "-", why);
  }
}

/* ============================================================
   ชั้นที่ 7 — กฎ UI/UX ตามโครง CDC STEADI
   ------------------------------------------------------------
   ตรวจว่าหน้าจอพาผู้ใช้ผ่านวงจร คัดกรอง → ประเมิน → แผนดูแล → ติดตาม
   และไม่ถอยกลับไปเป็นหน้าจอที่โชว์แต่คะแนนหรือสี
   ============================================================ */
function layer7() {
  const app   = read("CareSignal-App.html") || "";
  const staff = read("CareSignal-Staff.html") || "";
  const uiAll = [...APPS, ...STAFF, ...WEBS];

  const checks = [
    ["X-01", "แอปสมาชิกแสดงเส้นทางการดูแลทั้ง 4 ขั้น ไม่ใช่แค่ผลตรวจ",
      () => ({ ok: /var STEADI=/.test(app) && /journeyHTML\(\)/.test(app),
               ev: "STEADI + journeyHTML ในหน้าแรก" })],
    ["X-02", "หน้าแรกบอก \"ขั้นตอนถัดไป\" ที่กดทำต่อได้ทันที",
      () => ({ ok: /ขั้นตอนถัดไป/.test(app) && /j\.next\.go/.test(app),
               ev: "การ์ดขั้นตอนถัดไปมีปุ่มพาไปทำงานต่อ" })],
    ["X-03", "คิวงานเจ้าหน้าที่จัดกลุ่มตามขั้นของวงจร",
      () => ({ ok: /var STAGES=/.test(staff) && /stageOf\(/.test(staff),
               ev: "STAGES 4 กลุ่ม + จัดกลุ่มในคิว" })],
    ["X-04", "หน้าเคสมีแถบบอกว่าอยู่ขั้นไหนของวงจร",
      () => ({ ok: /stageBar\(/.test(staff), ev: "stageBar ในหน้ารายละเอียดเคส" })],
    ["X-05", "หน้าเคสตอบ 3 คำถามทันที: พบอะไร · ใครทำอะไร · ภายในเมื่อไร",
      () => ({ ok: /พบอะไร/.test(staff) && /ใครต้องทำอะไร/.test(staff) && /ภายในเมื่อไร/.test(staff),
               ev: "การ์ดสรุปบนสุดของหน้าเคส" })],
    ["X-06", "ป้ายความสำคัญมีไอคอนและข้อความ ไม่ใช้สีลำพัง",
      () => ({ ok: /var PRIO=\{[\s\S]{0,400}ic:/.test(staff) && /prioPill\(/.test(staff),
               ev: "PRIO มี ic + nm + act และใช้ผ่าน prioPill()" })],
    ["X-07", "ป้ายความสำคัญบอกด้วยว่าต้องทำภายในเมื่อไร",
      () => ({ ok: /prioact/.test(staff) && /ภายใน 24 ชั่วโมง/.test(staff),
               ev: "บรรทัด .prioact ใต้ป้ายทุกใบ" })],
    ["X-08", "แบบประเมินมีแถบบอกความคืบหน้า",
      () => ({ ok: /role="progressbar"/.test(app) && /\[i\+1,QS\.length\]/.test(app),
               ev: "head() รับพารามิเตอร์ prog และหน้าคำถามส่งค่าให้" })],
    ["X-09", "แถบเส้นทางอ่านได้ด้วยเครื่องอ่านหน้าจอ",
      () => ({ ok: /role="list"[\s\S]{0,120}เส้นทางการดูแล/.test(app) && /aria-label/.test(app),
               ev: "role=list + aria-label บอกสถานะแต่ละขั้น" })],
  ];
  for (const [id, name, fn] of checks) {
    const r = fn();
    req(7, id, name, r.ok ? "PASS" : "MISSING", r.ev);
    if (!r.ok) finding("MEDIUM", id, "UI ไม่ตรงโครง STEADI: " + name,
      "หน้าจอยังไม่พาผู้ใช้ผ่านวงจรครบตามที่ออกแบบไว้", r.ev,
      "เพิ่มส่วนที่ขาดในหน้าจอที่เกี่ยวข้อง");
  }

  /* ---- โครงคอนโซลแบบระบบงาน: จอกว้างต้องเป็นแถบเมนูข้าง ไม่ใช่แอปมือถือยืด ---- */
  const consoleChecks = [
    ["X-14", "จอกว้างใช้แถบเมนูข้าง ไม่บีบเป็นคอลัมน์แคบ",
      () => ({ ok: /@media\(min-width:1040px\)[\s\S]{0,900}grid-template-areas/.test(staff)
                && /<nav class="side"/.test(staff),
               ev: "โครง grid + nav.side ที่ 1040px ขึ้นไป" })],
    ["X-15", "มีหน้าติดตามการส่งต่อจนถึงผลลัพธ์ ไม่จบที่ \"ส่งต่อแล้ว\"",
      () => ({ ok: /var REF_PIPE=/.test(staff) && /outcome_recorded/.test(staff)
                && /timeInStage\(/.test(staff),
               ev: "REF_PIPE 6 ขั้น + คำนวณเวลาที่ค้างในแต่ละขั้น" })],
    ["X-16", "หน้าส่งต่อชี้จุดติดขัดได้ (ค้างนานเกินกำหนด)",
      () => ({ ok: /var REF_LIMIT=/.test(staff) && /เกินกำหนด/.test(staff),
               ev: "REF_LIMIT ต่อขั้น + ทำเครื่องหมายรายการที่ค้างเกิน" })],
    ["X-17", "มีหน้ารายงานที่คำนวณจากข้อมูลจริง ไม่ใช่ตัวเลขที่ตั้งไว้",
      () => ({ ok: /async function reportsV\s*\(/.test(staff)
                && /ยังไม่มีข้อมูลในรายงานนี้/.test(staff),
               ev: "reportsV ดึงจาก caseQueue/listReferralQueue/medReviewQueue" })],
    ["X-18", "รายงานไม่แอบอ้างตัวเลขที่ยังไม่มีข้อมูลรองรับ",
      () => ({ ok: /ระบบจะไม่แสดงตัวเลขที่ยังไม่มีข้อมูลรองรับ/.test(staff),
               ev: "ประกาศรายการที่ยังทำไม่ได้ไว้ท้ายหน้ารายงาน" })],
    ["X-19", "มีหน้าดูบันทึกตรวจสอบว่าใครทำอะไรกับข้อมูลของใคร",
      () => ({ ok: /async function auditV\s*\(/.test(staff) && /listAudit/.test(staff)
                && /audit:\s*auditV/.test(staff),
               ev: "auditV อ่านจาก audit_logs และต่อสายไว้ในเมนูจริง" })],
    ["X-20", "บัญชีบริษัทประกันถูกซ่อนเมนูรายบุคคลตั้งแต่แรก ไม่ใช่กันตอนกด",
      () => {
        /* เมนูของบริษัทประกันต้องไม่มีหน้าที่แสดงข้อมูลรายบุคคลเลย */
        const m = staff.match(/insurer:\s*\[([^\]]*)\]/);
        const banned = ["queue", "refer", "meds", "mine", "reports", "audit", "users"];
        const ok = !!m && /function navForRole/.test(staff)
                && !banned.some(k => m[1].indexOf('"' + k + '"') >= 0);
        return { ok, ev: m ? "เมนูบริษัทประกัน: " + m[1].replace(/\s+/g, "") : "ไม่พบ insurer ใน NAV_BY_ROLE" };
      }],
    ["X-21", "คอนโซลไม่มีโมดูลการเงิน (ขัดกับขอบเขตที่ประกาศไว้)",
      () => {
        /* ข้อความที่ "ปฏิเสธ" ว่าไม่มีโมดูลการเงิน เป็นสิ่งที่ต้องการ ไม่ใช่ข้อผิดพลาด
           จึงต้องอ่านคำนำหน้าก่อนตัดสิน เช่น "ไม่ออกใบเสร็จ" ต้องไม่ถูกนับเป็นการละเมิด */
        const re = /ใบเสร็จ|ภาษีมูลค่าเพิ่ม|คอมมิชชั่|คอมมิชชั|ยอดขาย|มัดจำ|คืนเงิน|คูปอง|ตัดสต็อค/g;
        const hits = [];
        for (const m of staff.matchAll(re)) {
          const before = staff.slice(Math.max(0, m.index - 60), m.index);
          if (/ไม่|ไม่มี|ห้าม|ปราศจาก/.test(before)) continue;
          const ln = staff.slice(0, m.index).split(LF).length;
          hits.push(`CareSignal-Staff.html:${ln} «${m[0]}»`);
        }
        return { ok: !hits.length,
                 ev: hits.length ? hits.slice(0, 3).join(" · ") : "ไม่พบโมดูลการเงิน (ข้อความปฏิเสธไม่นับ)" };
      }],
  ];
  for (const [id, name, fn] of consoleChecks) {
    const r = fn();
    req(7, id, name, r.ok ? "PASS" : "MISSING", r.ev);
    if (!r.ok) finding("MEDIUM", id, "โครงคอนโซลไม่ตรงแผน: " + name,
      "หน้าจอเจ้าหน้าที่ยังไม่ครบตามโครงระบบงานที่ออกแบบไว้", r.ev,
      "เพิ่มส่วนที่ขาดในคอนโซลเจ้าหน้าที่");
  }

  /* ---- แต่ละบทบาทเห็นเฉพาะงานของตน ---- */
  const sqlAll = SQL.map(read).join("\n");
  const roleChecks = [
    ["X-22", "มีบทบาทวิชาชีพให้ปลายทางส่งต่อมีบัญชีจริง",
      () => ({ ok: /add value if not exists 'pharmacist'/.test(sqlAll)
                && /add value if not exists 'physio'/.test(sqlAll),
               ev: "cs_role มี pharmacist/physio/doctor/nurse" })],
    ["X-23", "วิชาชีพเห็นเฉพาะรายการที่ส่งถึงวิชาชีพตน (บังคับด้วย RLS)",
      () => ({ ok: /create policy referrals_select[\s\S]{0,400}cs_my_destination\(\)/.test(sqlAll),
               ev: "referrals_select เทียบ destination กับ cs_my_destination()" })],
    ["X-24", "หน้า \"งานของฉัน\" กรองที่ฐานข้อมูล ไม่ใช่ที่หน้าจอ",
      () => ({ ok: /create (or replace )?view public\.my_work[\s\S]{0,1500}auth\.uid\(\)/.test(sqlAll)
                && /from\("my_work"\)/.test(read("cs-backend.js") || ""),
               ev: "view my_work มี auth.uid() ในเงื่อนไขของตัวเอง" })],
    ["X-25", "เมนูของแต่ละบทบาทประกาศไว้ชัด ไม่ใช่ซ่อนทีละปุ่ม",
      () => ({ ok: /var NAV_BY_ROLE=\{[\s\S]{0,700}pharmacist:/.test(staff),
               ev: "NAV_BY_ROLE กำหนดเมนูครบทุกบทบาท" })],
    ["X-26", "วิชาชีพไม่มีเมนูคิวเคสทั้งพอร์ต",
      () => {
        const m = staff.match(/pharmacist:\s*\[([^\]]*)\]/);
        const ok = !!m && !/["']queue["']/.test(m[1]) && !/["']port["']/.test(m[1]);
        return { ok, ev: m ? "เมนูเภสัชกร: " + m[1].replace(/\s+/g, "") : "ไม่พบ" };
      }],
    ["X-27", "กดรับเคสข้ามวิชาชีพไม่ได้",
      () => ({ ok: /function public\.claim_referral[\s\S]{0,900}cs_my_destination\(\)/.test(sqlAll)
                && /ไม่ได้ส่งมาถึงคุณ/.test(sqlAll),
               ev: "claim_referral ตรวจ destination ก่อนอนุญาต" })],
    ["X-28", "เปลี่ยนบทบาทผู้ใช้ได้เฉพาะผู้ดูแลระบบ",
      () => ({ ok: /guard_role_change/.test(sqlAll) || /ไม่มีสิทธิ์เปลี่ยนบทบาทผู้ใช้/.test(sqlAll),
               ev: "trigger guard_role_change ที่ฐานข้อมูล" })],
  ];
  for (const [id, name, fn] of roleChecks) {
    const r = fn();
    req(7, id, name, r.ok ? "PASS" : "MISSING", r.ev);
    if (!r.ok) finding("HIGH", id, "การแบ่งงานตามบทบาทไม่ครบ: " + name,
      "ถ้าแต่ละบทบาทไม่ถูกจำกัดให้เห็นเฉพาะงานของตน ข้อมูลสุขภาพจะรั่วข้ามวิชาชีพ",
      r.ev, "เพิ่มการจำกัดที่ฐานข้อมูล ไม่ใช่เฉพาะที่หน้าจอ");
  }

  /* ---- ความยินยอมรายครั้ง (แนวระบบ Health Link) ---- */
  const appAll = read("CareSignal-App.html") || "";
  const backAll = read("cs-backend.js") || "";
  const consentChecks = [
    ["X-29", "ผู้เชี่ยวชาญต้องขอความยินยอมก่อนเปิดดูข้อมูลคลินิก",
      () => ({ ok: /create table if not exists public\.access_requests/.test(sqlAll)
                && /cs_has_live_access/.test(sqlAll),
               ev: "ตาราง access_requests + ฟังก์ชัน cs_has_live_access" })],
    ["X-30", "รายการยาถูกกั้นด้วยความยินยอมที่ยังไม่หมดอายุ",
      () => ({ ok: /create policy meds_pharmacist_read[\s\S]{0,300}cs_has_live_access/.test(sqlAll),
               ev: "RLS ของ medications เรียก cs_has_live_access" })],
    ["X-31", "ผู้เอาประกันเท่านั้นที่ตัดสินคำขอ",
      () => ({ ok: /function public\.decide_access[\s\S]{0,700}member_id <> auth\.uid\(\)/.test(sqlAll),
               ev: "decide_access ปฏิเสธถ้าไม่ใช่เจ้าของข้อมูล" })],
    ["X-32", "คำขอมีเวลาจำกัด และสิทธิ์ที่ให้แล้วหมดอายุเอง",
      () => ({ ok: /expires_at[\s\S]{0,80}interval '5 minutes'/.test(sqlAll)
                && /access_until\s*>\s*now\(\)/.test(sqlAll),
               ev: "ตอบภายใน 5 นาที · สิทธิ์มี access_until" })],
    ["X-33", "หน้าจอผู้เชี่ยวชาญมีครบ 3 สถานะ ขอ → รอ → ตรวจสอบ",
      () => ({ ok: /ขอความยินยอม/.test(staff) && /รอผู้เอาประกันยืนยัน/.test(staff)
                && /ตรวจสอบความยินยอม/.test(staff),
               ev: "consentBox แสดงสามสถานะ" })],
    ["X-34", "ผู้เอาประกันเห็นว่าใครขอ จากหน่วยงานใด เลขใบประกอบวิชาชีพอะไร",
      () => ({ ok: /license_no/.test(appAll) && /org_name/.test(appAll) && /data-allow/.test(appAll),
               ev: "การ์ดคำขอแสดงตัวตนผู้ขอ + ปุ่มอนุญาต/ไม่อนุญาต" })],
    ["X-35", "ผู้เอาประกันตรวจย้อนได้ว่าใครเคยขอและได้ดูหรือไม่",
      () => ({ ok: /myAccessLog/.test(backAll) && /alogHost/.test(appAll),
               ev: "ประวัติคำขอในหน้าความโปร่งใส" })],
    ["X-36", "การปฏิเสธไม่กระทบสิทธิ์ตามกรมธรรม์ (ต้องบอกผู้ใช้)",
      () => ({ ok: /ปฏิเสธได้[\s\S]{0,60}ไม่กระทบสิทธิ์/.test(appAll),
               ev: "ข้อความใต้ปุ่มในการ์ดคำขอ" })],
    ["X-37", "คอนโซลออกจากระบบเองเมื่อไม่มีการใช้งาน",
      () => ({ /* ต้องเจอทั้งการประกาศตัวแปร ตัวจับเวลาที่เรียก signOut และการรีเซ็ตเมื่อมีการใช้งาน
                  เช็คแค่ชื่อตัวแปรไม่พอ เพราะชื่อยังโผล่ในข้อความแจ้งผู้ใช้ได้แม้ถอดกลไกออกแล้ว */
               ok: /var IDLE_MIN\s*=\s*\d+/.test(staff)
                && /idleT\s*=\s*setTimeout[\s\S]{0,200}signOut/.test(staff)
                && /addEventListener\(ev,\s*resetIdle/.test(staff),
               ev: "ประกาศ IDLE_MIN + ตัวจับเวลาเรียก signOut + รีเซ็ตเมื่อมีการใช้งาน" })],
    ["X-38", "ไม่มีช่องค้นหาผู้เอาประกันข้ามพอร์ต (ต่างจากระบบแลกเปลี่ยนข้อมูลระดับชาติ)",
      () => {
        /* Health Link ให้แพทย์ค้นหาใครก็ได้ด้วยเลขบัตรประชาชน เพราะต้องเปิดดูคนที่เพิ่งมารักษา
           CareSignal ไม่ทำแบบนั้น — ช่องค้นหาแบบนั้นจะทำลายการแยกสิทธิ์ตามบทบาท */
        const bad = /เลขบัตรประชาชน[\s\S]{0,120}(ค้นหา|search)/i.test(staff)
                 || /citizen_id/i.test(staff);
        return { ok: !bad, ev: bad ? "พบช่องค้นหาด้วยเลขบัตรประชาชนในคอนโซล" : "ไม่มีช่องค้นหาข้ามพอร์ต" };
      }],
  ];
  for (const [id, name, fn] of consentChecks) {
    const r = fn();
    req(7, id, name, r.ok ? "PASS" : "MISSING", r.ev);
    if (!r.ok) finding("HIGH", id, "ความยินยอมรายครั้งไม่ครบ: " + name,
      "ถ้าผู้เชี่ยวชาญเปิดดูข้อมูลคลินิกได้โดยไม่ต้องขอ ผู้เอาประกันจะควบคุมข้อมูลตนเองไม่ได้",
      r.ev, "เพิ่มการกั้นที่ฐานข้อมูล และแสดงสถานะให้ทั้งสองฝ่ายเห็น");
  }

  /* ---- ขั้นตอนตามระบบ Health Link ---- */
  const hlChecks = [
    ["X-39", "เจ้าหน้าที่ต้องระบุหน่วยบริการที่ปฏิบัติงานทุกครั้งที่เข้าระบบ",
      () => ({ ok: /create table if not exists public\.work_sessions/.test(sqlAll)
                && /function orgPrompt\(\)/.test(staff)
                && /startWorkSession/.test(staff),
               ev: "ตาราง work_sessions + กล่องเลือกหน่วยบริการตอนเข้าระบบ" })],
    ["X-40", "หน่วยบริการถูกบันทึกติดกับคำขอ ไม่ใช่อ่านสดจากโปรไฟล์",
      /* ต้องเห็นคำสั่งสร้าง trigger จริง — ชื่อฟังก์ชันโผล่เฉย ๆ ไม่ได้แปลว่ามันทำงาน */
      () => ({ ok: /requester_org/.test(sqlAll)
                && /^create trigger trg_stamp_request_org[\s\S]{0,200}stamp_request_org\(\)/m.test(sqlAll)
                && /requester_org/.test(appAll),
               ev: "create trigger trg_stamp_request_org + แอปแสดง requester_org" })],
    ["X-41", "ตรวจสถานะสมาชิกก่อนจึงส่งคำขอความยินยอมได้",
      /* ต้องเห็นว่าเอาค่า can_request มาปิดปุ่มจริง ไม่ใช่แค่มีคำนี้อยู่ในไฟล์ */
      () => ({ ok: /function public\.check_membership/.test(sqlAll)
                && /canAsk\s*=\s*!ms\s*\|\|\s*ms\.can_request/.test(staff)
                && /data-ask'\+\(canAsk\?''/.test(staff),
               ev: "check_membership() + canAsk ปิดปุ่มเมื่อยังขอไม่ได้" })],
    ["X-42", "การตรวจสถานะสมาชิกไม่คืนข้อมูลส่วนบุคคล",
      () => {
        const m = sqlAll.match(/function public\.check_membership[\s\S]{0,1600}?\$\$;/);
        const body = m ? m[0] : "";
        /* ต้องคืนเฉพาะสถานะ ไม่คืนชื่อ เบอร์ วันเกิด หรือผลตรวจ */
        const leaks = /jsonb_build_object[\s\S]{0,400}(display_name|'phone'|birth_year|ftsst|tug_seconds)/.test(body);
        return { ok: !!body && !leaks,
                 ev: leaks ? "พบข้อมูลส่วนบุคคลในค่าที่คืน" : "คืนเฉพาะ enrolled/consented/channel/can_request" };
      }],
    ["X-43", "มีลิงก์เข้าตรงที่เคส ไม่ต้องไล่หาในคิว",
      () => ({ ok: /function deepLink\(\)/.test(staff) && /ST\.focusRef/.test(staff),
               ev: "#ref=<id> พาไปที่เคสนั้นและทำเครื่องหมายให้เห็น" })],
    ["X-44", "ผู้เอาประกันเห็นว่าคำขอมาจากหน่วยบริการใด",
      () => ({ ok: /หน่วยบริการที่ขอ/.test(appAll),
               ev: "การ์ดคำขอแสดงหน่วยบริการ ณ เวลาที่ขอ" })],
  ];
  for (const [id, name, fn] of hlChecks) {
    const r = fn();
    req(7, id, name, r.ok ? "PASS" : "MISSING", r.ev);
    if (!r.ok) finding("MEDIUM", id, "ขั้นตอนตามมาตรฐานไม่ครบ: " + name,
      "ขั้นตอนนี้ทำให้ตรวจย้อนได้ว่าใครเปิดดูข้อมูลจากที่ใด และผู้เอาประกันตัดสินใจได้บนข้อมูลที่ครบ",
      r.ev, "เพิ่มส่วนที่ขาด");
  }

  /* ---- ส่งต่อแบบมีโครงสร้าง + ส่งกลับ (แนว MOPH Refer) ---- */
  const mophChecks = [
    ["X-45", "ใบส่งต่อมีชุดข้อมูล ณ เวลาส่ง ไม่ใช่ส่งแค่ระดับสี",
      () => ({ ok: /function public\.build_referral_package/.test(sqlAll)
                && /pkg := public\.build_referral_package\(target\)/.test(sqlAll)
                && /previewPackage/.test(staff) && /pkgHTML\(/.test(staff),
               ev: "send_referral สร้างชุดข้อมูลเอง + แผ่นส่งต่อแสดงชุดข้อมูล" })],
    ["X-46", "ส่งต่อต้องมีคำถามที่ต้องการคำตอบอย่างน้อย 1 ข้อ (บังคับที่ฐานข้อมูล)",
      () => ({ ok: /array_length\(qs,1\) is null[\s\S]{0,120}raise exception/.test(sqlAll)
                && /if\(!qs\.length\)\{toast/.test(staff),
               ev: "send_referral ปฏิเสธ qs ว่าง + หน้าจอกันก่อน" })],
    ["X-47", "ผู้ประสานงานสร้างรายการส่งต่อได้ (RLS ไม่ปิดกั้น)",
      () => ({ ok: /^create policy referrals_insert_own[\s\S]{0,200}cs_is_staff\(\)/m.test(sqlAll),
               ev: "referrals_insert_own อนุญาต cs_is_staff()" })],
    ["X-48", "ผู้เชี่ยวชาญส่งผลกลับเป็นโครงสร้าง ไม่จบที่ \"ได้รับบริการแล้ว\"",
      () => ({ ok: /function public\.return_review/.test(sqlAll)
                && /next_step not in \('sufficient','need_more_info','book_assessment','refer_doctor','follow_plan'\)/.test(sqlAll)
                && /function reviewSheet\(/.test(staff) && /returnReview/.test(staff),
               ev: "return_review() + แผ่นส่งผลกลับพร้อมขั้นตอนถัดไป 5 แบบ" })],
    ["X-49", "ผลที่ส่งกลับไปตั้งงานถัดไปของเคสให้ผู้ประสานงาน (วงจรปิด)",
      () => ({ ok: /function public\.return_review[\s\S]{0,3000}update public\.care_cases[\s\S]{0,500}กลับมาแล้ว — ปรับแผนดูแล/.test(sqlAll),
               ev: "return_review อัปเดต care_cases.next_action" })],
    ["X-50", "return_review กันช่องโหว่ NULL ในการตรวจสิทธิ์",
      () => ({ /* พบจากการทดสอบจริง: assigned_to เป็น NULL → not(NULL) ไม่ยก exception */
               ok: /allowed := coalesce\(public\.cs_is_staff\(\), false\)[\s\S]{0,300}coalesce\(rec\.assigned_to = auth\.uid\(\), false\)/.test(sqlAll)
                && /if not allowed then raise exception/.test(sqlAll),
               ev: "สิทธิ์ถูกบังคับเป็น boolean ด้วย coalesce ก่อนตรวจ" })],
    ["X-51", "มีไทม์ไลน์เคสที่ดึงจากข้อมูลจริงทุกตาราง",
      () => ({ ok: /function public\.case_timeline/.test(sqlAll)
                && /from public\.access_requests a, c/.test(sqlAll)
                && /function timelineHTML\(/.test(staff) && /tlHost/.test(staff),
               ev: "case_timeline() รวม signal/contact/refer/review/consent/followup" })],
    ["X-52", "ไม่เป็นระบบส่งต่อผู้ป่วยเต็มรูปแบบ (ไม่มีภาพรังสี/ห้องฉุกเฉิน/รถพยาบาล)",
      () => {
        const bad = /ภาพรังสี|x-ray|รถพยาบาล|ambulance|ห้องฉุกเฉิน|admit|ผู้ป่วยใน|IPD/i.test(staff);
        return { ok: !bad, ev: bad ? "พบคำที่เป็นระบบโรงพยาบาล" : "ส่งเฉพาะ 4 ด้าน: หกล้ม การเคลื่อนไหว ยา กิจวัตร" };
      }],
  ];
  for (const [id, name, fn] of mophChecks) {
    const r = fn();
    req(7, id, name, r.ok ? "PASS" : "MISSING", r.ev);
    if (!r.ok) finding(id === "X-50" || id === "X-47" ? "HIGH" : "MEDIUM", id, "การส่งต่อไม่ครบวงจร: " + name,
      "ถ้าส่งต่อแค่ระดับสี หรือไม่มีผลกลับ ผู้ประสานงานพิสูจน์ไม่ได้ว่า Red แล้วเกิดการดูแลจริง",
      r.ev, "เพิ่มส่วนที่ขาดทั้งที่ฐานข้อมูลและหน้าจอ");
  }

  /* ---- ความปลอดภัยในบ้าน + โหมดอยู่ในกรอบ ---- */
  const visAll = read("CareSignal-Vision.html") || "";
  const extraChecks = [
    ["X-53", "มีการประเมินความปลอดภัยในบ้านตาม CDC STEADI",
      () => ({ ok: /var HOME_Q=/.test(appAll) && /function renderHomeQ\(/.test(appAll)
                && /k:"home"[\s\S]{0,60}homeDetail:true/.test(appAll),
               ev: "HOME_Q 7 ข้อ + หน้าคำถามในชุดประเมิน" })],
    ["X-54", "อันตรายในบ้านไม่เข้าคะแนนหลัก แต่ออกที่สัญญาณความปลอดภัย",
      () => {
        /* ต้องมีกฎ B15 ที่ผลักเข้า S7 และต้องไม่ถูกบวกเข้าคะแนน */
        const hasRule = /id:"B15"/.test(appAll);
        const inS7 = /k:"S7"[\s\S]{0,120}"B15"/.test(appAll);
        const inScore = /parts=\{[^}]*home/.test(appAll) || /\+\s*parts\.home/.test(appAll);
        return { ok: hasRule && inS7 && !inScore,
                 ev: hasRule && inS7 ? "B15 → S7 และไม่อยู่ในสูตรคะแนน" : "ขาด B15 หรือไม่ได้ผูกกับ S7" };
      }],
    ["X-55", "เอนจินของแอปสมาชิกและโหมดทดลองมีกฎเท่ากัน",
      () => ({ ok: /id:"B15"/.test(appAll) && /id:"B15"/.test(visAll),
               ev: "B15 อยู่ในทั้งสองไฟล์ (test_parity ตรวจซ้ำอีกชั้น)" })],
    ["X-56", "ความปลอดภัยในบ้านถูกส่งไปกับชุดข้อมูลส่งต่อ",
      () => ({ ok: /home_detail/.test(sqlAll) && /'home', coalesce\(last_a\.home_detail/.test(sqlAll)
                && /home_detail/.test(backAll),
               ev: "คอลัมน์ home_detail + อยู่ใน build_referral_package + backend ส่งค่า" })],
    ["X-57", "ชุดข้อมูลส่งต่ออ่านจากคอลัมน์จริง ไม่ใช่เดาว่าอยู่ใน parts",
      () => ({ /* ของเดิมอ่าน parts->'falls_detail' ซึ่งไม่ใช่ที่เก็บจริง — เก็บในคอลัมน์
                  ตรวจว่ารูปแบบผิดนั้นหายไป และมีการอ่านจากคอลัมน์ (จะเขียนตรง ๆ
                  หรือผ่านตัวแปรก็ได้ ผลเท่ากัน) */
               ok: !/parts->'falls_detail'/.test(sqlAll)
                && /last_a\.falls_detail/.test(sqlAll)
                && /last_a\.home_detail/.test(sqlAll),
               ev: "อ่าน falls_detail / home_detail จากคอลัมน์ ไม่ได้เดาว่าอยู่ใน parts" })],
    ["X-58", "หัวแอปสมาชิกย่อลงเมื่อเปิดอยู่ในกรอบของหน้าเดียว",
      () => ({ ok: /html\[data-embedded\] \.bar\{/.test(appAll)
                && /window\.self!==window\.top/.test(appAll),
               ev: "ตั้งธง data-embedded + CSS ย่อหัว (คืนพื้นที่ ~50px)" })],
    ["X-59", "แท็บล่างของแอปสมาชิกยังใหญ่เท่าเดิมแม้อยู่ในกรอบ",
      () => {
        /* ปุ่มใหญ่สำหรับผู้สูงอายุเป็นข้อกำหนดเดิม ห้ามย่อเพื่อประหยัดที่ */
        const shrinks = /html\[data-embedded\][^{]*\.tabs[^{]*\{[^}]*min-height/.test(appAll);
        return { ok: !shrinks && /min-height:84px/.test(appAll),
                 ev: shrinks ? "พบการย่อแท็บล่างในโหมดกรอบ" : "แท็บล่างคง min-height 84px" };
      }],
  ];
  for (const [id, name, fn] of extraChecks) {
    const r = fn();
    req(7, id, name, r.ok ? "PASS" : "MISSING", r.ev);
    if (!r.ok) finding("MEDIUM", id, "ส่วนที่ขาด: " + name,
      "รายการนี้อยู่ในแผนงานที่ประกาศไว้ ถ้าขาดจะทำให้การประเมินหรือการส่งต่อไม่ครบ",
      r.ev, "เพิ่มส่วนที่ขาด");
  }

  /* ---- CSS ที่ถูกแทรกผิดจนกฎรวมร่างกัน ---- */
  {
    /* เคยเกิดจริง: แทรกบล็อกใหม่ก่อน ".tabs .tab b{" ซึ่งเป็นบรรทัดที่สอง
       ของรายการ selector — กฎกลายเป็น ".tabs button b, .prog{height:8px;
       overflow:hidden}" ป้ายแท็บล่างจึงถูกตัดเหลือ 8px และมีพื้นขาวทับ
       ตรวจทุกไฟล์: บรรทัดที่จบด้วยจุลภาคต้องตามด้วย selector เท่านั้น */
    const hits = [];
    for (const f of [...APPS, ...STAFF, ...WEBS]) {
      const src = read(f); if (!src) continue;
      const m = src.match(/<style>([\s\S]*?)<\/style>/);
      if (!m) continue;
      const lines = m[1].split(LF);
      const base = src.slice(0, m.index).split(LF).length;
      for (let i = 0; i < lines.length - 1; i++) {
        const cur = lines[i].trim(), nxt = lines[i + 1].trim();
        if (!cur.endsWith(",") || cur.startsWith("/*") || cur.includes("{")) continue;
        if (nxt.startsWith("/*") || nxt === "") hits.push(`${f}:${base + i} «${cur.slice(0, 40)}»`);
      }
    }
    req(7, "X-60", "ไม่มี selector ที่ถูกแทรกคั่นกลางจนกฎรวมร่างกัน",
        hits.length ? "VIOLATION" : "PASS",
        hits.slice(0, 3).join(" · ") || "ตรวจทุกบล็อก <style> แล้ว ไม่พบ");
    if (hits.length) finding("HIGH", "X-60", "CSS ถูกแทรกคั่นกลางรายการ selector",
      "กฎสองชุดรวมร่างกัน ทำให้ส่วนที่ไม่เกี่ยวข้องได้สไตล์ผิด — เคยทำให้ป้ายแท็บล่างอ่านไม่ออก",
      hits.slice(0, 3).join(" · "), "ย้ายบล็อกที่แทรกไปไว้หลัง selector ที่สมบูรณ์");
  }

  /* ---- X-61: โหมดสาธิตอยู่ได้เฉพาะฝั่งเจ้าหน้าที่ และต้องไม่มีซากของโหมดเก่า ----
     ประวัติ: โหมดสาธิตชุดแรกถูกถอดออกทั้งหมดตามคำสั่งเจ้าของระบบ เพราะโค้ดที่ถอด
     ไม่หมดอันตรายกว่าโค้ดที่อยู่ครบ (ตัวแปรค้างตัวเดียวป้อนข้อมูลปลอมเข้าหน้าจอโดย
     ไม่มีป้าย) · 4 ก.ย. 2569 เจ้าของระบบให้นำโหมดสาธิตกลับมาตามรายการเตรียมนำเสนอ
     ("ข้อมูลสาธิตต้องติดป้ายชัดเจนว่าเป็น synthetic") โดยอยู่ในไฟล์เดียว cs-demo.js
     ทับ CSBackend ทั้งชุด และมีแถบกำกับที่ปิดไม่ได้ (X-128 ตรวจเรื่องนั้น)
     กฎข้อนี้จึงเหลือหน้าที่สองอย่าง: แอปสมาชิกต้องไม่มีทางเข้าโหมดสาธิตเลย
     และซากของโหมดเก่า (CSDemo, demoV, demoCase, bindDemoPanel) ต้องไม่กลับมาในไฟล์ใด */
  {
    const bad = [];
    [["CareSignal-App.html", appAll],
     ["CareSignal-Staff.html", staff],
     ["CareSignal-Portfolio-Dashboard.html", read("CareSignal-Portfolio-Dashboard.html") || ""],
     ["CareSignal-Vision.html", read("CareSignal-Vision.html") || ""],
     ["index.html", read("index.html") || ""]].forEach(([nm, t]) => {
      if (/CSDemo|demoV\(|demoCase\(|bindDemoPanel/.test(t)) bad.push(nm + " ยังมีซากโหมดสาธิตชุดเก่า");
    });
    if (/cs-demo\.js|CS_DEMO/.test(appAll)) bad.push("แอปสมาชิกอ้างถึงโหมดสาธิต");
    if (/cs-demo\.js|CS_DEMO/.test(read("CareSignal-Vision.html") || "")) bad.push("Vision อ้างถึงโหมดสาธิต");
    req(7, "X-61", "โหมดสาธิตอยู่เฉพาะคอนโซลเจ้าหน้าที่และแดชบอร์ด ไม่มีในแอปสมาชิก และไม่มีซากโหมดเก่า",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ") : "แอปสมาชิกและ Vision ไม่มีทางเข้าโหมดสาธิต · ไม่พบ CSDemo/demoV/demoCase/bindDemoPanel ในไฟล์ใด");
    if (bad.length) finding("HIGH", "X-61", "ข้อมูลจำลองอาจปนเข้าแอปสมาชิก หรือซากโหมดเก่าไม่มีป้ายกำกับ",
      "ผลตรวจจริงของผู้เอาประกันปนกับข้อมูลสังเคราะห์ หรือมีเส้นทางป้อนข้อมูลปลอมที่ไม่มีแถบบอกผู้ชม",
      "ให้โหมดสาธิตอยู่ใน cs-demo.js เท่านั้น โหลดเฉพาะคอนโซลและแดชบอร์ด (X-128)");
  }

  /* ---- เสถียรภาพเสียงและ OCR (แก้ด่วนตามรายงานผู้ใช้) ---- */
  {
    const visAll = read("CareSignal-Vision.html") || "";
    const pair = [["CareSignal-App.html", appAll], ["CareSignal-Vision.html", visAll]];
    const vChecks = [
      ["X-68", "คำสั่งเสียงต้องทวนกลับและรอคำว่า ยืนยัน ก่อนทำจริง",
        (t) => t.includes("function vcDispatch(") && t.includes("var VC_NAMES=")
            && t.includes("พูดว่า ยืนยัน") && t.includes('k:"confirm"')],
      ["X-69", "ตัวกรองเสียงสะท้อนต้องหมดอายุเองเสมอ (ห้าม Infinity)",
        (t) => !t.includes("until:Infinity") && t.includes("until:Date.now()+9000")],
      ["X-70", "speak() ต้องกันพูดประโยคเดิมซ้ำ",
        (t) => t.includes("SPK.last[key]")],
      ["X-71", "OCR อ่านหลายรอบ และไม่โทษรูปเมื่อยาไม่อยู่ในฐาน",
        (t) => t.includes("function ocrVariants(") && t.includes("ไม่ใช่ปัญหาความคมชัดของรูป")],
    ];
    for (const [id, name, fn] of vChecks) {
      const bad = pair.filter(([f, t]) => !fn(t)).map(([f]) => f);
      req(7, id, name, bad.length ? "MISSING" : "PASS",
          bad.length ? ("ขาดใน " + bad.join(", ")) : "ครบทั้งแอปสมาชิกและหน้าทดลอง");
      if (bad.length) finding("HIGH", id, "เสถียรภาพเสียง/OCR ถดถอย: " + name,
        "อาการที่ผู้ใช้รายงานจริง: ระบบไม่ฟังคำสั่ง พูดซ้ำ และโทษว่ารูปไม่ชัดทั้งที่รูปคม",
        "ขาดใน " + bad.join(", "), "คืนกลไกตามหัวคอมเมนต์ของแต่ละฟังก์ชัน");
    }
  }

  /* กลไกเหล่านี้ต้องมีครบทั้งแอปสมาชิกและหน้าทดลอง — เคยพลาดใส่เฉพาะแอปเดียว
     ผู้ใช้ที่ใช้อีกแอปจึงไม่เห็นการเปลี่ยนแปลงเลย */
  /* ต้องตรวจ "แยกไฟล์" ไม่ใช่ต่อกันเป็นสายเดียว
     ถ้าต่อกัน การมีกลไกในไฟล์เดียวจะทำให้ผ่านทั้งที่อีกไฟล์ขาด
     ซึ่งเป็นความผิดพลาดที่เพิ่งเกิดจริง: ใส่หน้ารวมหัวข้อเฉพาะแอปสมาชิก
     ผู้ใช้ที่ใช้หน้าทดลองจึงไม่เห็นการเปลี่ยนแปลงเลย */
  const APP_PAIR = [["CareSignal-App.html", appAll],
                    ["CareSignal-Vision.html", read("CareSignal-Vision.html") || ""]];
  /* ---- แยกหัวข้อ · ยืนยันทีละขั้น · กันข้อมูลหาย ---- */
  {
    const hChecks = [
      ["X-72", "การประเมินแยกเป็นหัวข้อ มีหน้ารวมให้เลือกทำ (ทั้งสองแอป)",
        (t) => /var ASSESS_SECTIONS=/.test(t) && /function assessHubV\(/.test(t)
           && /assessHub:assessHubV/.test(t)],
      ["X-73", "ทุกหัวข้อจบด้วยการ์ดยืนยันก่อนไปต่อ",
        (t) => /function sectionDone\(/.test(t) && /ยืนยัน · กลับหน้ารวมหัวข้อ/.test(t)],
      ["X-74", "ร่างการประเมินถูกบันทึกลงเครื่องทุกครั้งที่ยืนยัน",
        (t) => new RegExp("^  saveDraft\\(\\);$", "m").test(t)
           && /async function saveDraft\(/.test(t)],
      ["X-75", "กู้ร่างที่ค้างได้ และร่างหมดอายุเอง",
        (t) => /มีการตรวจที่ค้างอยู่/.test(t) && /Date\.now\(\)-v\.at>864e5/.test(t)],
      ["X-76", "เขียนฐานข้อมูลครั้งเดียวตอนจบ ไม่เขียนผลค้างครึ่ง ๆ กลาง ๆ",
        (t) => !/function sectionDone\([\s\S]{0,600}CSBackend\.saveAssessment/.test(t)
           && (function(){ const m = t.match(/go\("(assessResult|result)"/); return !!m && t.slice(Math.max(0, m.index-200), m.index).indexOf("clearDraft()") >= 0; })()],
    ];
    for (const [id, name, fn] of hChecks) {
      const bad = APP_PAIR.filter(([f, t]) => !fn(t)).map(([f]) => f);
      const ok = bad.length === 0;
      req(7, id, name, ok ? "PASS" : "MISSING",
          ok ? "ครบทั้งแอปสมาชิกและหน้าทดลอง" : ("ขาดใน " + bad.join(", ")));
      if (!ok) finding("HIGH", id, "การประเมินทีละขั้นถดถอย: " + name,
        "ถ้าไม่บันทึกร่าง ผู้ใช้ที่ถูกขัดจังหวะกลางทางจะเสียข้อมูลทั้งชุดและต้องทำใหม่ 8 นาที",
        "ขาดใน " + bad.join(", "), "คืนกลไกตามหัวคอมเมนต์ของ assessHubV / sectionDone");
    }
  }

  /* ---- กล้องครึ่งจอ + ยืนยันด้วยเสียง ---- */
  {
    const fChecks = [
      ["X-77", "หน้ายืนยันใบหน้าใช้กล้องครึ่งจอ ปุ่มอยู่ครึ่งล่าง",
        (t) => /function camHalf\(/.test(t) && /height:46dvh/.test(t)
           && !(function(){ const j = t.indexOf("async function startFacePipeline");
                            return j >= 0 && t.slice(j, j+400).includes("camFullscreen") })()],
      ["X-78", "ย้ายช่องติ๊กยินยอมลงแผงด้วย ไม่ใช่ย้ายเฉพาะปุ่ม",
        (t) => t.includes('camHalf(["fcChkWrap","fcSave","fcVoiceHint","fcSkip"')],
      ["X-79", "ยืนยันด้วยเสียงได้ทั้งหน้าใบหน้าและทุกหัวข้อ",
        (t) => /function voiceConfirm\(/.test(t)
           && /voiceConfirm\({[\s\S]{0,400}onRedo:goRedo/.test(t)
           && /id="fcVoiceHint"/.test(t)],
      ["X-80", "เสียงต้องผ่านเงื่อนไขเดียวกับปุ่ม และบอกเหตุผลเมื่อยังทำไม่ได้",
        (t) => /enabled:function\(\){ return !!\(cur&&chk\.checked\)/.test(t)
           && /ยังยืนยันไม่ได้/.test(t)],
    ];
    for (const [id, name, fn] of fChecks) {
      const bad = APP_PAIR.filter(([f, t]) => !fn(t)).map(([f]) => f);
      const ok = bad.length === 0;
      req(7, id, name, ok ? "PASS" : "MISSING",
          ok ? "ครบทั้งแอปสมาชิกและหน้าทดลอง" : ("ขาดใน " + bad.join(", ")));
      if (!ok) finding("HIGH", id, "หน้ายืนยันตัวตน/เสียงถดถอย: " + name,
        "เคยเกิดจริง: กล้องเต็มจอบังช่องติ๊กยินยอม ปุ่มบันทึกจึงค้าง disabled ผู้ใช้กดไม่ได้เลย",
        "ขาดใน " + bad.join(", "), "คืนกลไกตามหัวคอมเมนต์ของ camHalf / voiceConfirm");
    }
  }

  /* ---- หน้าเปิดแอปและไอคอนติดตั้ง ---- */
  {
    let mf = null, mfs = null;
    try { mf  = JSON.parse(read("manifest.json") || "{}") } catch (e) {}
    try { mfs = JSON.parse(read("manifest-staff.json") || "{}") } catch (e) {}
    const iChecks = [
      ["X-81", "ไอคอน maskable ต้องเป็นไฟล์แยกที่มีขอบปลอดภัย ไม่ใช้ไฟล์เดียวกับไอคอนธรรมดา",
        () => {
          /* Android ครอบไอคอน maskable เป็นวงกลม กินขอบราว 20% ของแต่ละด้าน
             ถ้าใช้ไฟล์เต็มกรอบเป็น maskable โลโก้จะถูกตัด */
          for (const m of [mf, mfs]) {
            if (!m || !m.icons) return false;
            const mk = m.icons.filter(i => (i.purpose || "").includes("maskable"));
            const any = m.icons.filter(i => (i.purpose || "") === "any").map(i => i.src);
            if (!mk.length) return false;
            if (mk.some(i => any.includes(i.src))) return false;
            if (!mk.every(i => /maskable/.test(i.src))) return false;
          }
          return true;
        }],
      ["X-82", "สีพื้นหน้าเปิดแอปตรงกับ manifest ทุกแอป (ไม่กะพริบขาว-น้ำเงิน)",
        () => {
          if (!mf || mf.background_color !== mf.theme_color) return false;
          const bg = mf.background_color;
          for (const f of ["index.html", "CareSignal-App.html", "CareSignal-Vision.html"]) {
            const t = read(f) || "";
            const m = t.match(/name="theme-color" content="([^"]+)"/);
            if (!m || m[1].toUpperCase() !== bg.toUpperCase()) return false;
          }
          return true;
        }],
      ["X-83", "หน้าเปิดแอปมีโลโก้ ชื่อระบบ และตัวบอกสถานะ ไม่ใช่จอเปล่า",
        () => ["CareSignal-App.html", "CareSignal-Vision.html"].every(f => {
          const t = read(f) || "";
          return /class="boot"/.test(t) && /กำลังเปิด/.test(t) && /class="bar"/.test(t);
        })],
      ["X-84", "ทางลัดใน manifest ไม่ชี้หน้าที่เลิกใช้แล้ว",
        () => {
          const dead = /Insurer-Model|Actuarial|CareSignal-Web/;
          const all = [mf, mfs].filter(Boolean);
          return all.every(m => !(m.shortcuts || []).some(sc => dead.test(sc.url || ""))
                             && !dead.test(m.start_url || ""));
        }],
    ];
    for (const [id, name, fn] of iChecks) {
      const ok = fn();
      req(7, id, name, ok ? "PASS" : "MISSING", ok ? "ตรวจจาก manifest และซอร์สจริง" : "ไม่ตรงตามที่กำหนด");
      if (!ok) finding("MEDIUM", id, "หน้าเปิดแอป/ไอคอนไม่ได้มาตรฐาน: " + name,
        "ผู้ใช้เห็นตั้งแต่วินาทีแรกที่เปิดแอป ถ้าโลโก้ถูกครอบหรือจอกะพริบ ระบบจะดูไม่น่าเชื่อถือ",
        "ไม่ตรงตามที่กำหนด", "แก้ manifest และไอคอนให้ตรงตามที่ระบุ");
    }
  }

  /* ---- ผู้ช่วยเสียงแบบสนทนา และฐานยา ---- */
  {
    const meds = read("cs-meds.js") || "";
    const vChecks = [
      ["X-85", "ผู้ช่วยเสียงตอบคำถามได้ ไม่ใช่รับเฉพาะคำสั่งตายตัว",
        (t) => /var VC_ASK=/.test(t) && /function vcReply\(/.test(t) && /function vcAsk\(/.test(t)],
      ["X-86", "ตัดคำลงท้ายก่อนจับคำสั่ง (พูดสุภาพแล้วยังสั่งได้)",
        (t) => /function vcStrip\(/.test(t) && /vcParse\(txt\)\|\|vcParse\(vcStrip\(txt\)\)/.test(t)],
      ["X-87", "ฟังไม่เข้าใจต้องบอกว่าพูดอะไรได้ ไม่เงียบ",
        (t) => /function vcNotUnderstood\(/.test(t) && /ยังไม่เข้าใจที่พูด/.test(t)],
      ["X-88", "คำตอบด้วยเสียงเขียนไว้ล่วงหน้า ไม่เรียกโมเดลภาษาภายนอก",
        (t) => !/openai|anthropic\.com|generativelanguage|\/v1\/chat\/completions/i.test(t)],
      ["X-89", "คำตอบด้วยเสียงต้องไม่ข้ามเส้นเป็นการวินิจฉัยหรือแนะนำยา",
        (t) => {
          const m = t.match(/function vcReply\([\s\S]*?\n\}/);
          if (!m) return false;
          const body = m[0];
          if (/วินิจฉัยว่า|เป็นโรค|ควรกินยา|ให้หยุดยา|ปรับขนาดยา/.test(body)) return false;
          return /ไม่ใช่การวินิจฉัย/.test(body) && /หยุดทันที/.test(body);
        }],
    ];
    for (const [id, name, fn] of vChecks) {
      const bad = APP_PAIR.filter(([f, t]) => !fn(t)).map(([f]) => f);
      const ok = bad.length === 0;
      req(7, id, name, ok ? "PASS" : "MISSING",
          ok ? "ครบทั้งแอปสมาชิกและหน้าทดลอง" : ("ขาดใน " + bad.join(", ")));
      if (!ok) finding("HIGH", id, "ผู้ช่วยเสียงถดถอย: " + name,
        "ถ้าเสียงรับได้เฉพาะคำตายตัว ผู้สูงอายุที่พูดไม่ตรงรูปแบบจะใช้ไม่ได้เลย " +
        "และถ้าคำตอบข้ามเส้นไปเป็นคำแนะนำทางการแพทย์ จะขัดกับขอบเขตที่ระบบประกาศไว้",
        "ขาดใน " + bad.join(", "), "คืนกลไกตามหัวคอมเมนต์ของ vcReply / vcAsk");
    }

    /* ฐานยาต้องครอบคลุมฉลากที่พบจริง — เคยตอบว่า "ไม่รู้จักยานี้" กับยาสามัญ */
    const need = ["montelukast", "procaterol", "acetylcysteine", "dextromethorphan",
                  "guaifenesin", "multivitamin"];
    const miss = need.filter(k => meds.indexOf(String.fromCharCode(91,34) + k + String.fromCharCode(34)) < 0);
    req(7, "X-90", "ฐานยาครอบคลุมตัวยาที่พบบนฉลากจริงของผู้ใช้",
        miss.length ? "MISSING" : "PASS",
        miss.length ? ("ขาด: " + miss.join(", ")) : "ครบตามฉลากที่ทดสอบ");
    if (miss.length) finding("MEDIUM", "X-90", "ฐานยาไม่ครอบคลุมฉลากที่พบจริง",
      "ผู้ใช้ถ่ายฉลากชัดแล้วระบบยังบอกว่าไม่รู้จักยา ทำให้เข้าใจผิดว่าถ่ายรูปไม่ดี",
      "ขาด: " + miss.join(", "), "เพิ่มตัวยาพร้อมรหัส ATC และกลุ่มเสี่ยงตาม STOPPFall");

    /* ต้องแยกออกว่า OCR อ่านเป็นขยะ กับ อ่านได้แต่ไม่รู้จักยา */
    const okReadable = APP_PAIR.every(([f, t]) => /function ocrLooksReadable\(/.test(t));
    req(7, "X-91", "แยกได้ว่า OCR อ่านเป็นขยะ หรืออ่านได้แต่ไม่รู้จักยา",
        okReadable ? "PASS" : "MISSING",
        okReadable ? "ocrLooksReadable ตรวจว่ามีคำจริงพอ" : "ยังนับแค่จำนวนอักขระ");
    if (!okReadable) finding("MEDIUM", "X-91", "ระบบโทษรูปทั้งที่อ่านไม่ออกจริง",
      "นับแค่จำนวนอักขระ ทำให้ขยะผ่านเกณฑ์ แล้วบอกผู้ใช้ผิดสาเหตุ",
      "ไม่พบ ocrLooksReadable", "ตรวจว่ามีคำอังกฤษหรือไทยยาวพอ ไม่ใช่แค่นับตัวอักษร");

    /* จำนวนตัวยาที่บอกผู้ใช้ ต้องตรงกับจำนวนจริงในฐาน
       เคยค้างที่ 155 หลังขยายฐานเป็น 170 — เภสัชกรอ่านแล้วเข้าใจขนาดฐานผิด */
    const realCount = (meds.match(/^\s*\[".+?",\s*"[A-Z]\d\d[A-Z]?[A-Z]?\d*"/gm) || []).length;
    const claimed = [];
    for (const [f, t] of APP_PAIR.concat([["CareSignal-Staff.html", read("CareSignal-Staff.html") || ""]])) {
      for (const m of t.matchAll(/(\d{2,4})\s*ตัวยา/g)) if (+m[1] !== realCount) claimed.push(f + ":" + m[1]);
    }
    const countOk = realCount > 0 && claimed.length === 0;
    req(7, "X-92", "จำนวนตัวยาที่แจ้งผู้ใช้ตรงกับฐานจริง",
        countOk ? "PASS" : "MISMATCH",
        countOk ? ("ฐาน " + realCount + " ตัวยา ตรงกันทุกหน้า")
                : ("ฐานจริง " + realCount + " แต่หน้าจอบอก " + claimed.join(" · ")));
    if (!countOk) finding("LOW", "X-92", "ตัวเลขขนาดฐานยาบนหน้าจอค้างของเก่า",
      "เภสัชกรใช้ตัวเลขนี้ตัดสินว่ายาที่ไม่รู้จักแปลว่าอะไร ถ้าค้างจะเข้าใจขนาดฐานผิด",
      claimed.join(" · ") || "นับตัวยาในฐานไม่ได้", "แก้ให้ตรงกับจำนวนจริงในไฟล์ cs-meds.js");
  }


  /* ============================================================
     ชั้นที่ต่อกับทะเบียนตำรับยาของ อย. และการแนบรูปฉลากยา
     ------------------------------------------------------------
     ทั้งสองอย่างนี้เป็นครั้งแรกที่ระบบส่งข้อมูลออกไปนอกเครื่องผู้ใช้
     (ชื่อยาไปที่ อย. · รูปฉลากขึ้น storage) จึงต้องมีกฎกำกับให้ชัด
     ============================================================ */
  {
    const fnPath = "supabase/functions/drug-lookup/index.ts";
    const fn = read(fnPath) || "";

    /* ---- X-93: ทั้งสองแอปต้องมีชั้นค้นทะเบียน ไม่ใช่แอปเดียว ---- */
    const regChecks = [
      ["X-93", "แอปมีชั้นค้นทะเบียนตำรับยา อย. เมื่อฐานในเครื่องไม่รู้จัก",
        (t) => /function\s+askRegistry\s*\(/.test(t) && /function\s+registryBox\s*\(/.test(t),
        "ยาที่ฐาน 170 ตัวไม่รู้จักจะตันอยู่แค่นั้น ทั้งที่ทะเบียนราชการอาจรู้"],
      ["X-94", "ยาที่ไม่มีใครจัดกลุ่มได้ต้องเข้าคิวเภสัชกร ไม่ค้างเป็น unknown เฉย ๆ",
        (t) => /queueUnknownDrug\s*\(/.test(t),
        "ยาที่ระบบไม่รู้จักจะค้างในรายการโดยไม่มีใครตามต่อ"],
      ["X-95", "หน้าจอบอกที่มาของการจัดกลุ่มยาแต่ละรายการ",
        (t) => /function\s+srcBadge\s*\(/.test(t) && /ทะเบียนตำรับยา อย\./.test(t),
        "ผู้ใช้และเภสัชกรแยกไม่ออกว่ากลุ่มที่เห็นมาจากฐานที่คนตรวจแล้ว หรือจากกฎอัตโนมัติ"],
    ];
    for (const [id, name, fnTest, why] of regChecks) {
      const bad = APP_PAIR.filter(([f, t]) => !fnTest(t)).map(([f]) => f);
      req(7, id, name, bad.length ? "MISSING" : "PASS",
          bad.length ? ("ขาดใน " + bad.join(" · ")) : "ครบทั้งสองแอป");
      if (bad.length) finding("MEDIUM", id, name, why, bad.join(" · "),
        "ใส่ให้ครบทั้ง CareSignal-App.html และ CareSignal-Vision.html");
    }

    /* ---- X-96: รูปฉลากยาต้องไม่ขึ้นระบบก่อนได้รับความยินยอม ----
       ตรวจตำแหน่งจริงในโค้ด ไม่ใช่แค่ว่ามีคำว่า photoConsent อยู่ที่ไหนสักแห่ง */
    const consentBad = APP_PAIR.filter(([f, t]) => {
      const up = t.indexOf("CSBackend.uploadMedPhoto");
      if (up < 0) return true;
      const guard = t.lastIndexOf("m.photoConsent", up);
      return guard < 0 || (up - guard) > 200;
    }).map(([f]) => f);
    req(7, "X-96", "อัปโหลดรูปฉลากยาเฉพาะเมื่อผู้ใช้ติ๊กยินยอม",
        consentBad.length ? "MISSING" : "PASS",
        consentBad.length ? ("ไม่พบการตรวจความยินยอมก่อนอัปโหลดใน " + consentBad.join(" · "))
                          : "มีการตรวจความยินยอมก่อนอัปโหลดทั้งสองแอป");
    if (consentBad.length) finding("HIGH", "X-96", "ส่งรูปฉลากยาขึ้นระบบโดยไม่ได้ถาม",
      "รูปฉลากยาเป็นข้อมูลสุขภาพ การส่งออกจากเครื่องโดยไม่ถามขัดกับที่ประกาศไว้บนหน้าเว็บ",
      consentBad.join(" · "), "ตรวจ m.photoConsent ก่อนเรียก uploadMedPhoto");

    /* ---- X-97: ร่างที่เก็บในเครื่องต้องไม่มีรูปฉลากยา ---- */
    const draftBad = APP_PAIR.filter(([f, t]) => !/delete\s+x\.thumb/.test(t)).map(([f]) => f);
    req(7, "X-97", "ถอดรูปฉลากออกจากร่างก่อนบันทึกลงเครื่อง",
        draftBad.length ? "MISSING" : "PASS",
        draftBad.length ? ("ขาดใน " + draftBad.join(" · ")) : "ถอดรูปย่อออกก่อนบันทึกร่าง");
    if (draftBad.length) finding("MEDIUM", "X-97", "รูปฉลากยาติดไปกับร่างใน localStorage",
      "ร่างเก็บในเครื่องแบบไม่เข้ารหัสและอยู่ยาว ไม่ควรมีภาพข้อมูลสุขภาพ",
      draftBad.join(" · "), "ลบฟิลด์ thumb ก่อนเขียนร่าง");

    /* ---- X-98: ตัวกันจับคู่ผิดกับทะเบียน ----
       ทะเบียน อย. ค้นแบบ substring · ตอนทดสอบพบว่าค้น ZOLAM แล้วได้ DORZOLAMIDE
       ถ้าไม่มีตัวกรองนี้ ยานอนหลับจะถูกจัดเป็นยาหยอดตาแล้วสัญญาณเสี่ยงหายไป */
    const guardOk = /function\s+nameMatches\s*\(/.test(fn) && /q\.length\s*<\s*4/.test(fn)
                    && /nameMatches\(name,/.test(fn);
    req(7, "X-98", "กันการจับคู่ผิดจากการค้นแบบมีคำอยู่กลางชื่อ",
        guardOk ? "PASS" : "MISSING",
        guardOk ? "nameMatches กรองก่อนใช้ผลจากทะเบียน" : "ไม่พบตัวกรองชื่อ หรือกรองไม่ครบ");
    if (!guardOk) finding("HIGH", "X-98", "ผลจากทะเบียนถูกใช้โดยไม่ตรวจว่าชื่อตรงกันจริง",
      "ค้น ZOLAM แล้วได้ DORZOLAMIDE ซึ่งเป็นยาหยอดตา จับคู่ผิดทำให้กลุ่มเสี่ยงผิดตามไปด้วย",
      fnPath, "กรองด้วย nameMatches และไม่รับคำค้นสั้นกว่า 4 ตัวอักษร");

    /* ---- X-99: ตัวกลางต้องไม่ส่งตัวตนผู้ใช้ออกไปนอกระบบ ---- */
    const bodySafe = /body:\s*\{\s*name:\s*q\s*\}/.test(read("cs-backend.js") || "");
    const noIdOut = !/user_id|auth\.uid|jwt/i.test(fn.slice(fn.indexOf("async function soap"),
                                                            fn.indexOf("Deno.serve")));
    const privacyOk = bodySafe && noIdOut;
    req(7, "X-99", "ส่งออกไปที่ อย. เฉพาะชื่อยา ไม่มีตัวตนผู้ใช้",
        privacyOk ? "PASS" : "RISK",
        privacyOk ? "ตัวเรียกส่งเฉพาะฟิลด์ name" : "พบการส่งข้อมูลอื่นออกไปด้วย");
    if (!privacyOk) finding("HIGH", "X-99", "ส่งข้อมูลระบุตัวตนไปยังหน่วยงานภายนอก",
      "ชื่อยาไม่ระบุตัวบุคคล แต่ถ้าพ่วง user id ไปด้วยจะกลายเป็นการเปิดเผยข้อมูลสุขภาพรายบุคคล",
      fnPath, "ส่งเฉพาะ {name} และอย่าบันทึกผู้ค้นลงตารางแคช");
  }

  /* ---- X-100: คะแนนเต็มที่เขียนกำกับต้องตรงกับคะแนนเต็มจริง ----
     ระบบเปลี่ยนฐานคะแนนจาก 12 เป็น 9 แต่ข้อความกำกับกราฟค้างอยู่ที่ 12
     ผลคือหน้าจอเดียวกันขึ้น "2 / 9" ข้างบน และ "เต็ม 12" ข้างล่าง */
  {
    const bad = APP_PAIR.filter(([f, t]) => /เต็ม\s*12/.test(t)).map(([f]) => f);
    req(7, "X-100", "คะแนนเต็มที่เขียนกำกับตรงกับฐานคะแนนจริง (9)",
        bad.length ? "MISMATCH" : "PASS",
        bad.length ? ("ยังเขียนว่าเต็ม 12 ใน " + bad.join(" · ")) : "ไม่มีข้อความค้างที่ 12");
    if (bad.length) finding("MEDIUM", "X-100", "หน้าจอบอกคะแนนเต็มสองค่าพร้อมกัน",
      "ผู้ใช้และเจ้าหน้าที่อ่านคะแนนผิดสเกล และทำให้ตัวเลขบนสไลด์นำเสนอขัดกันเอง",
      bad.join(" · "), "แก้ข้อความกำกับให้ตรงกับ max ที่ lineChart ใช้จริง");
  }

  /* ---- X-101: ช่วงอายุต้องครอบคลุมประชากรที่ระบบให้บริการ ----
     เดิมช่วงบนสุดเป็น "66–70" แบบรับทุกอายุที่เหลือ คนอายุ 72 หรือ 85
     จึงถูกรายงานให้บริษัทประกันว่าอยู่ช่วง 66–70 ซึ่งผิดตรง ๆ
     และป้ายช่วงอายุที่ใช้กำกับเกณฑ์คลินิกต้องแบ่งตรงกับ ftsstCut (60 และ 70) */
  {
    const bandBad = APP_PAIR.filter(([f, t]) => {
      const m = /ageBand:function\(a\)\{return ([^;]+);\}/.exec(t);
      if (!m) return true;
      return !/80/.test(m[1]);            /* ต้องมีช่วงถึง 80 ขึ้นไป */
    }).map(([f]) => f);
    req(7, "X-101", "ช่วงอายุที่รายงานครอบคลุมผู้สูงอายุเกิน 70 ปี",
        bandBad.length ? "MISSING" : "PASS",
        bandBad.length ? ("ช่วงอายุยังตันก่อน 80 ใน " + bandBad.join(" · ")) : "ครอบคลุมถึง 80+");
    if (bandBad.length) finding("MEDIUM", "X-101", "ช่วงอายุบนสุดรับทุกอายุที่เหลือ",
      "ผู้สูงอายุ 72 หรือ 85 ถูกรายงานว่าอยู่ช่วงเดียวกับคน 66 ปี แดชบอร์ดจึงไม่มีใครเกิน 70",
      bandBad.join(" · "), "แบ่งช่วงให้ครอบคลุมถึง 80+");

    const clinBad = APP_PAIR.filter(([f, t]) =>
      !/ftsstBand:function/.test(t) || /เกณฑ์ของช่วงอายุ "\+CFG\.ageBand/.test(t)).map(([f]) => f);
    req(7, "X-102", "ป้ายเกณฑ์เวลาลุกนั่งแบ่งช่วงตรงกับค่าตัดเกณฑ์",
        clinBad.length ? "MISMATCH" : "PASS",
        clinBad.length ? ("ยังใช้ช่วงอายุของรายงานมากำกับเกณฑ์คลินิกใน " + clinBad.join(" · "))
                       : "ใช้ ftsstBand ซึ่งแบ่งที่ 60 และ 70");
    if (clinBad.length) finding("MEDIUM", "X-102", "ป้ายช่วงอายุไม่ตรงกับเกณฑ์ที่แสดงคู่กัน",
      "หน้าจอขึ้นว่าเกณฑ์ของช่วง 66–70 คือ 12.1 วินาที ทั้งที่ 12.1 เป็นเกณฑ์ของคน 70 ปีขึ้นไป",
      clinBad.join(" · "), "ใช้ ftsstBand ที่แบ่งตรงกับ ftsstCut");
  }

  /* ---- X-103: ค่าตัดเกณฑ์ลุกนั่งต้องตรงกับงานต้นทาง ----
     Poncumhak 2557 ระบุ 11.50 วินาทีสำหรับอายุ 65–74 ปี และ 12.10 วินาทีสำหรับ 75 ปีขึ้นไป
     เคยเขียนผิดเป็นแบ่งที่ 60/70 ทำให้คนอายุ 70–74 ถูกใช้เกณฑ์ 12.1 คือปักธงต่ำกว่าหลักฐาน */
  {
    const bad = APP_PAIR.filter(([f, t]) =>
      !/age<65\?10\.0:\(age<75\?11\.5:12\.1\)/.test(t.replace(/\s/g, ""))).map(([f]) => f);
    req(7, "X-103", "ค่าตัดเกณฑ์ลุกนั่งแบ่งช่วงอายุตามงานวิจัยต้นทาง (65–74 · 75+)",
        bad.length ? "MISMATCH" : "PASS",
        bad.length ? ("แบ่งช่วงไม่ตรงกับงานต้นทางใน " + bad.join(" · ")) : "11.5 ที่ 65–74 · 12.1 ที่ 75+");
    if (bad.length) finding("HIGH", "X-103", "ใช้ค่าตัดเกณฑ์ลุกนั่งผิดช่วงอายุ",
      "คนอายุ 70–74 ถูกใช้เกณฑ์ 12.1 ทั้งที่งานวิจัยไทยระบุ 11.5 ระบบจึงพลาดคนกลุ่มนี้",
      bad.join(" · "), "ตั้งค่าเป็น age<65?10.0:(age<75?11.5:12.1)");
  }

  /* ---- X-104: ด่านกันระบบสั่งตัวเอง ต้องอยู่หน้าการตัดสินใจเสียงเสมอ ----
     อาการจริงที่เคยเกิด: ระบบพูด → ไมค์ได้ยินเสียงตัวเองแบบถอดความเพี้ยน →
     ตัวกรองข้อความจับไม่ได้ → เข้าชั้นถาม-ตอบ → ระบบพูดอีก → วนลูปคุยกับตัวเอง
     ด่านที่ต้องมี: หน้าต่างเวลาที่ระบบกำลังพูด (SPK.until)
     เดิมกฎนี้บังคับชั้น VAD ที่เปิดไมค์เส้นที่สองด้วย ถอดข้อบังคับนั้นออกแล้ว
     เพราะวัดบนเครื่องจริงพบว่าไม่เคยเปิดติด (ready=false) แต่ยังแย่งสิทธิ์ไมค์
     กับตัวรู้จำเสียงบนมือถือ คือได้ความเสี่ยงมาโดยไม่ได้ประโยชน์
     เพิ่มการล็อกค่าประมาณเวลาพูด ไม่ให้กลับไปยาวจนระบบปิดหูตัวเองหลายวินาที
     (เคยวัดได้ 9.66 วินาทีต่อการประกาศหนึ่งครั้ง ผู้ใช้พูดตอบแล้วหายไปทั้งหมด) */
  {
    const bad = APP_PAIR.filter(([f, t]) => {
      const okFns = /function\s+vcBlockedBy\s*\(/.test(t)
        && /SPK\.until=now\+800\+text\.length\*75;/.test(t);
      const di = t.indexOf("function vcDispatch(");
      if (di < 0 || !okFns) return true;
      const head = t.slice(di, di + 600);
      return !head.includes("var blocked=vcBlockedBy();");
    }).map(([f]) => f);
    req(7, "X-104", "ด่านกันระบบพูดใส่ตัวเอง ต่อไว้หน้า vcDispatch และไม่ปิดหูนานเกินไป",
        bad.length ? "MISSING" : "PASS",
        bad.length ? ("ขาดหรือไม่ได้ต่อไว้ใน " + bad.join(" · ")) : "ครบทั้งสองแอป และเรียกก่อนตัดสินใจ");
    if (bad.length) finding("HIGH", "X-104", "การตัดสินใจเสียงไม่ผ่านด่านกันสั่งตัวเอง",
      "ระบบจะกลับไปตอบเอง/ทำงานเองจากเสียงตัวเองหรือเสียงแวดล้อม ซึ่งเป็นอาการที่ผู้ใช้เคยแจ้งจริง",
      bad.join(" · "), "เรียก vcBlockedBy() ที่ต้น vcDispatch และเปิด vadStart คู่กับไมค์เสมอ");
  }

  /* ---- X-105: ปุ่ม "ติดตั้งเป็นแอป" ในหน้าแรกต้องกดได้จริง ----
     บั๊กจริงที่เคยเกิด: หน้าแรกเขียนคำว่า "ติดตั้งเป็นแอป" ไว้ในการ์ดคำมั่น
     แต่เป็นข้อความประดับ ไม่ใช่ปุ่ม ผู้ใช้กดแล้วเงียบ และทั้งหน้าไม่มีทาง
     ติดตั้งเลย จึงสรุปว่าติดตั้งไม่ได้
     สิ่งที่ต้องมี: เป็น <button> จริง · มีตัวรับการกด · รู้จักเบราว์เซอร์ใน
     แอปแชทซึ่งติดตั้งไม่ได้เลย (ทางที่คนไทยเปิดลิงก์มากที่สุด) · มีคำแนะนำ
     ทำมือครบทั้ง iOS / Android / คอมพิวเตอร์ เผื่อเบราว์เซอร์ไม่ให้ปุ่มอัตโนมัติ */
  {
    const t = read("index.html");
    const miss = [];
    if (!/<button[^>]*id="csInstall"/.test(t)) miss.push("ปุ่มไม่ใช่ <button> ที่มี id=csInstall");
    if (!/getElementById\("csInstall"\)/.test(t)) miss.push("ไม่มีสคริปต์ผูกกับปุ่ม");
    if (!/btn\.addEventListener\("click"/.test(t)) miss.push("ปุ่มไม่มีตัวรับการกด");
    if (!/beforeinstallprompt/.test(t)) miss.push("ไม่รับ beforeinstallprompt");
    const inApp = (/var inApp = ([^;]+);/.exec(t) || [])[1] || "";
    if (!/FB_IAB|FBAN/.test(inApp) || !/Line/.test(inApp)) miss.push("ไม่รู้จักเบราว์เซอร์ในแอปแชท");
    for (const [nm, re] of [["iOS", /ติดตั้งบน iPhone/], ["Android", /ติดตั้งบน Android/],
                            ["คอมพิวเตอร์", /ติดตั้งบนคอมพิวเตอร์/], ["ในแอปแชท", /เปิดในเบราว์เซอร์ก่อน/]])
      if (!re.test(t)) miss.push("ไม่มีคำแนะนำสำหรับ " + nm);
    req(7, "X-105", "ปุ่มติดตั้งเป็นแอปในหน้าแรกกดได้จริงทุกเบราว์เซอร์",
        miss.length ? "MISSING" : "PASS",
        miss.length ? miss.join(" · ") : "เป็นปุ่มจริง มีตัวรับการกด และมีคำแนะนำครบทุกแพลตฟอร์ม");
    if (miss.length) finding("MEDIUM", "X-105", "หน้าแรกติดตั้งเป็นแอปไม่ได้",
      "ผู้ใช้กดแล้วไม่มีอะไรเกิดขึ้น จะเข้าใจว่าระบบพัง และไม่ได้ความสามารถใช้ออฟไลน์ที่โฆษณาไว้",
      "index.html · " + miss.join(" · "),
      "ทำให้ #csInstall เป็นปุ่มจริงที่มีตัวรับการกด และมีคำแนะนำทำมือครบทุกแพลตฟอร์ม");
  }

  /* ---- X-106: หน้าตรวจร่างกายต้องสั่งด้วยเสียงแบบทีละขั้น ----
     บั๊กจริงที่ผู้ใช้เจอ: คำสั่งเกือบทุกคำถูกส่งเข้าการทวนให้ยืนยัน ซึ่งพูด
     ประโยคยาวราว 45 ตัวอักษร ด่านกันฟังเสียงตัวเองจึงปิดหูระบบไปราว 5.2 วินาที
     คนที่ตอบ "ยืนยัน" ทันทีตามธรรมชาติถูกทิ้งเงียบ ๆ พอพูดซ้ำคำสั่งก็หมดอายุแล้ว
     ผู้ใช้เห็นเป็น "พูดแล้วระบบไม่ฟังเลย"
     สิ่งที่ต้องมี: ตัวจับรูปแบบคำ · เครื่องสถานะขั้นตอน · ต่อไว้หน้า vcDispatch
     และทั้งสี่หน้าวัดผลต้องประกาศขั้นตอนจริง ไม่ใช่ฟังลอย ๆ
     ห้ามเรียกโมเดลภาษาหรือบริการเสียงภายนอกในเส้นทางนี้ */
  {
    const bad = APP_PAIR.filter(([f, t]) => {
      const core = /var VC_INTENT=/.test(t) && /function\s+vcIntent\s*\(/.test(t)
        && /function\s+stepBegin\s*\(/.test(t) && /function\s+stepHear\s*\(/.test(t)
        && /function\s+stepStop\s*\(/.test(t);
      const di = t.indexOf("function vcDispatch(");
      if (di < 0 || !core) return true;
      /* ต้องต่อไว้ในช่วงต้นของ vcDispatch จริง ไม่ใช่แค่มีฟังก์ชันลอยอยู่ */
      if (!t.slice(di, di + 1200).includes("var hit=stepHear(txt);")) return true;
      /* ทั้งสี่หน้าวัดผลต้องประกาศขั้นตอนของตัวเอง */
      for (const id of ['id:"calSit"', 'id:"calStand"', 'id:"ftsst"', 'id:"tug"', 'id:"balConfirm"'])
        if (!t.includes(id)) return true;
      /* ลำดับการจับคำ: ไม่ผ่าน/ไม่ได้ยิน ต้องมาก่อน ผ่าน/ไม่ได้ ไม่งั้นบันทึกผลผิด */
      const iv = t.indexOf("var VC_INTENT=");
      const blk = t.slice(iv, t.indexOf("];", iv));
      if (blk.indexOf('"fail"') > blk.indexOf('"pass"')) return true;
      if (blk.indexOf('"repeat"') > blk.indexOf('"fail"')) return true;
      if (blk.indexOf('"redo"') > blk.indexOf('"start"')) return true;
      return false;
    }).map(([f]) => f);
    req(7, "X-106", "สั่งงานด้วยเสียงแบบทีละขั้น พูดแล้วทำทันที ไม่ต้องยืนยันซ้ำ",
        bad.length ? "MISSING" : "PASS",
        bad.length ? ("ขาดหรือต่อไม่ครบใน " + bad.join(" · "))
                   : "ครบทั้งสองแอป ทุกหน้าวัดผลประกาศขั้นตอน และลำดับการจับคำถูกต้อง");
    if (bad.length) finding("HIGH", "X-106", "การสั่งงานด้วยเสียงกลับไปเป็นแบบทวนให้ยืนยัน",
      "ประโยคทวนยาวทำให้ด่านกันฟังเสียงตัวเองปิดหูระบบหลายวินาที ผู้ใช้พูดแล้วไม่มีอะไรเกิดขึ้น",
      bad.join(" · "),
      "ประกาศขั้นตอนด้วย stepBegin ในทุกหน้าวัดผล และเรียก stepHear ที่ต้น vcDispatch");
  }

  /* ---- X-107: ไม่เพิ่มบริการเสียงของบุคคลที่สามนอกเหนือจากของเบราว์เซอร์ ----
     ข้อความเดิมของกฎนี้เขียนว่า "การรู้จำเสียงทำในเครื่อง ไม่ส่งเสียงออกนอกเครื่อง"
     ซึ่งไม่จริงและต้องแก้ เพราะข้อความนี้ไปโผล่ในรายงานตรวจสอบที่ส่งกรรมการ
     Web Speech API ของ Chrome ส่งเสียงไปถอดความที่เซิร์ฟเวอร์ของ Google
     ตรวจบนเครื่องจริงแล้ว SpeechRecognition.available({processLocally:true,
     langs:["th-TH"]}) คืน "unavailable" ส่วนแบบผ่านเซิร์ฟเวอร์คืน "available"
     คือเส้นทางที่ระบบใช้อยู่จริง — ภาษาไทยยังไม่มีชุดถอดความในเครื่องให้ใช้

     สิ่งที่กฎนี้รับประกันได้จริงมีสองข้อ
       1. ไม่มีการเพิ่มบริการเสียงของบุคคลที่สามนอกเหนือจากที่เบราว์เซอร์ทำเอง
          ผู้ใช้จึงเปิดเผยเสียงต่อผู้ให้บริการเบราว์เซอร์ที่ตัวเองเลือกเท่านั้น
          ไม่ใช่ต่อคู่สัญญาเพิ่มอีกรายที่ไม่ได้ตกลงด้วย
       2. ไม่มีการต่อโมเดลภาษาให้ตอบอิสระ ซึ่งเป็นคำมั่นที่ประกาศไว้ในหน้าเว็บ
     สิ่งที่ประกาศต่อผู้ใช้ได้ว่าไม่ออกจากเครื่องคือภาพและวิดีโอ ไม่ใช่เสียง */
  {
    const HOSTS = /ai-coustics|krisp\.ai|soniox|assemblyai|deepgram|api\.openai|speechmatics/i;
    const bad = APP_PAIR.filter(([f, t]) => HOSTS.test(t)).map(([f]) => f);
    req(7, "X-107", "ไม่เพิ่มบริการเสียงบุคคลที่สามนอกเหนือจากของเบราว์เซอร์",
        bad.length ? "FAIL" : "PASS",
        bad.length ? ("พบการอ้างบริการเสียงภายนอกใน " + bad.join(" · "))
                   : "ใช้ Web Speech API ของเบราว์เซอร์เท่านั้น (ซึ่งถอดความที่เซิร์ฟเวอร์ของผู้ให้บริการเบราว์เซอร์)");
    if (bad.length) finding("HIGH", "X-107", "เพิ่มบริการเสียงของบุคคลที่สามเข้ามา",
      "ผู้ใช้จะถูกส่งเสียงไปให้คู่สัญญาอีกรายที่ไม่ได้ตกลงด้วย และต้องแก้คำอธิบายความเป็นส่วนตัวให้ตรงด้วย",
      bad.join(" · "), "ถ้าจำเป็นต้องใช้จริง ต้องแจ้งผู้ใช้และแก้หน้าอธิบายความเป็นส่วนตัวให้ตรงก่อน");
  }

  /* ---- X-108: ปลายทางการเปลี่ยนหน้าต้องมีอยู่จริง ----
     บั๊กจริงที่ผู้ใช้เจอ: จบการสอบเทียบท่านั่ง/ท่ายืนแล้วสั่ง go("test")
     แต่หน้าจอในไฟล์นั้นลงทะเบียนชื่อ "camtest" การค้นหาในตาราง render จึงพลาด
     และตกกลับไปหน้าแรกด้วย ||homeV แบบเงียบสนิท ผู้ใช้เห็นเป็น "โปรแกรมตัดจบ"
     ขั้นลุกนั่ง 5 ครั้งเข้าไม่ถึงเลยและไม่มีค่าใดถูกบันทึก
     สองแอปตั้งชื่อหน้าไม่เหมือนกัน การคัดลอกโค้ดข้ามไฟล์จึงพลาดแบบนี้ได้ง่าย
     กฎนี้จับทั้งคลาสของบั๊ก ไม่ใช่แค่กรณีเดียว */
  {
    const bad = [];
    for (const [f, t] of APP_PAIR) {
      const m = /var fn=\{([\s\S]{0,4000}?)\}\[S\.screen\]/.exec(t);
      if (!m) { bad.push(f + " (หาตารางหน้าจอไม่เจอ)"); continue; }
      const keys = new Set((m[1].match(/([A-Za-z]+)\s*:/g) || []).map(x => x.replace(/\s*:$/, "")));
      const miss = new Set();
      /* ตัดคอมเมนต์ออกก่อนสแกน — ตัดทีละบรรทัดไม่พอ เพราะคอมเมนต์อธิบายบั๊กนี้
         เองก็มีคำว่า go("test") อยู่กลางย่อหน้า และบรรทัดกลางไม่ได้ขึ้นต้นด้วย * */
      const code = t.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");
      for (const g of code.match(/go\("([A-Za-z]+)"/g) || []) {
        const k = g.slice(4, -1);
        if (!keys.has(k)) miss.add(k);
      }
      if (miss.size) bad.push(f + " → " + [...miss].join(", "));
    }
    req(7, "X-108", "ทุกปลายทาง go() มีหน้าจอรองรับจริง ไม่ตกกลับหน้าแรกเงียบ ๆ",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ") : "ปลายทางทุกจุดตรงกับตารางหน้าจอของไฟล์นั้น");
    if (bad.length) finding("HIGH", "X-108", "สั่งเปลี่ยนไปหน้าจอที่ไม่มีอยู่",
      "ระบบตกกลับหน้าแรกโดยไม่มีอะไรแจ้ง ขั้นตอนที่ค้างอยู่หายไปพร้อมข้อมูลที่ยังไม่บันทึก",
      bad.join(" · "), "ใช้ชื่อหน้าจอที่ลงทะเบียนไว้ในตาราง render ของไฟล์นั้น");
  }

  /* ---- X-109: ติดตั้งแล้วกดไอคอนต้องเข้าตัวแอป ไม่ใช่หน้าเว็บนำเสนอ ----
     ผู้ใช้แจ้งว่ากดไอคอนแล้วไปโผล่หน้าเบราว์เซอร์ ต้องกดผ่านหน้าเว็บอีกทอด
     ต้นเหตุ: manifest ตั้ง start_url ไว้ที่ index.html ซึ่งเป็นหน้านำเสนอ
     และ index.html ไม่มีเมตาเต็มจอของ iOS ถ้าติดตั้งจากหน้านั้นบน iPhone
     ระบบจะเปิดใน Safari พร้อมแถบที่อยู่เว็บ เห็นเป็นเบราว์เซอร์ชัด ๆ */
  {
    const miss = [];
    let mf = null;
    try { mf = JSON.parse(read("manifest.json")); }
    catch (e) { miss.push("อ่าน manifest.json ไม่ได้"); }
    if (mf) {
      if (mf.start_url !== "./CareSignal-App.html")
        miss.push('start_url ต้องเป็นตัวแอป ไม่ใช่ ' + mf.start_url);
      if (mf.display !== "standalone") miss.push("display ต้องเป็น standalone");
      /* id ต้องคงเดิม เปลี่ยนเมื่อไหร่เบราว์เซอร์นับเป็นแอปตัวใหม่แล้วขึ้นไอคอนซ้ำ */
      if (mf.id !== "./index.html") miss.push("id เปลี่ยนไป จะเกิดไอคอนซ้ำบนเครื่องผู้ใช้");
    }
    const idx = read("index.html");
    for (const [nm, needle] of [
      ["เมตาเต็มจอ iOS", 'name="apple-mobile-web-app-capable" content="yes"'],
      ["เมตาเต็มจอ Android", 'name="mobile-web-app-capable" content="yes"'],
      ["ตัวพาเข้าแอปเมื่อเปิดจากไอคอน", 'location.replace("./CareSignal-App.html")'],
      ["ตัวกันวนลูปเปลี่ยนเส้นทาง", 'sessionStorage.setItem("cs:toapp"'],
    ]) if (!idx.includes(needle)) miss.push("index.html ขาด" + nm);
    if (!read("sw.js").includes('"./CareSignal-App.html"'))
      miss.push("service worker ไม่ได้แคชตัวแอป เปิดออฟไลน์จากไอคอนจะพัง");
    req(7, "X-109", "ติดตั้งแล้วกดไอคอนเข้าตัวแอปเลย ไม่ผ่านหน้าเว็บนำเสนอ",
        miss.length ? "FAIL" : "PASS",
        miss.length ? miss.join(" · ") : "start_url ชี้ตัวแอป เต็มจอทั้งสองระบบ และมีตัวพาเข้าแอปสำหรับเครื่องที่ติดตั้งไว้ก่อน");
    if (miss.length) finding("MEDIUM", "X-109", "แอปที่ติดตั้งแล้วเปิดมาเป็นหน้าเว็บ",
      "ผู้ใช้สูงอายุต้องกดผ่านหน้าเว็บอีกทอดกว่าจะถึงการตรวจ และเห็นแถบเบราว์เซอร์จนไม่รู้สึกว่าเป็นแอป",
      miss.join(" · "), "ตั้ง start_url ไปที่ CareSignal-App.html และใส่เมตาเต็มจอในหน้าเว็บด้วย");
  }

  /* ---- X-110: เสียงต้องไม่ใช่ทางเดียวที่ทำให้การตรวจเดินหน้าได้ ----
     ผู้ใช้เจอปัญหาสั่งเสียงไม่ติดซ้ำ ๆ จนตรวจไม่จบ ต้นเหตุคือทั้งสี่หน้าวัดผล
     ถูกตั้งให้ "ประกาศแล้วรอคำสั่งเสียง" พอเสียงพลาดก็ค้างตรงนั้นถาวร
     Web Speech API ส่งเสียงไปถอดความที่เซิร์ฟเวอร์ (ไทยไม่มีชุดในเครื่อง)
     จึงพึ่งเป็นทางเดียวไม่ได้ — กล้องที่เปิดอยู่แล้วเชื่อถือได้กว่า
     ทุกหน้าต้องนับถอยหลังแล้วลงมือเองเมื่อกล้องเห็นว่าผู้ใช้อยู่ในท่าพร้อม
     และต้องยกเลิกได้ เพราะผู้ใช้เคยสะท้อนว่าระบบเริ่มทั้งที่ยังไม่พร้อม */
  {
    const bad = APP_PAIR.filter(([f, t]) => {
      /* ตัวนับถอยหลังร่วมที่ยกเลิกได้สามทาง: เสียง ปุ่ม และแตะจอ */
      if (!/function\s+cdStart\s*\(/.test(t) || !/function\s+cdCancel\s*\(/.test(t)) return true;
      if (!t.includes('addEventListener("pointerdown",CD.tap,true)')) return true;
      /* ต้องมีคำสั่งเสียงสำหรับขอเวลาเพิ่ม ไม่งั้นยกเลิกด้วยเสียงไม่ได้ */
      if (!/\["wait",/.test(t)) return true;
      /* ทั้งสี่หน้าวัดผลต้องเรียกตัวนับถอยหลังเอง ไม่ใช่รอเสียงอย่างเดียว */
      const calls = (t.match(/cdStart\(\{/g) || []).length;
      if (calls < 4) return true;
      /* ทาง B: ต้องขอคำเดาหลายแบบ และเลือกอันที่ขั้นตอนนั้นรับ */
      if (!/maxAlternatives=5/.test(t) || !/function\s+vcPick\s*\(/.test(t)) return true;
      if (!t.includes("vcDispatch(vcPick(res))")) return true;
      return false;
    }).map(([f]) => f);
    req(7, "X-110", "การตรวจเดินหน้าได้ด้วยกล้อง แม้คำสั่งเสียงใช้ไม่ได้เลย",
        bad.length ? "FAIL" : "PASS",
        bad.length ? ("ขาดหรือต่อไม่ครบใน " + bad.join(" · "))
                   : "ทั้งสี่หน้าวัดผลนับถอยหลังเอง ยกเลิกได้ด้วยเสียง ปุ่ม และแตะจอ");
    if (bad.length) finding("HIGH", "X-110", "การตรวจค้างเมื่อคำสั่งเสียงไม่ติด",
      "ผู้สูงอายุจะติดค้างกลางการตรวจโดยไม่มีทางไปต่อ ซึ่งเป็นอาการที่ผู้ใช้แจ้งมาจริงหลายรอบ",
      bad.join(" · "),
      "ให้ทุกหน้าเรียก cdStart เมื่อกล้องเห็นว่าพร้อม และเปิดทางยกเลิกครบสามทาง");
  }

  /* ---- X-111: ต้องสั่งงานระยะไกลได้โดยไม่ต้องพูด ----
     ผู้ใช้ยืนห่างจอ 2-3 เมตร กดปุ่มบนจอไม่ถึง ส่วนเสียงต้องวิ่งไปถอดความ
     ที่เซิร์ฟเวอร์จึงไม่นิ่งโดยธรรมชาติ ถ้าเหลือแค่เสียงกับปุ่มบนจอ
     ผู้สูงอายุที่สั่งเสียงไม่ติดจะไม่มีทางสั่งเลย
     ต้องมีอย่างน้อย: ยกมือ (ใช้ข้อมือที่ MediaPipe ส่งมาอยู่แล้ว)
     และปุ่มจากรีโมต Bluetooth (รีโมตนำเสนอส่งปุ่มลูกศร/PageUp/PageDown)
     ทั้งสองทางต้องต่อเข้าลูปกล้องครบทุกหน้า และต้องกันสั่งซ้อนตอนนับถอยหลัง */
  {
    const bad = APP_PAIR.filter(([f, t]) => {
      for (const re of [/function\s+handsUp\s*\(/, /function\s+gestureTick\s*\(/,
                        /function\s+stepPrimary\s*\(/, /function\s+stepSecondary\s*\(/,
                        /function\s+gestureHint\s*\(/, /function\s+remoteFire\s*\(/])
        if (!re.test(t)) return true;
      /* ต้องแยกความหมายด้วยจำนวนมือจริง ไม่ใช่ยกมือแล้วทำอย่างเดียวทุกกรณี
         มือเดียว = คำสั่งหลัก · สองมือ = คำสั่งตรงข้าม (ไม่ผ่าน/ทำใหม่/หยุด) */
      if (!/n===1\?stepPrimary\(\):stepSecondary\(\)/.test(t)) return true;
      /* จำนวนมือต้องคงที่ครบเวลาก่อนถึงนับ ไม่งั้นคนยกสองมือไม่พร้อมกัน
         จะถูกอ่านเป็นคำสั่งมือเดียวไปก่อน ซึ่งอาจบันทึกผลตรงข้ามกับที่ตั้งใจ */
      if (!/if\(n!==HAND\.n\)\{HAND\.n=n;/.test(t)) return true;
      /* ต้องต่อเข้าลูปกล้องครบทั้งสี่หน้า ไม่ใช่มีฟังก์ชันลอยอยู่เฉย ๆ */
      if ((t.match(/\n\s*gestureTick\(lm\);/g) || []).length < 4) return true;
      /* ปุ่มรีโมตต้องผูกไว้จริง */
      /* ตรวจทั้งการประกาศและการใช้งานจริง — เช็คแค่ว่ามีคำนี้อยู่ที่ไหนก็ได้
         ยังหลวม เพราะเปลี่ยนชื่อตัวแปรที่ประกาศให้พังก็ยังเหลือคำนี้ที่จุดใช้งาน */
      if (!/var REMOTE_KEYS=\{/.test(t)) return true;
      /* ตัวรับปุ่มต้องผูกกับตรรกะรีโมตจริง — หาคำว่า keydown ที่ไหนก็ได้ในไฟล์
         ยังหลวม เพราะมีตัวรับปุ่มอื่นอยู่ด้วย (เช่นปิดกล่องด้วย Escape) */
      const use = t.indexOf("REMOTE_KEYS[e.key]");
      if (use < 0) return true;
      if (!t.slice(Math.max(0, use - 400), use).includes('addEventListener("keydown"')) return true;
      /* กำลังนับถอยหลังอยู่ สั่งอีกทีต้องเป็นการยกเลิก ไม่ใช่สั่งซ้อน */
      if (!/if\(cdRunning\(\)\)\{cdCancel\(\);return "cancel"\}/.test(t)) return true;
      return false;
    }).map(([f]) => f);
    req(7, "X-111", "สั่งงานระยะไกลได้โดยไม่ต้องพูด (ยกมือ · ปุ่มรีโมต)",
        bad.length ? "FAIL" : "PASS",
        bad.length ? ("ขาดหรือต่อไม่ครบใน " + bad.join(" · "))
                   : "ยกมือและปุ่มรีโมตใช้ได้ทุกหน้า และไม่สั่งซ้อนตอนนับถอยหลัง");
    if (bad.length) finding("HIGH", "X-111", "ไม่มีทางสั่งงานระยะไกลนอกจากเสียง",
      "ผู้สูงอายุที่ยืนห่างจอและสั่งเสียงไม่ติด จะไม่มีทางสั่งระบบได้เลย",
      bad.join(" · "),
      "ต่อ gestureTick เข้าทุกลูปกล้อง และผูกปุ่มรีโมตไว้กับคำสั่งหลักของขั้นตอน");
  }

  /* ---- X-112: วัดทรงตัวด้วยเซ็นเซอร์ในมือถือ เสริมกล้องไม่ใช่แทน ----
     ผู้ใช้แจ้งว่าหน้าทรงตัว 4 ท่า กล้องวัดยากมาก เพราะต้องเห็นเท้าเล็ก ๆ ที่พื้น
     จากระยะ 2-3 เมตรตอนคนกำลังแกว่ง จึงเพิ่มการอ่านความเร่งจากมือถือ
     ซึ่งมีงานวิจัยรองรับว่าเทียบเท่าแผ่นวัดแรงในการแยกกลุ่มเสี่ยงหกล้ม
     เลือกทางนี้แทนแผ่นวัดบลูทูธ เพราะ Wii Balance Board ใช้ Bluetooth classic
     แบบ HID ส่วน Web Bluetooth รองรับเฉพาะ BLE GATT จึงต่อกับเว็บแอปไม่ได้เลย
     และ CDC STEADI วัดผลเป็น "ยืนครบ 10 วินาทีหรือไม่" ไม่ได้ขอค่าการแกว่ง

     กฎนี้บังคับสามอย่าง
       1. ต้องมีทางถอยไปใช้กล้องเมื่อเซ็นเซอร์ใช้ไม่ได้ ห้ามพังทั้งหน้า
       2. ต้องขออนุญาตผ่านปุ่มจริง เพราะ iOS ไม่ยอมให้ขอจากเสียงหรือท่าทาง
       3. ต้องปิดตัวจับเมื่อจบหรือหยุดกลางคัน ไม่งั้นค้างอ่านเซ็นเซอร์กินแบต */
  {
    const bad = APP_PAIR.filter(([f, t]) => {
      for (const re of [/function\s+imuStart\s*\(/, /function\s+imuStop\s*\(/,
                        /function\s+imuSway\s*\(/, /function\s+imuLurch\s*\(/,
                        /function\s+imuAsk\s*\(/, /function\s+imuLabel\s*\(/])
        if (!re.test(t)) return true;
      /* ถอยไปใช้กล้องได้จริง — ค่าจากกล้องต้องยังถูกใช้เมื่อเซ็นเซอร์ไม่มีข้อมูล */
      if (!/else if\(h\.sway!=null\)swayEl\.textContent/.test(t)) return true;
      /* ขออนุญาตจากปุ่มจริง ไม่ใช่เรียกเองตอนโหลดหน้า ซึ่ง iOS จะปฏิเสธ
         ตรวจว่าตัวรับการกดอยู่ติดกับปุ่มเซ็นเซอร์จริงและเรียกขออนุญาตจริง
         หาคำว่า addEventListener("click" ที่ไหนก็ได้ยังหลวม เพราะไฟล์มีตัวรับ
         การกดชื่อ btn อยู่หลายที่ ถอดของปุ่มเซ็นเซอร์ทิ้งก็ยังผ่านการตรวจ */
      const gi = t.indexOf('getElementById("imuOn")');
      if (gi < 0) return true;
      const near = t.slice(gi, gi + 600);
      if (!near.includes('addEventListener("click"') || !near.includes("imuAsk()")) return true;
      /* ปิดตัวจับทั้งตอนจบท่าและตอนหยุดกลางคัน */
      if ((t.match(/imuStop\(\);/g) || []).length < 2) return true;
      return false;
    }).map(([f]) => f);
    req(7, "X-112", "วัดทรงตัวด้วยเซ็นเซอร์ในมือถือ โดยยังถอยไปใช้กล้องได้",
        bad.length ? "FAIL" : "PASS",
        bad.length ? ("ขาดหรือต่อไม่ครบใน " + bad.join(" · "))
                   : "เซ็นเซอร์เสริมกล้อง ขออนุญาตผ่านปุ่มจริง และปิดตัวจับทุกทางออก");
    if (bad.length) finding("HIGH", "X-112", "การวัดทรงตัวด้วยเซ็นเซอร์ต่อไม่ครบ",
      "ถ้าไม่มีทางถอยไปใช้กล้อง เครื่องที่ไม่ให้สิทธิ์เซ็นเซอร์จะทำการทดสอบไม่ได้เลย และถ้าไม่ปิดตัวจับจะค้างกินแบต",
      bad.join(" · "),
      "คงเส้นทางกล้องไว้เป็นทางถอย ขออนุญาตจากปุ่ม และเรียก imuStop ทุกทางออกของหน้า");
  }

  /* ---- X-113: โมดูลเรดาร์ mmWave ต้องครบและซื่อสัตย์กับข้อจำกัดของมัน ----
     ผู้ใช้สั่งให้เพิ่มการวัดสี่การทดสอบผ่านเรดาร์ HLK-LD2410 ตามแนวงานวิจัย
     Sensors 2026;26:681 — เรดาร์ตัวนี้ไม่มีความละเอียดเชิงมุม การนับลุกนั่ง
     อ่านจากจังหวะพลังงานไม่ใช่ท่าจริง และผลยังไม่เคยเทียบกับนักกายภาพบำบัด
     กฎนี้บังคับว่า
       1. ตัววิเคราะห์ครบสี่ตัวและตัวจำลองต้องอยู่ (ทดสอบได้โดยไม่มีฮาร์ดแวร์)
       2. ทุกผลต้องติดที่มา src:"radar" — ห้ามปนกับผลจากกล้องแบบแยกไม่ออก
       3. หน้าจอต้องประกาศข้อจำกัดเรื่องทิศทางและการเทียบคู่ขนาน
       4. หน้าจอ radar ต้องมีในตาราง render จริง (บทเรียนบั๊ก go("test")) */
  {
    const bad = APP_PAIR.filter(([f, t]) => {
      for (const re of [/function\s+radarGaitSpeed\s*\(/, /function\s+radarTUG\s*\(/,
                        /function\s+radarChairStand\s*\(/, /function\s+radarBalance\s*\(/,
                        /function\s+radarSimFrames\s*\(/, /function\s+radarIngest\s*\(/])
        if (!re.test(t)) return true;
      /* ทุกตัววิเคราะห์ติดที่มาของผล */
      if ((t.match(/src:"radar"/g) || []).length < 4) return true;
      /* ประกาศข้อจำกัดต่อผู้ใช้บนหน้าจอจริง ไม่ใช่แค่ในคอมเมนต์ — กฎรอบแรก
         ยอมรับข้อความจากที่ไหนก็ได้ในไฟล์ คอมเมนต์หัวโมดูลจึงผ่านแทนหน้าจอได้
         บังคับเฉพาะไฟล์ที่มีหน้าวัดผล (radarV) เพราะอีกไฟล์มีแต่ตัววิเคราะห์ */
      if (t.includes("function radarV(") &&
          !t.includes("ผลจากเรดาร์เป็นการวัดทางเลือก")) return true;
      return false;
    }).map(([f]) => f);
    /* หน้าจอ radar ต้องผูกเข้าตาราง render ของแอปผู้ใช้ */
    const app = APP_PAIR.find(([f]) => f.includes("App"));
    if (app && app[1].includes("function radarV(") && !/radar:radarV/.test(app[1]))
      bad.push("CareSignal-App.html (radarV ไม่อยู่ในตาราง render)");
    req(7, "X-113", "โมดูลเรดาร์ mmWave ครบสี่การทดสอบ พร้อมที่มาและข้อจำกัด",
        bad.length ? "FAIL" : "PASS",
        bad.length ? ("ขาดหรือต่อไม่ครบใน " + bad.join(" · "))
                   : "ตัววิเคราะห์สี่ตัว + ตัวจำลอง ทุกผลติดที่มา radar และประกาศข้อจำกัดต่อผู้ใช้");
    if (bad.length) finding("MEDIUM", "X-113", "โมดูลเรดาร์ไม่ครบหรือไม่ประกาศข้อจำกัด",
      "ผลจากเรดาร์ที่ไม่ติดที่มาจะปนกับผลจากกล้องจนแยกไม่ออก และผู้ใช้ไม่รู้ข้อจำกัดของการวัด",
      bad.join(" · "), "คงตัววิเคราะห์ครบสี่ ที่มา src:radar และคำประกาศข้อจำกัดไว้เสมอ");
  }

  /* ---- X-114: รายงานส่งต่อและการส่งออก HL7 FHIR ----
     เติมช่องว่างสุดท้ายของโครง Assessment & Referral Record: รายงานสรุป
     ที่ Care Manager และผู้เชี่ยวชาญอ่านต่อได้ทันที และการส่งออกตามมาตรฐาน
     แลกเปลี่ยนข้อมูลสุขภาพสากล กฎนี้บังคับความซื่อสัตย์สามข้อ
       1. รหัสมาตรฐานใส่เฉพาะที่มีจริง — TUG ใช้ LOINC 89423-8 ได้
          แต่ลุกนั่ง 5 ครั้งไม่มีรหัส LOINC ที่ยืนยันได้ ห้ามแต่งรหัสใส่
       2. รายงานต้องปิดท้ายว่าเป็นผลคัดกรอง ไม่ใช่การวินิจฉัย
       3. รายงานใช้รหัสผู้เอาประกัน ไม่ฝังชื่อจริง */
  {
    const bad = APP_PAIR.filter(([f, t]) => {
      if (!/function\s+csReferralText\s*\(/.test(t) || !/function\s+csFHIRBundle\s*\(/.test(t)) return true;
      if (!t.includes('code:"89423-8"')) return true;
      /* ในฟังก์ชัน FHIR ต้องมีรหัส LOINC แค่ตัวเดียว (ของ TUG) — เกินหนึ่ง
         แปลว่ามีคนแต่งรหัสเพิ่มโดยไม่ผ่านการยืนยันว่ามีจริง */
      const fb = t.indexOf("function csFHIRBundle(");
      const fe = t.indexOf("function ", fb + 30);
      const body = t.slice(fb, fe > 0 ? fe : undefined);
      if ((body.match(/http:\/\/loinc\.org/g) || []).length !== 1) return true;
      if (!t.includes("ไม่ใช่การวินิจฉัยโรค และต้องผ่านการทบทวนโดยผู้เชี่ยวชาญ")) return true;
      if (!body.includes("Screening result only")) return true;
      /* รายงานอ้างรหัส ไม่อ้างชื่อ — ต้องเห็นการใช้ uid และต้องไม่เห็น p.name */
      const rb = t.indexOf("function csReferralText(");
      const rbody = t.slice(rb, t.indexOf("function csFHIRBundle("));
      if (!rbody.includes("p.uid") || rbody.includes("p.name")) return true;
      return false;
    }).map(([f]) => f);
    req(7, "X-114", "รายงานส่งต่อ + FHIR ใช้รหัสจริง ประกาศเป็นการคัดกรอง ไม่ฝังชื่อ",
        bad.length ? "FAIL" : "PASS",
        bad.length ? ("ขาดหรือผิดใน " + bad.join(" · "))
                   : "LOINC เฉพาะ TUG (89423-8) · ปิดท้ายว่าคัดกรอง · รายงานใช้รหัสผู้เอาประกัน");
    if (bad.length) finding("HIGH", "X-114", "รายงานส่งต่อหรือ FHIR ไม่ซื่อสัตย์กับมาตรฐาน",
      "รหัสที่แต่งเองในข้อมูลสุขภาพจะถูกระบบปลายทางตีความผิด และรายงานที่ไม่ประกาศขอบเขตจะถูกใช้แทนการวินิจฉัย",
      bad.join(" · "), "ใช้รหัสที่ยืนยันได้เท่านั้น และคงคำประกาศขอบเขตไว้เสมอ");
  }

  /* ---- X-115: มุมมองวอร์ดและแผนภาพวงจรงาน ----
     คอนโซลเต็มจอสำหรับจอใหญ่ที่เคาน์เตอร์ ออกแบบให้ยืนดูจากระยะสองเมตร
     แล้วรู้ทันทีว่าต้องไปที่ใครก่อน กฎนี้บังคับสามข้อ
       1. ใช้ข้อมูลชุดเดียวกับหน้าคิวเคส (WL.rows) และเปิดเคสด้วยเส้นทางเดิม
          ห้ามคำนวณระดับหรือลำดับใหม่ ไม่งั้นสองหน้าจอจะบอกคนละอย่าง
       2. แถบวงจรงานสร้างจาก STAGES ตัวจริง ไม่ใช่รายการที่พิมพ์ค้างไว้
          ถ้าเพิ่มขั้นตอนในระบบแล้วแถบไม่ขยับตาม แปลว่าเป็นภาพลวง
       3. ยังประกาศขอบเขตว่าคนเป็นผู้ตัดสินใจ ไม่ใช่ระบบ
     และหน้าเว็บต้องมีแผนภาพวงจรครบเก้าขั้นตามที่สื่อสารกับกรรมการ */
  {
    const bad = [];
    const st = read("CareSignal-Staff.html");
    if (!/function\s+wardV\s*\(/.test(st) || !/function\s+wardPaint\s*\(/.test(st))
      bad.push("CareSignal-Staff.html (ไม่มีมุมมองวอร์ด)");
    else {
      if (!st.includes("WL.rows")) bad.push("มุมมองวอร์ดไม่ได้ใช้ข้อมูลชุดเดียวกับคิวเคส");
      /* ต้องเป็นการเรียกจากมุมมองวอร์ดจริง — ข้อความเดียวกันมีอยู่ในหน้าคิวเคสเดิมด้วย
         ถ้าตรวจแบบหาที่ไหนก็ได้ ต่อให้วอร์ดเปลี่ยนไปใช้เส้นทางอื่นก็ยังผ่าน */
      if (!st.includes("wardClose(); caseDetailV(b.dataset.open,b.dataset.uid)"))
        bad.push("มุมมองวอร์ดเปิดเคสไม่ได้ใช้เส้นทางเดิม");
      if (!/STAGES\.map\(function\(s\)\{/.test(st))
        bad.push("แถบวงจรงานไม่ได้สร้างจาก STAGES ตัวจริง");
      if (!st.includes("การตัดสินใจส่งต่อทุกครั้งเป็นของคุณ"))
        bad.push("ไม่ประกาศขอบเขตว่าคนเป็นผู้ตัดสินใจ");
    }
    const web = read("index.html");
    const steps = (web.match(/<li class="fl-[msce i]+"/g) || []).length;
    if (!web.includes('<section class="flow"')) bad.push("index.html (ไม่มีแผนภาพวงจรงาน)");
    else if (steps !== 9) bad.push("แผนภาพวงจรงานมี " + steps + " ขั้น ควรมี 9");
    req(7, "X-115", "มุมมองวอร์ดใช้ข้อมูลชุดเดียวกัน และเว็บแสดงวงจรงานครบเก้าขั้น",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ")
                   : "คอนโซลวอร์ดอ่านจากคิวเคสเดียวกัน แถบวงจรสร้างจาก STAGES จริง และเว็บแสดงครบเก้าขั้น");
    if (bad.length) finding("MEDIUM", "X-115", "มุมมองวอร์ดหรือแผนภาพวงจรงานไม่ตรงระบบจริง",
      "ถ้าหน้าจอวอร์ดคำนวณเองแยก เจ้าหน้าที่จะเห็นลำดับความเร่งด่วนคนละชุดกับหน้าคิวเคส และตัดสินใจจากข้อมูลที่ขัดกัน",
      bad.join(" · "), "ให้มุมมองวอร์ดอ่านจาก WL.rows และสร้างแถบวงจรจาก STAGES เสมอ");
  }

  /* ---- X-116: ประตูเข้าคอนโซลด้วยรหัสที่ผู้ดูแลระบบออก ----
     ปลายทางของคอนโซลคือข้อมูลสุขภาพรายบุคคล การสมัครเองแล้วรอกำหนดบทบาท
     ทีหลังจึงไม่พอ กฎนี้บังคับให้เส้นทางเดียวที่ได้บทบาทคือการแลกรหัส
     และบังคับสามอย่างที่พังเงียบได้ง่าย
       1. รหัสเก็บเป็นแฮชเท่านั้น ฐานข้อมูลที่หลุดต้องไม่กลายเป็นกุญแจ
       2. บทบาทมาจากแถวของรหัส ไม่ใช่จากค่าที่ผู้เรียกส่งมา ไม่งั้นยกระดับตัวเองได้
       3. หน้าเว็บต้องพาบัญชีที่ยังไม่มีบทบาทไปหน้ากรอกรหัส ไม่ใช่ปล่อยผ่าน
     ย้ำว่าหน้าเว็บเป็นแค่การนำทาง จุดตัดสินจริงอยู่ที่ RLS และฟังก์ชัน
     security definer ในฐานข้อมูล */
  {
    const bad = [];
    const sql = read("supabase/18_staff_invite.sql");
    if (!sql) bad.push("ไม่มี supabase/18_staff_invite.sql");
    else {
      if (!/values \(encode\(extensions\.digest\(v_code,'sha256'\),'hex'\)/.test(sql))
        bad.push("รหัสไม่ได้ถูกแปลงเป็นแฮชก่อนบันทึก");
      if (/^\s*code\s+text/m.test(sql))
        bad.push("ตารางมีคอลัมน์เก็บตัวรหัสจริง");
      if (!sql.includes("extensions.digest"))
        bad.push("ไม่ได้อ้าง extensions.digest แบบเต็ม (เสี่ยงถูกสลับด้วย search_path)");
      /* ต้องตรวจ "ทุกฟังก์ชัน" ไม่ใช่แค่มีสักตัวที่ล็อก search_path
         เพราะตัวที่หลุดตัวเดียวก็ถูกสลับฟังก์ชันด้วย search_path ของผู้เรียกได้ */
      const defs = sql.match(/language \w+ security definer[^\n]*/g) || [];
      if (!defs.length || defs.some(d => !/set search_path = public/.test(d)))
        bad.push("มีฟังก์ชัน security definer ที่ไม่ได้ล็อก search_path");
      if (!/set role = v\.role/.test(sql))
        bad.push("บทบาทไม่ได้มาจากแถวของรหัส");
      /* ตรวจแยกรายฟังก์ชัน ไม่ใช่ทั้งไฟล์ ไม่งั้นตัวหนึ่งที่ยังมีเงื่อนไข
         จะบังตัวที่ถูกถอดเงื่อนไขออกไปแล้ว */
      const body = (nm) => (sql.split("function public." + nm)[1] || "").split("$fn$;")[0];
      if (!/cs_role\(\) <> 'admin'/.test(body("issue_staff_invite")))
        bad.push("การออกรหัสไม่ได้จำกัดไว้ที่ผู้ดูแลระบบ");
      if (!/cs_role\(\) <> 'admin'/.test(body("revoke_staff_invite")))
        bad.push("การยกเลิกรหัสไม่ได้จำกัดไว้ที่ผู้ดูแลระบบ");
      if (!/cs_role\(\) = 'admin'/.test(body("list_staff_invites")))
        bad.push("รายการรหัสไม่ได้จำกัดไว้ที่ผู้ดูแลระบบ");
    }
    const be = read("cs-backend.js");
    /* ชื่อฟังก์ชันซ้ำในสโคปเดียวกันจะทับกันเงียบ ๆ — ฝั่งครอบครัวมี redeemInvite อยู่ก่อน */
    if ((be.match(/async function redeemInvite\(/g) || []).length > 1)
      bad.push("cs-backend.js มี redeemInvite ซ้ำชื่อ ตัวหลังจะทับตัวแรก");
    if (!/redeemStaffInvite: redeemStaffInvite/.test(be))
      bad.push("cs-backend.js ไม่ได้ส่งออก redeemStaffInvite");

    const st = read("CareSignal-Staff.html");
    if (!/function redeemV\(/.test(st)) bad.push("ไม่มีหน้ากรอกรหัสในคอนโซล");
    if (!/if\(!mayConsole\(pr\.role\)\)\{ redeemV\([\s\S]{0,40}\); return; \}/.test(st))
      bad.push("ทางล็อกอินไม่ได้พาบัญชีที่ยังไม่มีบทบาทไปหน้ากรอกรหัส");
    if (!/ST\.name=p\.display_name\|\|ST\.email; redeemV\(/.test(st))
      bad.push("ทางเปิดแอปซ้ำไม่ได้พาไปหน้ากรอกรหัส");
    if (!/CSBackend\.issueInvite\(/.test(st) || !/CSBackend\.revokeInvite\(/.test(st))
      bad.push("หน้าผู้ดูแลระบบออกหรือยกเลิกรหัสไม่ได้");
    if (st.includes("แล้วกลับมาที่หน้านี้เพื่อกำหนดบทบาท"))
      bad.push("ยังมีคำแนะนำเดิมที่บอกให้สมัครเองแล้วรอกำหนดบทบาท");
    if (!/ปิดหน้านี้แล้วจะไม่เห็นรหัสนี้อีก/.test(st))
      bad.push("ไม่ได้เตือนว่ารหัสแสดงครั้งเดียว");

    req(7, "X-116", "บทบาทเจ้าหน้าที่มาจากรหัสที่ผู้ดูแลระบบออก และเก็บเป็นแฮชเท่านั้น",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ")
                   : "ออกรหัสได้เฉพาะผู้ดูแลระบบ · เก็บเป็นแฮช · บทบาทมาจากแถวของรหัส · บัญชีที่ยังไม่แลกรหัสถูกพาไปหน้ากรอกรหัส");
    if (bad.length) finding("HIGH", "X-116", "ประตูเข้าคอนโซลไม่รัดกุม",
      "ถ้าบทบาทมาจากค่าที่ผู้เรียกส่งมา หรือรหัสถูกเก็บเป็นข้อความธรรมดา ผู้ไม่มีสิทธิ์จะเข้าถึงข้อมูลสุขภาพรายบุคคลของผู้สูงอายุได้",
      bad.join(" · "), "ให้บทบาทมาจากแถวของรหัสเสมอ เก็บเฉพาะแฮช และบังคับสิทธิ์ที่ฐานข้อมูล ไม่ใช่ที่หน้าจอ");
  }

  /* ---- X-117: ความลับเดียวที่ผู้ดูแลระบบควบคุม แล้วส่งต่อให้เจ้าของบัญชี ----
     เจ้าหน้าที่ไม่มีอีเมลและไม่ได้ตั้งรหัสผ่านไว้ล่วงหน้า เข้าครั้งแรกด้วย
     ชื่อผู้ใช้ + รหัสที่ผู้ดูแลระบบออกให้ แล้วต้องตั้งรหัสผ่านของตัวเองทันที
     สองอย่างนี้ต้องอยู่ด้วยกันเสมอ ถ้าขาดข้อหลัง รหัสที่เดินผ่านมือคนอื่น
     จะกลายเป็นรหัสผ่านถาวร และ audit log จะตอบไม่ได้ว่าใครเป็นคนลงมือจริง

     ข้อที่มองข้ามง่ายที่สุดคือสิทธิ์ระดับคอลัมน์ RLS ตัดสินว่าแถวไหนแก้ได้
     แต่ไม่ได้ตัดสินว่าคอลัมน์ไหน ถ้า authenticated ยังมี UPDATE ทั้งตาราง
     ใครก็ปลดธง must_set_password หรือตั้ง role ของตัวเองได้ผ่าน API ตรง ๆ
     โดยไม่ต้องแตะหน้าเว็บเลย */
  {
    const bad = [];
    const st = read("CareSignal-Staff.html");
    const be = read("cs-backend.js");
    const sql = read("supabase/19_staff_login.sql") || "";
    const fx = read("supabase/functions/staff-activate/index.ts") || "";
    const priv = read("supabase/19_staff_login.sql") || "";
    const tools = read("supabase/20_admin_data.sql") || "";

    if (!/must_set_password/.test(sql)) bad.push("ไม่มีธงบังคับตั้งรหัสผ่านในฐานข้อมูล");
    if (!/function setPwV\(\)/.test(st)) bad.push("ไม่มีหน้าตั้งรหัสผ่านครั้งแรก");
    if (!/if\(pr\.must_set_password\)\{ setPwV\(\); return; \}/.test(st))
      bad.push("ทางล็อกอินไม่ได้บังคับตั้งรหัสผ่าน");
    if (!/p\.must_set_password\)\{[\s\S]{0,200}setPwV\(\);/.test(st))
      bad.push("ทางเปิดแอปซ้ำไม่ได้บังคับตั้งรหัสผ่าน");
    if (/LOGIN_CATS|pickedCat/.test(st))
      bad.push("ยังให้ผู้ใช้เลือกหมวดบทบาทเอง ทั้งที่บทบาทมาจากรหัส");
    if (!/function staffEmail\(id\)/.test(be) || !/staff\.caresignal\.local/.test(be))
      bad.push("ไม่ได้ประกอบอีเมลภายในจากชื่อผู้ใช้");
    if (/signUpStaff/.test(be)) bad.push("ยังมีเส้นทางสมัครบัญชีเจ้าหน้าที่เอง");
    if (!/rpc\("admin_set_role"/.test(be) || /from\("profiles"\)\.update\(\{ role/.test(be))
      bad.push("ยังเปลี่ยนบทบาทด้วย UPDATE ตรงจากเบราว์เซอร์");

    /* Edge Function ต้องตรวจรหัสก่อนสร้างบัญชี ไม่ใช่สร้างก่อนแล้วค่อยตรวจ */
    if (fx) {
      const iCreate = fx.indexOf("createUser(");
      if (iCreate < 0) bad.push("staff-activate ไม่ได้สร้างบัญชี");
      else {
        /* ด่านทั้งห้าต้องอยู่ครบและอยู่ก่อนการสร้างบัญชี ตรวจทีละด่าน
           ไม่ใช่ดูแค่ว่ามี reject สักตัวโผล่มาก่อน ซึ่งด่านที่หายไปหนึ่งด่าน
           ก็ยังผ่านได้ */
        [["if (!inv) return await reject", "รหัสที่ไม่มีอยู่จริง"],
         ["if (inv.username !== username) return await reject", "รหัสที่ไม่ตรงกับชื่อผู้ใช้"],
         ["if (inv.revoked_at) return await reject", "รหัสที่ถูกยกเลิก"],
         ["if (inv.used_at) return await reject", "รหัสที่ถูกใช้ไปแล้ว"],
         ["if (new Date(inv.expires_at) < new Date()) return await reject", "รหัสที่หมดอายุ"]].forEach(([g, nm]) => {
          const i = fx.indexOf(g);
          if (i < 0 || i > iCreate) bad.push("staff-activate ไม่ได้กัน" + nm + "ก่อนสร้างบัญชี");
        });
      }
      if (!/email_confirm: true/.test(fx)) bad.push("staff-activate ไม่ได้ยืนยันอีเมลภายในให้ทันที");
      if (!/must_set_password: true/.test(fx)) bad.push("staff-activate ไม่ได้ติดธงบังคับตั้งรหัสผ่าน");
      if (!/SUPABASE_SERVICE_ROLE_KEY/.test(fx)) bad.push("staff-activate ไม่ได้ใช้สิทธิ์ฝั่งเซิร์ฟเวอร์");
    } else bad.push("ไม่มี Edge Function staff-activate");

    /* สิทธิ์ระดับคอลัมน์ — คอลัมน์ที่ตัดสินสิทธิ์ต้องไม่อยู่ในรายการที่ให้แก้เอง */
    const g = (priv.match(/grant update \(([\s\S]*?)\)\s*\n?\s*on public\.profiles/) || [])[1] || "";
    if (!/revoke update on public\.profiles from authenticated/.test(priv))
      bad.push("ไม่ได้ถอนสิทธิ์ UPDATE ทั้งตารางของ profiles");
    ["role", "username", "must_set_password", "id", "pseudonym"].forEach((c) => {
      if (new RegExp("(^|[\\s,])" + c + "([\\s,]|$)").test(g))
        bad.push("ยังให้ผู้ใช้แก้คอลัมน์ " + c + " เองได้");
    });
    if (!/display_name/.test(g)) bad.push("ผู้ใช้แก้ชื่อที่แสดงของตัวเองไม่ได้");

    /* เครื่องมือลบข้อมูล — บันทึกตรวจสอบต้องไม่อยู่ในรายการที่ลบได้ */
    if (/delete from public\.audit_logs/.test(tools))
      bad.push("มีคำสั่งลบบันทึกตรวจสอบ");
    if (!/async function dataV\(\)/.test(st)) bad.push("ไม่มีหน้าจัดการข้อมูลของผู้ดูแลระบบ");
    if (!/function askExact\(word,what\)/.test(st))
      bad.push("ลบข้อมูลไม่ได้ให้พิมพ์คำยืนยัน");
    if (!/เคยลงมือทำงานในระบบ ลบไม่ได้/.test(tools))
      bad.push("ยอมให้ลบบัญชีที่มีประวัติการทำงาน");

    req(7, "X-117", "เจ้าหน้าที่เข้าด้วยชื่อผู้ใช้+รหัสครั้งเดียว แล้วต้องตั้งรหัสผ่านของตัวเอง",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ")
                   : "ตรวจรหัสก่อนสร้างบัญชี · บังคับตั้งรหัสผ่านทั้งทางล็อกอินและทางเปิดแอปซ้ำ · คอลัมน์ที่ตัดสินสิทธิ์แก้เองไม่ได้ · ลบบันทึกตรวจสอบไม่ได้");
    if (bad.length) finding("HIGH", "X-117", "ประตูเข้าระบบหรือสิทธิ์ระดับคอลัมน์ไม่รัดกุม",
      "ถ้ารหัสที่ผู้ดูแลระบบออกให้กลายเป็นรหัสผ่านถาวร หรือผู้ใช้แก้คอลัมน์ role ของตัวเองได้ผ่าน API ผู้ที่ไม่มีสิทธิ์จะเข้าถึงข้อมูลสุขภาพรายบุคคลได้",
      bad.join(" · "), "บังคับตั้งรหัสผ่านครั้งแรกเสมอ และคืนสิทธิ์ UPDATE ให้เฉพาะคอลัมน์ที่เจ้าของโปรไฟล์ควรแก้เอง");
  }

  /* ---- X-118: โหมดป้ายสัญลักษณ์เป็นตัวเสริม ไม่ใช่เงื่อนไข ----
     ป้าย ArUco ให้จุดอ้างอิงที่นิ่งกว่าจุดข้อต่อที่ประมาณจากภาพมาก
     และเพราะรู้ขนาดที่พิมพ์ จึงรายงานเป็นมิลลิเมตรจริงได้
     แต่มันมาพร้อมภาระของผู้ใช้: ต้องมีเครื่องพิมพ์ ต้องพิมพ์ให้ถูกขนาด
     ต้องติดให้ถูกที่ · กฎนี้จึงบังคับสามอย่าง

       1. ไม่มีป้ายต้องทำงานได้เหมือนเดิม ทุกจุดที่ใช้ป้ายต้องมีทางถอย
          กลับไปใช้ MediaPipe · ถ้าโมดูลนี้กลายเป็นเงื่อนไข ผู้ใช้ที่ไม่มี
          เครื่องพิมพ์จะใช้แอปไม่ได้เลย ซึ่งขัดกับข้อเสนอทั้งหมดของระบบ
       2. ต้องมีทางสอบเทียบขนาดที่พิมพ์จริง เครื่องพิมพ์ย่อขนาดเองเงียบ ๆ
          ได้เสมอ และการคำนวณมิลลิเมตรจะผิดทั้งหมดโดยไม่มีอะไรฟ้อง
          ซึ่งอันตรายกว่าอ่านป้ายไม่ออก
       3. ต้องบอกขีดจำกัดขนาดขั้นต่ำบนหน้าจอ และต้องไม่อ้างว่าค่าที่ได้
          เทียบเท่าห้องปฏิบัติการ เพราะยังไม่มีการทดสอบภาคสนาม */
  {
    const bad = [];
    const ar = read("cs-aruco.js") || "";
    const app = appAll;

    if (!ar) bad.push("ไม่มีไฟล์ cs-aruco.js");
    else {
      /* ต้องไม่พึ่งไลบรารีภายนอก เพราะแอปต้องทำงานตอนออฟไลน์ */
      if (/import\s|require\s*\(|cdn\.|unpkg|jsdelivr/.test(ar.replace(/module\.exports[\s\S]*$/, "")))
        bad.push("cs-aruco.js พึ่งพาไฟล์ภายนอก ซึ่งใช้ไม่ได้ตอนออฟไลน์");
      if (!/ctx\.fillRect\(x - QUIET \* cell/.test(ar) || !/function totalSize\(codeSize\)/.test(ar))
        bad.push("ไม่ได้พิมพ์ขอบขาวรอบป้าย");
      if (!/MIN_SIDE_PX =/.test(ar) || !/function minMarkerMm\(distM/.test(ar))
        bad.push("ไม่ได้ประกาศขนาดขั้นต่ำที่อ่านได้");
      if (!/function Tracker\(opts\)/.test(ar))
        bad.push("ไม่มีตัวติดตาม ต้องสแกนเต็มเฟรมทุกเฟรม");
      /* ค่าที่คืนต้องเป็น null เมื่อข้อมูลไม่พอ ไม่ใช่เดาเป็นตัวเลข */
      if (!/if \(!sidePx \|\| !markerMm \|\| !focalPx\) return null/.test(ar))
        bad.push("คำนวณระยะโดยไม่ตรวจว่าข้อมูลครบ");
    }

    /* ---- ทางถอยกลับไปใช้กล้องต้องมีจริง ---- */
    if (!/function riseNow\(lm\)/.test(app)) bad.push("ไม่มีตัวเลือกแหล่งสัญญาณท่าทาง");
    else {
      const rn = (app.split("function riseNow(lm)")[1] || "").split("\n}")[0];
      if (!/poseRise\(lm\)/.test(rn)) bad.push("riseNow ไม่มีทางถอยไปใช้กล้อง");
      if (!/src: "mark"/.test(rn) || !/src: "pose"/.test(rn))
        bad.push("riseNow ไม่บอกว่าค่ามาจากแหล่งใด");
    }
    if (!/function scaleNow\(lm\)/.test(app)) bad.push("ไม่มีตัวเลือกมาตรวัดระยะ");
    else if (!/return \{ v: shoulderWidth\(lm\), src: "pose" \}/.test(app))
      bad.push("scaleNow ไม่มีทางถอยไปใช้ความกว้างไหล่");
    /* เกณฑ์ของตัวนับต้องอยู่บนสเกลเดียว ไม่งั้นสลับแหล่งกลางคันแล้วพัง */
    if (!/DET\.setRefs\(0,1\)/.test(app))
      bad.push("ตัวนับลุกนั่งไม่ได้ใช้สเกลกลาง ทำให้สลับแหล่งกลางคันไม่ได้");
    if (!/TugTracker\(\{sitRef:0,standRef:1\}\)/.test(app))
      bad.push("ตัวจับ TUG ไม่ได้ใช้สเกลกลาง");
    /* ค่าอ้างอิงของป้ายต้องเก็บตอนสอบเทียบ และต้องกันกรณีเห็นแค่ท่าเดียว */
    if (!/mSit!=null&&mStand!=null/.test(app))
      bad.push("รับค่าอ้างอิงของป้ายทั้งที่เห็นไม่ครบสองท่า");

    /* ---- การสอบเทียบขนาดที่พิมพ์ ---- */
    if (!/function markersV\(\)/.test(app)) bad.push("ไม่มีหน้าพิมพ์ป้าย");
    if (!/mkRuler/.test(app) || !/MARK\.mm=SHEET_MM\*\(v\/100\)/.test(app))
      bad.push("ไม่มีทางสอบเทียบขนาดที่เครื่องพิมพ์ทำออกมาจริง");
    /* ต้องเป็นมิลลิเมตรทั้งกว้างและสูง ตรวจแค่ด้านเดียวแล้วอีกด้านเปลี่ยนไป
       จะได้ป้ายที่ผิดสัดส่วน ซึ่งตัวตรวจอ่านไม่ออกเลย */
    if (!/width:'\+total\.toFixed\(2\)\+'mm;height:'\+total\.toFixed\(2\)\+'mm;/.test(app))
      bad.push("แผ่นพิมพ์ไม่ได้ใช้หน่วยมิลลิเมตรทั้งสองด้าน");

    /* ---- ต้องไม่อ้างเกินจริง ---- */
    if (!/<b>9 เซนติเมตร<\/b>/.test(app)) bad.push("ไม่ได้บอกขนาดขั้นต่ำที่ต้องพิมพ์บนหน้าจอ");
    if (!/ระบบ<b>ยังไม่ได้ทดสอบภาคสนาม<\/b>/.test(app))
      bad.push("ไม่ได้ประกาศบนหน้าจอว่ายังไม่ผ่านการทดสอบภาคสนาม");
    if (!/ไม่ได้นำไปตัดสินผ่านหรือไม่ผ่าน/.test(app))
      bad.push("ไม่ได้บอกว่าค่าจากป้ายยังไม่ใช้ตัดสินผล");
    /* ต้องแยกให้ออกระหว่าง "อ้าง" กับ "ปฏิเสธการอ้าง" — ข้อความปฏิเสธก็มีคำเดียวกัน
       จึงดูคำปฏิเสธในช่วง 40 ตัวอักษรก่อนหน้าด้วย ไม่ใช่จับแค่คำ */
    (function () {
      const re = /(แม่นยำเท่า|เทียบเท่าห้องปฏิบัติการ|แม่นระดับห้องแล็บ)/g;
      let m;
      while ((m = re.exec(app)) !== null) {
        const before = app.slice(Math.max(0, m.index - 18), m.index);
        if (!/(ไม่ได้อ้างว่า|ไม่ใช่|ไม่เท่า|มิได้)$/.test(before.replace(/\s+$/, ""))) {
          bad.push("อ้างความแม่นยำเทียบห้องปฏิบัติการ"); break;
        }
      }
    })();

    /* ---- เก็บไฟล์ไว้ใช้ตอนออฟไลน์ ---- */
    if (!/"\.\/cs-aruco\.js"/.test(read("sw.js") || ""))
      bad.push("service worker ไม่ได้เก็บ cs-aruco.js");

    req(7, "X-118", "โหมดป้ายเป็นตัวเสริมที่ถอยกลับไปใช้กล้องได้ และสอบเทียบขนาดที่พิมพ์ได้",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ")
                   : "ไม่มีป้ายก็ทำงานเหมือนเดิม · สัญญาณสองแหล่งอยู่บนสเกลเดียวกันจึงสลับกลางคันได้ · สอบเทียบขนาดที่พิมพ์ด้วยไม้บรรทัดบนแผ่นเดียวกัน · ประกาศขีดจำกัดและยังไม่อ้างประสิทธิผล");
    if (bad.length) finding("MEDIUM", "X-118", "โหมดป้ายกลายเป็นเงื่อนไข หรืออ้างเกินกว่าที่ทดสอบไว้",
      "ถ้าไม่มีป้ายแล้วใช้ไม่ได้ ผู้ใช้ที่ไม่มีเครื่องพิมพ์จะทำแบบประเมินไม่ได้เลย และถ้าขนาดที่พิมพ์ผิดโดยไม่มีอะไรฟ้อง ค่ามิลลิเมตรที่รายงานจะผิดทั้งหมดโดยไม่มีใครรู้",
      bad.join(" · "), "ให้ทุกจุดที่ใช้ป้ายมีทางถอยกลับไปใช้ MediaPipe และให้ผู้ใช้วัดไม้บรรทัดบนแผ่นที่พิมพ์เพื่อสอบเทียบขนาดจริง");
  }

  /* ---- X-119: แผ่นป้ายที่พิมพ์ต้องตรงกับตัวอ่านเสมอ ----
     ความเสี่ยงของโมดูลนี้ไม่ได้อยู่ที่โค้ดตรวจจับ แต่อยู่ที่ "แผ่นกระดาษ"
     ถ้าแผ่นที่ผู้ใช้พิมพ์ไม่ตรงกับพจนานุกรมที่แอปใช้อ่าน ทุกอย่างจะพังเงียบ ๆ
     ผู้ใช้จะติดป้ายเรียบร้อยแล้วพบว่ากล้องไม่เห็นอะไรเลย โดยไม่มีคำอธิบาย

     จึงบังคับสามอย่าง
       1. ทั้งแผ่น PDF และแผ่นในแอปต้องวาดจาก CSAruco.DICT ตัวเดียวกัน
          ห้ามฝังลายป้ายไว้เป็นภาพหรือตารางที่พิมพ์ค้างไว้
       2. ชื่อและการใช้งานของแต่ละป้ายมาจากที่เดียว (ROLE_NM / ROLE_USE)
          ไม่ให้แผ่นสองใบบอกคนละอย่าง
       3. ทุกบทบาทที่โมดูลรู้จักต้องมีป้ายให้พิมพ์ครบ ไม่มีบทบาทลอย
          และไม่มีป้ายที่พิมพ์แล้วไม่มีการทดสอบใดใช้ */
  {
    const bad = [];
    const ar = read("cs-aruco.js") || "";
    const gen = read("tools/make-marker-pdf.mjs") || "";
    const app = appAll;

    if (!gen) bad.push("ไม่มีตัวสร้างแผ่น PDF");
    else {
      if (!/require\("\.\.\/cs-aruco\.js"\)/.test(gen))
        bad.push("ตัวสร้าง PDF ไม่ได้ใช้พจนานุกรมตัวเดียวกับตัวอ่าน");
      if (!/A\.bitsOf\(A\.DICT\[id\]\)/.test(gen))
        bad.push("ตัวสร้าง PDF ไม่ได้วาดจากบิตของพจนานุกรม");
      if (!/A\.ROLE_NM\[role\]/.test(gen) || !/A\.ROLE_USE\[role\]/.test(gen))
        bad.push("ตัวสร้าง PDF ไม่ได้ใช้ชื่อบทบาทจากโมดูล");
      /* ขอบขาวต้องอยู่ในสี่เหลี่ยมที่วาดจริง ไม่ใช่แค่วาดกรอบเส้นประ */
      if (!/x: x, y: y, w: total, h: total, white: true/.test(gen))
        bad.push("แผ่น PDF ไม่ได้พิมพ์พื้นขาวรอบป้าย");
      if (!/ห้ามตัดชิดขอบดำ/.test(gen))
        bad.push("แผ่น PDF ไม่ได้เตือนเรื่องตัดชิดขอบดำ");
      /* ไม้บรรทัดสอบเทียบเครื่องพิมพ์ — ถ้าไม่มี ขนาดที่พิมพ์ผิดจะไม่มีอะไรฟ้อง */
      /* ต้องดูที่เส้นและขีดที่วาดจริง ไม่ใช่คำว่า 100 มิลลิเมตร ซึ่งอยู่ในคำอธิบายด้วย */
      if (!/p\.rect\(mm\(rx\), mm\(ry\), mm\(100\)/.test(gen) ||
          !/p\.rect\(mm\(rx \+ i \* 10\)/.test(gen))
        bad.push("แผ่น PDF ไม่ได้วาดไม้บรรทัดสอบเทียบ");
    }

    /* ---- แผ่นในแอปต้องบอกเรื่องเดียวกับแผ่น PDF ---- */
    if (!/MK_SHEET_IDS = \[0, 1, 2, 3, 4, 5\]/.test(app))
      bad.push("แผ่นในแอปมีป้ายไม่ครบหกตำแหน่ง");
    if (!/CSAruco\.ROLE_NM\[role\]/.test(app) || !/CSAruco\.ROLE_USE\[role\]/.test(app))
      bad.push("แผ่นในแอปใช้ชื่อป้ายที่พิมพ์ค้างไว้ แทนที่จะอ่านจากโมดูล");
    if (!/CSAruco\.bitsOf\(CSAruco\.DICT\[id\]\)/.test(app))
      bad.push("แผ่นในแอปไม่ได้วาดจากบิตของพจนานุกรม");
    if (!/href="\.\/CareSignal-markers\.pdf"/.test(app))
      bad.push("แอปไม่มีทางดาวน์โหลดไฟล์ PDF");

    /* ---- บทบาทต้องครบและตรงกันทั้งสามที่ ---- */
    const roles = (ar.match(/var ROLE = \{([^}]*)\}/) || [])[1] || "";
    const names = (ar.match(/var ROLE_NM = \{([\s\S]*?)\};/) || [])[1] || "";
    const uses = (ar.match(/var ROLE_USE = \{([\s\S]*?)\n  \};/) || [])[1] || "";
    const ids = [...roles.matchAll(/(\d+):\s*"(\w+)"/g)].map((m) => m[2]);
    if (ids.length !== 6) bad.push("โมดูลประกาศบทบาทไม่ครบหกตำแหน่ง (" + ids.length + ")");
    for (const r of ids) {
      if (!new RegExp(r + ":").test(names)) bad.push("บทบาท " + r + " ไม่มีชื่อไทย");
      if (!new RegExp(r + ":").test(uses)) bad.push("บทบาท " + r + " ไม่ได้บอกว่าใช้กับการทดสอบใด");
    }

    /* ---- ไฟล์ PDF ต้องถูกสร้างไว้จริงและเก็บไว้ใช้ตอนออฟไลน์ ---- */
    if (!exists("CareSignal-markers.pdf")) bad.push("ยังไม่ได้สร้างไฟล์ CareSignal-markers.pdf");
    if (!/"\.\/CareSignal-markers\.pdf"/.test(read("sw.js") || ""))
      bad.push("service worker ไม่ได้เก็บไฟล์ PDF");

    req(7, "X-119", "แผ่นป้ายที่พิมพ์วาดจากพจนานุกรมเดียวกับตัวอ่าน และครบทุกตำแหน่งที่โปรแกรมใช้",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ")
                   : "แผ่น PDF และแผ่นในแอปวาดจาก CSAruco.DICT ตัวเดียวกัน · ชื่อและการใช้งานมาจากที่เดียว · ครบห้าตำแหน่ง · มีไม้บรรทัดสอบเทียบเครื่องพิมพ์");
    if (bad.length) finding("HIGH", "X-119", "แผ่นป้ายที่พิมพ์อาจไม่ตรงกับตัวอ่าน",
      "ถ้าลายบนกระดาษไม่ตรงกับพจนานุกรมที่แอปใช้ ผู้ใช้จะพิมพ์ ตัด ติดป้ายจนเสร็จ แล้วพบว่ากล้องไม่เห็นอะไรเลย โดยไม่มีข้อความใดอธิบายว่าเกิดอะไรขึ้น",
      bad.join(" · "), "ให้ทั้งแผ่น PDF และแผ่นในแอปวาดจาก CSAruco.DICT และใช้ ROLE_NM / ROLE_USE เป็นแหล่งชื่อเดียว");
  }

  /* ---- X-120: หยุดทันทีได้ และบันทึกให้ครบว่าเกิดอะไรขึ้น ----
     CDC STEADI เขียนวิธีทำแบบทดสอบทรงตัวไว้ชัดว่า ผู้ประเมินยืนข้าง ๆ
     ช่วยจัดท่า ปล่อยเมื่อผู้ทดสอบนิ่ง จับเวลา และพร้อมเข้าช่วยตลอดเวลา
     และถ้ายืนท่าใดไม่ครบสิบวินาที ให้ "หยุดการทดสอบ" ไม่ทำท่าถัดไป
     เพราะท่าถัดไปยากกว่าเดิมเสมอ

     ข้อที่ระบบนี้ต้องมีเพิ่มเอง เพราะเป็นการทดสอบที่ไม่มีนักกายภาพอยู่ด้วย
       · ปุ่มหยุดต้องกดได้ตั้งแต่ตอนจัดท่า ไม่ใช่โผล่หลังจบท่าแล้ว
         ปุ่มที่ยังไม่ปรากฏตอนคนกำลังจะล้ม ไม่มีประโยชน์
       · เหตุผลที่หยุดต้องแยกกัน เสียสมดุล เวียนศีรษะ และต้องจับพยุง
         หมายถึงคนละเรื่อง ถ้าบันทึกรวมเป็น "หยุดกลางคัน" ผู้เชี่ยวชาญ
         จะแยกไม่ออกว่าควรส่งต่อไปทางไหน
       · คุณภาพภาพต้องบันทึกทุกครั้งรวมทั้งครั้งที่ผ่าน เพราะค่าเดียวกัน
         จากภาพที่เห็นชัดตลอด กับจากภาพที่คนหลุดกรอบครึ่งหนึ่ง
         ไม่ควรถูกอ่านเท่ากัน */
  {
    const bad = [];
    const app = appAll;

    /* ---- ปุ่มหยุดต้องมีและต้องมาก่อนเวลาที่ต้องใช้ ---- */
    if (!/id="bHaltNow"/.test(app)) bad.push("ไม่มีปุ่มหยุดทันทีระหว่างทดสอบ");
    if (!/haltBtn\.hidden=false; whyBox\.hidden=true;/.test(app))
      bad.push("ปุ่มหยุดไม่ได้แสดงตั้งแต่ตอนจัดท่า");
    /* ต้องหยุดนาฬิกาก่อนถามเหตุผล ไม่งั้นเวลาที่บันทึกยาวกว่าที่ยืนได้จริง */
    if (!/clearCd\(\); stepStop\(\); imuStop\(\);[\s\S]{0,700}whyBox\.hidden=false/.test(app))
      bad.push("ถามเหตุผลก่อนหยุดจับเวลา ทำให้เวลาที่บันทึกยาวเกินจริง");

    /* ---- เหตุผลต้องแยกกันและมาจากรายการกลาง ---- */
    const rl = (app.match(/var STOP_REASONS = \[([\s\S]*?)\];/) || [])[1] || "";
    ["balance", "dizzy", "support"].forEach((k) => {
      if (!new RegExp('k: "' + k + '"').test(rl)) bad.push("ไม่มีเหตุผล " + k + " แยกเป็นของตัวเอง");
    });
    if (!/STOP_REASONS\.map\(function\(r\)\{/.test(app))
      bad.push("ปุ่มเหตุผลไม่ได้สร้างจากรายการกลาง");
    if (!/stopReason:k, stopReasonNm:stopReasonNm\(k\)/.test(app))
      bad.push("ไม่ได้บันทึกทั้งรหัสและชื่อของเหตุผลที่หยุด");
    if (!/held:Math\.round\(\(haltAt\|\|0\)\*10\)\/10/.test(app))
      bad.push("ไม่ได้บันทึกเวลาที่ยืนได้ตอนกดหยุด");
    /* หยุดกลางคันแล้วต้องไม่พาไปท่าถัดไป ซึ่งยากกว่าเดิม */
    if (!/finishAll\("หยุดกลางคัน — "\+stopReasonNm\(k\)\)/.test(app))
      bad.push("หยุดกลางคันแล้วยังพาไปทำท่าถัดไป ขัดกับ STEADI");
    if (!/audit\("หยุดการทดสอบทรงตัวกลางคัน"/.test(app))
      bad.push("ไม่ได้เขียนบันทึกตรวจสอบเมื่อหยุดกลางคัน");

    /* ---- คุณภาพภาพ ---- */
    if (!/function QLog\(\)/.test(app)) bad.push("ไม่มีตัวเก็บคุณภาพภาพ");
    if (!/this\.q\.push\(visOK\(lm\), !!r\.feet, !!this\._sawMark, POSE_COUNT\)/.test(app))
      bad.push("ไม่ได้เก็บคุณภาพภาพทุกเฟรมระหว่างจับเวลา");
    if (!/if\(this\.state==="hold"\)this\.q\.push\(null,false,false,POSE_COUNT\)/.test(app))
      bad.push("เฟรมที่กล้องมองไม่เห็นตัวไม่ถูกนับ ทำให้ค่าเฉลี่ยสวยเกินจริง");
    if ((app.match(/quality:o\.quality, qualityNote:qualityNote\(o\.quality\)/g) || []).length < 2)
      bad.push("บันทึกคุณภาพภาพเฉพาะบางกรณี ไม่ครบทุกครั้ง");
    if (!/esc\(qualityNote\(o\.quality\)\)/.test(app))
      bad.push("ไม่ได้แสดงคุณภาพภาพให้คนเห็นก่อนยืนยันผล");

    /* ---- โหมดผู้ดูแล ---- */
    if (!/function voiceOK\(\)/.test(app)) bad.push("ไม่มีประตูเดียวที่ควบคุมการรับคำสั่งเสียง");
    if (!/if\(typeof voiceOK==="function"&&!voiceOK\(\)\)/.test(app))
      bad.push("โหมดผู้ดูแลไม่ได้ปิดการรับคำสั่งเสียงที่ต้นทาง");
    if (!/id="carerOn"/.test(app)) bad.push("ไม่มีสวิตช์โหมดผู้ดูแลให้เปิดปิด");
    /* ปิดคำสั่งเสียงแล้วต้องยังพูดบอกขั้นตอน เพราะผู้ทดสอบยืนห่างจอ */
    if (!/if\(spec&&spec\.cue\)speak\(spec\.cue,\{force:true\}\);/.test(app))
      bad.push("โหมดผู้ดูแลปิดเสียงพูดบอกขั้นตอนไปด้วย ซึ่งผู้ทดสอบจะไม่รู้ว่าต้องทำอะไร");

    /* ---- ป้ายบนพื้นแยกด้วยรหัส ไม่ใช่สี ---- */
    if (/(วาง|ติด|ใช้)ป้าย(สี)?(แดง|เขียว|เหลือง|น้ำเงิน|ฟ้า|ส้ม)/.test(app))
      bad.push("ยังใช้สีเป็นตัวระบุป้าย");
    if (!/① ป้ายจุดเริ่มต้น/.test(app) || !/② ป้ายจุด 1 เมตร/.test(app) ||
        !/③ ป้ายจุด 3 เมตร/.test(app))
      bad.push("หน้าลุกเดินไม่ได้เรียกป้ายแยกเป็นสามจุด");

    req(7, "X-120", "หยุดทดสอบได้ทันที บันทึกเวลา เหตุผล และคุณภาพภาพทุกครั้ง",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ")
                   : "ปุ่มหยุดกดได้ตั้งแต่จัดท่า · หยุดนาฬิกาก่อนถามเหตุผล · เหตุผลสามข้อหลักแยกกัน · หยุดแล้วไม่ทำท่าถัดไปตาม STEADI · คุณภาพภาพบันทึกทุกครั้งรวมเฟรมที่มองไม่เห็น · โหมดผู้ดูแลปิดคำสั่งเสียงแต่ยังพูดบอกขั้นตอน");
    if (bad.length) finding("HIGH", "X-120", "หยุดทดสอบไม่ทันหรือบันทึกไม่ครบ",
      "การทดสอบทรงตัวทำที่บ้านโดยไม่มีนักกายภาพอยู่ด้วย ถ้าปุ่มหยุดยังไม่ปรากฏตอนผู้สูงอายุกำลังเสียหลัก หรือถ้าบันทึกไม่บอกว่าหยุดเพราะอะไรและตอนนั้นกล้องเห็นดีแค่ไหน ผู้เชี่ยวชาญจะอ่านผลไม่ออกและอาจตัดสินผิด",
      bad.join(" · "), "ให้ปุ่มหยุดอยู่บนจอตลอดการทดสอบ หยุดนาฬิกาก่อนถามเหตุผล และบันทึกเวลา เหตุผล และคุณภาพภาพทุกครั้ง");
  }

  /* ---- X-121: จุดกลับตัว 3 เมตร ต้องมีหลักฐาน ไม่ใช่การอนุมาน ----
     เดิมระบบยืนยันว่า "เดินครบ 3 เมตร" จากขนาดตัวในภาพที่เล็กลงเหลือ 82%
     ซึ่งบอกได้แค่ว่าไกลขึ้น ไม่ได้บอกว่าไกลเท่าไร เดิน 4 เมตรจึงผ่านเป็น 3 เมตร
     และเดินจริง 2 เมตรแต่กล้องอยู่ใกล้ ก็ผ่านได้เหมือนกัน
     เวลาที่ได้จาก TUG จะเทียบกับเกณฑ์ 12 วินาทีของ CDC ไม่ได้เลยถ้าระยะไม่แน่

     ป้ายที่วางไว้ตรงจุดให้หลักฐานสองแบบที่ไม่ต้องสอบเทียบกล้อง
       บัง   ป้ายที่เห็นมาตลอดหายไป แปลว่ามีคนไปยืนตรงนั้น
       ข้าม  จุดกึ่งกลางไหล่เคลื่อนไปถึงตำแหน่งป้ายในภาพ
     ทั้งสองแบบเป็นการเปรียบเทียบภายในเฟรมเดียวกัน ทางยาวโฟกัส มุมมองภาพ
     และความละเอียดจึงตัดกันหมด — ต่างจากการคำนวณระยะเป็นเมตรซึ่งทำไม่ได้
     ในเบราว์เซอร์ เพราะไม่มีทางรู้ค่าพารามิเตอร์ภายในของกล้อง

     ส่วนการหยุดเวลา CDC ให้ผู้ประเมินจับจน "นั่งลงเรียบร้อย" ซึ่งกล้องแยก
     ไม่ออกจาก "เพิ่งทรุดลงเก้าอี้" กล้องจึงหยุดเร็วกว่าความจริงเสมอ
     ทำให้ผลดูดีเกินจริง ซึ่งเป็นทิศทางที่ผิดที่สุดสำหรับเครื่องมือคัดกรอง */
  {
    const bad = [];
    const app = appAll;

    /* ---- ต้องติดตามป้ายพื้นจริง ไม่ใช่แค่พิมพ์ออกมาได้ ---- */
    if (!/markStart\(\[0,1,3,4\]\)/.test(app))
      bad.push("หน้าลุกเดินไม่ได้ติดตามป้ายจุด 3 เมตรและป้ายข้างเก้าอี้");
    if (!/TUG\.pushMarks\(markNorm\(markOf\("turn"\)\),markNorm\(markOf\("start"\)\),cx,tNow\)/.test(app))
      bad.push("ไม่ได้ป้อนป้ายพื้นเข้าตัวจับเวลา");
    if (!/function markNorm\(m\)\{/.test(app))
      bad.push("ไม่มีตัวแปลงหน่วยป้ายให้ตรงกับพิกัดของโมเดลท่าทาง");

    /* ---- หลักฐานการบัง ---- */
    if (!/if\(this\.turnHid>=TUG_HIDE_N&&this\.turnHidAt!=null&&/.test(app))
      bad.push("ไม่ได้ดูว่าป้ายเริ่มถูกบังเมื่อไร ดูแต่ว่าหายมากี่เฟรม");
    if (!/\(this\.turnHidAt-this\.tWalk\)>=TUG_WALK_MIN/.test(app))
      bad.push("ป้ายที่ถูกบังอยู่ก่อนออกเดินจะถูกอ่านว่าเป็นจุดกลับตัว");
    if (!/this\.turnN>=TUG_SEEN_N/.test(app))
      bad.push("ป้ายที่ไม่เคยเห็นมั่นคงก็ถูกนับว่าถูกบัง");
    if (!/this\.homeHidAt>=this\.tTurn/.test(app))
      bad.push("ป้ายข้างเก้าอี้ที่ถูกบังตั้งแต่ตอนนั่งจะถูกอ่านว่ากลับถึงแล้ว");

    /* ---- หลักฐานแนวนอน ต้องรู้ตัวว่าเมื่อไรใช้ไม่ได้ ---- */
    if (!/span>=TUG_SPAN_MIN/.test(app) || !/sp>=TUG_SPAN_MIN/.test(app))
      bad.push("ใช้ตำแหน่งแนวนอนทั้งที่กล้องอยู่ปลายทางและวัดอะไรไม่ได้");

    /* ---- ป้ายต้องมาก่อนการเดาจากขนาดตัวเสมอ ---- */
    const ord = app.match(/if\(this\.turnHid>=TUG_HIDE_N[\s\S]{0,400}?by="size";/);
    if (!ord) bad.push("ไม่พบลำดับการเลือกหลักฐานของจุดกลับตัว");
    else if (ord[0].indexOf('by="occlude"') > ord[0].indexOf('by="size"') ||
             ord[0].indexOf('by="cross"') > ord[0].indexOf('by="size"'))
      bad.push("ใช้ขนาดตัวก่อนป้าย ทั้งที่ป้ายเป็นหลักฐานที่ตรงกว่า");

    /* ---- ต้องบันทึกว่ารู้ได้อย่างไร ไม่ใช่แค่รู้ว่าเท่าไร ---- */
    ["tugTurnBy", "tugBackBy", "tugEndedBy"].forEach((k) => {
      if (!new RegExp("S\\.draft\\." + k + "=").test(app))
        bad.push("ไม่ได้บันทึก " + k);
      if (!new RegExp(k + ":S\\.draft\\." + k).test(app))
        bad.push("ไม่ได้ส่ง " + k + " ไปกับผลประเมิน");
    });
    if (!/จุดกลับตัว: "\+tugTurnNm\(ev\.turnBy\)/.test(app))
      bad.push("บันทึกตรวจสอบไม่ได้บอกว่ายืนยันระยะด้วยอะไร");
    if (!/หยุดเวลาโดย: "\+tugEndNm\(ev\.endedBy\)/.test(app))
      bad.push("บันทึกตรวจสอบไม่ได้บอกว่าใครเป็นคนหยุดนาฬิกา");
    if (!/ประมาณจากขนาดตัวในภาพ — ไม่ได้ยืนยันด้วยป้าย/.test(app))
      bad.push("ไม่ได้บอกตรง ๆ ว่ากรณีไหนคือการประมาณ ไม่ใช่การยืนยัน");

    /* ---- ปุ่มจบ ---- */
    if (!/id="tugEnd" hidden/.test(app)) bad.push("ไม่มีปุ่มจบ หรือปุ่มไม่ได้ซ่อนไว้ก่อนเริ่ม");
    if (!/var eb=document\.getElementById\("tugEnd"\); if\(eb\)eb\.hidden=false;/.test(app))
      bad.push("ปุ่มจบไม่ได้แสดงตอนเริ่มทดสอบ");
    if (!/getElementById\("tugEnd"\)\.addEventListener\("click",function\(\)\{ endNow\("press"\) \}\)/.test(app))
      bad.push("ปุ่มจบไม่ได้ผูกกับการหยุดเวลา");
    if (!/TUG\.autoStop=!CARER\.on;/.test(app))
      bad.push("โหมดผู้ดูแลไม่ได้ปิดการหยุดเวลาเองของกล้อง");
    if (!/if\(by!=="press"&&TUG\.state!=="walkBack"\)return;/.test(app))
      bad.push("เสียงหรือมือสั่งจบได้ตั้งแต่ยังเดินไม่ถึงจุดกลับตัว");
    if (!/TugTracker\.prototype\.stop=function\(t,by\)\{/.test(app))
      bad.push("ตัวจับเวลาไม่มีทางหยุดด้วยคำสั่งของคน");

    /* ---- ห้ามอ้างเกินกว่าที่ทำได้ ---- */
    if (/ระบบวัดระยะ(ให้|เอง)|วัดระยะ 3 เมตรให้อัตโนมัติ/.test(app))
      bad.push("อ้างว่าระบบวัดระยะ 3 เมตรเอง ทั้งที่ผู้ใช้ต้องวัดด้วยตลับเมตร");

    req(7, "X-121", "จุดกลับตัวและการจบต้องมีหลักฐาน ไม่ใช่การอนุมานจากขนาดตัว",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ")
                   : "ติดตามป้ายจุด 3 เมตรและป้ายข้างเก้าอี้จริง · ยืนยันด้วยการบังและตำแหน่งก่อนเดาจากขนาดตัว · ป้ายที่ถูกบังอยู่ก่อนไม่ถูกนับ · คนกดจบได้เสมอ และโหมดผู้ดูแลปิดการหยุดเองของกล้อง · บันทึกทุกครั้งว่ายืนยันระยะด้วยอะไรและใครหยุดนาฬิกา");
    if (bad.length) finding("HIGH", "X-121", "TUG ยืนยันระยะหรือเวลาไม่ได้",
      "เกณฑ์ 12 วินาทีของ CDC ใช้ได้ต่อเมื่อระยะเป็น 3 เมตรจริงและจับเวลาจนนั่งลงเรียบร้อยจริง ถ้าระยะมาจากการเดาขนาดตัวในภาพ หรือกล้องหยุดเวลาเองตอนเพิ่งทรุดลงเก้าอี้ ตัวเลขที่ได้จะสั้นกว่าความจริงและทำให้ผู้เชี่ยวชาญประเมินความเสี่ยงต่ำเกินไป",
      bad.join(" · "), "ติดตามป้ายจุด 3 เมตรและป้ายข้างเก้าอี้ ใช้ป้ายเป็นหลักฐานก่อนขนาดตัว ให้คนกดจบได้ และบันทึกไว้เสมอว่ายืนยันด้วยอะไร");
  }

  /* ---- X-122: ทำคนเดียว ต้องมีผลจริง ไม่ใช่แค่จดไว้ ----
     CDC STEADI ให้ผู้ประเมินยืนข้าง จับแขน แล้วปล่อยเมื่อนิ่ง ในทุกท่าของ
     การทดสอบทรงตัว การทำที่บ้านโดยไม่มีใครอยู่จึงต้องเลือกว่าจะตัดท่าไหน
     ท่าต่อเท้า (ท่าที่ 3) คือเกณฑ์คัดกรองหลัก ตัดแล้วการทดสอบไม่เหลือค่า
     ท่ายืนขาเดียวคือท่าที่ล้มบ่อยที่สุดและไม่ใช่เกณฑ์คัดกรอง จึงเป็นท่าเดียว
     ที่ต้องมีคนอยู่ข้าง ๆ

     ข้อบกพร่องที่รูลนี้กัน
       · เดิมด่านความปลอดภัยถามว่ามีผู้ดูแลไหม แล้วบันทึกไว้เฉย ๆ คำตอบ "ไม่มี"
         ไม่เปลี่ยนอะไรเลย ผู้สูงอายุยังถูกพาไปยืนขาเดียวคนเดียวตามปกติ
       · มีสองที่ถามเรื่องเดียวกัน (ด่านความปลอดภัย กับสวิตช์โหมดผู้ดูแล)
         แต่ไม่คุยกัน ตอบ "มี" แล้วไม่เปิดสวิตช์ก็ได้ ผลที่บันทึกจึงขัดกันเอง
       · ถ้าข้ามท่าแล้วบันทึกเป็น "0.0 วินาที ไม่ผ่าน" ผู้เชี่ยวชาญจะอ่านว่า
         ยืนไม่ได้ ทั้งที่ความจริงคือไม่ได้ทดสอบ ซึ่งเป็นคนละเรื่องกัน */
  {
    const bad = [];
    const app = appAll;

    /* ---- แหล่งเดียว ---- */
    if (!/function testAlone\(\)/.test(app)) bad.push("ไม่มีที่เดียวที่ตอบว่าทำคนเดียวหรือไม่");
    if (!/function setCarer\(on, why\)/.test(app)) bad.push("ไม่มีทางเดียวในการตั้งโหมดผู้ดูแล");
    const direct = (app.match(/CARER\.on\s*=[^=]/g) || []).length;
    if (direct !== 2) bad.push("มีที่เขียน CARER.on ตรง ๆ " + direct + " จุด ควรมีแค่ใน setCarer และ carerLoad");
    if (!/setCarer\(a\.helper===0,"คำตอบในด่านความปลอดภัย"\);/.test(app))
      bad.push("คำตอบในด่านความปลอดภัยไม่ได้ตั้งโหมดผู้ดูแล — สองที่ยังขัดกันได้");
    if (!/setCarer\(this\.checked,"สวิตช์ในหน้าตั้งค่า"\);/.test(app))
      bad.push("สวิตช์ในหน้าตั้งค่าไม่ได้ผ่านทางเดียวกัน");
    if (!/S\.draft\.safety\.helper = CARER\.on \? 0 : 1;/.test(app))
      bad.push("เปลี่ยนสวิตช์แล้วคำตอบในด่านความปลอดภัยไม่เปลี่ยนตาม");
    if (!/S\.draft\.safetyVerdict\.alone = !CARER\.on;/.test(app))
      bad.push("เปลี่ยนสวิตช์แล้วผลคัดกรองที่บันทึกไว้ไม่เปลี่ยนตาม");

    /* ---- คำตอบต้องมีผล ---- */
    if (!/function balStagesAllowed\(\)\{ return testAlone\(\)\?BAL_ALONE_MAX:BAL_STAGES\.length \}/.test(app))
      bad.push("จำนวนท่าที่ทำได้ไม่ขึ้นกับว่าคนเดียวหรือไม่");
    const mx = app.match(/var BAL_ALONE_MAX=(\d+);/);
    if (!mx || +mx[1] !== 3) bad.push("ทำคนเดียวต้องเหลือ 3 ท่า (ตัดเฉพาะยืนขาเดียว) พบ " + (mx ? mx[1] : "ไม่มี"));
    if (!/stage\+\+;[\s\S]{0,400}if\(stage>=balStagesAllowed\(\)\)\{/.test(app))
      bad.push("ไม่มีประตูข้ามท่าตอนเลื่อนไปท่าถัดไป — ยังพาไปยืนขาเดียวคนเดียว");
    if (!/skipped:"alone"[\s\S]{0,600}finishAll\("ข้ามท่ายืนขาเดียวเพราะทำคนเดียว"\)/.test(app))
      bad.push("ข้ามท่าแล้วไม่จบชุด หรือไม่ได้บันทึกเหตุผล");
    if (!/held:0, pass:false, stage:BAL_STAGES\[stage\]\.nm, attempts:0,\s*skipped:"alone"/.test(app))
      bad.push("ท่าที่ข้ามถูกนับเป็นผ่าน หรือไม่ได้ทำเครื่องหมายว่าข้าม");

    /* ---- บอกก่อน ไม่ใช่ไปเจอตอนถึงท่าที่ 4 ---- */
    if (!/var aloneNow=testAlone\(\);[\s\S]{0,120}chip\(BAL_ALONE_MAX/.test(app))
      bad.push("ไม่ได้บอกตั้งแต่ก่อนเริ่มว่าวันนี้จะทำกี่ท่า");
    if (!/จึงทำสามท่า/.test(app)) bad.push("เสียงแนะนำไม่ได้บอกว่าทำสามท่าเมื่อคนเดียว");
    if (!/ผู้ดูแลจะเป็นคนกดเริ่มและกดหยุด ถ้าไม่มี ระบบจะข้ามท่ายืนขาเดียว/.test(app))
      bad.push("คำถามในด่านความปลอดภัยไม่ได้บอกว่าคำตอบมีผลอะไร");

    /* ---- ผู้เชี่ยวชาญต้องแยก "ไม่ได้ทดสอบ" จาก "ทดสอบแล้วไม่ผ่าน" ได้ ---- */
    if (!/r\.skipped\?\(\(i\+1\)\+"\."\+BAL_STAGES\[i\]\.nm\+" ไม่ได้ทำ \(ต้องมีผู้ดูแล\)"\)/.test(app))
      bad.push("บันทึกตรวจสอบพิมพ์ท่าที่ไม่ได้ทำเป็น 0.0 วินาที ไม่ผ่าน");
    if (!/S\.draft\.balAloneSkip=results\.some\(function\(r\)\{return r&&r\.skipped==="alone"\}\);/.test(app))
      bad.push("ไม่ได้บันทึกว่าข้ามท่าเพราะคนเดียว");
    if (!/balAlone:!!S\.draft\.balAlone, balAloneSkip:!!S\.draft\.balAloneSkip,/.test(app))
      bad.push("ผลประเมินที่ส่งต่อไม่มีข้อมูลว่าทำคนเดียวและข้ามท่าใด");

    req(7, "X-122", "ทำคนเดียวต้องข้ามท่ายืนขาเดียว และคำตอบเรื่องผู้ดูแลต้องมีที่เดียว",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ")
                   : "ด่านความปลอดภัยเป็นผู้ตั้งโหมดผู้ดูแล สวิตช์เขียนกลับที่เดียวกัน · คนเดียวเหลือ 3 ท่า ตัดเฉพาะยืนขาเดียว · บอกก่อนเริ่ม · ท่าที่ข้ามบันทึกว่าไม่ได้ทดสอบ ไม่ใช่ไม่ผ่าน");
    if (bad.length) finding("HIGH", "X-122", "ผู้สูงอายุถูกพาไปยืนขาเดียวคนเดียว",
      "STEADI ให้มีคนยืนข้างจับแขนตลอด ท่ายืนขาเดียวคือท่าที่ล้มบ่อยที่สุด ถ้าคำตอบว่าไม่มีผู้ดูแลไม่มีผลอะไรกับลำดับท่า ระบบกำลังพาคนที่บอกแล้วว่าอยู่คนเดียวไปทำท่าที่เสี่ยงที่สุด",
      bad.join(" · "), "ให้คำตอบเรื่องผู้ดูแลมีที่เดียว ตัดท่ายืนขาเดียวเมื่อคนเดียว บอกก่อนเริ่ม และบันทึกว่าไม่ได้ทดสอบ ไม่ใช่ไม่ผ่าน");
  }

  /* ---- X-123: กฎที่จุดได้ทุกข้อต้องถูกประกาศ ----
     หน้าผู้เชี่ยวชาญแสดงหลักฐานด้วย ENGINE.rules[id].nm ของทุกกฎที่ติด
     กฎที่จุดได้แต่ไม่มีในตาราง จึงไม่ใช่แค่ "ไม่มีชื่อ" แต่ทำให้ทั้งการ์ดล้ม
     และมันเกิดกับผู้ใช้ที่ติดกฎน้อยที่สุด คือคนที่มาครั้งแรกและมีกฎนั้นข้อเดียว
     เคยเกิดจริงกับ B15: แก้ให้จุดได้แล้วลืมประกาศ */
  {
    const bad = [];
    const files = { "CareSignal-App.html": appAll, "CareSignal-Vision.html": read("CareSignal-Vision.html") || "" };
    const declaredBy = {};
    Object.keys(files).forEach((f) => {
      const t = files[f];
      const blk = (t.match(/rules:\{([\s\S]*?)\},\s*cadence:/) || [])[1] || "";
      const declared = new Set([...blk.matchAll(/\b([RB]\d+):\{nm:/g)].map((m) => m[1]));
      const fired = new Set([...t.matchAll(/id:"([RB]\d+)"/g)].map((m) => m[1]));
      declaredBy[f] = declared;
      if (!declared.size) { bad.push(f + ": ไม่พบตารางกฎ"); return; }
      const missing = [...fired].filter((id) => !declared.has(id)).sort();
      if (missing.length) bad.push(f + ": จุดได้แต่ไม่ประกาศ " + missing.join(" "));
      const dead = [...declared].filter((id) => !fired.has(id)).sort();
      if (dead.length) bad.push(f + ": ประกาศแต่ไม่มีที่ไหนจุด " + dead.join(" "));
    });
    /* สองไฟล์ต้องมีชุดกฎเดียวกัน ไม่งั้นผลจากแอปจะอ่านไม่ออกในหน้าผู้เชี่ยวชาญ */
    const a = declaredBy["CareSignal-App.html"], v = declaredBy["CareSignal-Vision.html"];
    if (a && v && (a.size !== v.size || [...a].some((k) => !v.has(k))))
      bad.push("ชุดกฎของแอปกับหน้าผู้เชี่ยวชาญไม่ตรงกัน");

    req(7, "X-123", "กฎที่จุดได้ทุกข้อต้องถูกประกาศ และสองไฟล์ต้องมีชุดกฎเดียวกัน",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ")
                   : "กฎที่จุดได้ " + (a ? a.size : 0) + " ข้อ ประกาศครบ ไม่มีกฎตาย และตรงกันทั้งสองไฟล์");
    if (bad.length) finding("HIGH", "X-123", "หน้าผู้เชี่ยวชาญล้มเมื่อเจอกฎที่ไม่ได้ประกาศ",
      "การ์ดหลักฐานเปิดชื่อกฎจากตารางกลาง กฎที่จุดได้แต่ไม่อยู่ในตารางทำให้การ์ดทั้งใบไม่แสดง ผู้เชี่ยวชาญจะไม่เห็นหลักฐานใด ๆ ของผู้ใช้คนนั้นเลย",
      bad.join(" · "), "ประกาศทุกกฎที่จุดได้ในตาราง ENGINE.rules ของทุกไฟล์ที่มีเอนจิน");
  }

  /* ---- X-124: เลือกหน่วยบริการ ----
     เจ้าหน้าที่ต้องระบุหน่วยบริการก่อนเริ่มงานทุกครั้ง (แนวทาง Health Link)
     ค่านี้ถูกประทับไว้กับคำขอเปิดดูข้อมูลทุกใบ ผู้เอาประกันจึงเห็นว่าคำขอมาจากที่ใด
     เดิมเป็นช่องพิมพ์เปล่า ซึ่งพิมพ์ผิดได้ทุกวันและเทียบข้ามคนไม่ได้

     ข้อที่รูลนี้กันเป็นหลัก: รายชื่อโรงพยาบาลที่ใส่เข้ามาไม่ครบทุกหน่วยงาน
     ไม่มีกรุงเทพมหานคร ไม่มี รพ.สต. ไม่มีคลินิก ถ้าบังคับให้เลือกจากรายการ
     อย่างเดียว คนกลุ่มใหญ่ของระบบจะเริ่มงานไม่ได้เลย ช่องพิมพ์เองจึงต้อง
     มีอยู่เสมอและต้องหาเจอ ไม่ใช่ซ่อนไว้ */
  {
    const bad = [];
    const st = read("CareSignal-Staff.html") || "";
    const hosp = read("cs-hospitals.js") || "";

    if (!hosp) bad.push("ไม่มีไฟล์รายชื่อโรงพยาบาล");
    else {
      if (!/<script src="\.\/cs-hospitals\.js/.test(st)) bad.push("คอนโซลไม่ได้โหลดไฟล์รายชื่อ");
      if (!/"\.\/cs-hospitals\.js"/.test(read("sw.js") || ""))
        bad.push("service worker ไม่ได้เก็บไฟล์รายชื่อ — ออฟไลน์แล้วเลือกไม่ได้");
      if (!/localeCompare\(b, "th"\)/.test(hosp))
        bad.push("เรียงจังหวัดตามรหัสอักขระ จังหวัดขึ้นต้นด้วยสระจะถูกดันไปท้ายสุด");
      if (!/function label\(name, prov\)[\s\S]{0,120}prov/.test(hosp))
        bad.push("บันทึกชื่อโรงพยาบาลโดยไม่มีจังหวัด ทั้งที่ชื่อซ้ำข้ามจังหวัดได้");
    }

    /* ---- สองทางต้องมีครบ: เลือกจากรายการ และพิมพ์เอง ---- */
    ["orgProv", "orgHosp", "orgIn", "orgOther"].forEach((id) => {
      if (!new RegExp('id="' + id + '"').test(st)) bad.push("ไม่มีส่วน " + id + " ในกล่องเลือกหน่วยบริการ");
    });
    if (!/ไม่รวม รพ\.สต\. คลินิก และสำนักงานบริษัทประกัน/.test(st))
      bad.push("ไม่ได้บอกผู้ใช้ว่ารายการนี้ไม่ครบหน่วยงานประเภทใดบ้าง");
    if (!/grp\("โรงพยาบาลรัฐ",g\.gov\)\+grp\("โรงพยาบาลเอกชน",g\.priv\)/.test(st))
      bad.push("ไม่ได้แยกกลุ่มโรงพยาบาลรัฐกับเอกชนในตัวเลือก");
    if (!/function isPrivate\(h\)/.test(hosp) || !/function split\(prov\)/.test(hosp))
      bad.push("ไฟล์รายชื่อไม่ได้แยกรัฐกับเอกชน");
    /* ต้องเป็นคีย์ข้อมูลที่มีรายการจริง ไม่ใช่แค่คำที่โผล่ในหมายเหตุ */
    if (!/"กรุงเทพมหานคร":\[\[/.test(hosp))
      bad.push("รายชื่อไม่มีกรุงเทพมหานคร ซึ่งเป็นจังหวัดที่มีโรงพยาบาลมากที่สุด");
    if (!/var hasList = typeof CSHosp!=="undefined"/.test(st))
      bad.push("ไฟล์รายชื่อโหลดไม่ได้แล้วกล่องจะพัง แทนที่จะถอยไปใช้ช่องพิมพ์เอง");
    if (!/if\(free && !free\.hidden\)\{[\s\S]{0,200}finish\(t\); return;/.test(st))
      bad.push("อ่านค่าจากตัวเลือกก่อนช่องพิมพ์เอง สิ่งที่ผู้ใช้พิมพ์จะถูกทับ");

    /* ---- ต้องไม่ยอมให้ยืนยันค่าว่าง เพราะค่านี้ไปติดกับคำขอทุกใบ ---- */
    ["กรุณาเลือกจังหวัด", "กรุณาเลือกโรงพยาบาล", "กรุณาระบุหน่วยบริการ"].forEach((t) => {
      if (!new RegExp('toast\\("' + t + '"\\)').test(st)) bad.push("ไม่มีการตรวจ: " + t);
    });
    if (!/list\.slice\(0,3\)/.test(st) || !/data-org="'\+esc\(o\)\+'"/.test(st))
      bad.push("ไม่ได้ให้เลือกหน่วยบริการที่เคยใช้ด้วยการแตะครั้งเดียว");

    req(7, "X-124", "เลือกหน่วยบริการจากรายชื่อได้ และหน่วยงานนอกรายชื่อยังพิมพ์เองได้เสมอ",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ")
                   : "จังหวัดแล้วโรงพยาบาล เรียงแบบไทย บันทึกพร้อมจังหวัด · บอกขอบเขตของรายการตรง ๆ · พิมพ์เองได้เสมอและมาก่อนตัวเลือก · แตะซ้ำหน่วยเดิมได้ทันที");
    if (bad.length) finding("MED", "X-124", "เลือกหน่วยบริการไม่ได้ หรือเลือกผิดโดยไม่รู้ตัว",
      "หน่วยบริการถูกประทับไว้กับคำขอเปิดดูข้อมูลทุกใบ ถ้าเลือกไม่ได้ เจ้าหน้าที่จะเริ่มงานไม่ได้ ถ้าบันทึกชื่อโดยไม่มีจังหวัด คำขอจากโรงพยาบาลชื่อซ้ำกันสี่จังหวัดจะแยกไม่ออกตอนตรวจย้อนหลัง",
      bad.join(" · "), "ให้เลือกจังหวัดแล้วโรงพยาบาล บันทึกพร้อมจังหวัด และคงช่องพิมพ์เองไว้สำหรับหน่วยงานนอกรายการ");
  }

  /* ---- X-125: เว็บส่วนที่ 2 = คู่มือ + ผลที่ยืนยันแล้ว ไม่ใช่ที่ทำการตรวจ ----
     การตรวจร่างกายต้องทำในแอปบนมือถือ เพราะต้องใช้กล้อง เซ็นเซอร์ และเสียง
     ของเครื่อง หน้าเว็บมีสองหน้าที่: บอกล่วงหน้าว่าต้องทำอะไร และแสดงผล
     "หลังผู้เชี่ยวชาญยืนยันแล้ว" เท่านั้น — คะแนนดิบจากกล้องไม่ควรขึ้นเว็บ
     เพราะยังไม่ผ่านคน และเว็บคือที่ที่ครอบครัวเปิดดูโดยไม่มีบริบท */
  {
    const bad = [];
    const idx = read("index.html") || "";
    const app = appAll;

    /* ---- เว็บ ---- */
    if (/data-src="try"/.test(idx) || /try\s*:\s*"\.\/CareSignal-Vision\.html"/.test(idx))
      bad.push("ส่วนที่ 2 ยังฝังโปรแกรมทดลองวัด — การตรวจอยู่บนเว็บ");
    if (!/CareSignal-App\.html\?view=results/.test(idx))
      bad.push("กรอบสมาชิกไม่ได้เปิดแอปในโหมดดูผลเท่านั้น");
    if (!/data-mv="guide"/.test(idx) || !/data-mv="results"/.test(idx))
      bad.push("ส่วนที่ 2 ไม่มีสองแท็บ คู่มือ/ผลที่ยืนยันแล้ว");
    const g0 = idx.indexOf('id="g-member"'), g1 = idx.indexOf('id="f-member"');
    const guide = g0 >= 0 && g1 > g0 ? idx.slice(g0, g1) : "";
    const titles = [...app.matchAll(/\{k:"[a-z]+",\s+ic:"[^"]+",\s+t:"([^"]+)"/g)].map((m) => m[1]);
    if (titles.length !== 8) bad.push("อ่านชื่อ 8 ขั้นจากแอปไม่ได้ (" + titles.length + ")");
    const miss = titles.filter((t) => guide.indexOf(t) < 0);
    if (miss.length) bad.push("คู่มือขาดขั้น: " + miss.join(", "));
    ["กอดอกไว้", "ยืนหันข้างให้กล้อง", "หมุนกลับตรงป้าย ไม่หมุนก่อนถึง",
     "ยืนขาเดียวทำเฉพาะเมื่อมีคนอยู่ข้าง ๆ", "ปุ่มหยุดทันทีอยู่บนจอตลอด", "พิมพ์ที่ขนาด 100%"].forEach((t) => {
      if (guide.indexOf(t) < 0) bad.push("คู่มือไม่ได้บอกท่าทางสำคัญ: " + t);
    });
    if (!/การตรวจทั้งหมดทำในแอป CareSignal บนมือถือ/.test(guide))
      bad.push("คู่มือไม่ได้บอกว่าการตรวจทำในแอปมือถือ");

    /* ---- แอปในโหมดดูผล ---- */
    if (!/function appMode\(\)/.test(app) || !/RESULTS_ONLY=\["welcome","login","results"\]/.test(app))
      bad.push("แอปไม่มีโหมดดูผลที่จำกัดหน้า");
    const go = (app.match(/function go\(sc,arg\)\{[\s\S]{0,900}?\n\}/) || [""])[0];
    if (!/S\.mode==="results"/.test(go) || !/sc=S\.data\.profile\?"results":"welcome"/.test(go))
      bad.push("go() ไม่ได้กันหน้าตรวจในโหมดดูผล");
    if (!/go\(S\.mode==="results"\?"results":"home"\)/.test(app))
      bad.push("เข้าสู่ระบบในโหมดดูผลแล้วไปหน้าแรกของแอปเต็ม");
    const rv = (app.match(/async function resultsV\(\)\{[\s\S]*?\n\}/) || [""])[0];
    if (!rv) bad.push("ไม่มีหน้า resultsV");
    else {
      if (!/CSBackend\.myReferrals\(\)/.test(rv)) bad.push("หน้าผลไม่ได้อ่านจากใบส่งต่อ");
      if (/\.score\b|\.ftsst\b|\.tug\b|balPassed|barthel/.test(rv))
        bad.push("หน้าผลแสดงคะแนนดิบที่ยังไม่ผ่านผู้เชี่ยวชาญ");
      if (!/rv\.finding/.test(rv) || !/rv\.recommend/.test(rv) || !/NEXT_NM\[/.test(rv))
        bad.push("หน้าผลไม่ได้แสดงข้อค้นพบ คำแนะนำ และขั้นตอนถัดไป");
      if (!/รอผู้เชี่ยวชาญ/.test(rv)) bad.push("ใบที่ยังไม่มีผลไม่ได้บอกว่ารอผู้เชี่ยวชาญ");
      if (/assessIntro|data-go="home"|data-go="calib"/.test(rv)) bad.push("หน้าผลมีทางไปหน้าตรวจ");
    }

    req(7, "X-125", "เว็บส่วนที่ 2 บอกสิ่งที่ต้องทำ และแสดงเฉพาะผลที่ผู้เชี่ยวชาญยืนยันแล้ว",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ")
                   : "ไม่มีโปรแกรมตรวจบนเว็บ · คู่มือครบ 8 ขั้นชื่อตรงกับแอปพร้อมท่าทางสำคัญ · แอปโหมดดูผลไปถึงหน้าตรวจไม่ได้ · หน้าผลแสดงเฉพาะสิ่งที่ผู้เชี่ยวชาญส่งกลับ");
    if (bad.length) finding("MED", "X-125", "เว็บทำหน้าที่เกินขอบเขต หรือคู่มือไม่ตรงกับแอป",
      "ถ้าเว็บเปิดให้ตรวจได้ คนจะตรวจบนจอคอมที่ไม่มีกล้องมองเห็นทั้งตัว ผลจะแย่กว่าแอปโดยไม่รู้ตัว ถ้าเว็บโชว์คะแนนดิบ ครอบครัวจะอ่านตัวเลขที่ยังไม่ผ่านคนเป็นคำตัดสิน",
      bad.join(" · "), "ให้เว็บมีแค่คู่มือกับผลที่ยืนยันแล้ว และให้แอปในโหมดดูผลปิดทางไปหน้าตรวจ");
  }

  /* ---- X-126: แดชบอร์ดมาตรฐานโรงพยาบาล — ชุดเดียวทุกหน้ารายการ ----
     เจ้าหน้าที่ใช้คอนโซลนี้ทั้งวันบนจอเคาน์เตอร์และบนมือถือ
     ถ้าแต่ละหน้าวาดรายการคนละแบบ จะไม่มีที่ไหนเรียงหรือค้นหาได้
     และแถวเกินกำหนดจะไม่โดดออกมา — สามชิ้นร่วมนี้ต้องอยู่ครบทุกหน้า */
  {
    const bad = [];
    const st = read("CareSignal-Staff.html") || "";
    const pf = read("CareSignal-Portfolio-Dashboard.html") || "";
    ["function kpiRow(", "function sortRows(", "function searchRows(", "function dashTable(", "function dashInner(", "function bindDash("].forEach((f) => {
      if (st.indexOf(f) < 0) bad.push("ไม่มีชิ้นส่วนร่วม " + f);
    });
    const uses = (st.match(/dashTable\(\{id:"([a-z]+)"/g) || []).map((m) => m.match(/id:"([a-z]+)"/)[1]);
    ["queue", "mine", "refer", "meds", "port", "audit"].forEach((k) => {
      if (uses.indexOf(k) < 0) bad.push("หน้า " + k + " ไม่ได้ใช้ตารางมาตรฐาน");
    });
    if (!/function head\(t,p,n\)/.test(st) || !/id="hdClk"/.test(st) || !/🏥 <b>'\+esc\(ST\.org\)/.test(st))
      bad.push("หัวหน้าไม่มีหน่วยบริการ จำนวนรายการ และเวลาจริง");
    ["งานวันนี้", "งานของฉัน", "ติดตามการส่งต่อ", "ทบทวนยา", "พอร์ตความเสี่ยง", "บันทึกตรวจสอบ", "จัดการผู้ใช้"].forEach((t) => {
      if (!new RegExp('head\\("' + t + '",[^;]*,\\s*(rows|q|n)(\\.length)?\\)').test(st)) bad.push("หน้า " + t + " ไม่ได้ส่งจำนวนรายการเข้าหัวหน้า");
    });
    if (!/\.dtbl td::before\{content:attr\(data-th\)/.test(st)) bad.push("จอแคบไม่พับตารางเป็นการ์ด");
    if (!/<td data-th="'\+esc\(c\.label\)\+'"/.test(st)) bad.push("ช่องตารางไม่มี data-th จึงพับเป็นการ์ดไม่ได้");
    if (!/\.dtbl tbody tr\.late td\{background:var\(--c1t\)\}/.test(st)) bad.push("แถวเกินกำหนดไม่ย้อมสี");
    if (!/th\[data-sort\]/.test(st) || !/st\.sort=\(st\.sort&&st\.sort\.k===k\)/.test(st)) bad.push("หัวคอลัมน์เรียงไม่ได้");
    if (!/class="dsearch"/.test(st) || !/function searchRows/.test(st)) bad.push("ตารางค้นหาไม่ได้");
    if (!/class="pthead"/.test(st) || !/pthead" style="border-left-color:'\+\(LV_C\[c\.level\]/.test(st))
      bad.push("หน้ารายละเอียดเคสไม่มีแถบผู้ป่วยแบบหัวเวชระเบียน");
    /* สีบนตารางต้องมาจากระดับเท่านั้น — ไม่มีสีสุ่มในหน้ารายการ */
    const listBlocks = ["renderQueue", "mineV", "portV", "auditV"].map((f) => (st.match(new RegExp("function " + f + "\\([\\s\\S]*?\\n\\}")) || [""])[0]).join("\n");
    if (/#[0-9A-Fa-f]{6}/.test(listBlocks.replace(/#5B77B4|#D9E1EC|#64748B/g, ""))) bad.push("หน้ารายการใช้สีฮาร์ดโค้ดนอกระบบระดับ");
    if (/linear-gradient\(160deg,#1E3A8A/.test(pf) || !/--brand:#1D4E9A/.test(pf)) bad.push("แดชบอร์ดบริษัทประกันยังคนละโทนกับคอนโซล");

    req(7, "X-126", "ทุกหน้ารายการใช้แดชบอร์ดมาตรฐานโรงพยาบาลชุดเดียวกัน",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ") : "หัวหน้า+KPI+ตารางมาตรฐานครบ 6 หน้า · เรียง/ค้นหาได้ · แถวเกินกำหนดย้อมสี · จอแคบพับเป็นการ์ด · แถบผู้ป่วยบนหน้าเคส · แดชบอร์ดบริษัทประกันโทนเดียวกัน");
    if (bad.length) finding("MED", "X-126", "หน้ารายการไม่เป็นมาตรฐานเดียวกัน",
      "เจ้าหน้าที่ต้องเรียนรู้ใหม่ทุกหน้า เรียงหรือค้นหาไม่ได้ และเคสเกินกำหนดไม่โดดออกมาจากรายการ", bad.join(" · "),
      "ให้ทุกหน้ารายการประกอบจาก head()+kpiRow()+dashTable() และคงกติกาสี=ระดับเท่านั้น");
  }

  /* ---- X-127: ภาษาบนเว็บตรงกับสิ่งที่ระบบเป็นจริง ----
     ตรรกะหลักเป็นกฎที่ประกาศไว้ ไม่ใช่ AI จึงต้องไม่เรียกตัวเองว่า AI ในข้อความถึงผู้ใช้
     รอบตรวจซ้ำที่เว็บบอกต้องเท่ากับ ENGINE.cadence ในแอป (กรรมการจับได้ทันทีถ้าสองที่บอกไม่เท่ากัน)
     และเว็บต้องบอกโมเดลธุรกิจเป็นตัวเลขที่ตรวจได้ โดยแยก "เป้าหมาย" ออกจาก "ผลที่วัดแล้ว" */
  {
    const bad = [];
    ["index.html", "CareSignal-App.html", "CareSignal-Staff.html", "CareSignal-Portfolio-Dashboard.html", "CareSignal-Vision.html"].forEach((f) => {
      const src = (read(f) || "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/<!--[\s\S]*?-->/g, "").replace(/(^|\n)\s*\/\/[^\n]*/g, "");
      const m = src.match(/(^|[^A-Za-z])AI([^A-Za-z]|$)/g);
      if (m) bad.push(f + " เรียกตัวเองว่า AI " + m.length + " ครั้ง ทั้งที่ตรรกะหลักเป็นกฎ");
    });
    const ix = read("index.html") || "", app = read("CareSignal-App.html") || "";
    const cad = app.match(/cadence:\{stable:(\d+), watch:(\d+), decline:(\d+), urgent:(\d+)\}/);
    if (!cad) bad.push("หา ENGINE.cadence ในแอปไม่พบ");
    else {
      if (ix.indexOf("ถี่ตามระดับ: " + cad[4] + " ถึง " + cad[1] + " วัน") < 0) bad.push("รอบตรวจซ้ำในวงจรบนเว็บไม่ตรงกับ ENGINE.cadence");
      if (!new RegExp("ติดตาม " + cad[4] + "–" + cad[1] + " วัน").test(ix)) bad.push("ขั้นที่ 4 ของวงจร STEADI บนเว็บบอกรอบไม่ตรงกับแอป");
    }
    if (/2 สัปดาห์ ถึง 6 เดือน|ติดตาม 30–90 วัน/.test(ix)) bad.push("ยังมีรอบตรวจซ้ำชุดเก่าบนเว็บ");
    if (/เซ็นเซอร์ หรือเรดาร์/.test(ix)) bad.push("เว็บยังชูโหมดเซ็นเซอร์ที่ไม่อยู่ในเดโมหลัก");
    if (!/id="bizmodel"/.test(ix)) bad.push("เว็บไม่มีส่วนโมเดลธุรกิจ");
    if (!/50–150 บาท/.test(ix) || !/time-to-contact/.test(ix) || !/12–24 เดือน/.test(ix)) bad.push("โมเดลธุรกิจไม่ระบุ PMPM ตัวชี้วัด และช่วงเวลาที่วัดผลระยะยาว");
    if (!/ไม่ใช่ผลที่วัดแล้ว/.test(ix)) bad.push("ตารางเทียบไม่ได้บอกว่าเป็นเป้าหมาย");
    if (!/สิ่งที่ยังไม่พิสูจน์/.test(ix) || !/ยังไม่มีหลักฐานว่าลดเคลม/.test(ix)) bad.push("เว็บไม่มีรายการสิ่งที่ยังไม่พิสูจน์");
    if (!/ไม่ได้สัญญาว่าจะทำนายการหกล้มได้อย่างสมบูรณ์/.test(ix)) bad.push("ไม่มีประโยคแกนกลางของการนำเสนอ");
    req(7, "X-127", "ภาษาบนเว็บตรงกับความจริงของระบบ: ไม่เรียกตัวเองว่า AI · รอบตรวจซ้ำตรงกับแอป · โมเดลธุรกิจแยกเป้าหมายจากผลที่วัดแล้ว",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ") : "ไม่มีคำว่า AI · รอบตรวจซ้ำ " + (cad ? cad[4] + "–" + cad[1] : "?") + " วันตรงกัน · มีโมเดลธุรกิจ ตารางเป้าหมาย รายการสิ่งที่ยังไม่พิสูจน์ และประโยคแกนกลาง");
    if (bad.length) finding("MED", "X-127", "เว็บอ้างเกินจริงหรือบอกตัวเลขไม่ตรงกับแอป",
      "กรรมการเทียบสองหน้าจอแล้วเจอตัวเลขคนละชุด หรือได้ยินคำว่า AI ทั้งที่ตรรกะเป็นกฎ ความน่าเชื่อถือทั้งงานหายทันที",
      "แก้ข้อความบนเว็บให้อ่านค่าเดียวกับแอป และติดป้าย เป้าหมาย กับทุกตัวเลขที่ยังไม่ได้วัด");
  }

  /* ---- X-128: โหมดสาธิตติดป้ายชัด แยกจากของจริง และไม่แตะฐานข้อมูล ----
     เดโมบนเวทีต้องซ้ำได้และปลอดภัย: ข้อมูลสังเคราะห์ทั้งหมด ทุกหน้าจอมีแถบบอก
     ทับทุกฟังก์ชันของ backend (ฟังก์ชันที่ลืมทับคือทางหลุดไปฐานข้อมูลจริง)
     และแอปสมาชิกต้องไม่โหลดโหมดนี้ เพราะผลตรวจจริงห้ามปนกับข้อมูลสังเคราะห์ */
  {
    const bad = [];
    const d = read("cs-demo.js") || "", st = read("CareSignal-Staff.html") || "", pf = read("CareSignal-Portfolio-Dashboard.html") || "", app = read("CareSignal-App.html") || "", sw = read("sw.js") || "";
    if (!d) bad.push("ไม่มี cs-demo.js");
    if (!/ข้อมูลสาธิต/.test(d) || !/ไม่ใช่บุคคลจริง/.test(d) || !/id = "csDemoBar"/.test(d)) bad.push("แถบกำกับไม่บอกว่าเป็นข้อมูลสังเคราะห์");
    if (!/"DEMO-" \+ pad\(i, 2\)/.test(d) || !/"สาธิต " \+ NAMES/.test(d)) bad.push("ชื่อ/รหัสสาธิตไม่มีคำนำหน้าที่แยกจากของจริงด้วยตาเปล่า");
    if (/supabase|CS_CONFIG|esm\.sh|fetch\(/.test(d)) bad.push("โหมดสาธิตอ้างถึงฐานข้อมูลจริง");
    if (!/Object\.keys\(CSBackend\)\.forEach/.test(d)) bad.push("ฟังก์ชันที่ไม่ได้ทับอาจหลุดไปฐานข้อมูลจริง");
    if (!/sessionStorage/.test(d) || /localStorage/.test(d)) bad.push("สถานะสาธิตต้องอยู่ใน sessionStorage เท่านั้น จะได้หายเมื่อปิดแท็บ");
    if (st.indexOf("cs-demo.js") < 0 || st.indexOf("cs-demo.js") < st.indexOf("cs-backend.js")) bad.push("คอนโซลไม่ได้โหลดโหมดสาธิตหลัง backend");
    if (pf.indexOf("cs-demo.js") < 0 || pf.indexOf("cs-demo.js") < pf.indexOf("cs-backend.js")) bad.push("แดชบอร์ดไม่ได้โหลดโหมดสาธิตหลัง backend");
    if (app.indexOf("cs-demo.js") >= 0) bad.push("แอปสมาชิกโหลดโหมดสาธิต ผลตรวจจริงอาจปนกับข้อมูลสังเคราะห์");
    if (sw.indexOf("./cs-demo.js") < 0) bad.push("service worker ไม่ precache cs-demo.js เดโมออฟไลน์จะล้ม");
    const ix = read("index.html") || "";
    if (!/CareSignal-Staff\.html\?demo=1/.test(ix) || !/Portfolio-Dashboard\.html\?demo=1/.test(ix)) bad.push("เว็บไม่บอกทางเข้าโหมดสาธิต");
    req(7, "X-128", "โหมดสาธิตใช้ข้อมูลสังเคราะห์ที่ติดป้ายทุกหน้าจอ ทับ backend ครบ และไม่เข้าแอปสมาชิก",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ") : "cs-demo.js ทับ CSBackend ทั้งหมด · แถบ ข้อมูลสาธิต ทุกหน้า · ชื่อขึ้นต้น สาธิต รหัส DEMO- · sessionStorage · ไม่แตะแอปสมาชิก");
    if (bad.length) finding("HIGH", "X-128", "เดโมอาจปนข้อมูลจริงหรือไม่บอกว่าเป็นข้อมูลจำลอง",
      "ตัวเลขสังเคราะห์ถูกอ่านเป็นหลักฐานทางธุรกิจ หรือการกดบนเวทีไปเขียนฐานข้อมูลจริง",
      "ให้ cs-demo.js ทับทุกฟังก์ชันของ CSBackend และแสดงแถบกำกับที่ปิดไม่ได้");
  }

  /* ---- X-129: แผ่นที่พิมพ์ไปใช้จริง ต้องอ่านออกและกรอกกลับเข้าระบบได้ ----
     แผ่นป้าย: ชื่อป้ายต้องอยู่ในกรอบตัดเดียวกับตัวป้าย เคยมีบั๊กที่ชื่อถูกวางใต้กรอบ
     แล้วพื้นขาวของการ์ดใบถัดไปทับจนหาย ป้ายหน้าอกกับป้ายเอวจึงออกมาไม่มีชื่อทั้งคู่
     ซึ่งสลับกันได้ง่ายและทำให้ค่าการโคลงของลำตัวผิดตั้งแต่ยังไม่เริ่มวัด
     ชุดทดสอบภาคสนาม: ห้ามมีช่องชื่อจริง และคอลัมน์ที่กระดาษอ้างถึงต้องมีจริงใน
     validation_trials ไม่งั้นข้อมูลที่อุตส่าห์ไปเก็บมาจะกรอกเข้าระบบไม่ได้ */
  {
    const bad = [];
    const mk = read("tools/make-marker-pdf.mjs") || "";
    const ft = read("tools/make-fieldtest-pdf.mjs") || "";
    const vsql = read("supabase/04_validation_and_mrv.sql") || "";
    if (!mk) bad.push("ไม่มีตัวสร้างแผ่นป้าย");
    if (!/total \+ LABEL_H \+ fold \+ 2 \* CUT_PAD/.test(mk))
      bad.push("กรอบตัดของแผ่นป้ายไม่ได้ล้อมแถบชื่อและฐานพับ ชื่อป้ายจะถูกทับหายอีก");
    if (/markerBlock\(p, \d, x, 297 - MARGIN - 12 - \(total \+ 16\)/.test(mk))
      bad.push("ยังใช้ตำแหน่งการ์ดชุดเก่าที่ทำให้การ์ดทับกัน");
    if (!ft) bad.push("ไม่มีชุดทดสอบภาคสนาม (tools/make-fieldtest-pdf.mjs)");
    if (/ชื่อ-นามสกุลผู้เข้าร่วม|ชื่อจริงผู้เข้าร่วม/.test(ft))
      bad.push("ชุดทดสอบภาคสนามมีช่องให้กรอกชื่อจริง");
    if (!/ห้ามกรอกชื่อจริงเข้าระบบ/.test(ft) || !/1669/.test(ft))
      bad.push("ชุดทดสอบภาคสนามไม่มีข้อห้ามเรื่องชื่อจริง หรือไม่มีเบอร์ฉุกเฉิน");
    const dbCols = ((vsql.match(/create table if not exists public\.validation_trials \(([\s\S]*?)\n\);/) || ["", ""])[1])
      .split("\n").map((l) => (l.trim().split(/\s+/)[0] || "")).filter((c) => /^[a-z][a-z0-9_]*$/.test(c));
    ["site", "participant_code", "trial_no", "cs_seconds", "ref1_seconds", "ref2_seconds",
     "reps", "reps_correct", "setup_sec", "tech_fail", "notes"].forEach((c) => {
      if (ft.indexOf('"' + c + '"') < 0) bad.push("กระดาษไม่ได้แมปคอลัมน์ " + c);
      else if (dbCols.indexOf(c) < 0) bad.push("กระดาษแมปคอลัมน์ " + c + " ที่ไม่มีในฐานข้อมูล");
    });
    const ix = read("index.html") || "";
    if (!/แผ่นป้าย 6 หน้า/.test(ix) || /แผ่นป้าย 5 หน้า|ห้าหน้าพร้อมพิมพ์/.test(ix))
      bad.push("เว็บยังบอกจำนวนหน้าแผ่นป้ายเป็นชุดเก่า");
    req(7, "X-129", "แผ่นพิมพ์ใช้งานได้จริง: ชื่อป้ายอยู่ในกรอบตัด และแบบบันทึกภาคสนามกรอกกลับเข้าระบบได้",
        bad.length ? "FAIL" : "PASS",
        bad.length ? bad.join(" · ")
                   : "ชื่อป้ายและฐานพับอยู่ในกรอบตัดเดียวกัน · แบบบันทึกไม่มีช่องชื่อจริง และแมปครบ 11 คอลัมน์ที่มีจริงใน validation_trials");
    if (bad.length) finding("MED", "X-129", "แผ่นที่พิมพ์ไปใช้จริงมีข้อบกพร่อง",
      "ป้ายไม่มีชื่อทำให้ติดสลับหน้าอกกับเอว หรือข้อมูลที่ไปเก็บมากรอกเข้าระบบไม่ได้",
      "แก้ให้กรอบตัดล้อมแถบชื่อ และให้ชื่อคอลัมน์ในกระดาษตรงกับ validation_trials");
  }

  /* ---- ภาษาที่ห้ามใช้กับผู้ใช้ (NICE ไม่แนะนำให้แสดงความน่าจะเป็นว่าจะหกล้ม) ---- */
  const banned = [
    ["X-10", "ห้ามเรียกผู้ใช้ว่า \"ผู้ป่วย Red\"", /ผู้ป่วย\s*(Red|แดง)/i],
    ["X-11", "ห้ามแสดงความน่าจะเป็นว่าจะหกล้ม", /(?:เสี่ยง|โอกาส)หกล้ม\s*\d+\s*%/],
    ["X-12", "ห้ามอ้างว่า AI วินิจฉัย", /AI\s*(?:วินิจฉัย|ตรวจพบว่าเป็นโรค)/],
    ["X-13", "ห้ามสั่งให้หยุดยาเอง", /(?:ควร|ให้|กรุณา)หยุดยา(?!เอง)/],
  ];
  for (const [id, name, re] of banned) {
    const hits = [];
    for (const f of uiAll) {
      const t = read(f); if (!t) continue;
      for (const m of t.matchAll(new RegExp(re.source, "gi"))) {
        const before = t.slice(Math.max(0, m.index - 100), m.index).replace(/\s+/g, " ");
        if (/ไม่|ห้าม|เลิก|ถอด/.test(before)) continue;
        hits.push(`${f}:${t.slice(0, m.index).split("\n").length} «${m[0]}»`);
      }
    }
    req(7, id, name, hits.length ? "VIOLATION" : "PASS", hits.slice(0, 2).join(" · ") || "ไม่พบ");
    if (hits.length) finding("HIGH", id, "ภาษาที่อาจทำให้เข้าใจผิด: " + name,
      "ถ้อยคำนี้ทำให้ผู้ใช้เข้าใจว่าระบบวินิจฉัยหรือทำนายผล ทั้งที่ระบบสร้างสัญญาณเพื่อการติดตามเท่านั้น",
      hits.slice(0, 3).join(" · "), "เปลี่ยนเป็นภาษาที่บอกสิ่งที่พบและสิ่งที่ต้องทำต่อ");
  }
}

/* ============================================================
   สรุปผลและออกรายงาน
   ============================================================ */
function verdict() {
  const crit = F.filter(f => f.sev === "CRITICAL").length;
  const high = F.filter(f => f.sev === "HIGH").length;
  if (crit) return "FAIL";
  if (high) return "CONDITIONAL PASS";
  return F.length ? "CONDITIONAL PASS" : "PASS";
}

function report() {
  const now = new Date().toISOString().slice(0, 16).replace("T", " ");
  const v = verdict();
  const byLayer = (n) => R.filter(r => r.layer === n);
  const LN = { 1: "ความครบถ้วนของฟีเจอร์", 2: "Workflow แบบ End-to-End",
               3: "ขอบเขตของระบบ", 4: "Rules Engine (รันจริง)",
               5: "สิทธิ์และข้อมูลส่วนบุคคล", 6: "สิ่งที่ตรวจยืนยันไม่ได้",
               7: "UI/UX ตามโครง CDC STEADI" };
  const cnt = (s) => R.filter(r => r.status === s).length;

  let md = `# CareSignal — รายงานการตรวจสอบความสอดคล้อง

| | |
|---|---|
| วันที่ตรวจ | ${now} |
| เวอร์ชันที่ตรวจ | ${(read("CareSignal-Vision.html") || "").match(/version:"([^"]+)"/)?.[1] || "—"} |
| ขอบเขต | requirements · workflow · scope · rules engine · สิทธิ์ข้อมูล |
| ผู้ตรวจ | เครื่องมืออัตโนมัติ (อ่านอย่างเดียว ไม่แก้ระบบ) |
| **ผลรวม** | **${v}** |

> ตัวตรวจนี้ตรวจ "ความสอดคล้องระหว่างโปรแกรมกับแผนงาน" เท่านั้น
> **ไม่ใช่การรับรองทางคลินิก และไม่ใช่การยืนยันว่าระบบพร้อมใช้งานจริง**
> ข้อที่ตรวจด้วยการอ่านโค้ดไม่ได้ ถูกรายงานเป็น UNVERIFIABLE ไม่นับเป็นผ่าน

## สรุปตัวเลข

| สถานะ | จำนวน |
|---|---:|
| PASS | ${cnt("PASS")} |
| PARTIAL | ${cnt("PARTIAL")} |
| MISSING | ${cnt("MISSING")} |
| VIOLATION | ${cnt("VIOLATION")} |
| UNVERIFIABLE | ${cnt("UNVERIFIABLE")} |

| ความรุนแรงของสิ่งที่พบ | จำนวน |
|---|---:|
| Critical | ${F.filter(f => f.sev === "CRITICAL").length} |
| High | ${F.filter(f => f.sev === "HIGH").length} |
| Medium | ${F.filter(f => f.sev === "MEDIUM").length} |
| Low | ${F.filter(f => f.sev === "LOW").length} |
`;

  for (const n of [1, 2, 3, 4, 5, 6, 7]) {
    const rows = byLayer(n); if (!rows.length) continue;
    md += `\n## ชั้นที่ ${n} — ${LN[n]}\n\n| รหัส | ข้อกำหนด | สถานะ | หลักฐาน |\n|---|---|---|---|\n`;
    for (const r of rows) {
      md += `| ${r.id} | ${r.requirement} | ${r.status} | ${(r.evidence || "-").slice(0, 150)}${r.note ? " · " + r.note : ""} |\n`;
    }
  }

  md += `\n## สิ่งที่พบและข้อเสนอแก้ไข\n\n`;
  if (!F.length) md += `ไม่พบข้อขัดแย้งกับแผนงานในรอบนี้\n`;
  else {
    F.sort((a, b) => SEV[a.sev] - SEV[b.sev]);
    for (const f of F) {
      md += `### [${f.sev}] ${f.id} — ${f.title}\n\n`;
      md += `- **ปัญหา:** ${f.detail}\n- **หลักฐาน:** ${f.evidence}\n- **ข้อเสนอแก้ไข:** ${f.fix}\n\n`;
    }
  }

  md += `\n## เกณฑ์การตัดสิน\n
- **FAIL** — พบ Critical อย่างน้อย 1 ข้อ
- **CONDITIONAL PASS** — ไม่มี Critical แต่มี High/Medium หรือมีข้อที่ยืนยันไม่ได้ในจุดสำคัญ
- **PASS** — ไม่พบข้อขัดแย้งเลย

## ข้อจำกัดของการตรวจนี้ (ประกาศไว้ให้ชัด)

1. ตรวจจากซอร์สโค้ดและสคีมา **ไม่ได้ตรวจระบบที่กำลังรันจริงกับผู้ใช้จริง**
2. **ไม่ได้ตรวจความถูกต้องทางคลินิก** ของเกณฑ์ที่ใช้ — ตรวจเพียงว่าระบบทำตามเกณฑ์ที่ประกาศไว้
3. การไม่พบรูปแบบต้องห้าม **ไม่ได้แปลว่าไม่มีทางเกิดขึ้นได้** เพียงแปลว่าไม่พบด้วยวิธีที่ใช้
4. ผลนี้**ใช้แทนการตรวจโดยผู้เชี่ยวชาญไม่ได้** และไม่ใช่หลักฐานว่าผ่าน clinical validation
`;
  return md;
}

/* ---------- รัน ---------- */
layer1(); layer2(); layer3(); layer4(); layer5(); layer6(); layer7();
const md = report();
fs.mkdirSync(path.join(ROOT, "audit"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "audit", "report-latest.md"), md, "utf8");

const v = verdict();
console.log("=".repeat(64));
console.log("CareSignal Compliance Audit —", v);
console.log("=".repeat(64));
for (const n of [1, 2, 3, 4, 5, 6, 7]) {
  const rows = R.filter(r => r.layer === n);
  const bad = rows.filter(r => r.status !== "PASS" && r.status !== "UNVERIFIABLE");
  console.log(`ชั้น ${n}: ${rows.filter(r => r.status === "PASS").length}/${rows.length} ผ่าน` +
              (bad.length ? `  ← ${bad.map(b => b.id + ":" + b.status).join(", ")}` : ""));
}
console.log("-".repeat(64));
if (F.length) {
  F.sort((a, b) => SEV[a.sev] - SEV[b.sev]);
  for (const f of F) console.log(`[${f.sev}] ${f.id} ${f.title}\n         ${f.evidence}`);
} else console.log("ไม่พบข้อขัดแย้งกับแผนงาน");
console.log("-".repeat(64));
console.log("ยืนยันไม่ได้ (ต้องทดสอบภาคสนาม):",
  R.filter(r => r.status === "UNVERIFIABLE").length, "ข้อ");
console.log("รายงานเต็ม: audit/report-latest.md");
process.exit(v === "FAIL" ? 1 : 0);
