// Mirrors Papa Parse's escapeFormulae defaults while preserving numeric values.
const FORMULA_PREFIX = /^(?:[\t\r\n ]*[=+\-@]|[\t\r\n])/;

export function financialCsvCell(value) {
  const numeric = typeof value === "number" || typeof value === "bigint";
  let text = String(value ?? "");
  if (!numeric && FORMULA_PREFIX.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function financialCsvRows(rows) {
  return rows.map((row) => row.map(financialCsvCell).join(",")).join("\r\n") + "\r\n";
}
