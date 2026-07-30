CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  customer_code TEXT,
  payer_code TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  phone TEXT,
  line_uid TEXT,
  virtual_account TEXT,
  group_name TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_line_uid_uq
ON customers(line_uid) WHERE line_uid IS NOT NULL AND line_uid <> '';

CREATE INDEX IF NOT EXISTS customers_virtual_account_idx
ON customers(virtual_account);

CREATE TABLE IF NOT EXISTS billing_records (
  id TEXT PRIMARY KEY,
  customer_id TEXT,
  payer_code TEXT NOT NULL,
  payer_name TEXT,
  group_name TEXT,
  billing_period TEXT NOT NULL,
  due_date TEXT,
  channel TEXT,
  amount_due REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  amount_outstanding REAL NOT NULL DEFAULT 0,
  fee REAL NOT NULL DEFAULT 0,
  credited_amount REAL NOT NULL DEFAULT 0,
  payment_date TEXT,
  credited_date TEXT,
  virtual_account TEXT,
  note TEXT,
  status TEXT NOT NULL DEFAULT 'unpaid',
  source_import_id TEXT,
  imported_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id),
  UNIQUE(payer_code, billing_period)
);

CREATE INDEX IF NOT EXISTS billing_status_idx ON billing_records(status);
CREATE INDEX IF NOT EXISTS billing_virtual_account_idx ON billing_records(virtual_account);
CREATE INDEX IF NOT EXISTS billing_period_idx ON billing_records(billing_period);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  filename TEXT NOT NULL,
  row_count INTEGER NOT NULL DEFAULT 0,
  matched_count INTEGER NOT NULL DEFAULT 0,
  unmatched_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
