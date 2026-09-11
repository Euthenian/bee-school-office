import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createStudentFinanceForm,
  formatMaskedAccountNumber,
  formatMonthlyFeeYen,
  formatStudentBankAccountType,
  hasStudentFinanceData,
  normalizeStudentFinance,
  normalizeStudentFinancePayload,
  validateStudentFinanceForm
} from "../lib/student-finance.js";
import {
  canEditStudentBankDetails,
  canEditStudentFinance,
  canViewStudentBankDetails,
  canViewStudentFinance
} from "../lib/roles.js";

const migrationSql = readFileSync(
  new URL("../supabase/migrations/20260911001000_student_profile_finance_access.sql", import.meta.url),
  "utf8"
);
const dataSource = readFileSync(new URL("../lib/data.js", import.meta.url), "utf8");
const studentProfilePage = readFileSync(new URL("../app/(app)/students/profile/page.js", import.meta.url), "utf8");
const studentFinanceEditPage = readFileSync(new URL("../app/(app)/students/finance/edit/page.js", import.meta.url), "utf8");
const studentFinanceForm = readFileSync(new URL("../components/StudentFinanceForm.js", import.meta.url), "utf8");

test("Student Profile finance helpers format monthly fee and masked bank values without full account data", () => {
  const finance = normalizeStudentFinance({
    account_number_last4: "1578",
    account_type: "ordinary",
    bank_name: "Fukuoka Bank",
    branch_name: "Ohashi",
    can_edit_bank_details: true,
    can_edit_finance: true,
    can_view_full_bank_details: true,
    has_bank_account: true,
    monthly_fee_yen: 6600,
    postal_address: "Fukuoka city"
  });

  assert.equal(formatMonthlyFeeYen(finance.monthly_fee_yen), "\u00a56,600");
  assert.equal(formatMaskedAccountNumber(finance.account_number_last4), "\u2022\u2022\u2022\u20221578");
  assert.equal(formatStudentBankAccountType(finance.account_type), "Ordinary");
  assert.equal(hasStudentFinanceData(finance), true);
  assert.equal(hasStudentFinanceData(null), false);
  assert.equal(hasStudentFinanceData({}), false);
  assert.equal(JSON.stringify(finance).includes("1234567"), false);
});

test("Student finance form preserves leading-zero bank fields as text and validates partial legacy data", () => {
  const form = createStudentFinanceForm(
    {
      monthly_fee_yen: null,
      postal_address: "",
      account_type: "ordinary",
      account_number_last4: "0123"
    },
    {
      account_number: "0000123",
      bank_code: "0177",
      branch_code: "004"
    }
  );

  assert.equal(form.accountNumber, "0000123");
  assert.equal(form.bankCode, "0177");
  assert.equal(form.branchCode, "004");
  assert.equal(validateStudentFinanceForm(form, { canEditBankDetails: true }), "");
  assert.equal(validateStudentFinanceForm({ ...form, accountNumber: "123" }, { canEditBankDetails: true }), "Account number must be seven digits.");
  assert.equal(normalizeStudentFinancePayload(form, { canEditBankDetails: true }).accountNumber, "0000123");
  assert.equal(normalizeStudentFinancePayload(form, { canEditBankDetails: false }).accountNumber, undefined);
});

test("UI role helpers expose finance to office staff but full bank details only to restricted admins", () => {
  const superAdmin = { organization_memberships: [{ role: "super_admin" }] };
  const franchiseOwner = { organization_memberships: [{ role: "franchise_owner" }] };
  const schoolManager = { school_memberships: [{ role: "school_manager" }] };
  const officeStaff = { school_memberships: [{ role: "office_staff" }] };
  const teacher = { school_memberships: [{ role: "teacher" }] };

  for (const profile of [superAdmin, franchiseOwner, schoolManager, officeStaff]) {
    assert.equal(canViewStudentFinance(profile), true);
    assert.equal(canEditStudentFinance(profile), true);
  }

  for (const profile of [superAdmin, franchiseOwner, schoolManager]) {
    assert.equal(canViewStudentBankDetails(profile), true);
    assert.equal(canEditStudentBankDetails(profile), true);
  }

  assert.equal(canViewStudentBankDetails(officeStaff), false);
  assert.equal(canEditStudentBankDetails(officeStaff), false);
  assert.equal(canViewStudentFinance(teacher), false);
  assert.equal(canEditStudentFinance(teacher), false);
  assert.equal(canViewStudentBankDetails(teacher), false);
});

test("finance profile RPCs enforce masked initial load, explicit full-bank access, and atomic controlled updates", () => {
  const maskedFunction =
    migrationSql.match(/create or replace function public\.get_student_finance_mvp[\s\S]*?grant execute on function public\.get_student_finance_mvp\(uuid\) to authenticated;/)?.[0] ||
    "";
  const fullBankFunction =
    migrationSql.match(/create or replace function public\.get_student_bank_details_mvp[\s\S]*?grant execute on function public\.get_student_bank_details_mvp\(uuid\) to authenticated;/)?.[0] ||
    "";
  const updateFunction =
    migrationSql.match(
      /create or replace function public\.update_student_finance_mvp[\s\S]*?grant execute on function public\.update_student_finance_mvp\(uuid, integer, text, boolean, text, text, text, text, text, text, text, text\) to authenticated;/
    )?.[0] || "";

  assert.match(maskedFunction, /returns table \([\s\S]*account_number_last4 text/);
  assert.doesNotMatch(maskedFunction.match(/returns table \([\s\S]*?\)/)?.[0] || "", /\baccount_number text\b/);
  assert.match(maskedFunction, /public\.can_manage_student_finance_org\(v_student\.organization_id, v_student\.school_id\)/);
  assert.match(maskedFunction, /right\(v_bank\.account_number, 4\)/);
  assert.match(maskedFunction, /v_can_bank/);
  assert.match(fullBankFunction, /public\.can_manage_student_bank_accounts_org\(v_student\.organization_id, v_student\.school_id\)/);
  assert.match(fullBankFunction, /\bsba\.account_number\b/);
  assert.match(updateFunction, /if not public\.can_manage_student_finance_org/);
  assert.match(updateFunction, /if p_replace_bank then[\s\S]*can_manage_student_bank_accounts_org/);
  assert.match(updateFunction, /\bp_bank_code text\b/);
  assert.match(updateFunction, /\bp_branch_code text\b/);
  assert.match(updateFunction, /\bp_account_number text\b/);
  assert.match(updateFunction, /v_account_number !~ '\^\[0-9\]\{7\}\$'/);
  assert.match(updateFunction, /insert into public\.student_billing_profiles/);
  assert.match(updateFunction, /insert into public\.student_addresses/);
  assert.match(updateFunction, /insert into public\.student_bank_accounts/);
  assert.match(updateFunction, /delete from public\.student_bank_accounts/);
  assert.match(migrationSql, /revoke all on function public\.get_student_finance_mvp\(uuid\) from public, anon/);
  assert.match(migrationSql, /revoke all on function public\.get_student_bank_details_mvp\(uuid\) from public, anon/);
  assert.match(migrationSql, /notify pgrst, 'reload schema'/);
});

test("existing finance RLS remains tenant-scoped and keeps office staff and teachers away from full bank tables", () => {
  const legacyFinanceSql = readFileSync(
    new URL("../supabase/migrations/20260909002000_legacy_finance_banking_import_staging.sql", import.meta.url),
    "utf8"
  );
  const productionFinanceSql = readFileSync(
    new URL("../supabase/migrations/20260909003000_student_finance_banking_profiles.sql", import.meta.url),
    "utf8"
  );

  assert.match(legacyFinanceSql, /array\['franchise_owner', 'office_staff'\]::public\.membership_role\[\]/);
  assert.match(legacyFinanceSql, /array\['school_manager', 'office_staff'\]::public\.membership_role\[\]/);
  assert.match(legacyFinanceSql, /array\['franchise_owner'\]::public\.membership_role\[\]/);
  assert.match(legacyFinanceSql, /array\['school_manager'\]::public\.membership_role\[\]/);
  assert.doesNotMatch(legacyFinanceSql, /array\[[^\]]*'teacher'/);
  assert.match(productionFinanceSql, /create policy "student_bank_accounts_bank_admin_access"/);
  assert.match(productionFinanceSql, /as restrictive/);
  assert.match(productionFinanceSql, /can_manage_student_bank_accounts_org\(organization_id, school_id\)/);
});

test("Student Profile finance UI uses masked initial data and a separate full-bank details RPC", () => {
  assert.match(studentProfilePage, /<h2>Finance<\/h2>/);
  assert.match(studentProfilePage, /fetchStudentFinance\(supabase, studentId\)/);
  assert.match(studentProfilePage, /fetchStudentBankDetails\(supabase, state\.student\.id\)/);
  assert.match(studentProfilePage, /View bank details/);
  assert.match(studentProfilePage, /href=\{`\/students\/finance\/edit\/\?id=\$\{student\.id\}`\}/);
  assert.match(studentProfilePage, /formatMaskedAccountNumber\(finance\.account_number_last4\)/);
  assert.doesNotMatch(studentProfilePage, /student_bank_accounts|account_number:/);
  assert.match(dataSource, /get_student_finance_mvp/);
  assert.match(dataSource, /get_student_bank_details_mvp/);
});

test("Student finance edit route is static-export compatible and saves through the controlled RPC", () => {
  assert.match(studentFinanceEditPage, /"use client"/);
  assert.match(studentFinanceEditPage, /useSearchParams/);
  assert.match(studentFinanceEditPage, /fetchStudentFinance\(supabase, studentId\)/);
  assert.match(studentFinanceEditPage, /mayEditBankDetails \? fetchStudentBankDetails/);
  assert.match(studentFinanceEditPage, /updateStudentFinance\(supabase/);
  assert.match(studentFinanceEditPage, /canEditBankDetails/);
  assert.doesNotMatch(studentFinanceEditPage, /from\("student_billing_profiles"\)|from\("student_addresses"\)|from\("student_bank_accounts"\)/);
  assert.doesNotMatch(studentFinanceEditPage, /server action|route\.js|api\/students/i);
  assert.match(studentFinanceForm, /inputMode="numeric"/);
  assert.doesNotMatch(studentFinanceForm, /type="number"/);
  assert.match(studentFinanceForm, /maxLength="7"/);
  assert.match(dataSource, /update_student_finance_mvp/);
});

test("legacy owner-review Rico rows stay untouched by profile finance work", () => {
  const productionImportScript = readFileSync(
    new URL("../scripts/legacy-finance-banking-import-production.js", import.meta.url),
    "utf8"
  );

  assert.match(productionImportScript, /OWNER_REVIEW_ROWS = \[15, 26\]/);
  assert.doesNotMatch(migrationSql, /legacy_finance_banking_import_rows[\s\S]*matched_student_id/);
  assert.doesNotMatch(studentFinanceEditPage, /legacy_finance_banking_import_rows|OWNER_REVIEW_ROWS|Rico/);
});
