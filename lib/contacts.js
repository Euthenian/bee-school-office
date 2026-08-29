export const contactLabels = ["Student", "Mother", "Father", "Guardian", "Home", "Mobile", "Work", "Other"];

export function createInitialContactRows() {
  return {
    emails: [createContactRow("email", true)],
    phones: [createContactRow("phone", true)]
  };
}

export function createContactRowsFromStudentContacts(contacts = []) {
  const grouped = groupStudentContacts(contacts);

  return {
    emails: createEditorRows(grouped.emails, "email"),
    phones: createEditorRows(grouped.phones, "phone")
  };
}

export function addContactRow(rows, type) {
  const key = getContactKey(type);
  return {
    ...rows,
    [key]: [...rows[key], createContactRow(type, false, "Other")]
  };
}

export function updateContactRow(rows, type, rowId, field, value) {
  const key = getContactKey(type);

  return {
    ...rows,
    [key]: rows[key].map((row) => (row.id === rowId ? { ...row, [field]: value } : row))
  };
}

export function markPrimaryContact(rows, type, rowId) {
  const key = getContactKey(type);

  return {
    ...rows,
    [key]: rows[key].map((row) => ({ ...row, is_primary: row.id === rowId }))
  };
}

export function removeContactRow(rows, type, rowId) {
  const key = getContactKey(type);
  const remaining = rows[key].filter((row) => row.id !== rowId);

  if (!remaining.length) {
    return rows;
  }

  return {
    ...rows,
    [key]: ensureOnePrimary(remaining)
  };
}

export function serializeContactRows(rows) {
  return [
    ...serializeType(rows.emails || [], "email"),
    ...serializeType(rows.phones || [], "phone")
  ];
}

export function groupStudentContacts(contacts = []) {
  return {
    emails: sortContacts(contacts.filter((contact) => contact.contact_type === "email")),
    phones: sortContacts(contacts.filter((contact) => contact.contact_type === "phone"))
  };
}

function createContactRow(type, isPrimary, label = "Student") {
  return {
    id: createLocalId(),
    contact_type: type,
    label,
    value: "",
    is_primary: isPrimary
  };
}

function getContactKey(type) {
  return type === "email" ? "emails" : "phones";
}

function ensureOnePrimary(rows) {
  if (rows.some((row) => row.is_primary)) {
    return rows;
  }

  return rows.map((row, index) => ({ ...row, is_primary: index === 0 }));
}

function createEditorRows(contacts, type) {
  if (!contacts.length) {
    return [createContactRow(type, true)];
  }

  return ensureOnePrimary(
    contacts.map((contact) => ({
      id: contact.id || createLocalId(),
      contact_type: type,
      label: contact.label || "Other",
      value: contact.value || "",
      is_primary: Boolean(contact.is_primary)
    }))
  );
}

function serializeType(rows, type) {
  const filledRows = rows
    .map((row) => ({
      contact_type: type,
      value: row.value.trim(),
      label: row.label || "Other",
      is_primary: row.is_primary
    }))
    .filter((row) => row.value);

  const primaryIndex = filledRows.findIndex((row) => row.is_primary);
  const normalizedPrimaryIndex = primaryIndex >= 0 ? primaryIndex : 0;

  return filledRows.map((row, index) => ({
    ...row,
    is_primary: index === normalizedPrimaryIndex
  }));
}

function sortContacts(contacts) {
  return [...contacts].sort((a, b) => {
    if (a.is_primary !== b.is_primary) {
      return a.is_primary ? -1 : 1;
    }

    return `${a.label || ""}${a.value || ""}`.localeCompare(`${b.label || ""}${b.value || ""}`);
  });
}

function createLocalId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
