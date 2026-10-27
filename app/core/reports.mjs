let embeddedFonts='';
export async function prepareFonts(){if(embeddedFonts)return;const list=await Promise.all([['NanumSquareR.ttf',400],['NanumSquareB.ttf',700]].map(async([name,weight])=>{const res=await fetch(new URL('../fonts/'+name,import.meta.url));if(!res.ok)throw Error('인쇄 글꼴을 불러오지 못했습니다.');const bytes=new Uint8Array(await res.arrayBuffer());let binary='';for(let i=0;i<bytes.length;i+=16384)binary+=String.fromCharCode(...bytes.subarray(i,i+16384));return '@font-face{font-family:NanumSquare;font-weight:'+weight+';src:url(data:font/ttf;base64,'+btoa(binary)+')}';}));embeddedFonts=list.join('');}
const fontCSS=()=>embeddedFonts;
import { dateOK, expandRecurrences } from "./domain.mjs";
const labels = {
  planned: "예정",
  progress: "진행 중",
  waiting: "대기",
  done: "완료",
  canceled: "취소",
  moved: "이월",
  open: "확인 전",
  answered: "해결",
  hold: "보류",
};
const esc = (x) =>
  String(x ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
function range(o) {
  if (!dateOK(o.date)) throw Error("출력 날짜를 확인해 주세요.");
  const y = o.date.slice(0, 4),
    m = o.date.slice(0, 7);
  const end = new Date(Date.UTC(Number(y), Number(o.date.slice(5, 7)), 0, 12))
    .toISOString()
    .slice(0, 10);
  return o.period === "year"
    ? [y + "-01-01", y + "-12-31"]
    : o.period === "day"
      ? [o.date, o.date]
      : [m + "-01", end];
}
function selectReport(s, o) {
  const [start, end] = range(o);
  return expandRecurrences(s.entries, end)
    .filter(
      (e) =>
        !e.deletedAt &&
        e.date >= start &&
        e.date <= end &&
        (o.includePersonal !== false || e.kind !== "personal") &&
        (!o.projectId || e.projectId === o.projectId) &&
        (o.includeDone !== false ||
          !["done", "answered", "canceled", "moved"].includes(e.status)) &&
        (!o.kinds || o.kinds.includes(e.kind)),
    )
    .sort(
      (a, b) => a.date.localeCompare(b.date) || (a.order ?? 0) - (b.order ?? 0),
    );
}
function title(o) {
  return (
    (o.period === "year"
      ? o.date.slice(0, 4) + "년"
      : o.period === "day"
        ? o.date
        : o.date.slice(0, 4) + "년 " + Number(o.date.slice(5, 7)) + "월") +
    " 업무 다이어리"
  );
}
function detail(e) {
  return [
    e.text,
    e.parentId ? "↳ 하위 업무" : "",
    e.notes ? "메모: " + e.notes : "",
    e.dueDate ? "마감: " + e.dueDate : "",
    e.movedTo ? "→ " + e.movedTo + " 이월" : "",
  ]
    .filter(Boolean)
    .join("\n");
}
function question(e) {
  return [
    e.text,
    e.target ? "확인 대상: " + e.target : "",
    e.answer ? "답변: " + e.answer : "",
    e.reviewDate ? "재확인: " + e.reviewDate : "",
  ]
    .filter(Boolean)
    .join("\n");
}
function reportHTML(s, o) {
  const es = selectReport(s, o),
    map = new Map(s.projects.map((p) => [p.id, p]));
  const body = es
    .map((e) => {
      const p = map.get(e.projectId);
      const content = e.kind === "question" ? question(e) : detail(e);
      const flow =
        content.length > 700 || content.split("\n").length > 12
          ? "auto"
          : "avoid";
      return `<tr style="break-inside:${flow}"><td class="date">${esc(e.date.slice(5).replace("-", "."))}<br><small>${["일", "월", "화", "수", "목", "금", "토"][new Date(e.date + "T12:00:00Z").getUTCDay()]}</small></td><td>${e.kind === "personal" ? esc(detail(e)) : ""}</td><td>${esc(p?.name || (e.kind === "task" ? "공통 업무" : ""))}</td><td ${o.monochrome ? "" : `style="color:${/^#[\da-f]{6}$/i.test(e.color || "") ? e.color : "#222"}"`}>${e.kind === "task" ? esc(detail(e)) : ""}</td><td>${e.kind === "question" ? esc(question(e)) : ""}</td><td class="status">${esc(labels[e.status])}</td></tr>`;
    })
    .join("");
  return `<!doctype html><html lang="ko"><head><meta charset="UTF-8"><title>${esc(title(o))}</title><style>${fontCSS()}@page{size:${o.paper === "A3" ? "A3" : "A4"} landscape;margin:14mm 12mm 17mm}*{box-sizing:border-box}body{font-family:'NanumSquare',sans-serif;color:#202024;font-size:10px;margin:0}header{display:flex;justify-content:space-between;align-items:end;padding:4px 0 14px;border-bottom:3px solid ${o.monochrome ? "#222" : "#C9232C"}}h1{font-size:22px;letter-spacing:-1px;margin:0}header p{font-size:10px;color:#666}.brand{font-weight:700;letter-spacing:2px}table{width:100%;border-collapse:collapse;table-layout:fixed;margin-top:14px}thead{display:table-header-group}th{background:#f1f1f3;padding:10px 7px;text-align:left;font-size:10px;border-bottom:1px solid #aaa}td{border-bottom:1px solid #ddd;padding:9px 7px;vertical-align:top;white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.7}tr{break-inside:avoid}td.date{font-weight:bold}.date small{color:#888;font-weight:normal}.status{color:#666;font-size:9px}footer{margin-top:15px;color:#888;font-size:9px}.empty{text-align:center;padding:50px;color:#888}</style></head><body><header><div><p class="brand">H.PLAN / WORK DIARY</p><h1>${esc(title(o))}</h1></div><p>${es.length}개 항목 · ${o.includePersonal === false ? "개인 할 일 제외" : "개인 할 일 포함"}</p></header><table><colgroup><col style="width:7%"><col style="width:16%"><col style="width:15%"><col style="width:30%"><col style="width:25%"><col style="width:7%"></colgroup><thead><tr><th>날짜</th><th>개인 할 일</th><th>프로젝트</th><th>업무 일정</th><th>확인·질문 / 답변</th><th>상태</th></tr></thead><tbody>${body || '<tr><td colspan="6" class="empty">선택한 조건에 해당하는 기록이 없습니다.</td></tr>'}</tbody></table><footer>H.PLAN · ${esc(o.date)} 기준 · 업무 기록은 작성 날짜 순서로 정리됩니다.</footer></body></html>`;
}
function wrappedLines(value, width) {
  const result = [];
  for (const line of String(value || "").split("\n")) {
    let current = "",
      used = 0;
    for (const ch of line) {
      const size = ch.codePointAt(0) > 255 ? 2 : 1;
      if (used + size > width) {
        result.push(current);
        current = "";
        used = 0;
      }
      current += ch;
      used += size;
    }
    result.push(current);
  }
  return result;
}
async function writeWorkbook(s, o) {
  const ExcelJS=globalThis.ExcelJS;
  if(!ExcelJS)throw Error("Excel 내보내기를 준비하지 못했습니다.");
  const book = new ExcelJS.Workbook();
  book.creator = "H.PLAN";
  book.created = new Date();
  const months =
    o.period === "year"
      ? Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"))
      : [o.date.slice(5, 7)];
  for (const m of months) {
    const opts = {
      ...o,
      period: o.period === "year" ? "month" : o.period,
      date: o.period === "year" ? o.date.slice(0, 4) + "-" + m + "-01" : o.date,
    };
    const entries = selectReport(s, opts),
      widths = [15, 28, 25, 60, 55, 14];
    const ws = book.addWorksheet(
      o.period === "day" ? o.date.slice(5) : Number(m) + "월",
      {
        pageSetup: {
          paperSize: o.paper === "A3" ? 8 : 9,
          orientation: "landscape",
          fitToPage: true,
          fitToWidth: 1,
          fitToHeight: 0,
        },
        views: [{ state: "frozen", ySplit: 3 }],
      },
    );
    ws.columns = widths.map((width) => ({ width }));
    ws.mergeCells("A1:F1");
    ws.getCell("A1").value = "H.PLAN | " + title(opts);
    ws.getCell("A1").font = {
      name: "NanumSquare",
      size: 19,
      bold: true,
      color: { argb: o.monochrome ? "FF222222" : "FFC9232C" },
    };
    ws.getRow(1).height = 38;
    ws.mergeCells("A2:F2");
    ws.getCell("A2").value =
      entries.length +
      "개 항목 · " +
      (o.includePersonal === false ? "개인 할 일 제외" : "개인 할 일 포함");
    ws.addRow([
      "날짜",
      "개인 할 일",
      "프로젝트",
      "업무 일정",
      "확인·질문 / 답변",
      "상태",
    ]);
    ws.getRow(3).height = 25;
    ws.getRow(3).eachCell((c) => {
      c.font = { name: "NanumSquare", bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF222228" },
      };
    });
    const pm = new Map(s.projects.map((p) => [p.id, p]));
    for (const e of entries) {
      const values = [
        e.date,
        e.kind === "personal" ? detail(e) : "",
        pm.get(e.projectId)?.name || "",
        e.kind === "task" ? detail(e) : "",
        e.kind === "question" ? question(e) : "",
        labels[e.status],
      ];
      const cells = values.map((v, i) => wrappedLines(v, widths[i] - 3));
      const count = Math.max(...cells.map((c) => Math.ceil(c.length / 18)));
      for (let part = 0; part < count; part++) {
        const chunk = cells.map((c) => c.slice(part * 18, (part + 1) * 18));
        if (part > 0) chunk[0] = ["↳ 계속"];
        const row = ws.addRow(chunk.map((c) => c.join("\n")));
        row.height = Math.max(
          30,
          Math.max(...chunk.map((c) => c.length)) * 17 + 12,
        );
        row.eachCell({ includeEmpty: true }, (c) => {
          c.font = {
            name: "NanumSquare",
            size: 10,
            color: { argb: "FF333333" },
          };
          c.alignment = { vertical: "top", wrapText: true };
          c.border = { bottom: { style: "hair", color: { argb: "FFD9D9DF" } } };
        });
        if (e.color && !o.monochrome)
          row.getCell(
            e.kind === "question" ? 5 : e.kind === "personal" ? 2 : 4,
          ).font.color = { argb: "FF" + e.color.slice(1) };
      }
    }
    ws.pageSetup.printTitlesRow = "1:3";
    ws.headerFooter.oddFooter = "&LH.PLAN&R&P / &N";
    ws.autoFilter = "A3:F3";
  }
  return book.xlsx.writeBuffer();
}
export { selectReport, reportHTML, writeWorkbook, title };
