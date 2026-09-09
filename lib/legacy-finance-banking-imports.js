import { createHash } from "node:crypto";

export const LEGACY_FINANCE_BANKING_IMPORT_BATCHES_TABLE = "legacy_finance_banking_import_batches";
export const LEGACY_FINANCE_BANKING_IMPORT_ROWS_TABLE = "legacy_finance_banking_import_rows";
export const LEGACY_FINANCE_BANKING_WORKSHEET = "Rico";

const EXPECTED_HEADERS = [
  "CustomerID",
  "Active",
  "NameJp",
  "Katakana",
  "Phone Number:",
  "Address",
  "Bank Name",
  "Branch Name",
  "Yomigana",
  "Account Type",
  "Account Number:",
  "Bank Code:",
  "Branch Code",
  "Fee",
  "Date Rico Start"
];

const SENSITIVE_HEADERS = new Map([
  ["Account Number:", maskAccountNumber],
  ["Address", maskPresence],
  ["Phone Number:", maskPhoneNumber],
  ["Fee", maskFeeValue],
  ["Date Rico Start", maskDateRicoValue]
]);

const text = (value) => String(value ?? "").trim();
const key = (value) => text(value).normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
const compactKey = (value) => key(value).replace(/[\s\u3000]/gu, "");

export function identifyLegacyFinanceBankingSheet(workbook) {
  const candidates = (workbook.sheets || []).map((sheet) => {
    const headerKeys = new Set((sheet.headers || []).map(key));
    const matchedHeaders = EXPECTED_HEADERS.filter((header) => headerKeys.has(key(header)));
    const bankingHeaders = ["Bank Name", "Branch Name", "Account Type", "Account Number:", "Bank Code:", "Branch Code"]
      .filter((header) => headerKeys.has(key(header)));
    return {
      name: sheet.name,
      row_count: sheet.rows?.length || 0,
      headers: sheet.headers || [],
      matched_headers: matchedHeaders,
      banking_headers: bankingHeaders,
      score: matchedHeaders.length + bankingHeaders.length * 2
    };
  }).sort((a, b) => b.score - a.score || b.row_count - a.row_count);

  const selected = candidates[0] || null;
  if (!selected || selected.banking_headers.length < 5 || !selected.matched_headers.includes("CustomerID")) {
    throw new Error("Could not identify a dedicated finance/banking worksheet in the legacy workbook.");
  }
  return { selected_sheet_name: selected.name, candidates };
}

export function buildLegacyFinanceBankingDryRun({ workbook, snapshot }) {
  const detected = identifyLegacyFinanceBankingSheet(workbook);
  const sheet = (workbook.sheets || []).find((candidate) => candidate.name === detected.selected_sheet_name);
  if (!sheet) throw new Error("Selected finance/banking worksheet is missing from the workbook.");
  if (!snapshot?.target?.school_id || !Array.isArray(snapshot.students) || !snapshot.fetched_at) {
    throw new Error("A complete database snapshot is required; missing student evidence is not treated as no matches.");
  }

  const rows = sheet.rows.map((source) => normalizeFinanceBankingRow(source, workbook, snapshot));
  const genuineRows = rows.filter((row) => row.student_match_category !== "D");
  const finalProductionPolicy = buildFinalProductionPolicy(genuineRows);
  const count = (predicate) => genuineRows.filter(predicate).length;
  const populatedColumns = sheet.headers
    .map((column) => ({ column, count: genuineRows.filter((row) => text(row.source_data_masked[column])).length }))
    .filter((column) => column.count);

  return {
    mode: "dry_run_only",
    database_writes: 0,
    generated_at: new Date().toISOString(),
    database_snapshot_at: snapshot.fetched_at,
    target: snapshot.target,
    worksheet_detection: detected,
    workbook: {
      file: workbook.file || null,
      date1904: workbook.date1904,
      sheet_name: sheet.name,
      dimension: sheet.dimension,
      header_row_number: sheet.headerRowNumber,
      columns: sheet.columns || [],
      headers: sheet.headers
    },
    summary: {
      total_physical_rows_including_header: sheet.physicalRowCount,
      total_source_rows: sheet.rows.length,
      genuine_finance_rows: genuineRows.length,
      non_student_helper_rows: rows.length - genuineRows.length,
      existing_students_in_target_school: snapshot.students.length,
      exact_student_matches_by_customer_id: count((row) => row.student_match_category === "A"),
      ambiguous_student_matches: count((row) => row.student_match_category === "B"),
      unmatched_rows: count((row) => row.student_match_category === "C"),
      rows_with_valid_bank_details: count((row) => row.normalized_candidate.bank_account.bank_details_status === "valid"),
      rows_missing_bank_details: count((row) => row.normalized_candidate.bank_account.bank_details_status === "missing"),
      rows_with_incomplete_or_malformed_bank_details: count((row) => row.normalized_candidate.bank_account.bank_details_status === "review"),
      valid_account_numbers: count((row) => row.normalized_candidate.bank_account.account_number_status === "valid"),
      malformed_account_numbers: count((row) => row.normalized_candidate.bank_account.account_number_status === "malformed"),
      missing_account_numbers: count((row) => row.normalized_candidate.bank_account.account_number_status === "missing"),
      address_coverage: count((row) => row.normalized_candidate.address.present),
      fee_coverage: count((row) => row.normalized_candidate.billing_profile.monthly_fee_yen !== null),
      invalid_fee_rows: count((row) => row.normalized_candidate.billing_profile.fee_status === "invalid"),
      active_y_rows: count((row) => key(row.source_data_masked.Active) === "y"),
      active_blank_rows: count((row) => !text(row.source_data_masked.Active)),
      date_rico_populated_rows: count((row) => row.normalized_candidate.date_rico.raw_present),
      date_rico_yyyymm_rows: count((row) => row.normalized_candidate.date_rico.format === "yyyymm"),
      production_importable_rows: finalProductionPolicy.production_importable_rows,
      rows_requiring_partial_import: finalProductionPolicy.rows_requiring_partial_import,
      rows_completely_blocked: finalProductionPolicy.rows_completely_blocked
    },
    populated_columns: populatedColumns,
    unique_values: {
      bank_names: valueCounts(genuineRows, "Bank Name"),
      account_types: valueCounts(genuineRows, "Account Type", normalizeAccountType),
      bank_code_formats: formatCounts(genuineRows, "Bank Code:"),
      branch_code_formats: formatCounts(genuineRows, "Branch Code"),
      fee_values: valueCounts(genuineRows, "Fee", normalizeFeeValue),
      date_rico_values: valueCounts(genuineRows, "Date Rico Start", normalizeDateRico)
    },
    correlations: {
      katakana_yomigana: katakanaYomiganaCorrelation(genuineRows),
      date_rico_by_active: valuesByColumn(genuineRows, "Active", (row) => row.normalized_candidate.date_rico.format || "missing")
    },
    ambiguous_customer_id_resolution: buildAmbiguousCustomerIdResolution(genuineRows),
    malformed_account_number_analysis: buildMalformedAccountNumberAnalysis(genuineRows),
    bank_code_branch_code_policy: buildCodePolicy(genuineRows),
    bank_name_normalization_policy: buildBankNameNormalizationPolicy(genuineRows),
    final_production_policy: finalProductionPolicy,
    production_schema: proposedProductionSchema(),
    rls_policy: proposedRlsPolicy(),
    production_field_mapping: productionFieldMapping(),
    unresolved_fields: unresolvedFields(),
    staging: {
      batches_table: LEGACY_FINANCE_BANKING_IMPORT_BATCHES_TABLE,
      rows_table: LEGACY_FINANCE_BANKING_IMPORT_ROWS_TABLE,
      persisted: false,
      idempotency_key: ["school_id", "source_file_sha256", "source_sheet_name", "source_row_number"],
      report_sensitive_policy: "Generated JSON/Markdown reports contain masked account numbers only. Full source bank values belong only in restricted database staging during a future approved import."
    },
    rows
  };
}

export function normalizeFinanceBankingRow(source, workbook, snapshot) {
  const raw = source.values || {};
  const sourceDataMasked = maskSourceData(raw);
  const target = snapshot.target;
  const warnings = [];
  const errors = [];
  const legacyCustomerId = normalizeCustomerId(raw.CustomerID);
  const bankAccount = normalizeBankAccount(raw, warnings);
  const billingProfile = normalizeBillingProfile(raw.Fee, warnings);
  const dateRico = normalizeDateRico(raw["Date Rico Start"]);
  const phoneNormalized = normalizePhone(raw["Phone Number:"]);
  const address = {
    present: Boolean(text(raw.Address)),
    target: text(raw.Address) ? "student_addresses.postal_address" : null,
    import_action: text(raw.Address) ? "requires_student_address_model" : "none"
  };
  const matching = matchFinanceBankingStudent({
    legacyCustomerId,
    phone: phoneNormalized,
    japaneseName: raw.NameJp,
    katakana: raw.Katakana,
    students: snapshot.students,
    target
  });

  if (dateRico.raw_present && dateRico.format !== "yyyymm") {
    warnings.push({ code: "date_rico_meaning_or_format_unresolved", column: "Date Rico Start" });
  }

  return {
    organization_id: target.organization_id,
    school_id: target.school_id,
    import_kind: "finance_banking",
    source_file_sha256: workbook.file?.sha256 || null,
    source_sheet_name: LEGACY_FINANCE_BANKING_WORKSHEET,
    source_row_number: source.rowNumber,
    source_identity: financeBankingSourceIdentity(target, workbook.file?.sha256, source.rowNumber),
    source_data_masked: sourceDataMasked,
    legacy_customer_id: legacyCustomerId,
    matched_student_id: matching.chosen_student_id,
    match_confidence: matching.confidence,
    student_match_category: matching.category,
    student_match_candidates: matching.candidates,
    normalized_candidate: {
      active_raw: text(raw.Active) || null,
      name_jp: text(raw.NameJp) || null,
      katakana: text(raw.Katakana) || null,
      phone: { present: Boolean(phoneNormalized), normalized_masked: maskPhoneNumber(phoneNormalized) },
      address,
      billing_profile: billingProfile,
      bank_account: bankAccount,
      date_rico: dateRico,
      student_matching: matching,
      import_blockers: matching.category === "A" ? [] : ["student_link_requires_review"]
    },
    warnings,
    errors,
    import_status: "dry_run",
    imported_billing_profile_id: null,
    imported_bank_account_id: null,
    imported_address_id: null,
    validation_state: errors.length ? "error" : warnings.length || matching.category !== "A" ? "warning" : "valid"
  };
}

export function matchFinanceBankingStudent({ legacyCustomerId, phone, japaneseName, katakana, students, target }) {
  const scoped = students.filter((student) => student.organization_id === target.organization_id && student.school_id === target.school_id);

  if (legacyCustomerId) {
    const customerMatches = scoped.filter((student) => text(student.legacy_customer_id) === legacyCustomerId);
    const context = { legacyCustomerId, phone, japaneseName, katakana };
    if (customerMatches.length === 1) return matchResult("A", "exact_legacy_customer_id", customerMatches, null, context);
    if (customerMatches.length > 1) return matchResult("B", "duplicate_legacy_customer_id", customerMatches, null, context);
    return matchResult("C", "legacy_customer_id_not_found", []);
  }

  const candidateMatches = scoped
    .map((student) => {
      const contacts = student.student_contacts || student.contacts || [];
      const signals = [];
      if (phone && contacts.some((contact) => contact.contact_type === "phone" && normalizePhone(contact.value) === phone)) signals.push("phone");
      const names = studentNames(student);
      if (names.some((name) => [japaneseName, katakana].map(compactKey).filter(Boolean).includes(name))) signals.push("compatible_name");
      return signals.length ? { student, signals } : null;
    })
    .filter(Boolean);
  const conservative = candidateMatches.filter((candidate) => candidate.signals.includes("phone") && candidate.signals.includes("compatible_name"));
  if (conservative.length) return matchResult("B", "reviewed_fallback_phone_and_compatible_name", conservative.map((candidate) => candidate.student), conservative);
  if (candidateMatches.length) return matchResult("B", "weak_fallback_signal", candidateMatches.map((candidate) => candidate.student), candidateMatches);

  const hasAnyMeaning = Boolean(legacyCustomerId || phone || text(japaneseName) || text(katakana));
  return matchResult(hasAnyMeaning ? "C" : "D", hasAnyMeaning ? "no_student_match" : "non_student_helper_row", []);
}

export function financeBankingSourceIdentity(target, hash, rowNumber) {
  if (!target?.organization_id || !target?.school_id || !/^[a-f0-9]{64}$/.test(hash || "") || !Number.isInteger(rowNumber) || rowNumber <= 0) {
    throw new Error("A resolved tenant, SHA-256 and positive source row are required.");
  }
  return createHash("sha256").update(JSON.stringify([target.school_id, hash, LEGACY_FINANCE_BANKING_WORKSHEET, rowNumber])).digest("hex");
}

export function maskAccountNumber(value) {
  const digits = digitsOnly(value);
  if (!digits) return null;
  const suffix = digits.slice(-3);
  return `${"*".repeat(Math.max(digits.length - 3, 3))}${suffix}`;
}

export function normalizeAccountNumber(value) {
  const raw = text(value);
  if (!raw) return {
    raw_present: false,
    status: "missing",
    masked: null,
    digit_count: 0,
    raw_string_length: 0,
    character_type_issue: "blank",
    issue: "blank",
    excel_formatting_assessment: "not_applicable"
  };
  const digits = digitsOnly(raw);
  const valid = /^\d{7}$/.test(digits) && !String(raw).trim().startsWith("-");
  const issue = accountNumberIssue(raw, digits);
  return {
    raw_present: true,
    status: valid ? "valid" : "malformed",
    masked: maskAccountNumber(raw),
    digit_count: digits.length,
    raw_string_length: raw.length,
    character_type_issue: valid ? "none" : accountNumberCharacterIssue(raw),
    issue: valid ? "none" : issue,
    excel_formatting_assessment: accountNumberExcelAssessment(value, raw, digits, issue)
  };
}

export function normalizeBankCode(value) {
  const raw = text(value);
  if (!raw) return { raw_present: false, status: "missing", normalized: null, format: "blank" };
  const normalized = typeof value === "number" && Number.isInteger(value) ? String(value).padStart(4, "0") : raw;
  const valid = /^\d{4}$/.test(normalized);
  return {
    raw_present: true,
    status: valid ? "valid" : "malformed",
    normalized: valid ? normalized : null,
    format: describeFormat(raw),
    storage_type: "text",
    normalization: typeof value === "number" && raw.length < 4 && valid ? "left_padded_numeric_cell" : "as_source_string"
  };
}

export function normalizeBranchCode(value) {
  const raw = text(value);
  if (!raw) return { raw_present: false, status: "missing", normalized: null, format: "blank" };
  const normalized = typeof value === "number" && Number.isInteger(value) ? String(value).padStart(3, "0") : raw;
  const valid = /^\d{3}$/.test(normalized);
  return {
    raw_present: true,
    status: valid ? "valid" : "malformed",
    normalized: valid ? normalized : null,
    format: describeFormat(raw),
    storage_type: "text",
    normalization: typeof value === "number" && raw.length < 3 && valid ? "left_padded_numeric_cell" : "as_source_string"
  };
}

export function normalizeAccountType(value) {
  const raw = text(value);
  const normalized = raw.normalize("NFKC");
  if (!raw) return { raw_value: null, canonical: null, status: "missing" };
  if (normalized === "普通") return { raw_value: raw, canonical: "ordinary", status: "mapped" };
  if (normalized === "当座") return { raw_value: raw, canonical: "current", status: "mapped" };
  return { raw_value: raw, canonical: null, status: "unresolved" };
}

export function normalizeFeeValue(value) {
  const raw = text(value);
  if (!raw) return { raw_value: null, monthly_fee_yen: null, status: "missing" };
  if (!/^\d+$/.test(raw)) return { raw_value: raw, monthly_fee_yen: null, status: "invalid" };
  const monthlyFeeYen = Number(raw);
  if (monthlyFeeYen > 100000) return { raw_value: raw, monthly_fee_yen: null, status: "invalid" };
  return { raw_value: raw, monthly_fee_yen: monthlyFeeYen, status: "valid" };
}

export function normalizeDateRico(value) {
  const raw = text(value);
  if (!raw) return { raw_present: false, raw_value: null, format: null, parsed_month: null, interpretation: "not_provided" };
  const normalized = raw.normalize("NFKC");
  const match = normalized.match(/^(\d{4})(\d{2})$/);
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) {
    return {
      raw_present: true,
      raw_value: normalized,
      format: "yyyymm",
      parsed_month: `${match[1]}-${match[2]}`,
      interpretation: "likely direct-debit/Rico setup start month; staged unresolved until owner confirms"
    };
  }
  return { raw_present: true, raw_value: maskDateRicoValue(normalized), format: describeFormat(normalized), parsed_month: null, interpretation: "unresolved" };
}

function normalizeBankAccount(raw, warnings) {
  const accountNumber = normalizeAccountNumber(raw["Account Number:"]);
  const bankCode = normalizeBankCode(raw["Bank Code:"]);
  const branchCode = normalizeBranchCode(raw["Branch Code"]);
  const accountType = normalizeAccountType(raw["Account Type"]);
  const requiredStatuses = [accountNumber.status, bankCode.status, branchCode.status, accountType.status];
  const bankTextPresent = ["Bank Name", "Branch Name", "Yomigana"].some((column) => text(raw[column]));
  const anyPresent = bankTextPresent || requiredStatuses.some((status) => status !== "missing");
  const allValid = text(raw["Bank Name"]) && text(raw["Branch Name"]) && accountNumber.status === "valid" &&
    bankCode.status === "valid" && branchCode.status === "valid" && accountType.status === "mapped";
  const bankDetailsStatus = allValid ? "valid" : anyPresent ? "review" : "missing";

  for (const [field, state] of [["account_number", accountNumber], ["bank_code", bankCode], ["branch_code", branchCode]]) {
    if (state.status === "malformed") warnings.push({ code: `malformed_${field}`, column: field });
  }
  if (accountType.status === "unresolved") warnings.push({ code: "unresolved_account_type", column: "Account Type" });

  return {
    bank_name: normalizeBankDisplayName(raw["Bank Name"], bankCode.normalized),
    branch_name: text(raw["Branch Name"]) || null,
    branch_name_yomigana: text(raw.Yomigana) || null,
    account_holder_katakana: text(raw.Katakana) || null,
    account_type: accountType,
    account_number_masked: accountNumber.masked,
    account_number_status: accountNumber.status,
    account_number_digit_count: accountNumber.digit_count,
    account_number_raw_string_length: accountNumber.raw_string_length,
    account_number_character_type_issue: accountNumber.character_type_issue,
    account_number_issue: accountNumber.issue,
    account_number_excel_formatting_assessment: accountNumber.excel_formatting_assessment,
    bank_code: bankCode.normalized,
    bank_code_status: bankCode.status,
    bank_code_format: bankCode.format,
    bank_code_normalization: bankCode.normalization,
    branch_code: branchCode.normalized,
    branch_code_status: branchCode.status,
    branch_code_format: branchCode.format,
    branch_code_normalization: branchCode.normalization,
    bank_details_status: bankDetailsStatus,
    import_action: bankDetailsStatus === "missing" ? "none" : "requires_secure_student_bank_accounts_model"
  };
}

function normalizeBillingProfile(value, warnings) {
  const fee = normalizeFeeValue(value);
  if (fee.status === "invalid") warnings.push({ code: "invalid_fee", column: "Fee" });
  return {
    monthly_fee_yen: fee.monthly_fee_yen,
    fee_status: fee.status,
    currency: "JPY",
    import_action: fee.status === "valid" ? "requires_student_billing_profiles_model" : "none"
  };
}

function matchResult(category, confidence, students, signalMatches = null, context = {}) {
  const candidates = students.map((student) => {
    const signalEntry = signalMatches?.find((candidate) => candidate.student.id === student.id);
    const evidence = candidateEvidence(student, context);
    return {
      student_id: student.id,
      student_name: [student.first_name, student.last_name].filter(Boolean).join(" ") || student.preferred_name || student.legacy_japanese_name || null,
      legacy_customer_id: student.legacy_customer_id || null,
      status: student.status || null,
      legacy_japanese_name: student.legacy_japanese_name || null,
      signals: [...new Set([...(signalEntry?.signals || []), ...evidence.matching_signals])],
      matching_signals: evidence.matching_signals,
      conflicting_signals: evidence.conflicting_signals
    };
  });
  return {
    category,
    confidence,
    chosen_student_id: category === "A" && candidates.length === 1 ? candidates[0].student_id : null,
    candidates
  };
}

function studentNames(student) {
  return [...new Set([
    student.legacy_japanese_name,
    student.japanese_name,
    student.katakana,
    [student.first_name, student.last_name].filter(Boolean).join(" "),
    [student.last_name, student.first_name].filter(Boolean).join(" ")
  ].map(compactKey).filter(Boolean))];
}

function candidateEvidence(student, context = {}) {
  const matchingSignals = [];
  const conflictingSignals = [];
  if (context.legacyCustomerId && text(student.legacy_customer_id) === context.legacyCustomerId) matchingSignals.push("legacy_customer_id");
  if (context.phone) {
    const contacts = student.student_contacts || student.contacts || [];
    if (contacts.some((contact) => contact.contact_type === "phone" && normalizePhone(contact.value) === context.phone)) {
      matchingSignals.push("phone");
    } else {
      conflictingSignals.push("source_phone_not_found_on_candidate");
    }
  } else {
    conflictingSignals.push("source_phone_blank");
  }

  const sourceNames = [context.japaneseName, context.katakana].map(compactKey).filter(Boolean);
  const candidateNames = studentNames(student);
  if (sourceNames.some((sourceName) => candidateNames.includes(sourceName))) {
    matchingSignals.push("compatible_japanese_name");
  } else if (sourceNames.length && candidateNames.some((candidateName) => sourceNames.some((sourceName) => sourceName.startsWith(candidateName) || candidateName.startsWith(sourceName)))) {
    matchingSignals.push("partial_japanese_name_overlap");
  } else if (sourceNames.length && candidateNames.length) {
    conflictingSignals.push("source_name_not_equal_candidate_identity");
  }

  return { matching_signals: matchingSignals, conflicting_signals: conflictingSignals };
}

function buildAmbiguousCustomerIdResolution(rows) {
  return rows
    .filter((row) => row.student_match_category === "B" && row.match_confidence === "duplicate_legacy_customer_id")
    .map((row) => ({
      source_row_number: row.source_row_number,
      customer_id: row.legacy_customer_id,
      name_jp: row.normalized_candidate.name_jp,
      katakana: row.normalized_candidate.katakana,
      masked_phone: row.normalized_candidate.phone.normalized_masked || "",
      candidate_students: row.student_match_candidates.map((candidate) => ({
        student_id: candidate.student_id,
        student_name: candidate.student_name,
        legacy_customer_id: candidate.legacy_customer_id,
        status: candidate.status,
        legacy_japanese_name: candidate.legacy_japanese_name,
        matching_signals: candidate.matching_signals,
        conflicting_signals: candidate.conflicting_signals
      })),
      recommendation: "OWNER REVIEW",
      reason: "CustomerID is duplicated, and secondary identity evidence does not isolate exactly one existing Student."
    }));
}

function buildMalformedAccountNumberAnalysis(rows) {
  return rows
    .filter((row) => row.normalized_candidate.bank_account.account_number_status === "malformed")
    .map((row) => ({
      source_row_number: row.source_row_number,
      bank_name: row.normalized_candidate.bank_account.bank_name || "",
      masked_account_number: row.normalized_candidate.bank_account.account_number_masked,
      raw_string_length: row.normalized_candidate.bank_account.account_number_raw_string_length,
      character_type_issue: row.normalized_candidate.bank_account.account_number_character_type_issue,
      issue: row.normalized_candidate.bank_account.account_number_issue,
      excel_formatting_assessment: row.normalized_candidate.bank_account.account_number_excel_formatting_assessment
    }));
}

function buildCodePolicy(rows) {
  const bankRows = rows.map((row) => row.normalized_candidate.bank_account);
  const countCode = (field, status) => bankRows.filter((account) => account[`${field}_status`] === status).length;
  const formats = (field) => [...new Set(bankRows.map((account) => account[`${field}_format`]))].filter(Boolean);
  return {
    bank_code: {
      expected_length: 4,
      storage_type: "text",
      formats_found: formats("bank_code"),
      valid_count: countCode("bank_code", "valid"),
      malformed_count: countCode("bank_code", "malformed"),
      missing_count: countCode("bank_code", "missing"),
      normalization_safe: "Safe only for already 4-digit strings or numeric cells left-padded to four digits; never store as integer."
    },
    branch_code: {
      expected_length: 3,
      storage_type: "text",
      formats_found: formats("branch_code"),
      valid_count: countCode("branch_code", "valid"),
      malformed_count: countCode("branch_code", "malformed"),
      missing_count: countCode("branch_code", "missing"),
      normalization_safe: "Safe only for already 3-digit strings or numeric cells left-padded to three digits; never store as integer."
    }
  };
}

function buildBankNameNormalizationPolicy(rows) {
  const buckets = new Map();
  for (const row of rows) {
    const account = row.normalized_candidate.bank_account;
    const rawName = account.bank_name || "";
    const normalizedName = normalizeBankDisplayName(rawName, account.bank_code);
    const keyName = `${rawName}\n${account.bank_code || ""}\n${normalizedName}`;
    const bucket = buckets.get(keyName) || {
      raw_bank_name: rawName,
      legacy_bank_code: account.bank_code || null,
      canonical_display_name: normalizedName,
      rule: bankNameRule(rawName, account.bank_code),
      source_rows: []
    };
    bucket.source_rows.push(row.source_row_number);
    buckets.set(keyName, bucket);
  }
  return [...buckets.values()].sort((a, b) => a.canonical_display_name.localeCompare(b.canonical_display_name) || a.raw_bank_name.localeCompare(b.raw_bank_name));
}

function buildFinalProductionPolicy(rows) {
  const linkable = rows.filter((row) => row.student_match_category === "A");
  const blocked = rows.filter((row) => row.student_match_category !== "A");
  const partial = linkable.filter((row) => {
    const candidate = row.normalized_candidate;
    return candidate.bank_account.bank_details_status !== "valid" ||
      candidate.billing_profile.fee_status === "invalid";
  });
  return {
    production_importable_rows: linkable.length,
    rows_requiring_partial_import: partial.length,
    rows_completely_blocked: blocked.length,
    production_importable_source_rows: linkable.map((row) => row.source_row_number),
    partial_import_source_rows: partial.map((row) => row.source_row_number),
    completely_blocked_source_rows: blocked.map((row) => row.source_row_number),
    policy: "Only category A rows may write production Student finance records. Invalid subrecords are skipped with warnings while valid subrecords for the same linked Student may still import."
  };
}

function maskSourceData(raw) {
  return Object.fromEntries(Object.entries(raw).map(([header, value]) => [
    header,
    SENSITIVE_HEADERS.has(header) ? SENSITIVE_HEADERS.get(header)(value) : value
  ]));
}

function maskPresence(value) {
  return text(value) ? "[present]" : "";
}

function maskPhoneNumber(value) {
  const digits = digitsOnly(value);
  if (!digits) return "";
  return `${"*".repeat(Math.max(digits.length - 4, 4))}${digits.slice(-4)}`;
}

function maskFeeValue(value) {
  const raw = text(value);
  if (!raw) return "";
  const normalized = raw.normalize("NFKC");
  if (/^\d+$/.test(normalized) && Number(normalized) <= 100000) return value;
  if (/^\d+$/.test(normalized)) return `[invalid numeric fee: ${normalized.length} digits]`;
  return "[invalid fee value present]";
}

function maskDateRicoValue(value) {
  const raw = text(value).normalize("NFKC");
  if (!raw) return "";
  const match = raw.match(/^(\d{4})(\d{2})$/);
  if (match && Number(match[2]) >= 1 && Number(match[2]) <= 12) return value;
  return `[unresolved date rico: ${describeFormat(raw)}]`;
}

function valueCounts(rows, column, mapper = null) {
  const buckets = new Map();
  for (const row of rows) {
    const rawValue = row.source_data_masked[column] ?? "";
    const identity = JSON.stringify(rawValue);
    const bucket = buckets.get(identity) || { raw_value: rawValue, count: 0, source_rows: [], ...(mapper ? { normalized: mapper(rawValue) } : {}) };
    bucket.count += 1;
    bucket.source_rows.push(row.source_row_number);
    buckets.set(identity, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count || String(a.raw_value).localeCompare(String(b.raw_value)));
}

function formatCounts(rows, column) {
  const buckets = new Map();
  for (const row of rows) {
    const format = describeFormat(row.source_data_masked[column]);
    const bucket = buckets.get(format) || { format, count: 0, source_rows: [] };
    bucket.count += 1;
    bucket.source_rows.push(row.source_row_number);
    buckets.set(format, bucket);
  }
  return [...buckets.values()].sort((a, b) => b.count - a.count || a.format.localeCompare(b.format));
}

function valuesByColumn(rows, column, selector) {
  const buckets = new Map();
  for (const row of rows) {
    const value = text(row.source_data_masked[column]) || "(blank)";
    const selected = selector(row);
    const bucket = buckets.get(value) || {};
    bucket[selected] = (bucket[selected] || 0) + 1;
    buckets.set(value, bucket);
  }
  return Object.fromEntries(buckets.entries());
}

function katakanaYomiganaCorrelation(rows) {
  return {
    same_normalized_value_count: rows.filter((row) => compactKey(row.source_data_masked.Katakana) && compactKey(row.source_data_masked.Katakana) === compactKey(row.source_data_masked.Yomigana)).length,
    both_present_count: rows.filter((row) => text(row.source_data_masked.Katakana) && text(row.source_data_masked.Yomigana)).length,
    interpretation: "Katakana is the customer/account-holder katakana reading. Yomigana is the bank branch-name reading/romanization and maps separately to branch_name_yomigana."
  };
}

function proposedProductionSchema() {
  return [
    "student_billing_profiles(id uuid primary key, organization_id uuid not null, school_id uuid not null, student_id uuid not null, monthly_fee_yen integer, currency char(3) not null default 'JPY', source_type text, source_file_sha256 text, source_sheet_name text, source_row_number integer, created_at timestamptz not null default now(), updated_at timestamptz not null default now())",
    "student_addresses(id uuid primary key, organization_id uuid not null, school_id uuid not null, student_id uuid not null, postal_address text not null, source_type text, source_file_sha256 text, source_sheet_name text, source_row_number integer, created_at timestamptz not null default now(), updated_at timestamptz not null default now())",
    "student_bank_accounts(id uuid primary key, organization_id uuid not null, school_id uuid not null, student_id uuid not null, bank_name text, bank_code text, branch_name text, branch_name_yomigana text, branch_code text, account_type text check (account_type is null or account_type in ('ordinary', 'current')), account_number text check (account_number is null or account_number ~ '^[0-9]{7}$'), account_holder_katakana text, source_type text, source_file_sha256 text, source_sheet_name text, source_row_number integer, created_at timestamptz not null default now(), updated_at timestamptz not null default now())"
  ];
}

function proposedRlsPolicy() {
  return [
    "Enable RLS on student_billing_profiles, student_bank_accounts and student_addresses.",
    "Revoke table privileges from anon; grant only authenticated access guarded by policies plus service_role.",
    "Use can_manage_student_finance_org for billing/address admin data; office_staff may manage those records where otherwise authorized.",
    "Use a separate can_manage_student_bank_accounts_org helper for bank-account and raw staging data. Only super_admin, tenant franchise_owner and school_manager may read or write full bank details.",
    "Exclude teacher and office_staff from every full bank-account policy. Teachers and office_staff get zero SELECT/INSERT/UPDATE/DELETE access to student_bank_accounts.",
    "Policies must check both organization_id and school_id against the linked student row and use restrictive tenant FKs with on delete restrict."
  ];
}

function productionFieldMapping() {
  return [
    { source: "CustomerID", target: "students.legacy_customer_id lookup only", rule: "Unique exact target-school match is category A and automatically linkable; no Student creation." },
    { source: "Address", target: "student_addresses.postal_address", rule: "Enrolled Student admin/payment address only; never Prospect/Trial Lesson and never arbitrary notes. Missing address does not block row import." },
    { source: "Fee", target: "student_billing_profiles.monthly_fee_yen", rule: "Clean integer JPY only. Invalid Fee leaves monthly_fee_yen null and does not block other valid subrecords." },
    { source: "Bank Name / Bank Code", target: "student_bank_accounts.bank_name / bank_code", rule: "Validated code stored separately from display name." },
    { source: "Branch Name / Branch Code", target: "student_bank_accounts.branch_name / branch_code", rule: "Validated branch code stored separately from display name." },
    { source: "Account Type", target: "student_bank_accounts.account_type", rule: "Only verified 普通 -> ordinary and 当座 -> current mappings; blank or unknown values remain NULL." },
    { source: "Account Number", target: "student_bank_accounts.account_number", rule: "Only clean seven-digit values enter production. Malformed or possible leading-zero-loss values remain NULL and raw values stay only in protected staging." },
    { source: "Yomigana", target: "student_bank_accounts.branch_name_yomigana", rule: "Owner-approved branch-name reading/romanization; not an account-holder field." },
    { source: "Katakana", target: "student_bank_accounts.account_holder_katakana", rule: "Owner-approved account-holder katakana reading." },
    { source: "Date Rico Start", target: "protected staging only", rule: "YYYYMM pattern looks like setup/start month, but meaning remains unresolved and no production effective/start date is written." }
  ];
}

function accountNumberIssue(raw, digits) {
  const normalized = raw.normalize("NFKC");
  if (!normalized) return "blank";
  if (/[eE][+-]?\d+/.test(normalized)) return "excel_formatting_or_scientific_notation";
  if (/^\d+$/.test(normalized) && digits.length === 6) return "possible_leading_zero_loss";
  if (/^\d+$/.test(normalized) && digits.length < 7) return "too_short";
  if (/^\d+$/.test(normalized) && digits.length > 7) return "too_long";
  if (/^\d+$/.test(normalized)) return "other";
  if (digits.length > 7) return "too_long";
  if (digits.length < 7) return "non_numeric";
  return "other";
}

function accountNumberCharacterIssue(raw) {
  const normalized = raw.normalize("NFKC");
  if (!normalized) return "blank";
  if (/^\d+$/.test(normalized)) return "digits_only_wrong_length";
  if (/[eE][+-]?\d+/.test(normalized)) return "scientific_notation_characters";
  if (/^-/.test(normalized)) return "negative_sign";
  if (/[^\d]/.test(normalized)) return "non_digit_characters";
  return "other";
}

function accountNumberExcelAssessment(value, raw, digits, issue) {
  if (issue === "possible_leading_zero_loss") {
    return typeof value === "number"
      ? "likely Excel numeric-cell leading-zero loss; do not auto-repair account_number without owner/bank confirmation"
      : "possible leading-zero loss; string source is still too short, so do not auto-repair without owner/bank confirmation";
  }
  if (/[eE][+-]?\d+/.test(raw)) return "scientific notation detected; treat as damaged string";
  if (typeof value === "number") return "numeric spreadsheet cell; production importer must convert to text before validation and never store as integer";
  return "not obviously caused only by Excel formatting";
}

export function normalizeBankDisplayName(rawName, bankCode) {
  const normalized = text(rawName).normalize("NFKC");
  if (!normalized) return "";
  if (normalized === "西日本シティ" && bankCode === "0190") return "西日本シティ銀行";
  return normalized;
}

function bankNameRule(rawName, bankCode) {
  const normalized = text(rawName).normalize("NFKC");
  if (!normalized) return "blank raw bank name remains unresolved";
  if (normalized === "西日本シティ" && bankCode === "0190") {
    return "normalize display to 西日本シティ銀行 because the workbook also has 西日本シティ銀行 with the same legacy Bank Code 0190";
  }
  if (normalized !== text(rawName)) return "NFKC/trim only; no official bank name invented";
  return "preserve raw display name after trim; use legacy Bank Code when present";
}

function unresolvedFields() {
  return [
    "Date Rico Start business meaning: likely direct-debit/Rico start month from YYYYMM values, but it remains protected staging-only until owner confirmation.",
    "Whether full account_number should be encrypted at application level before storage or protected solely by Supabase/RLS and operational controls."
  ];
}

function normalizeCustomerId(value) {
  const normalized = text(value);
  if (!normalized) return null;
  return normalized.replace(/\.0$/, "");
}

function normalizePhone(value) {
  const raw = text(value).normalize("NFKC");
  if (!raw || !/^[+\d\s().-]+$/u.test(raw)) return null;
  let digits = raw.replace(/[\s().-]/gu, "");
  if (digits.startsWith("+81")) digits = `0${digits.slice(3).replace(/^0/, "")}`;
  return /^0\d{9,10}$/.test(digits) ? digits : null;
}

function digitsOnly(value) {
  return text(value).normalize("NFKC").replace(/\D/gu, "");
}

function describeFormat(value) {
  const raw = text(value).normalize("NFKC");
  if (!raw) return "blank";
  if (/^\d+$/.test(raw)) return `${raw.length}_digit_numeric`;
  if (/^-\d+$/.test(raw)) return `negative_${raw.length - 1}_digit_numeric`;
  if (/^\d+-\d+$/.test(raw)) return "hyphenated_numeric";
  if (/^[\d\s]+$/.test(raw)) return "numeric_with_spaces";
  return "mixed_or_text";
}
