export const CUSTOMER_TERMS_VERSION = "customer-terms-v1";
export const CUSTOMER_PRIVACY_VERSION = "customer-privacy-v1";

export function validateCustomerRegistration(body = {}) {
  const values = customerFields(body);
  const valid = Boolean(
    values.displayName &&
      values.firstName &&
      values.lastName &&
      values.addressLine1 &&
      values.city &&
      values.stateRegion &&
      values.postalCode &&
      /^[A-Z]{2}$/.test(values.country) &&
      body.acceptTerms === true &&
      body.acknowledgePrivacy === true &&
      !String(body.phone || "").trim(),
  );
  return { valid, values };
}

export function customerFields(body = {}) {
  return {
    displayName: clean(body.displayName, 80),
    firstName: clean(body.firstName, 100),
    lastName: clean(body.lastName, 100),
    company: clean(body.company, 160),
    addressLine1: clean(body.addressLine1, 200),
    addressLine2: clean(body.addressLine2, 200),
    city: clean(body.city, 100),
    stateRegion: clean(body.stateRegion, 100),
    postalCode: clean(body.postalCode, 30),
    country: clean(body.country, 2).toUpperCase(),
  };
}

export async function saveCustomerRegistration(db, userId, body, now) {
  const { valid, values } = validateCustomerRegistration(body);
  if (!valid) throw new Error("Complete the required Customer profile, billing, and agreement fields.");
  await db.batch([
    db.prepare(`INSERT INTO user_account_profiles (
      user_id,display_name,billing_first_name,billing_last_name,billing_company,
      billing_address_line1,billing_address_line2,billing_city,billing_state_region,
      billing_postal_code,billing_country,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(user_id) DO UPDATE SET
      display_name=excluded.display_name,billing_first_name=excluded.billing_first_name,
      billing_last_name=excluded.billing_last_name,billing_company=excluded.billing_company,
      billing_address_line1=excluded.billing_address_line1,billing_address_line2=excluded.billing_address_line2,
      billing_city=excluded.billing_city,billing_state_region=excluded.billing_state_region,
      billing_postal_code=excluded.billing_postal_code,billing_country=excluded.billing_country,
      updated_at=excluded.updated_at`).bind(
      userId, values.displayName, values.firstName, values.lastName, values.company,
      values.addressLine1, values.addressLine2, values.city, values.stateRegion,
      values.postalCode, values.country, now, now,
    ),
    db.prepare(`INSERT OR IGNORE INTO customer_registration_consents (
      user_id,terms_version,terms_accepted_at,privacy_version,privacy_acknowledged_at,created_at,updated_at
    ) VALUES(?,?,?,?,?,?,?)`).bind(
      userId, CUSTOMER_TERMS_VERSION, now, CUSTOMER_PRIVACY_VERSION, now, now, now,
    ),
  ]);
  return values;
}

export async function activatePendingCustomer(db, userId, now = new Date().toISOString()) {
  const row = await db.prepare(`SELECT s.state,u.email_verified,p.display_name,p.billing_first_name,
      p.billing_last_name,p.billing_address_line1,p.billing_city,p.billing_state_region,
      p.billing_postal_code,p.billing_country,p.payment_method_status,
      c.terms_accepted_at,c.privacy_acknowledged_at
    FROM users u JOIN customer_registration_states s ON s.user_id=u.id LEFT JOIN user_account_profiles p ON p.user_id=u.id
    LEFT JOIN customer_registration_consents c ON c.user_id=u.id WHERE u.id=?`).bind(userId).first();
  if (!row || row.state !== "pending" || Number(row.email_verified) !== 1 ||
      row.payment_method_status !== "ready" || !row.display_name || !row.billing_first_name ||
      !row.billing_last_name || !row.billing_address_line1 || !row.billing_city ||
      !row.billing_state_region || !row.billing_postal_code || !/^[A-Z]{2}$/.test(row.billing_country || "") ||
      !row.terms_accepted_at || !row.privacy_acknowledged_at) return false;
  await db.batch([
    db.prepare("UPDATE customer_registration_states SET state='active',activated_at=COALESCE(activated_at,?),updated_at=? WHERE user_id=? AND state='pending'").bind(now, now, userId),
    db.prepare("UPDATE user_account_profiles SET customer_activated_at=COALESCE(customer_activated_at,?),updated_at=? WHERE user_id=? AND payment_method_status='ready'").bind(now, now, userId),
  ]);
  const result = await db.prepare("SELECT state FROM customer_registration_states WHERE user_id=?").bind(userId).first();
  return result?.state === "active";
}

function clean(value, max) { return String(value || "").trim().slice(0, max); }
