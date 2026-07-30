import * as XLSX from "xlsx";
import { code39Svg, convenienceBarcodeValues } from "./barcode.js";
import "./styles.css";

const app = document.querySelector("#app");
const emptyData = {
  summary: { customers: 0, bills: 0, matched: 0, paid: 0, unpaid: 0, exceptions: 0 },
  customers: [],
  bills: [],
  imports: []
};
const state = {
  tab: "overview",
  data: emptyData,
  search: "",
  status: "all",
  busy: false,
  authenticated: false,
  protected: false
};

const customerAliases = {
  customerCode: ["客戶編號", "會員編號", "客戶代號", "編號", "customer_code"],
  payerCode: ["繳款人代號", "繳款代號", "payer_code"],
  name: ["客戶姓名", "繳款人名稱", "姓名", "name"],
  phone: ["行動電話", "手機號碼", "手機", "聯絡電話", "電話", "phone"],
  lineUid: ["LINE UID", "LINEUID", "line_uid", "UID"],
  virtualAccount: ["虛擬帳號", "virtual_account"],
  groupName: ["群組/團體", "群組", "團體", "group_name"]
};
const bankAliases = {
  payerCode: ["繳款人代號", "繳款代號", "payer_code"],
  payerName: ["繳款人名稱", "客戶姓名", "姓名"],
  groupName: ["群組/團體", "群組", "團體"],
  billingPeriod: ["繳費年度", "帳單月份", "帳務年月", "billing_period"],
  dueDate: ["限繳日期", "繳款期限", "due_date"],
  channel: ["繳款通路", "通路", "channel"],
  amountDue: ["應繳金額", "應收金額", "amount_due"],
  amountPaid: ["實繳金額", "繳款金額", "amount_paid"],
  amountOutstanding: ["未繳金額", "未收金額", "amount_outstanding"],
  fee: ["應付手續費", "手續費", "fee"],
  creditedAmount: ["入帳金額", "credited_amount"],
  paymentDate: ["繳款日期", "payment_date"],
  creditedDate: ["實際入帳日期", "入帳日期", "credited_date"],
  virtualAccount: ["虛擬帳號", "virtual_account"],
  note: ["備註", "note"]
};

const tabs = [
  ["overview", "總覽", "▦"],
  ["import", "資料匯入", "⇧"],
  ["billing", "電子帳單", "▤"],
  ["reconciliation", "入帳比對", "$"],
  ["crm", "客戶 CRM", "◎"],
  ["history", "匯入紀錄", "↻"]
];
const statusMeta = {
  paid: ["已入帳", "paid"],
  unpaid: ["未繳款", "unpaid"],
  pending_credit: ["已繳未入帳", "pending"],
  partial: ["部分繳款", "partial"],
  overpaid: ["溢繳", "overpaid"],
  unmatched: ["未匹配", "unmatched"]
};

const esc = (value) =>
  String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
const money = (value) => new Intl.NumberFormat("zh-TW", {
  style: "currency", currency: "TWD", maximumFractionDigits: 0
}).format(Number(value) || 0);
const normalize = (value) => String(value ?? "").trim().replace(/\s+/g, "").toLowerCase();
const text = (value) => String(value ?? "").trim();
const number = (value) => {
  const source = text(value);
  const parsed = Number(source.replace(/[^\d.-]/g, ""));
  return Number.isFinite(parsed) ? (/^\(.*\)$/.test(source) ? -Math.abs(parsed) : parsed) : 0;
};
const period = (value) => {
  const source = text(value);
  if (/^\d{5}$/.test(source)) return `民國${source.slice(0, 3)}年${Number(source.slice(3))}月`;
  if (/^\d{6}$/.test(source)) return `${source.slice(0, 4)}年${Number(source.slice(4))}月`;
  return source || "未標示";
};
const statusBadge = (status) => {
  const [label, className] = statusMeta[status] || statusMeta.unmatched;
  return `<span class="status ${className}">${label}</span>`;
};

function findValue(row, aliases) {
  const values = new Map(Object.entries(row).map(([key, value]) => [normalize(key), value]));
  for (const alias of aliases) {
    if (values.has(normalize(alias))) return values.get(normalize(alias));
  }
  return "";
}

async function readWorkbook(file) {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", raw: false });
  const recognized = new Set(
    [...Object.values(customerAliases), ...Object.values(bankAliases)]
      .flat().map(normalize)
  );
  let headerIndex = 0;
  let score = -1;
  matrix.slice(0, 40).forEach((row, index) => {
    const current = row.reduce((sum, cell) => sum + (recognized.has(normalize(cell)) ? 1 : 0), 0);
    if (current > score) {
      score = current;
      headerIndex = index;
    }
  });
  const headers = (matrix[headerIndex] || []).map((cell, index) =>
    text(cell) || `未命名欄位_${index + 1}`
  );
  return matrix.slice(headerIndex + 1)
    .filter((row) => row.some((value) => text(value)))
    .map((row) => Object.fromEntries(headers.map((header, index) => [header, row[index] ?? ""])));
}

function normalizeRows(type, rows) {
  if (type === "customers") {
    return rows.map((row) => ({
      customerCode: text(findValue(row, customerAliases.customerCode)),
      payerCode: text(findValue(row, customerAliases.payerCode)),
      name: text(findValue(row, customerAliases.name)),
      phone: text(findValue(row, customerAliases.phone)),
      lineUid: text(findValue(row, customerAliases.lineUid)),
      virtualAccount: text(findValue(row, customerAliases.virtualAccount)),
      groupName: text(findValue(row, customerAliases.groupName))
    }));
  }
  return rows.map((row) => ({
    payerCode: text(findValue(row, bankAliases.payerCode)),
    payerName: text(findValue(row, bankAliases.payerName)),
    groupName: text(findValue(row, bankAliases.groupName)),
    billingPeriod: text(findValue(row, bankAliases.billingPeriod)),
    dueDate: text(findValue(row, bankAliases.dueDate)),
    channel: text(findValue(row, bankAliases.channel)),
    amountDue: number(findValue(row, bankAliases.amountDue)),
    amountPaid: number(findValue(row, bankAliases.amountPaid)),
    amountOutstanding: number(findValue(row, bankAliases.amountOutstanding)),
    fee: number(findValue(row, bankAliases.fee)),
    creditedAmount: number(findValue(row, bankAliases.creditedAmount)),
    paymentDate: text(findValue(row, bankAliases.paymentDate)),
    creditedDate: text(findValue(row, bankAliases.creditedDate)),
    virtualAccount: text(findValue(row, bankAliases.virtualAccount)),
    note: text(findValue(row, bankAliases.note))
  }));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "content-type": "application/json", ...(options.headers || {}) }
  });
  const result = await response.json();
  if (!response.ok) {
    if (response.status === 401) {
      state.authenticated = false;
      render();
    }
    throw new Error(result.error || "操作失敗");
  }
  return result;
}

function toast(message, error = false) {
  document.querySelector(".toast")?.remove();
  const element = document.createElement("div");
  element.className = `toast${error ? " error" : ""}`;
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 4200);
}

async function loadDashboard() {
  state.busy = true;
  render();
  try {
    state.data = await api("/api/dashboard");
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.busy = false;
    render();
  }
}

function loginScreen() {
  app.innerHTML = `<main class="login">
    <form id="login-form" class="login-card">
      <div class="logo">R</div>
      <span>LINE 智慧對帳系統</span>
      <h1>管理員登入</h1>
      <p>帳務及客戶資料受到保護，請輸入管理密碼。</p>
      <label>管理密碼<input name="password" type="password" autocomplete="current-password" required></label>
      <button type="submit">登入工作台</button>
      <small>密碼由Cloudflare Secret保存，不會寫入程式碼。</small>
    </form>
  </main>`;
}

function shell(content) {
  const title = tabs.find(([id]) => id === state.tab)?.[1] || "總覽";
  return `<main class="shell">
    <aside>
      <div class="brand"><b>R</b><div><strong>Reconcile</strong><span>智慧對帳系統</span></div></div>
      <nav>${tabs.map(([id, label, icon]) =>
        `<button data-tab="${id}" class="${state.tab === id ? "active" : ""}">
          <i>${icon}</i><span>${label}</span>
          ${id === "reconciliation" && state.data.summary.exceptions
            ? `<em>${state.data.summary.exceptions}</em>` : ""}
        </button>`).join("")}</nav>
      <div class="side-note"><strong>LINE UID 已預留</strong><span>下一階段可加入帳單推播與催繳。</span></div>
    </aside>
    <section class="content">
      <header><div><small>LINE 智慧對帳系統</small><h1>${title}</h1></div>
        <button data-action="refresh" aria-label="重新整理">↻</button></header>
      <div class="page">${content}</div>
    </section>
    ${state.busy ? '<div class="busy">資料處理中…</div>' : ""}
  </main>`;
}

function overview() {
  const summary = state.data.summary;
  const latest = state.data.bills.slice(0, 6);
  return `<section class="hero">
      <div><span>● 對帳工作台</span><h2>電子帳單、超商繳費、自動對帳</h2>
      <p>匯入客戶表與國泰CSR530，系統自動產生電子帳單並找出已入帳、未繳及異常資料。</p>
      <button data-tab="import">開始匯入資料 →</button></div>
      <div class="hero-flow"><b>客戶資料</b><i>＋</i><b>CSR530</b><i>→</i><b>電子帳單</b></div>
    </section>
    <section class="stats">
      ${[
        ["CRM客戶", summary.customers, "已匯入客戶資料", "blue"],
        ["已入帳", summary.paid, "銀行確認完成", "green"],
        ["未繳款", summary.unpaid, "可建立催繳名單", "amber"],
        ["異常待處理", summary.exceptions, "未匹配、部分及溢繳", "red"]
      ].map(([label, value, note, color]) =>
        `<article><i class="${color}"></i><span>${label}</span><strong>${value}</strong><small>${note}</small></article>`
      ).join("")}
    </section>
    <section class="panel">
      <div class="panel-head"><div><h3>最新對帳結果</h3><p>最近更新的銀行帳單紀錄</p></div>
      <button data-tab="reconciliation">查看全部 →</button></div>
      ${latest.length ? `<div class="recent">${latest.map((bill) =>
        `<div><b>${esc(bill.customerName)}</b><span>${esc(period(bill.billingPeriod))} · ${esc(bill.payerCode)}</span>
        <strong>${money(bill.amountPaid || bill.amountDue)}</strong>${statusBadge(bill.status)}</div>`
      ).join("")}</div>` : empty("尚無對帳資料", "請先上傳客戶表與CSR530。")}
    </section>`;
}

function importPage() {
  return `<section class="intro"><span>資料匯入</span><h2>上傳兩張表，系統自動核對</h2>
    <p>支援.xls、.xlsx與.csv；CSR530會自動辨識第6列標題。</p></section>
    <section class="uploads">
      ${uploadCard("customers", "1", "上傳客戶表", "繳款人代號與姓名為必要欄位；電話、LINE UID可選填。")}
      ${uploadCard("bank", "2", "上傳國泰CSR530", "辨識金額、虛擬帳號、繳款通路及入帳狀態。")}
    </section>
    <section class="panel guide"><h3>欄位辨識與匹配規則</h3>
      <div><article><span>必要欄位</span><b>繳款人代號、繳費年度</b></article>
      <article><span>比對順序</span><b>代號 → 虛擬帳號</b></article>
      <article><span>重複上傳</span><b>同月份更新、不重複累加</b></article></div>
    </section>`;
}

function uploadCard(type, step, title, description) {
  return `<article class="upload-card"><i>${step}</i><div class="upload-icon">${type === "bank" ? "$" : "◎"}</div>
    <div><h3>${title}</h3><p>${description}</p></div>
    <label class="button">選擇檔案<input type="file" data-upload="${type}" accept=".xls,.xlsx,.csv" hidden></label>
  </article>`;
}

function billRows() {
  const keyword = state.search.toLowerCase();
  return state.data.bills.filter((bill) => {
    const account = String(bill.virtualAccount || "").replace(/\D/g, "");
    if (account.length !== 14 || Number(bill.amountDue) <= 0) return false;
    return !keyword || [bill.customerName, bill.payerCode, bill.virtualAccount]
      .join(" ").toLowerCase().includes(keyword);
  });
}

function billing() {
  const bills = billRows();
  return `<section class="intro with-count"><div><span>電子帳單</span><h2>批次產生超商三段式條碼</h2>
    <p>依CSR530虛擬帳號與金額產生手機Code 39電子帳單。</p></div><b>${bills.length} 張</b></section>
    <section class="warning"><b>銀行規格驗證版</b><span>代收代碼6R7、長效期限2049/12/31；正式發送前請先以3至5筆到超商測試讀取。</span></section>
    ${filter("搜尋姓名、繳款人代號或虛擬帳號", false)}
    <section class="panel table-wrap">${bills.length ? table(
      ["客戶", "帳單月份", "繳費期限", "應繳金額", "虛擬帳號", "狀態", "電子帳單"],
      bills.map((bill) => `<tr><td><b>${esc(bill.customerName)}</b><small>${esc(bill.payerCode)}</small></td>
        <td>${esc(period(bill.billingPeriod))}</td><td>${esc(bill.dueDate || "—")}</td>
        <td><strong>${money(bill.amountDue)}</strong></td><td><code>${esc(bill.virtualAccount)}</code></td>
        <td>${statusBadge(bill.status)}</td><td><button class="row-action" data-bill="${esc(bill.id)}">查看帳單</button></td></tr>`)
    ) : empty("尚無可產生的電子帳單", "請先上傳包含14碼虛擬帳號與金額的CSR530。")}</section>`;
}

function reconciliation() {
  const keyword = state.search.toLowerCase();
  const bills = state.data.bills.filter((bill) =>
    (state.status === "all" || bill.status === state.status) &&
    (!keyword || [bill.customerName, bill.payerCode, bill.phone, bill.virtualAccount]
      .join(" ").toLowerCase().includes(keyword))
  );
  return `<section class="intro"><span>入帳比對</span><h2>對帳結果與異常處理</h2>
    <p>快速找出未繳、待入帳、溢繳與未匹配資料。</p></section>
    ${filter("搜尋姓名、電話、代號或虛擬帳號", true)}
    <section class="panel table-wrap">${bills.length ? table(
      ["客戶", "帳單月份", "應繳", "實繳", "繳款／入帳日", "狀態", "備註"],
      bills.map((bill) => `<tr><td><b>${esc(bill.customerName)}</b><small>${esc(bill.payerCode)}</small></td>
      <td>${esc(period(bill.billingPeriod))}</td><td><strong>${money(bill.amountDue)}</strong></td>
      <td>${money(bill.amountPaid)}</td><td>${esc(bill.creditedDate || bill.paymentDate || "—")}</td>
      <td>${statusBadge(bill.status)}${bill.paymentReportPending ? `<small class="portal-report">客戶已回報</small>` : ""}</td><td>${esc(bill.note || "—")}</td></tr>`)
    ) : empty("找不到資料", "請調整搜尋條件或上傳CSR530。")}</section>`;
}

function crm() {
  const keyword = state.search.toLowerCase();
  const customers = state.data.customers.filter((customer) =>
    !keyword || [customer.name, customer.phone, customer.payerCode, customer.customerCode]
      .join(" ").toLowerCase().includes(keyword)
  );
  return `<section class="intro"><span>客戶CRM</span><h2>客戶帳戶、電話綁定與LINE UID</h2>
    <p>主要以姓名與電話核對，LINE UID欄位持續保留。</p></section>
    ${filter("搜尋姓名、電話、客戶編號或代號", false)}
    <section class="panel table-wrap">${customers.length ? table(
      ["客戶", "電話", "客戶編號", "繳款人代號", "虛擬帳號", "客戶入口", "LINE UID"],
      customers.map((customer) => `<tr><td><b>${esc(customer.name)}</b><small>${esc(customer.groupName || "未分組")}</small></td>
      <td>${esc(customer.phone || "—")}</td><td>${esc(customer.customerCode || "—")}</td>
      <td><code>${esc(customer.payerCode)}</code></td><td><code>${esc(customer.virtualAccount || "—")}</code></td>
      <td>${customer.portalBound ? '<span class="uid">已綁定</span>' : "未綁定"}</td>
      <td>${customer.lineUid ? '<span class="uid">已綁定</span>' : "未綁定"}</td></tr>`)
    ) : empty("尚無客戶資料", "請先上傳客戶表。")}</section>`;
}

function history() {
  return `<section class="intro"><span>匯入紀錄</span><h2>資料批次與處理結果</h2>
    <p>保存每次上傳的筆數、匹配與錯誤摘要。</p></section>
    <section class="panel history">${state.data.imports.length
      ? state.data.imports.map((item) => `<div><i>${item.type === "bank" ? "$" : "◎"}</i>
        <span><b>${esc(item.filename)}</b><small>${item.type === "bank" ? "銀行帳單" : "客戶表"}</small></span>
        <span>總筆數<b>${item.rowCount}</b></span><span>匹配<b>${item.matchedCount}</b></span>
        <span>異常<b>${item.unmatchedCount + item.errorCount}</b></span></div>`).join("")
      : empty("尚無匯入紀錄", "完成第一次上傳後會顯示在這裡。")}</section>`;
}

function filter(placeholder, withStatus) {
  return `<section class="filters"><input data-search value="${esc(state.search)}" placeholder="${placeholder}">
    ${withStatus ? `<select data-status>
      ${[["all", "全部狀態"], ...Object.entries(statusMeta).map(([key, [label]]) => [key, label])]
        .map(([value, label]) => `<option value="${value}" ${state.status === value ? "selected" : ""}>${label}</option>`).join("")}
    </select>` : ""}</section>`;
}
const table = (headers, rows) => `<table><thead><tr>${headers.map((header) => `<th>${header}</th>`).join("")}</tr></thead>
  <tbody>${rows.join("")}</tbody></table>`;
const empty = (title, description) => `<div class="empty"><b>${title}</b><span>${description}</span></div>`;

function render() {
  if (state.protected && !state.authenticated) return loginScreen();
  const pages = { overview, import: importPage, billing, reconciliation, crm, history };
  app.innerHTML = shell((pages[state.tab] || overview)());
}

function showBill(id) {
  const bill = state.data.bills.find((item) => item.id === id);
  if (!bill) return;
  const codes = convenienceBarcodeValues(bill);
  const modal = document.createElement("div");
  modal.className = "modal";
  modal.innerHTML = `<button class="scrim" data-close aria-label="關閉"></button><div class="modal-panel">
    <div class="toolbar"><div><b>電子帳單預覽</b><span>測試規格 · 請先完成超商掃碼驗證</span></div>
    <div><button data-copy>複製三段碼</button><button data-print>儲存PDF</button><button data-close>×</button></div></div>
    <article class="bill">
      <header><div class="bill-logo">E+</div><div><span>聯鑫網科技有限公司</span><h2>電子繳費帳單</h2></div>${statusBadge(bill.status)}</header>
      <section class="bill-amount"><span>本期應繳金額</span><strong>${money(bill.amountDue)}</strong><small>繳費期限：${esc(bill.dueDate || "未標示")}</small></section>
      <section class="bill-info"><div><span>繳款人</span><b>${esc(bill.customerName)}</b></div><div><span>繳款人代號</span><b>${esc(bill.payerCode)}</b></div>
      <div><span>帳單月份</span><b>${esc(period(bill.billingPeriod))}</b></div><div><span>虛擬帳號</span><b>${esc(bill.virtualAccount)}</b></div></section>
      <section class="codes"><h3>便利商店專用條碼區</h3><p>請將手機亮度調高，依序讓店員掃描三段條碼</p>
      ${codes.valid ? [codes.barcode1, codes.barcode2, codes.barcode3].map((value, index) =>
        `<div class="barcode">${code39Svg(value, index ? 68 : 58)}<span>* ${esc(Array.from(value).join(" "))} *</span></div>`
      ).join("") : '<div class="warning">虛擬帳號或金額格式不正確。</div>'}</section>
      <section class="bill-warning">目前依紙本樣張重建。正式上線前須確認代收代碼、有效期限及手機掃描相容性。</section>
      <footer>付款後請保留超商收據，實際入帳狀態以銀行回傳資料為準。</footer>
    </article></div>`;
  document.body.append(modal);
  modal.querySelectorAll("[data-close]").forEach((button) => button.onclick = () => modal.remove());
  modal.querySelector("[data-print]").onclick = () => window.print();
  modal.querySelector("[data-copy]").onclick = async () => {
    await navigator.clipboard.writeText(
      `第一段：${codes.barcode1}\n第二段：${codes.barcode2}\n第三段：${codes.barcode3}`
    );
    toast("三段條碼已複製");
  };
}

document.addEventListener("click", async (event) => {
  const tab = event.target.closest("[data-tab]")?.dataset.tab;
  if (tab) {
    state.tab = tab;
    state.search = "";
    render();
    return;
  }
  if (event.target.closest("[data-action='refresh']")) await loadDashboard();
  const billId = event.target.closest("[data-bill]")?.dataset.bill;
  if (billId) showBill(billId);
});
document.addEventListener("input", (event) => {
  if (event.target.matches("[data-search]")) {
    state.search = event.target.value;
    const cursor = event.target.selectionStart;
    render();
    const input = document.querySelector("[data-search]");
    input?.focus();
    input?.setSelectionRange(cursor, cursor);
  }
});
document.addEventListener("change", async (event) => {
  if (event.target.matches("[data-status]")) {
    state.status = event.target.value;
    render();
    return;
  }
  const type = event.target.dataset.upload;
  const file = event.target.files?.[0];
  if (!type || !file) return;
  state.busy = true;
  render();
  try {
    const rows = normalizeRows(type, await readWorkbook(file));
    const result = await api(`/api/import/${type}`, {
      method: "POST",
      body: JSON.stringify({ filename: file.name, rows })
    });
    toast(type === "bank"
      ? `完成${result.imported}筆：匹配${result.matched}、未匹配${result.unmatched}`
      : `客戶表已匯入${result.imported}筆`);
    await loadDashboard();
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.busy = false;
    render();
  }
});
document.addEventListener("submit", async (event) => {
  if (event.target.id !== "login-form") return;
  event.preventDefault();
  try {
    await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ password: new FormData(event.target).get("password") })
    });
    state.authenticated = true;
    await loadDashboard();
  } catch (error) {
    toast(error.message, true);
  }
});

async function start() {
  try {
    const status = await api("/api/auth/status");
    state.protected = status.protected;
    state.authenticated = status.authenticated;
    if (state.authenticated) await loadDashboard();
    else render();
  } catch (error) {
    app.innerHTML = `<main class="fatal"><b>系統尚未完成設定</b><span>${esc(error.message)}</span></main>`;
  }
}
start();
