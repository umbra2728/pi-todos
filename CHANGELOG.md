# Changelog

## 0.1.2 - 2026-11-13

- Normalize model-generated create calls with server IDs, lifecycle-only fields, and conflicting single/batch fields.
- Allow dependencies on earlier items in the same creation batch while rejecting forward and self references.
- Drop redundant statuses from explicit lifecycle actions.
- Disable constrained sampling to prevent providers from filling every optional field.

## 0.1.1 - 2026-11-13

- Verify Trusted Publishing, provenance, and GitHub Releases.

## 0.1.0 - 2026-11-13

- Initial release.
- Incremental lifecycle actions by task ID without full-list updates.
- Atomic initial batch creation and dependency validation.
- Session-branch operation journal with reload, branch, and compaction recovery.
- Live overlay, read-only `/todos` filters, and balanced settle reminders.
- Strict schema validation and safe normalization of legacy status updates.
