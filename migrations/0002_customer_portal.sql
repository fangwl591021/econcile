CREATE TABLE IF NOT EXISTS customer_lookup (
  customer_id TEXT PRIMARY KEY,
  name_normalized TEXT NOT NULL,
  phone_normalized TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS customer_lookup_identity_idx
ON customer_lookup(name_normalized, phone_normalized);

CREATE INDEX IF NOT EXISTS customer_lookup_phone_idx
ON customer_lookup(phone_normalized);

CREATE TABLE IF NOT EXISTS customer_portal_bindings (
  customer_id TEXT PRIMARY KEY,
  phone_normalized TEXT NOT NULL UNIQUE,
  bound_at INTEGER NOT NULL,
  last_login_at INTEGER,
  FOREIGN KEY (customer_id) REFERENCES customers(id)
);

CREATE INDEX IF NOT EXISTS customer_portal_bindings_phone_idx
ON customer_portal_bindings(phone_normalized);

CREATE TABLE IF NOT EXISTS payment_reports (
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
);

CREATE INDEX IF NOT EXISTS payment_reports_customer_idx
ON payment_reports(customer_id, created_at);

CREATE INDEX IF NOT EXISTS payment_reports_status_idx
ON payment_reports(status);
