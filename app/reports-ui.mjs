import { field, select, checkbox, download, esc } from "./ui.mjs";
import { reportHTML, prepareFonts, writeWorkbook } from "./core/reports.mjs";
let excelPromise;
function excel() {
  if (globalThis.ExcelJS) return Promise.resolve();
  return (excelPromise ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = new URL("./vendor/exceljs.min.js", import.meta.url).href;
    script.onload = resolve;
    script.onerror = () => {
      excelPromise = null;
      reject(Error("Excel 기능을 불러오지 못했습니다."));
    };
    document.head.append(script);
  }));
}
export function reportDialog({
  repo,
  date,
  projectOpen,
  modalOpen,
  closeModal,
  toast,
}) {
  const options = () => {
    const f = new FormData(document.querySelector("#modal-form"));
    return {
      date: f.get("date"),
      period: f.get("period"),
      projectId: f.get("projectId") || null,
      paper: f.get("paper"),
      includePersonal: f.has("includePersonal"),
      includeDone: f.has("includeDone"),
      monochrome: f.has("monochrome"),
    };
  };
  modalOpen(
    "보고서 · 내보내기",
    `<div class="stack"><div class="form-grid">${field("기준 날짜", "date", date, "date", "required")}${select(
      "기간",
      "period",
      [
        ["day", "하루"],
        ["month", "한 달"],
        ["year", "일 년"],
      ],
      "month",
    )}${select("프로젝트", "projectId", [["", "전체 프로젝트"], ...repo.state.projects.map((p) => [p.id, p.name])], projectOpen || "")}${select(
      "용지",
      "paper",
      [
        ["A4", "A4 가로"],
        ["A3", "A3 가로"],
      ],
    )}</div><div class="row">${checkbox("개인 일정 포함", "includePersonal", true)}${checkbox("완료 포함", "includeDone", true)}${checkbox("흑백", "monochrome")}</div><div class="row"><button type="button" id="report-html">HTML 저장</button><button type="button" id="report-excel">Excel 저장</button><button type="button" id="report-print">인쇄 / PDF</button></div><p class="help">아래 미리보기는 용지 비율을 유지하므로 가로로 스크롤할 수 있습니다. 휴대폰의 인쇄 기능 지원에 따라 PDF 저장 방식이 다를 수 있습니다.</p><iframe id="report-frame" class="report-frame" title="보고서 미리보기" sandbox="allow-same-origin allow-modals"></iframe></div>`,
    async () => {
      await preview();
    },
    { label: "미리보기" },
  );
  const frame = document.querySelector("#report-frame");
  async function html() {
    await prepareFonts();
    return reportHTML(repo.state, options());
  }
  async function preview() {
    frame.srcdoc = await html();
  }
  document.querySelector("#report-html").onclick = async (e) => {
    e.stopPropagation();
    try {
      download(
        `H.PLAN-${options().date}.html`,
        new Blob([await html()], { type: "text/html;charset=utf-8" }),
      );
      toast("HTML 보고서를 준비했습니다.");
    } catch (error) {
      toast(error.message);
    }
  };
  document.querySelector("#report-excel").onclick = async (e) => {
    e.stopPropagation();
    const b = e.currentTarget;
    b.disabled = true;
    try {
      await excel();
      const buffer = await writeWorkbook(repo.state, options());
      download(
        `H.PLAN-${options().date}.xlsx`,
        new Blob([buffer], {
          type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        }),
      );
      toast("Excel 보고서를 준비했습니다.");
    } catch (error) {
      toast(error.message);
    } finally {
      b.disabled = false;
    }
  };
  document.querySelector("#report-print").onclick = async (e) => {
    e.stopPropagation();
    try {
      await preview();
      frame.onload = () => {
        frame.contentWindow.focus();
        frame.contentWindow.print();
      };
    } catch (error) {
      toast(error.message);
    }
  };
  preview().catch((e) => toast(e.message));
}
