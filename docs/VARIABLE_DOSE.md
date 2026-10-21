# Variable prescribed doses — 26.9.8.4

Select **Variable dose** only in Add/Edit Inventory. The numeric prescribed amount
is cleared on save and the dose unit is retained. Medication Notes can contain the
authorized dosing instructions or plan reference. Actual Quantity Administered is
entered independently for every administration.

The Administration table shows **Varies** for variable prescribed-dose snapshots.
Administration and Not Given correction drawers have no variable-dose checkbox or
prescribed-dose editor. Ordinary corrections preserve the event's prescribed-dose
snapshot. Editing Inventory affects new entries and unresolved expected rows;
it does not relabel stored historical entries. Historical record repair is handled
individually by the user outside this UI change. No automatic migration runs.

## Install on the test server

1. Keep **CDOL CSS 26.9.1.3** installed for the smaller, italic gray Inventory option.
2. Install **CDOL Health 26.9.8.4**, then **CDOL Health - Data Access 26.9.8.4**.
3. Retain **CDOL PSCB Custom Reports 26.10.1.3**. Its package is unchanged.
4. Refresh cached pages and scripts.

The Health package preserves the pre-existing Health Forms document-preview changes.
No production records were changed during development.

## Acceptance checks

- Enable Variable dose in Inventory, save, and reload. Confirm the numeric field
  is genuinely blank, the flag is 1, and the unit remains selected.
- Record a new administration. Verify Prescribed Dosage shows Varies and actual
  administered quantity drives exactly one inventory deduction.
- Confirm neither correction drawer offers Variable dose or Corrected Prescribed
  Dosage. Correct ordinary event details and confirm the prescribed snapshot stays unchanged.
- Confirm old fixed snapshots remain fixed after editing the medication definition.
- Check fixed-dose validation, duplicate definitions, expected rows, annual Chart,
  reports, and authorized/denied access on the test server.

Local controller and AngularJS 1.4.7 browser checks pass. Installed schema API
clearing, Oracle execution, and PowerSchool authorization still need live testing.
