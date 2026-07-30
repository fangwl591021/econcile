const SESSION_COOKIE = "reconcile_admin";
const SESSION_SECONDS = 12 * 60 * 60;

const clean = (value) => String(value ?? "").trim();
const numeric = (value) => {
  const source = clean(value);
  const negative = /^\(.*\)$/.test(source);
  const parsed = Number(source.replace(/[^\d.-]/g, ""));
  if (!Number.isFinite(parsed)) return 0;
  return negative ? -Math.abs(parsed) : parsed;
};

function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers }
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
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, "0")
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

async function authenticated(request, env) {
  if (!env.ADMIN_PASSWORD) return false;
  const token = parseCookies(request)[SESSION_COOKIE] || "";
  const [expires, suppliedSignature] = token.split(".");
  if (!expires || !suppliedSignature || Number(expires) < Date.now()) return false;
  const expected = await signature(env.ADMIN_PASSWORD, expires);
  return await constantTimeEqual(expected, suppliedSignature);
}

async function login(request, env) {
  if (!env.ADMIN_PASSWORD) {
    return json({ error: "管理密碼尚未設定" }, 503);
  }
  const payload = await request.json().catch(() => ({}));
  if (!(await constantTimeEqual(clean(payload.password), clean(env.ADMIN_PASSWORD)))) {
    return json({ error: "管理密碼不正確" }, 401);
  }
  const expires = String(Date.now() + SESSION_SECONDS * 1000);
  const token = `${expires}.${await signature(env.ADMIN_PASSWORD, expires)}`;
  return json(
    { ok: true, protected: true },
    200,
    {
      "set-cookie": `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_SECONDS}`
    }
  );
}

async function initializeDatabase(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS customers (
      id TEXT PRIMARY KEY, customer_code TEXT, payer_code TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL, phone TEXT, line_uid TEXT, virtual_account TEXT,
      group_name TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS billing_records (
      id TEXT PRIMARY KEY, customer_id TEXT, payer_code TEXT NOT NULL,
      payer_name TEXT, group_name TEXT, billing_period TEXT NOT NULL,
      due_date TEXT, channel TEXT, amount_due REAL NOT NULL DEFAULT 0,
      amount_paid REAL NOT NULL DEFAULT 0, amount_outstanding REAL NOT NULL DEFAULT 0,
      fee REAL NOT NULL DEFAULT 0, credited_amount REAL NOT NULL DEFAULT 0,
      payment_date TEXT, credited_date TEXT, virtual_account TEXT, note TEXT,
      status TEXT NOT NULL DEFAULT 'unpaid', source_import_id TEXT,
      imported_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      UNIQUE(payer_code, billing_period)
    )`),
    db.prepare(`CREATE TABLE IF NOT EXISTS import_batches (
      id TEXT PRIMARY KEY, type TEXT NOT NULL, filename TEXT NOT NULL,
      row_count INTEGER NOT NULL DEFAULT 0, matched_count INTEGER NOT NULL DEFAULT 0,
      unmatched_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    )`)
  ]);
}

function statusOf(row, matched) {
  if (!matched) return "unmatched";
  const due = numeric(row.amountDue);
  const paid = numeric(row.amountPaid);
  const outstanding = numeric(row.amountOutstanding);
  const credited = numeric(row.creditedAmount);
  const note = clean(row.note);
  if (paid > due || note.includes("溢繳")) return "overpaid";
  if (paid > 0 && outstanding > 0) return "partial";
  if (paid > 0 && (credited <= 0 || note.includes("未入帳") || !clean(row.creditedDate))) {
    return "pending_credit";
  }
  if (paid > 0 && outstanding <= 0) return "paid";
  return "unpaid";
}

async function dashboard(db) {
  await initializeDatabase(db);
  const [
    customerCount,
    billCount,
    matchedCount,
    paidCount,
    unpaidCount,
    exceptionCount,
    customers,
    bills,
    imports
  ] = await Promise.all([
    db.prepare("SELECT COUNT(*) count FROM customers").first(),
    db.prepare("SELECT COUNT(*) count FROM billing_records").first(),
    db.prepare("SELECT COUNT(*) count FROM billing_records WHERE customer_id IS NOT NULL").first(),
    db.prepare("SELECT COUNT(*) count FROM billing_records WHERE status='paid'").first(),
    db.prepare("SELECT COUNT(*) count FROM billing_records WHERE status='unpaid'").first(),
    db.prepare("SELECT COUNT(*) count FROM billing_records WHERE status IN ('pending_credit','partial','overpaid','unmatched')").first(),
    db.prepare(`SELECT id, customer_code customerCode, payer_code payerCode,
      name, phone, line_uid lineUid, virtual_account virtualAccount,
      group_name groupName, updated_at updatedAt
      FROM customers ORDER BY updated_at DESC LIMIT 3000`).all(),
    db.prepare(`SELECT b.id, b.customer_id customerId, b.payer_code payerCode,
      COALESCE(c.name,b.payer_name,'未識別客戶') customerName,
      COALESCE(c.phone,'') phone, b.billing_period billingPeriod,
      b.due_date dueDate, b.channel, b.amount_due amountDue,
      b.amount_paid amountPaid, b.amount_outstanding amountOutstanding,
      b.credited_amount creditedAmount, b.payment_date paymentDate,
      b.credited_date creditedDate, b.virtual_account virtualAccount,
      b.note, b.status, b.updated_at updatedAt
      FROM billing_records b LEFT JOIN customers c ON c.id=b.customer_id
      ORDER BY b.billing_period DESC,b.updated_at DESC LIMIT 5000`).all(),
    db.prepare(`SELECT id,type,filename,row_count rowCount,
      matched_count matchedCount,unmatched_count unmatchedCount,
      error_count errorCount,created_at createdAt
      FROM import_batches ORDER BY created_at DESC LIMIT 30`).all()
  ]);
  return json({
    summary: {
      customers: customerCount?.count || 0,
      bills: billCount?.count || 0,
      matched: matchedCount?.count || 0,
      paid: paidCount?.count || 0,
      unpaid: unpaidCount?.count || 0,
      exceptions: exceptionCount?.count || 0
    },
    customers: customers.results,
    bills: bills.results,
    imports: imports.results
  });
}

async function importCustomers(request, db) {
  const payload = await request.json();
  const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 10000) : [];
  const valid = rows.filter((row) => clean(row.payerCode) && clean(row.name));
  if (!valid.length) return json({ error: "找不到有效的繳款人代號與姓名" }, 400);

  await initializeDatabase(db);
  const now = Date.now();
  const importId = crypto.randomUUID();
  const statements = valid.map((row) => {
    const payerCode = clean(row.payerCode);
    const id = `customer_${payerCode}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    return db.prepare(`INSERT INTO customers
      (id,customer_code,payer_code,name,phone,line_uid,virtual_account,group_name,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(payer_code) DO UPDATE SET
      customer_code=excluded.customer_code,name=excluded.name,phone=excluded.phone,
      line_uid=CASE WHEN excluded.line_uid<>'' THEN excluded.line_uid ELSE customers.line_uid END,
      virtual_account=CASE WHEN excluded.virtual_account<>'' THEN excluded.virtual_account ELSE customers.virtual_account END,
      group_name=excluded.group_name,updated_at=excluded.updated_at`)
      .bind(id, clean(row.customerCode), payerCode, clean(row.name),
        clean(row.phone), clean(row.lineUid) || null, clean(row.virtualAccount),
        clean(row.groupName), now, now);
  });
  for (let index = 0; index < statements.length; index += 80) {
    await db.batch(statements.slice(index, index + 80));
  }
  await db.prepare(`INSERT INTO import_batches
    (id,type,filename,row_count,matched_count,unmatched_count,error_count,created_at)
    VALUES(?,'customers',?,?,?,?,?,?)`)
    .bind(importId, clean(payload.filename) || "客戶表", rows.length,
      valid.length, 0, rows.length - valid.length, now).run();
  return json({ imported: valid.length, skipped: rows.length - valid.length });
}

async function importBank(request, db) {
  const payload = await request.json();
  const rows = Array.isArray(payload.rows) ? payload.rows.slice(0, 10000) : [];
  const valid = rows.filter((row) =>
    (clean(row.payerCode) || clean(row.virtualAccount)) && clean(row.billingPeriod)
  );
  if (!valid.length) return json({ error: "找不到有效的CSR530資料" }, 400);

  await initializeDatabase(db);
  const customerRows = await db.prepare(
    "SELECT id,payer_code payerCode,virtual_account virtualAccount FROM customers"
  ).all();
  const byPayer = new Map(customerRows.results.map((row) => [clean(row.payerCode), row.id]));
  const byVirtual = new Map(customerRows.results
    .filter((row) => clean(row.virtualAccount))
    .map((row) => [clean(row.virtualAccount), row.id]));
  const now = Date.now();
  const importId = crypto.randomUUID();
  let matched = 0;
  let unmatched = 0;
  const statements = valid.map((row) => {
    const payerCode = clean(row.payerCode) || clean(row.virtualAccount);
    const period = clean(row.billingPeriod);
    const virtualAccount = clean(row.virtualAccount);
    const customerId = byPayer.get(payerCode) || byVirtual.get(virtualAccount) || null;
    if (customerId) matched += 1;
    else unmatched += 1;
    const status = statusOf(row, Boolean(customerId));
    const id = `bill_${payerCode}_${period}`.replace(/[^a-zA-Z0-9_-]/g, "_");
    return db.prepare(`INSERT INTO billing_records
      (id,customer_id,payer_code,payer_name,group_name,billing_period,due_date,
      channel,amount_due,amount_paid,amount_outstanding,fee,credited_amount,
      payment_date,credited_date,virtual_account,note,status,source_import_id,imported_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(payer_code,billing_period) DO UPDATE SET
      customer_id=COALESCE(excluded.customer_id,billing_records.customer_id),
      payer_name=excluded.payer_name,group_name=excluded.group_name,
      due_date=excluded.due_date,channel=excluded.channel,
      amount_due=excluded.amount_due,amount_paid=excluded.amount_paid,
      amount_outstanding=excluded.amount_outstanding,fee=excluded.fee,
      credited_amount=excluded.credited_amount,payment_date=excluded.payment_date,
      credited_date=excluded.credited_date,virtual_account=excluded.virtual_account,
      note=excluded.note,status=excluded.status,source_import_id=excluded.source_import_id,
      imported_at=excluded.imported_at,updated_at=excluded.updated_at`)
      .bind(id, customerId, payerCode, clean(row.payerName), clean(row.groupName),
        period, clean(row.dueDate), clean(row.channel), numeric(row.amountDue),
        numeric(row.amountPaid), numeric(row.amountOutstanding), numeric(row.fee),
        numeric(row.creditedAmount), clean(row.paymentDate), clean(row.creditedDate),
        virtualAccount, clean(row.note), status, importId, now, now);
  });
  for (let index = 0; index < statements.length; index += 80) {
    await db.batch(statements.slice(index, index + 80));
  }
  await db.prepare(`INSERT INTO import_batches
    (id,type,filename,row_count,matched_count,unmatched_count,error_count,created_at)
    VALUES(?,'bank',?,?,?,?,?,?)`)
    .bind(importId, clean(payload.filename) || "CSR530", rows.length,
      matched, unmatched, rows.length - valid.length, now).run();
  return json({ imported: valid.length, matched, unmatched, skipped: rows.length - valid.length });
}

async function api(request, env) {
  const url = new URL(request.url);
  if (url.pathname === "/api/auth/status") {
    return json({
      authenticated: await authenticated(request, env),
      protected: true
    });
  }
  if (url.pathname === "/api/auth/login" && request.method === "POST") {
    return login(request, env);
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    return json({ ok: true }, 200, {
      "set-cookie": `${SESSION_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`
    });
  }
  if (!(await authenticated(request, env))) return json({ error: "尚未登入" }, 401);
  if (!env.DB) return json({ error: "尚未設定D1資料庫binding：DB" }, 503);
  if (url.pathname === "/api/dashboard" && request.method === "GET") {
    return dashboard(env.DB);
  }
  if (url.pathname === "/api/import/customers" && request.method === "POST") {
    return importCustomers(request, env.DB);
  }
  if (url.pathname === "/api/import/bank" && request.method === "POST") {
    return importBank(request, env.DB);
  }
  return json({ error: "找不到API" }, 404);
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname.startsWith("/api/")) return await api(request, env);
      return env.ASSETS.fetch(request);
    } catch (error) {
      return json({ error: "系統暫時無法處理請求" }, 500);
    }
  }
};
