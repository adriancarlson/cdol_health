# Variable prescribed doses — 26.9.8.2

Branch: `feature/variable-medication-dose` in `cdol_health` and the companion
`cdol_pscb_custom_reports` repository (report plugin 26.10.1.1).

## Install on the test server

1. Keep the existing CDOL CSS dependency installed (26.9.1.1 for the included
   Health Forms document-preview work). This feature adds no stylesheet.
2. Install **CDOL Health 26.9.8.2**, including its schema updates. Confirm
   `variable_dose` Integer exists on `u_student_medication` and
   `u_student_med_inv_txn` before using the new pages or reports.
3. Install **CDOL Health - Data Access 26.9.8.2**.
4. Install **CDOL PSCB Custom Reports 26.10.1.1** after the Health schema.
5. Refresh cached pages/scripts. No record conversion runs during installation.

The Health working tree already contained unrelated, uncommitted Health Forms
document-preview changes before this branch was created. They are preserved and
included in the packaged application; see the preceding Current State entry.

## Nurse workflow

In Add/Edit Inventory, select **Variable dose**, keep the correct dose unit,
and record authorized instructions or a plan reference in **Medication Notes**.
The amount input disappears and the save payload clears the numeric field.
Inventory, Administration, its drawers, chart legends, and the four medication
reports display **Varies · [dose unit]**. The nurse still enters the actual numeric
Quantity Administered. No dose is suggested or automatically calculated.

## Clarify existing placeholder records

1. Have the nurse confirm which medication definition and historical entries
   represent variable dosing. Do not assume every 99 is a placeholder.
2. Edit that medication in Inventory, select Variable dose, retain its unit,
   enter the appropriate Medication Notes, and save. Reload to confirm the flag
   and blank numeric amount persisted. Existing history is intentionally unchanged.
3. For each affected Given entry, open **Correct Administration**, select
   **Variable dose**, and explain the correction, for example: "Numeric amount
   was a placeholder for a variable prescribed dose; clarified against the
   authorized dosing plan." Leave actual quantity, date, time, staff, and notes
   unchanged. Save. The correction has zero inventory change.
4. For each affected Not Given entry, open **Correct Not-Given Entry**, keep
   **Medication Was Not Given** and its existing reason selected, select
   Variable dose, enter the correction explanation, and save.

Each correction affects one event. The original transaction remains stored with
its original dose. The effective row shows Varies, and its audit shows the prior
and corrected descriptions, correction reason, staff, and timestamp. Changing
the medication does not silently relabel prior records. No production records
were changed while developing this feature.

## Acceptance checks

- Existing fixed doses, including legitimate 99 values, still display and save.
- Variable dose supports Units and other controlled units; it leaves frequency
  unchanged. Unchecking Variable requires a valid positive fixed amount.
- Variable definitions with matching name/unit are rejected as duplicates.
- Edit a fixed definition to Variable, save, reload, and inspect the schema/API
  response: `variable_dose = 1`, `dose_amount` is genuinely blank. The client uses
  an empty string for clearing; local transport tests cannot establish server behavior.
- A new administration starts with blank actual quantity, rejects invalid or
  excessive quantities, and creates exactly one deduction of the actual quantity.
- Given and Not Given dose-only corrections show Varies after reload, retain the
  original audit, and leave inventory and effective daily resolution unchanged.
- Correct an already corrected event, then void a Given event in the fictional
  test record. Verify the effective prescribed mode and correct inventory restoration.
- Verify the List, annual Chart/print, Inventory Activity, medication filters,
  Inventory report, Inventory by Student report, Administration report, and
  Missed Daily Administration report. Historical corrections must not fall back
  to the original placeholder in the Administration report.
- Test authorized nurse, denied staff, and cross-school access. Existing route
  permissions are reused; no new access grant or server-side write endpoint is added.
- Check browser Console/Network and actual Oracle execution. Local AngularJS,
  controller, reducer, SQLite expression, XML, and ZIP tests are not installed proof.

## Local checks

Run the Node tests in `docs/tests`, excluding the browser scripts and the stdin
parity helper from the general test invocation. Run `variable_dose_browser.cjs`
with Playwright in `NODE_PATH` and AngularJS 1.4.7 plus angular-mocks in
`HEALTH_ANGULAR_TEST_DIR`. Run the existing missed-count and time-input Python
tests, and the companion report `tests/test_variable_dose.py`.
