import adminWorker from "./admin-worker.js";
import {
  CUSTOMER_SESSION_COOKIE,
  CUSTOMER_SESSION_SECONDS,
  decodeCustomerId,
  encodeCustomerId,
  maskPhone,
  normalizeName,
  normalizePhone,
  validPhone
} from "./customer-portal.js";

const clean = (value) => String(value ?? "").trim();

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...headers
    }
  });
}

function parseCookies(request) {
  return Object.fromEntries(
    (request.headers.get("cookie") || "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key]) => key)
      .map(([key, ...rest]) => [key, decodeURIComponent(rest.join("="))])
  );
}

async function signature(secret, value) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value)
  );
  return Array.from(
    new Uint8Array(bytes),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}

async function constantTimeEqual(left, right) {
  const encoder = new TextEncoder();
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right))
  ]);
  const leftBytes = new Uint8Array(leftHash);
  const rightBytes = new Uint8Array(rightHash);
  let different = 0;
  for (let index = 0; index < leftBytes.length; index += 1) {
    different |= leftBytes[index] ^ rightBytes[index];
  }
  return different === 0;
}

function cookie(token, maxAge = CUSTOMER_SESSION_SECONDS) {
  return `${CUSTOMER_SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export async function createSession(env, customerId) {
  const encodedId = encodeCustomerId(customerId);
  const expires = String(Date.now() + CUSTOMER_SESSION_SECONDS * 1000);
  const unsigned = `${encodedId}.${expires}`;
  return `${unsigned}.${await signature(env.ADMIN_PASSWORD, unsigned)}`;
}

export async function sessionCustomerId(request, env) {
  if (!env.ADMIN_PASSWORD) return null;
  const token = parseCookies(request)[CUSTOMER_SESSION_COOKIE] || "";
  const [encodedId, expires, suppliedSignature] = token.split(".");
  if (!encodedId || !expires || !suppliedSignature || Number(expires) < Date.now()) return null;
  const expected = await signature(env.ADMIN_PASSWORD, `${encodedId}.${expires}`);
  if (!(await constantTimeEqual(expected, suppliedSignature))) return null;
  return decodeCustomerId(encodedId) || null;
}

function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

async function initializePortal(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS customer_lookup (
      customer_id TEXT PRIMARY KEY,
      name_normalized TEXT NOT NULL,
      phone_normalized TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS customer_lookup_identity_idx
      ON customer_lookup(name_normalized, phone_normalized)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS customer_lookup_phone_idx
      ON customer_lookup(phone_normalized)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS customer_portal_bindings (
      customer_id TEXT PRIMARY KEY,
      phone_normalized TEXT NOT NULL UNIQUE,
      bound_at INTEGER NOT NULL,
      last_login_at INTEGER,
      FOREIGN KEY (customer_id) REFERENCES customers(id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS customer_portal_bindings_phone_idx
      ON customer_portal_bindings(phone_normalized)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS payment_reports (
      id TEXT PRIMARY KEY,
      customer_id TEXT NOT NULL,
      billing_record_id TEXT,
      phone_normalized TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      note TEXT,
      created_at INTEGER NOT NULL,
      resolved_at INTEGER,
      FOREIGN KEY (customer_id) REFERENCES customers(id),
      FOREIGN KEY (billing_record_id) REFERENCES billing_records(id)
    )`),
    db.prepare(`CREATE INDEX IF NOT EXISTS payment_reports_customer_idx
      ON payment_reports(customer_id, created_at)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS payment_reports_status_idx
      ON payment_reports(status)`)
  ]);
}

async function matchingCustomer(db, nameNormalized, phoneNormalized) {
  const cached = await db.prepare(`SELECT c.id,c.name,c.phone
    FROM customer_lookup l JOIN customers c ON c.id=l.customer_id
    WHERE l.name_normalized=? AND l.phone_normalized=? LIMIT 2`)
    .bind(nameNormalized, phoneNormalized).all();
  if (
    cached.results.length === 1 &&
    normalizeName(cached.results[0].name) === nameNormalized &&
    normalizePhone(cached.results[0].phone) === phoneNormalized
  ) return cached.results[0];
  if (cached.results.length > 1) return null;

  const candidates = await db.prepare(`SELECT id,name,phone FROM customers
    WHERE phone IS NOT NULL AND phone<>'' LIMIT 5000`).all();
  const matches = candidates.results.filter((customer) =>
    normalizeName(customer.name) === nameNormalized &&
    normalizePhone(customer.phone) === phoneNormalized
  );
  if (matches.length !== 1) return null;
  const customer = matches[0];
  await db.prepare(`INSERT INTO customer_lookup
    (customer_id,name_normalized,phone_normalized,updated_at)
    VALUES(?,?,?,?)
    ON CONFLICT(customer_id) DO UPDATE SET
      name_normalized=excluded.name_normalized,
      phone_normalized=excluded.phone_normalized,
      updated_at=excluded.updated_at`)
    .bind(customer.id, nameNormalized, phoneNormalized, Date.now()).run();
  return customer;
}

async function bindCustomer(request, env) {
  const payload = await request.json().catch(() => ({}));
  const nameNormalized = normalizeName(payload.name);
  const phoneNormalized = normalizePhone(payload.phone);
  if (!nameNormalized || nameNormalized.length > 80 || !validPhone(phoneNormalized)) {
    return json({ error: "請輸入正確的姓名與台灣手機號碼。" }, 400);
  }

  const customer = await matchingCustomer(env.DB, nameNormalized, phoneNormalized);
  if (!customer) {
    return json({ error: "資料無法核對，請確認姓名與電話，或聯繫管理單位。" }, 401);
  }

  const occupied = await env.DB.prepare(`SELECT customer_id customerId
    FROM customer_portal_bindings WHERE phone_normalized=? LIMIT 1`)
    .bind(phoneNormalized).first();
  if (occupied && occupied.customerId !== customer.id) {
    return json({ error: "資料無法核對，請聯繫管理單位。" }, 409);
  }

  const now = Date.now();
  await env.DB.prepare(`INSERT INTO customer_portal_bindings
    (customer_id,phone_normalized,bound_at,last_login_at)
    VALUES(?,?,?,?)
    ON CONFLICT(customer_id) DO UPDATE SET
      phone_normalized=excluded.phone_normalized,
      last_login_at=excluded.last_login_at`)
    .bind(customer.id, phoneNormalized, now, now).run();
  const token = await createSession(env, customer.id);
  return json({ ok: true }, 200, { "set-cookie": cookie(token) });
}

async function loginCustomer(request, env) {
  const payload = await request.json().catch(() => ({}));
  const phoneNormalized = normalizePhone(payload.phone);
  if (!validPhone(phoneNormalized)) {
    return json({ error: "電話或綁定狀態無法核對。" }, 401);
  }
  const binding = await env.DB.prepare(`SELECT customer_id customerId
    FROM customer_portal_bindings WHERE phone_normalized=? LIMIT 1`)
    .bind(phoneNormalized).first();
  if (!binding) return json({ error: "電話或綁定狀態無法核對。" }, 401);

  await env.DB.prepare(`UPDATE customer_portal_bindings
    SET last_login_at=? WHERE customer_id=?`)
    .bind(Date.now(), binding.customerId).run();
  const token = await createSession(env, binding.customerId);
  return json({ ok: true }, 200, { "set-cookie": cookie(token) });
}

async function customerAccount(request, env) {
  const customerId = await sessionCustomerId(request, env);
  if (!customerId) return json({ error: "登入已失效，請重新登入。" }, 401);

  const [customer, bills, reports] = await Promise.all([
    env.DB.prepare(`SELECT c.id,c.name,b.phone_normalized phone
      FROM customers c JOIN customer_portal_bindings b ON b.customer_id=c.id
      WHERE c.id=? LIMIT 1`).bind(customerId).first(),
    env.DB.prepare(`SELECT id,billing_period billingPeriod,due_date dueDate,
      amount_due amountDue,amount_paid amountPaid,amount_outstanding amountOutstanding,
      payment_date paymentDate,credited_date creditedDate,status,updated_at updatedAt
      FROM billing_records WHERE customer_id=?
      ORDER BY billing_period DESC,updated_at DESC LIMIT 36`).bind(customerId).all(),
    env.DB.prepare(`SELECT id,billing_record_id billingRecordId,status,created_at createdAt
      FROM payment_reports WHERE customer_id=?
      ORDER BY created_at DESC LIMIT 50`).bind(customerId).all()
  ]);
  if (!customer) return json({ error: "找不到客戶帳戶，請重新綁定。" }, 404);
  const rows = bills.results;
  return json({
    customer: {
      name: customer.name,
      phoneMasked: maskPhone(customer.phone)
    },
    summary: {
      total: rows.length,
      open: rows.filter((bill) => bill.status !== "paid").length
    },
    bills: rows,
    paymentReports: reports.results
  });
}

async function reportPayment(request, env) {
  const customerId = await sessionCustomerId(request, env);
  if (!customerId) return json({ error: "登入已失效，請重新登入。" }, 401);
  const payload = await request.json().catch(() => ({}));
  const billingRecordId = clean(payload.billingRecordId);
  if (!billingRecordId || billingRecordId.length > 160) {
    return json({ error: "請選擇要回報的帳單。" }, 400);
  }
  const [bill, binding] = await Promise.all([
    env.DB.prepare(`SELECT id,status FROM billing_records
      WHERE id=? AND customer_id=? LIMIT 1`).bind(billingRecordId, customerId).first(),
    env.DB.prepare(`SELECT phone_normalized phone FROM customer_portal_bindings
      WHERE customer_id=? LIMIT 1`).bind(customerId).first()
  ]);
  if (!bill || !binding) return json({ error: "找不到可回報的帳單。" }, 404);
  if (bill.status === "paid") return json({ error: "此帳單已確認入帳。" }, 409);

  const existing = await env.DB.prepare(`SELECT id FROM payment_reports
    WHERE customer_id=? AND billing_record_id=? AND status='pending' LIMIT 1`)
    .bind(customerId, billingRecordId).first();
  if (existing) return json({ ok: true, alreadyReported: true });

  await env.DB.prepare(`INSERT INTO payment_reports
    (id,customer_id,billing_record_id,phone_normalized,status,note,created_at,resolved_at)
    VALUES(?,?,?,?, 'pending',NULL,?,NULL)`)
    .bind(crypto.randomUUID(), customerId, billingRecordId, binding.phone, Date.now()).run();
  return json({ ok: true, status: "pending" }, 201);
}

async function publicApi(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/public/status" && request.method === "GET") {
    return json({ authenticated: Boolean(await sessionCustomerId(request, env)), protected: true });
  }
  if (!env.ADMIN_PASSWORD) return json({ error: "客戶入口尚未完成安全設定。" }, 503);
  if (!env.DB) return json({ error: "客戶入口尚未連接資料庫。" }, 503);
  await initializePortal(env.DB);
  if (request.method === "POST" && !sameOrigin(request)) {
    return json({ error: "不允許跨站操作。" }, 403);
  }
  if (url.pathname === "/api/public/bind" && request.method === "POST") {
    return bindCustomer(request, env);
  }
  if (url.pathname === "/api/public/login" && request.method === "POST") {
    return loginCustomer(request, env);
  }
  if (url.pathname === "/api/public/account" && request.method === "GET") {
    return customerAccount(request, env);
  }
  if (url.pathname === "/api/public/payment-report" && request.method === "POST") {
    return reportPayment(request, env);
  }
  if (url.pathname === "/api/public/logout" && request.method === "POST") {
    return json({ ok: true }, 200, { "set-cookie": cookie("", 0) });
  }
  return json({ error: "找不到此客戶服務。" }, 404);
}

async function enrichedAdminDashboard(request, env, context) {
  const response = await adminWorker.fetch(request, env, context);
  if (!response.ok || !env.DB) return response;
  await initializePortal(env.DB);
  const [bindings, reports] = await Promise.all([
    env.DB.prepare("SELECT customer_id customerId FROM customer_portal_bindings").all(),
    env.DB.prepare(`SELECT billing_record_id billingRecordId,COUNT(*) count
      FROM payment_reports WHERE status='pending' AND billing_record_id IS NOT NULL
      GROUP BY billing_record_id`).all()
  ]);
  const boundCustomers = new Set(bindings.results.map((row) => row.customerId));
  const pendingReports = new Map(
    reports.results.map((row) => [row.billingRecordId, Number(row.count) || 0])
  );
  const data = await response.json();
  data.customers = (data.customers || []).map((customer) => ({
    ...customer,
    portalBound: boundCustomers.has(customer.id)
  }));
  data.bills = (data.bills || []).map((bill) => ({
    ...bill,
    paymentReportPending: pendingReports.get(bill.id) || 0
  }));
  return json(data);
}
export default {
  async fetch(request, env, context) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/public/")) {
        return await publicApi(request, env);
      }
      if (url.pathname === "/api/dashboard" && request.method === "GET") {
        return await enrichedAdminDashboard(request, env, context);
      }
      return await adminWorker.fetch(request, env, context);
    } catch {
      return json({ error: "系統暫時無法處理，請稍後再試。" }, 500);
    }
  }
};
