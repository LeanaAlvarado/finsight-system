import { recordAuditEvent } from "./supabase.js?v=20260921-permanent-audit-v258";

// UI attempts are labelled separately from successful database changes, which
// are logged transactionally by triggers. Never record input values or URLs
// containing queries/tokens. Read-only actions otherwise leave no DB history.
export function installActivityAudit(page, moduleName) {
  const tableName = `page:${moduleName}`;
  const record = (action, metadata = {}) => recordAuditEvent(action, tableName, null, {
    page, ...metadata
  });
  void record("Module opened");

  document.addEventListener("click", event => {
    const control = event.target?.closest?.("button, a, input[type=button], input[type=submit]");
    if (!control || control.disabled) return;
    const label = (control.getAttribute("aria-label") || control.textContent || control.value || "Control")
      .trim().replace(/\s+/g, " ").slice(0, 120);
    void record(`${control.hasAttribute("download") ? "Download requested" : "Control activated"}: ${label}`, {
      control: control.id || control.getAttribute("name") || control.tagName.toLowerCase(),
      label
    });
  }, true);
  document.addEventListener("submit", event => {
    void record("Form submission attempted", { form: event.target.id || "form" });
  }, true);
  document.addEventListener("change", event => {
    const control = event.target;
    if (!control?.matches?.("input, select, textarea") || control.type === "password") return;
    void record("Field or filter changed", {
      control: control.id || control.name || control.tagName.toLowerCase()
    });
  }, true);
  window.addEventListener("beforeprint", () => { void record("Print dialog requested"); });
}
