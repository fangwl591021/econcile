import "./customer.css";

const app = document.querySelector("#customer-app");
const state = {
  mode: "login",
  busy: false,
  authenticated: false,
  account: null
};

const escapeHtml = (value) => String(value ?? "").replace(
  /[&<>"']/g,
  (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  })[character]
);

const money = (value) => new Intl.NumberFormat("zh-TW", {
  style: "currency",
  currency: "TWD",
  maximumFractionDigits: 0
}).format(Number(value) || 0);

const statusLabels = {
  paid: "已入帳",
  unpaid: "未繳款",
  pending_credit: "銀行入帳確認中",
  partial: "部分繳款",
  overpaid: "溢繳待確認",
  unmatched: "待人工核對"
};

async function request(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "操作失敗，請稍後再試。");
  return result;
}

function toast(message, error = false) {
  document.querySelector(".customer-toast")?.remove();
  const element = document.createElement("div");
  element.className = `customer-toast${error ? " error" : ""}`;
  element.textContent = message;
  document.body.append(element);
  setTimeout(() => element.remove(), 4200);
}

function loadingButton(label) {
  return state.busy ? "處理中…" : label;
}

function gate() {
  const binding = state.mode === "bind";
  return `<main class="customer-shell gate-shell">
    <section class="gate-copy">
      <a class="customer-brand" href="/customer.html" aria-label="客戶帳單查詢首頁">
        <b>R</b><span>Reconcile<small>客戶帳單服務</small></span>
      </a>
      <div>
        <span class="eyebrow">安全帳單入口</span>
        <h1>帳單查詢與<br>匯款回報</h1>
        <p>首次使用請以姓名與手機完成綁定。綁定後，只需手機號碼即可登入查詢。</p>
      </div>
      <ul>
        <li><b>01</b> 綁定既有客戶資料</li>
        <li><b>02</b> 查詢帳單與入帳狀態</li>
        <li><b>03</b> 回報已匯款，等待銀行確認</li>
      </ul>
    </section>
    <section class="gate-card">
      <div class="mode-tabs" role="tablist">
        <button data-mode="login" class="${binding ? "" : "active"}">電話登入</button>
        <button data-mode="bind" class="${binding ? "active" : ""}">首次綁定</button>
      </div>
      <form id="${binding ? "bind-form" : "login-form"}">
        <span class="eyebrow">${binding ? "FIRST TIME" : "WELCOME BACK"}</span>
        <h2>${binding ? "建立客戶綁定" : "登入查詢帳單"}</h2>
        <p>${binding
          ? "姓名與電話必須和管理端已匯入的客戶資料一致。"
          : "請輸入綁定時使用的手機號碼。"}</p>
        ${binding ? `<label>姓名
          <input name="name" autocomplete="name" maxlength="80" required placeholder="請輸入完整姓名">
        </label>` : ""}
        <label>手機號碼
          <input name="phone" type="tel" inputmode="tel" autocomplete="tel"
            maxlength="20" required placeholder="例如 0912345678">
        </label>
        <button class="primary" type="submit" ${state.busy ? "disabled" : ""}>
          ${loadingButton(binding ? "完成綁定並登入" : "登入帳單服務")}
        </button>
      </form>
      <div class="privacy-note">
        <b>資料安全說明</b>
        <span>系統不會在畫面顯示完整銀行帳號；登入狀態會在兩小時後自動失效。</span>
      </div>
    </section>
  </main>`;
}

function bills(account) {
  if (!account.bills.length) {
    return `<div class="empty-card"><b>目前沒有帳單資料</b><span>如有疑問，請聯繫管理單位。</span></div>`;
  }
  return account.bills.map((bill) => {
    const alreadyReported = account.paymentReports.some(
      (report) => report.billingRecordId === bill.id && report.status === "pending"
    );
    return `<article class="customer-bill">
      <div class="bill-top">
        <span>${escapeHtml(bill.billingPeriod || "未標示期別")}</span>
        <em class="bill-status ${escapeHtml(bill.status)}">${escapeHtml(statusLabels[bill.status] || "待確認")}</em>
      </div>
      <strong>${money(bill.amountDue)}</strong>
      <dl>
        <div><dt>繳費期限</dt><dd>${escapeHtml(bill.dueDate || "未標示")}</dd></div>
        <div><dt>實繳金額</dt><dd>${money(bill.amountPaid)}</dd></div>
        <div><dt>入帳日期</dt><dd>${escapeHtml(bill.creditedDate || "尚未入帳")}</dd></div>
      </dl>
      ${bill.status === "paid"
        ? `<div class="confirmed">✓ 銀行資料已確認入帳</div>`
        : `<button class="report-button" data-report="${escapeHtml(bill.id)}"
            ${alreadyReported || state.busy ? "disabled" : ""}>
            ${alreadyReported ? "已回報，等待銀行確認" : "我已匯款，送出回報"}
          </button>`}
    </article>`;
  }).join("");
}

function dashboard() {
  const account = state.account;
  return `<main class="customer-dashboard">
    <header>
      <a class="customer-brand" href="/customer.html"><b>R</b><span>Reconcile<small>客戶帳單服務</small></span></a>
      <button data-logout>安全登出</button>
    </header>
    <section class="welcome">
      <div><span class="eyebrow">MY ACCOUNT</span>
        <h1>${escapeHtml(account.customer.name)}，您好</h1>
        <p>已綁定手機 ${escapeHtml(account.customer.phoneMasked)}</p>
      </div>
      <aside><span>待繳／待確認</span><strong>${account.summary.open}</strong><small>筆帳單</small></aside>
    </section>
    <section class="account-grid">
      <div>
        <div class="section-title"><div><span>帳單紀錄</span><h2>近期帳單與入帳狀態</h2></div>
          <button data-refresh aria-label="重新整理">重新整理</button></div>
        <div class="bill-grid">${bills(account)}</div>
      </div>
      <aside class="notice-card">
        <span class="eyebrow">PAYMENT NOTICE</span>
        <h2>匯款回報說明</h2>
        <p>送出「我已匯款」只會建立待確認紀錄，不會直接將帳單改為已入帳。</p>
        <ol>
          <li>完成匯款或繳費</li>
          <li>點選對應帳單回報</li>
          <li>等待銀行檔案核對</li>
        </ol>
        <small>實際入帳狀態以銀行回傳資料為準。</small>
      </aside>
    </section>
  </main>`;
}

function render() {
  app.innerHTML = state.authenticated && state.account ? dashboard() : gate();
}

async function loadAccount() {
  state.account = await request("/api/public/account");
  state.authenticated = true;
  render();
}

document.addEventListener("click", async (event) => {
  const mode = event.target.closest("[data-mode]")?.dataset.mode;
  if (mode) {
    state.mode = mode;
    render();
    return;
  }
  if (event.target.closest("[data-refresh]")) {
    try {
      state.busy = true;
      await loadAccount();
    } catch (error) {
      toast(error.message, true);
    } finally {
      state.busy = false;
    }
    return;
  }
  if (event.target.closest("[data-logout]")) {
    try {
      await request("/api/public/logout", { method: "POST", body: "{}" });
    } finally {
      state.authenticated = false;
      state.account = null;
      render();
    }
    return;
  }
  const billId = event.target.closest("[data-report]")?.dataset.report;
  if (!billId) return;
  if (!window.confirm("確認已完成這筆帳單的匯款或繳費？送出後仍需等待銀行核對。")) return;
  try {
    state.busy = true;
    render();
    await request("/api/public/payment-report", {
      method: "POST",
      body: JSON.stringify({ billingRecordId: billId })
    });
    await loadAccount();
    toast("已收到回報，請等待銀行資料確認。");
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.busy = false;
    render();
  }
});

document.addEventListener("submit", async (event) => {
  if (!["bind-form", "login-form"].includes(event.target.id)) return;
  event.preventDefault();
  const form = new FormData(event.target);
  const payload = Object.fromEntries(form.entries());
  try {
    state.busy = true;
    render();
    await request(event.target.id === "bind-form" ? "/api/public/bind" : "/api/public/login", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await loadAccount();
    toast(event.target.id === "bind-form" ? "綁定完成。" : "登入成功。");
  } catch (error) {
    toast(error.message, true);
  } finally {
    state.busy = false;
    render();
  }
});

async function start() {
  try {
    const status = await request("/api/public/status");
    if (status.authenticated) await loadAccount();
    else render();
  } catch {
    render();
  }
}

start();
