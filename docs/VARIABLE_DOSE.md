# Variable prescribed doses — 26.9.8.5

Select **Variable dose** only in Add/Edit Inventory. The numeric prescribed amount
is cleared on save and the dose unit is retained. Medication Notes can contain the
authorized dosing instructions or plan reference. Actual Quantity Administered is
entered independently for every administration.

The current Inventory Variable dose flag overrides the prescribed-dose display
for every linked past Given, corrected, and Not Given entry. The Administration
column and its drawers display **Varies**. Original stored prescribed snapshots
remain intact; actual administered quantities and inventory calculations do not change.
Administration correction drawers do not edit dose mode or prescribed amounts.
Unchecking Variable dose removes the current-setting display override; an event
that was originally recorded as variable still displays Varies from its snapshot.

## Install on the test server

1. Keep **CDOL CSS 26.9.1.3** installed for the smaller, italic gray Inventory option.
2. Install **CDOL Health 26.9.8.5**, then **CDOL Health - Data Access 26.9.8.5**.
3. Install **CDOL PSCB Custom Reports 26.10.1.4** for the matching historical display override.
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
- Confirm historical entries display Varies after enabling Variable dose, while their stored numeric snapshots remain unchanged.
- Check fixed-dose validation, duplicate definitions, expected rows, annual Chart,
  reports, and authorized/denied access on the test server.

Local controller and AngularJS 1.4.7 browser checks pass. Installed schema API
clearing, Oracle execution, and PowerSchool authorization still need live testing.
