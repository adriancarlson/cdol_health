# Open Work and Questions

## Highest-priority implementation work

- Install both CDOL Health 26.9.8.2 packages, then CDOL PSCB Custom Reports
  26.10.1.3 on the test server. Follow `VARIABLE_DOSE.md`, particularly numeric
  field clearing on PUT, original versus effective prescribed snapshots,
  zero-inventory Given/Not Given corrections, report Oracle execution, and
  authorized/denied/cross-school access. No automatic 99 conversion is included.

- Validate the renamed CDOL Health and CDOL Health - Data Access 26.9.7.62
  packages in PowerSchool, including how the existing installations recognize
  the changed plugin names.
- Install CDOL CSS 26.9.0.3, then both CDOL Health 26.9.7.62 packages. Validate
  Health History, Medical Authorization, medication pages and drawers, Health
  Logs, and district Health Code Sets at desktop and narrow widths. Confirm
  chart printing stays landscape, Quick Sheet printing retains its existing
  layout, and other plugins retain their styling.

- Install Health Log 26.9.7.41 and validate the Diabetes, Seizure, and shared
  Asthma/Severe Allergy document pickers (including the Allergy/Asthma category union) from
  Health History: authorized versus denied staff, selected-student isolation,
  PDF/image preview and close, multiple files, missing category/files, and the
  native Attachments fallback. Production native metadata was inspected read-only;
  Health History endpoint authorization and document-content behavior remain
  live validation steps. See `HEALTH_ACTION_PLAN_ATTACHMENTS.md`.

- Install both Health Log 26.9.7.13 packages and validate Medical Authorization JSON
  loading and schema API saves with checked, unchecked, blank, and absent-extension
  records. Verify failed requests do not enable saving or falsely report success;
  test denied, view-only, and cross-school access. Investigate why approved/responded
  Basic First Aid values can differ from the mapped student field: the current form
  mapping is correct, so inspect historical response/approval processing before
  changing mappings or repairing any student data. See `HEALTH_FORMS_MIGRATION.md`.

1. Package, install, and test the initial student Medication Administration page and the new `ADMINISTRATION` transaction fields.
2. Confirm administration saves create exactly one deduction, update FIFO balances, refresh the available-medication list, and appear once in administration history.
3. Confirm the supported PowerSchool server-side mechanism for preventing simultaneous deductions from exceeding available inventory.
4. Install and test district Health Code Set creation plus in-context medication-option and removal-type creation with both administrator and non-administrator users who are authorized for Medication Inventory.
5. Import and test the approved Health Log defaults, controlled dropdowns, Communication Methods checkbox combinations and comma-separated storage, historical-value fallbacks, and in-context additions.
6. Install and validate daily gap calculation against real `Calendar_Day` records, transfers, weekends, non-session
   days, first-inventory boundaries, the current-day cutoff, and District Office student context.
7. Validate Not Given creation, reason correction, conversion to Given, effective reporting, and inventory effects.
8. Decide whether non-daily schedules need structured scheduling beyond the current Daily-versus-PRN behavior.
9. Complete authorization testing with nurse, ordinary staff, district, and cross-school accounts.
10. Add controlled-medication reconciliation and returned-to-school workflows after nurse review.
11. Add automated tests and PowerSchool plugin installation validation.
12. Install and validate the append-only Corrected and Entered-in-Error administration workflows, including inventory deltas, audit metadata, repeated corrections, and action locking after void.
13. Install and validate inventory-entry corrections with both `ADDED_IN_ERROR` and the existing/new Wrong Number Entered code forms, including partial corrections, fully hidden corrected lots, adjusted denominators, and preserved Inventory Activity history.
14. Install Health Log 26.8.7.24 and CDOL CSS 26.8.0.4 and validate the school-level
    header counter using `MISSED_MEDICATION_HEADER.md`, including live Oracle
    execution/performance, permission-denied direct requests, cutoff changes,
    classic/PDS navigation, and no District Office icon.
15. Validate the student missed-medication alert using
    `MISSED_MEDICATION_STUDENT_ALERT.md`: selected-student isolation, one icon,
    full-page FRN navigation, cutoff boundaries, permission-denied behavior,
    classic/PDS placement, and query latency. Local tests do not run PowerSchool
    template expansion or native Oracle.

16. After installing 26.8.7.24, open Resolve Missed Administration, select Medication
    Was Given, and compare Time Given with the Administer Medication Time field.
    Verify clock spacing, compact width, keyboard editing, and Given/Not Given
    toggling. A browser-only preview passed; installed-package acceptance remains.

17. Install Health Log 26.9.3 and validate the Medication Administration Chart tab against live PowerSchool annual
    term and `Calendar_Day` data. Confirm List remains the default, medication and staff keys are stable, corrected and
    Entered-in-Error behavior matches the effective-record rules, PRN medications do not create missed entries, and the
    built-in print action produces one readable US Letter landscape page without navigation or controls. Test authorized
    and denied users and confirm the new read-only endpoint cannot escape the selected student, school, or year context.

## Attendance-based automatic absence processing (planned)

Confirmed: run next morning after the overnight attendance refresh, independently of Daily Medication Cutoff Time.
Keep the existing alert cutoff behavior and clearly explain the separate timings on the school settings page.

Before implementation or automatic writes:

1. Select the scheduled execution host and authenticated service identity. This repository currently contains
   PowerSchool pages, data endpoints, schema, and permissions, but no scheduled background worker. A browser page-load
   action is not equivalent to an unattended next-morning run.
2. Validate a read-only preview against daily and meeting attendance examples on the test server. Confirm actual mode
   codes, conversion values, student ID/DCID joins, row uniqueness, partial-day/FTE behavior, and the units of
   `POTENTIAL_ATTENDANCEVALUE` before finalizing a percentage formula. Do not treat missing or conflicting rows as absent.
3. Identify a reliable refresh-success check and choose the morning execution time/time zone. Merely running at a later
   clock time does not prove attendance is fresh. Skip automatic submissions when freshness cannot be established.
4. Confirm the meeting-school threshold definition, default, and inclusive boundary, plus school opt-in behavior.
   No threshold percentage has been approved yet.
5. Decide whether automatic processing requires a configured alert cutoff despite ignoring its time. The current
   expected-row query suppresses all gaps without a cutoff; do not accidentally inherit or remove that requirement.
6. Define missed-run catch-up, initial historical backfill, and later attendance-change review. Preserve all historical
   medication records and leave already-resolved occurrences unchanged.
7. Implement duplicate/race protection, automation audit identity and attendance evidence, effective-resolution checks,
   and zero-inventory-change Not Given submissions. Verify behavior when a nurse resolves a dose during a run.
8. Implement the school settings controls with the explanation in `REQUIREMENTS.md` alongside them. Test that changing
   the alert cutoff does not change automatic execution timing, and do not imply the worker is enabled before deployment.

## Deployment cleanup

- After refreshing the test server, install both generated plugins and validate the expanded `u_student_med_inv_txn` correction fields with the old `cdol_health_log_pqs` plugin disabled.
- The permission mappings expose the full schema API action set consistently for the medication tables and `u_cdol_health_option`. Confirm during testing that application code still treats historical inventory lots and transaction rows as read-only and never issues PUT or DELETE requests for them.
- Populate and approve the initial medication values from the district CDOL Health Code Sets page before Medication Inventory is released to nurses. Import `docs/u_cdol_health_option_removal_type_defaults.csv` before testing Remove Inventory, and confirm each existing transaction code still displays its expected label. Import `docs/u_cdol_health_option_not_given_reason_defaults.csv` before testing missed administrations; first check whether `ill`, `refused`, or `absent` already exists so the import does not create duplicates. Before importing the updated removal template into an existing environment, check for the previously generated `wrongnumberentered` option and do not create a duplicate Wrong Number Entered row; both code forms already receive the same correction behavior. Confirm an empty table remains empty when Medication Inventory is opened.
- The UI suppresses duplicate values, but the PowerSchool extension table does not currently enforce a database uniqueness constraint; simultaneous identical additions remain a concurrency risk to test.
- Health Log permission mappings grant GET and POST to the full shared `u_cdol_health_option` route; PowerSchool cannot restrict that POST permission by `codetype`. Verify the intended nurse role can add options and that unauthorized users cannot access the Health Log page.
- After health-log reads, staff dropdowns, and schema API writes pass that validation, uninstall and archive the separately maintained `cdol_health_log_pqs` repository and plugin.

## Open design questions

These should be resolved explicitly before Codex hard-codes behavior:

- The current student alert markup has a user-added `dialogM` class, which is
  preserved by the 26.8.7.20 FRN fix. This conflicts with the earlier full-page
  navigation requirement and its existing test. Confirm whether to retain dialog
  behavior or remove the class; do not silently undo the user's markup change.

- Who owns ongoing review, deactivation, and cleanup of values added to the shared Health option table?
- Should a future report include unresolved calculated gaps, stored effective Not Given events, or separate views for both?
- How should medication discontinuation be represented so a daily definition no longer creates future expected rows?
- Which PowerSchool security groups or roles have access?
- Confirm whether view-only Medication Administration users should also receive
  the header counter and student alert. The initial implementation conservatively requires the
  existing page's modify permission; it does not create a new role grant.
- Confirm the student alert's District Office visibility during acceptance.
  Implementation follows the existing student Administration page: the selected
  student's medication schools are included in District Office context. The
  previously approved school-only restriction remains on the main header count.
- How are controlled-medication counts reconciled?
- Does each administration need a second-person verification option?
- Should medication returned after parent pickup create a newly counted lot? Current recommendation: yes.
- Should medication definitions have start/end dates or a status outside the inventory table?
- What reports and exports are required?
- What exact plugin paths and PowerSchool APIs are already used by the current code?
