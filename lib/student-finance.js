export const studentBankAccountTypes = [
  { value: "", label: "Not set" },
  { value: "ordinary", label: "Ordinary" },
  { value: "current", label: "Current" }
];

export const studentFinanceNotSet = "\u2014";

export function normalizeStudentFinance(row = {}) {
  const monthlyFeeYen = row.monthly_fee_yen === null || row.monthly_fee_yen === undefined ? null : Number(row.monthly_fee_yen);

  return {
    student_id: row.student_id || "",
    organization_id: row.organization_id || "",
    school_id: row.school_id || "",
    monthly_fee_yen: Number.isFinite(monthlyFeeYen) ? monthlyFeeYen : null,
    currency: row.currency || "JPY",
    postal_address: row.postal_address || "",
    bank_name: row.bank_name || "",
    branch_name: row.branch_name || "",
    account_type: row.account_type || "",
    account_number_last4: row.account_number_last4 || "",
    has_bank_account: Boolean(row.has_bank_account),
    can_view_full_bank_details: Boolean(row.can_view_full_bank_details),
    can_edit_finance: Boolean(row.can_edit_finance),
    can_edit_bank_details: Boolean(row.can_edit_bank_details)
  };
}

export function normalizeStudentBankDetails(row = {}) {
  return {
    bank_name: row.bank_name || "",
    bank_code: row.bank_code || "",
    branch_name: row.branch_name || "",
    branch_name_yomigana: row.branch_name_yomigana || "",
    branch_code: row.branch_code || "",
    account_type: row.account_type || "",
    account_number: row.account_number || "",
    account_holder_katakana: row.account_holder_katakana || ""
  };
}

export function createStudentFinanceForm(finance = {}, bankDetails = {}) {
  const normalizedFinance = normalizeStudentFinance(finance);
  const normalizedBank = normalizeStudentBankDetails(bankDetails);

  return {
    monthlyFeeYen:
      normalizedFinance.monthly_fee_yen === null || normalizedFinance.monthly_fee_yen === undefined
        ? ""
        : String(normalizedFinance.monthly_fee_yen),
    postalAddress: normalizedFinance.postal_address || "",
    bankName: normalizedBank.bank_name || normalizedFinance.bank_name || "",
    bankCode: normalizedBank.bank_code || "",
    branchName: normalizedBank.branch_name || normalizedFinance.branch_name || "",
    branchNameYomigana: normalizedBank.branch_name_yomigana || "",
    branchCode: normalizedBank.branch_code || "",
    accountType: normalizedBank.account_type || normalizedFinance.account_type || "",
    accountNumber: normalizedBank.account_number || "",
    accountHolderKatakana: normalizedBank.account_holder_katakana || ""
  };
}

export function validateStudentFinanceForm(form = {}, options = {}) {
  if (form.monthlyFeeYen !== "") {
    if (!/^\d+$/.test(String(form.monthlyFeeYen))) {
      return "Monthly fee must be a whole yen amount.";
    }

    const monthlyFee = Number(form.monthlyFeeYen);
    if (!Number.isInteger(monthlyFee) || monthlyFee < 0 || monthlyFee > 100000) {
      return "Monthly fee must be between 0 and 100000.";
    }
  }

  if (!options.canEditBankDetails) return "";

  if (form.bankCode && !/^\d{4}$/.test(form.bankCode)) {
    return "Bank code must be four digits.";
  }

  if (form.branchCode && !/^\d{3}$/.test(form.branchCode)) {
    return "Branch code must be three digits.";
  }

  if (form.accountNumber && !/^\d{7}$/.test(form.accountNumber)) {
    return "Account number must be seven digits.";
  }

  if (form.accountType && !studentBankAccountTypes.some((type) => type.value === form.accountType)) {
    return "Unsupported account type.";
  }

  return "";
}

export function formatMonthlyFeeYen(value) {
  if (value === null || value === undefined || value === "") return studentFinanceNotSet;

  const amount = Number(value);
  if (!Number.isFinite(amount)) return studentFinanceNotSet;

  return new Intl.NumberFormat("en-US", {
    currency: "JPY",
    maximumFractionDigits: 0,
    style: "currency"
  }).format(amount);
}

export function formatStudentFinanceValue(value) {
  return value ? String(value) : studentFinanceNotSet;
}

export function formatStudentBankAccountType(value) {
  return studentBankAccountTypes.find((type) => type.value === value)?.label || studentFinanceNotSet;
}

export function formatMaskedAccountNumber(last4) {
  return last4 ? `\u2022\u2022\u2022\u2022${last4}` : studentFinanceNotSet;
}

export function hasStudentFinanceData(finance = {}) {
  if (!finance) return false;

  return Boolean(
    (finance.monthly_fee_yen !== null && finance.monthly_fee_yen !== undefined) ||
      finance.postal_address ||
      finance.has_bank_account ||
      finance.bank_name ||
      finance.branch_name ||
      finance.account_type ||
      finance.account_number_last4
  );
}

export function normalizeStudentFinancePayload(form = {}, options = {}) {
  const payload = {
    monthlyFeeYen: form.monthlyFeeYen === "" ? null : Number(form.monthlyFeeYen),
    postalAddress: emptyToNull(form.postalAddress),
    replaceBank: Boolean(options.canEditBankDetails)
  };

  if (options.canEditBankDetails) {
    return {
      ...payload,
      bankName: emptyToNull(form.bankName),
      bankCode: emptyToNull(form.bankCode),
      branchName: emptyToNull(form.branchName),
      branchNameYomigana: emptyToNull(form.branchNameYomigana),
      branchCode: emptyToNull(form.branchCode),
      accountType: emptyToNull(form.accountType),
      accountNumber: emptyToNull(form.accountNumber),
      accountHolderKatakana: emptyToNull(form.accountHolderKatakana)
    };
  }

  return payload;
}

function emptyToNull(value) {
  const trimmed = String(value || "").trim();
  return trimmed ? trimmed : null;
}
