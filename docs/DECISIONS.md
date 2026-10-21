# Decisions Made

## Confirmed workflow decisions

1. The administration experience uses the table-based List view as its default and primary workflow. A supplemental
   read-only annual Chart view is allowed, but it does not replace List administration, correction, or audit controls.
2. Medication name remains free-form.
3. Route uses a controlled dropdown and is not unrestricted free text.
4. Do not use `cc` as a dosage unit.
5. Inventory timing or administration timing does not belong on an inventory lot.
6. An `active_flag` was removed from the simplified inventory design.
7. Keep one medication definition row for a student's medication.
8. A refill creates a new inventory lot linked to the medication.
9. Never overwrite the original lot quantity or its audit information.
10. Deduct inventory FIFO from the oldest lot with remaining quantity.
11. Inventory needs count-in date, counted-by user, notes, totals, and parent-pickup deductions.
12. Missed scheduled doses require a reason.
13. The system needs missed-gap and low-inventory alerts.
14. Daily reminder timing should be configurable.
15. Access is limited to authorized staff.
16. The workflow must support controlled medications.
17. Medication administration should identify who gave the dose and preserve an auditable record.
18. Dose values must support whole numbers and decimals.
19. Frequency must support daily and PRN behavior without treating PRN as a missed daily dose.
20. Routine medication administrations should not use a redundant confirmation modal. Sensitive or high-risk medication double-check behavior remains a later conditional workflow rather than an interruption applied to every administration.
21. Inventory removals use an append-only transaction ledger with one row per real-world event.
22. FIFO lot balances are derived from immutable received lots and the medication-level transaction history; transactions are not split into per-lot allocation rows.
23. Existing inventory lots are read-only after creation.
24. The nurse-facing inventory workflow does not expose reversal. A separate, clearly labeled correction workflow must be designed before corrections are implemented.
25. Added-in-error corrections, parent pickup, disposal, lost/damaged medication, and other removal require notes.
26. Medication editing and inventory removal share one drawer; nested PowerSchool drawers are not used.
27. Nurses do not configure an inventory quantity per dose. During administration they enter the actual quantity used in the inventory unit, while the prescribed dosage is displayed in parentheses as reference.
28. The entered administration quantity supports decimals and becomes the auditable inventory deduction.
29. Low inventory is based on the percentage of inventory remaining in the current replenishment cycle, not all inventory historically received.
30. Adding inventory automatically resets the alert baseline to the total quantity available after the addition; deductions do not reset it.
31. Inventory status levels use fixed system thresholds: Normal above 20%, Low above 10% through 20%, Critical above 0% through 10%, and Out at 0%. Nurses do not configure these levels.
32. Normal inventory has no visible status label, and inventory percentages are not displayed. Warning color, border, and the full label `Low Inventory`, `Critical Inventory`, or `Out of Inventory` appear left-aligned on the single lot row or, when multiple lots exist, only on the Total row; the quantity remains right-aligned. Out of Inventory uses a subtle pale-red treatment.
33. The main inventory page uses `Add Medication` for creating a medication definition and its starting inventory; `Add Inventory` remains the action for adding inventory to an existing medication.
34. A student cannot have duplicate medication definitions with the same normalized medication name, numeric dosage amount, and dose unit. A different dosage amount or dose unit is allowed. The form disables Save and directs the nurse to add inventory to the existing medication.
35. Medication names are trimmed, repeated internal spaces are collapsed, and the first character is capitalized before saving. The remainder of the entered capitalization is preserved; full title case is not used.
36. Remaining/original inventory quantities display spaces around the slash, such as `2.75 / 5 Pills`, to keep decimal quantities readable.
37. A given medication administration is stored as one `ADMINISTRATION` row in `u_student_med_inv_txn`. The row holds administration snapshots and its negative quantity is the inventory deduction, avoiding a two-record partial-save risk.
38. The initial Administration page is student-specific and contains one Administer Medication button followed by one history table with no section heading. Inventory is not displayed on the page; the drawer's medication selector includes only medications whose calculated available inventory is greater than zero.
39. Administration history can contain mixed medications. When more than one medication is present, a medication-and-dosage filter is available above the table.
40. The Administer Medication button remains visible when no inventory is available. Opening it shows guidance to add medication through the student's Medication Inventory page instead of hiding or disabling the action.
41. The Inventory and Administration grids use matching low-emphasis, left-arrow links for navigation between the two student-specific pages. Administration displays `← View Medication Inventory`; Inventory displays `← Administer Medication`. Add Medication and the Administration page's Administer Medication button remain the primary actions, and every cross-page link preserves student context with `?frn=~(studentfrn)`. The no-inventory administration drawer guidance also links directly to that student's inventory.
42. The administration drawer reuses the Inventory page's warning colors as compact pills. Available Inventory represents the current status; Quantity Administered recalculates against the projected remaining inventory as the nurse types and can move through Low Inventory, Critical Inventory, and Last of Inventory before save. Last of Inventory uses the Out styling only for a valid quantity that consumes the remaining balance. Invalid or excessive quantities have no projected pill, Out of Inventory appears in the no-available-medication message, and Normal has no pill.
43. Administration history uses the same pencil and minus visual pattern as Health Logs, but it does not copy Health Log's direct PUT and DELETE behavior. The original administration transaction remains immutable.
44. A pencil correction creates one `ADMINISTRATION_CORRECTION` transaction linked to the original. It stores the complete corrected administration snapshot and an inventory delta equal to old effective quantity minus corrected quantity, allowing a correction to remain one atomic POST.
45. The minus action is labeled Mark Administration as Entered in Error. It requires a reason and a confirmation modal explaining that the effective administered quantity will be restored to inventory. The append-only `ADMINISTRATION_VOID` row captures the correction user and timestamp; the original remains visible and marked, and no further actions are offered for that entry.
46. Successful administration actions use the PowerSchool `feedback-confirm` treatment inside the rounded administration table container and disappear automatically after five seconds so confirmation is visible without becoming persistent page clutter.
47. The Edit Inventory transaction table is titled `Inventory Activity` rather than `Deductions` because append-only corrections may increase inventory. Documentation-only administration corrections with a zero inventory delta remain in administration audit history but are omitted from Inventory Activity. Correction rows use the correction date, correcting user, and reason.
48. Corrected and Entered-in-Error labels in Inventory Activity use the same compact pill treatment as Administration history, with the red warning treatment reserved for Entered in Error.
49. Dose unit, inventory unit, route, frequency, and removal type dropdowns are populated from the shared `u_cdol_health_option` extended table using the categories `MED_DOSE_UNIT`, `MED_INVENTORY_UNIT`, `MED_ROUTE`, `MED_FREQUENCY`, and `MED_REMOVAL_TYPE`.
50. Every user authorized for the Medication Inventory page may use the dropdown's italicized `Other` action to add a value to its associated option category. Selecting it replaces that dropdown with the add-value controls until the value is successfully added or Cancel is clicked. `Other` is not stored as a medication value.
51. New option display values are normalized like medication names: trim the ends, collapse repeated internal whitespace, capitalize the first character, and preserve the remaining capitalization. The same normalized value is stored as both Display Value and Description.
52. A newly generated option Code is the normalized value lowercased with all whitespace removed. Display Value and Description are limited to 100 characters, Code is limited to 40, and overlong codes are rejected rather than truncated to avoid ambiguous collisions.
53. A fresh `u_cdol_health_option` table starts empty. Initial values are entered deliberately through the district CDOL Health Code Sets page rather than being seeded when a nurse opens Medication Inventory.
54. The shared option table now supplies Health Log Complaint, Destination, and Conversation Type. Sport remains connected to PowerSchool's native `Sports` Code Set and `HEALTH_SPORT` is not exposed by the custom manager.
55. Medication removal types use `MED_REMOVAL_TYPE` in the shared option table. The initial import preserves the five former hard-coded transaction codes so existing audit records and reports remain compatible and adds `WRONG_NUMBER_ENTERED` as an inventory-entry correction. System-owned administration/correction transaction types remain application-controlled. Treatment remains free text unless a later requirement explicitly converts it to a controlled dropdown.
56. Authorized Health Log users receive GET and POST access to the shared option table so they can use the in-context add-new action. PowerSchool schema permission mappings authorize a table route, not individual `codetype` rows; this limitation is accepted and must remain documented and included in authorization testing.
57. The CDOL Health Code Sets page is cataloged under `navDistrictManagementHealth` with `districtLevelContext = 2`, a main navigation context, and a sort order immediately after the native Health Code Sets page. Its page content also refuses management outside District Office context.
58. Health option codes are generated from the normalized display value and become immutable after creation. Administrators may change display text and Active status. Display order is assigned automatically and changed with Move up and Move down controls or the Sort Alphabetically action on the main grid. Alphabetical sorting applies to every custom health code set and preserves the Active/Inactive boundary. Inactive status is used instead of deletion so historical medication and Health Log records retain a resolvable code.
59. PowerSchool automatically supplies the option table's record ID and standard created/modified user and timestamp fields. The extension XML and application payloads must not redeclare or submit those fields.
60. The district Health Code Sets grid hides Inactive values by default. A Show Inactive checkbox displays the inactive count and, when selected, appends Inactive values after all Active values. Move controls do not allow a row to cross the Active/Inactive boundary.
61. The shared option table does not store `ismodifiable` or `isdeletable`. The application always permits editing through its authorized manager and preserves history by marking values Inactive instead of deleting them. Only `isvisible` and `uidisplayorder` are needed for those behaviors.
62. New Health Log records store controlled option codes for Complaint, Destination, and Conversation Type. Arbitrary raw text cannot be saved for those fields; visit-specific detail belongs in Notes.
63. The district Add Health Code drawer and every in-context Health Log or Medication option-add control warn when a proposed value reduces to the same meaningful words as an existing value in that code set after ignoring capitalization, punctuation, common filler words, and common destination-action words such as `back`, `return`, `go`, and `sent`. Similarity is advisory so a genuinely distinct value may still be saved; exact duplicates remain blocked or select the existing option according to the workflow.
64. Existing Health Log values are matched by code or case-insensitive display value. Active matches show the dropdown but preserve the original stored value until the nurse deliberately changes it. Inactive and unmatched values are displayed read-only and remain unchanged when unrelated fields are saved.
65. Read-only historical values cannot be added to or replaced from the historical record. History resolves known values to current labels and falls back to the original stored text.
66. Health Log `Other` is an italicized add-new action for authorized users, not a stored option. Save stays disabled while an add-new input is open, while its POST is pending, and after failure until the action succeeds or is canceled.
67. The approved general import CSV includes the expanded complaint defaults and Recess. Conversation Type defaults are Email, Phone, and In Person; `Multiple Methods` is not a stored catch-all option. A separate removal-type import template preserves the former hard-coded values, including the existing `OTHER_REMOVAL` audit code. The italicized `Other` add-new action itself is never stored.
68. Conversation Logs use visible Communication Methods checkboxes rather than a browser multi-select. At least one Active method is required; selected codes are stored comma-separated in the existing `conversation_type` field and displayed as comma-and-space-separated labels.
69. Historical `conversation_type` values first receive an exact single-option match. A value is interpreted as a comma-separated method list only when every segment resolves to a known option; otherwise the complete original value remains read-only.
70. Commas are reserved as the saved Communication Methods delimiter. Newly generated `HEALTH_CONVERSATION` codes remove commas while retaining the normalized display text, and the district manager rejects a conversation-method code containing a comma.
71. `Added in Error` and `Wrong Number Entered` removals correct the effective quantity received rather than behaving like ordinary consumption. They remain append-only transactions, are allocated FIFO, never overwrite or delete the original lot, and cap the low-inventory replenishment baseline at the corrected effective quantity.
72. The Inventory page uses the effective received quantity as the denominator and hides only lots fully eliminated by an inventory-entry correction. Ordinarily depleted lots remain visible, and a medication whose lots are all corrected away remains visible as Out of Inventory.
73. Inventory-entry correction matching normalizes transaction codes so `ADDED_IN_ERROR`, `WRONG_NUMBER_ENTERED`, and the previously generated `wrongnumberentered` code remain compatible without migrating stored transactions.
74. Daily expected administrations are calculated from PowerSchool's school calendar and student enrollment rather
than pre-created as database rows. Only the controlled `daily` frequency code participates; weekends and days where
the school's calendar is not in session are excluded.
75. Gap calculation begins on the day after the medication's first inventory-added date. The current day does not
become Action Required until the medication school's configured cutoff time.
76. The cutoff is stored per school in `u_cdol_med_admin_setting`. Without an effective cutoff row, the Administration
page warns the user and does not create speculative gaps for that school.
77. An unresolved gap is a red calculated Action Required row. Resolving it as Given creates the normal inventory-
deducting `ADMINISTRATION` transaction on the expected date. Resolving it as Not Given creates a zero-quantity
`NON_ADMINISTRATION` transaction.
78. Not Given reasons use `MED_NOT_GIVEN_REASON`. The approved initial import values are `Ill`, `Refused`, and `Absent`.
The italicized `Other` item remains the standard add-new action and is never stored as a reason.
79. Each Not Given transaction stores the stable reason code and the then-current reason label. This supports grouping
future reports by identity while preserving historical wording after a district label change.
80. Not Given corrections and conversions are append-only. A reason correction uses
`NON_ADMINISTRATION_CORRECTION`; a later Given row links to the original Not Given transaction. Effective reports omit
converted Not Given events but retain the original and linked audit rows.

81. The header missed-medication count counts distinct students, not doses or
days. It is school-level only and does not appear at District Office. The icon
links to `/admin/reports_pscb_dev_pro/health/cdol_missed_daily_administration.html`. It uses
the existing CDOL header count format and shared CDOL CSS badge styles.
82. The header count runs once on page load, like Enrollment Express. There is
no background polling or focus/visibility refresh. A new page load or manual
browser refresh recalculates the count using the school cutoff at that time.
83. The student missed-medication alert uses a separate `title_student_end_css`
extension in Health Log, following CDOL Custom Alerts without editing that plugin.
Render one icon only when this student has an unresolved daily gap; click opens
the full Administration page with `studentfrn`. It does not use `dialogM`.
84. As of 26.8.7.18, the student icon returns to the blue outline and red plus,
with a solid blue cap, using `#05729d` and `#c22026` from Custom Alerts'
`icon-meds.svg`. Its display size increases from 15 by 20 to 21 by 28 pixels,
preserving proportions. This supersedes the 26.8.7.17 red-body variant.
The original outlined-cap variant from 26.8.7.16 remains as
`icon-missed-medication-outline.svg` for backup.
The white school-header icon and its badge are unchanged.
In 26.8.7.21, a borderless orange warning triangle with a white exclamation
overlaps the student bottle's lower-right edge. A square 28-by-28 canvas adds
space on the right without shrinking the existing 21-by-28 bottle artwork.
In 26.8.7.22 the badge increases 10%, shifts left, and gains a transparent
knockout gap separating it from the bottle, including on nonwhite backgrounds.
In 26.8.7.23 it grows another 10% (21% total), preserving its bottom-center anchor
and matching knockout gap. Bottle and composite display dimensions stay unchanged.
85. In a `tlist_sql` row body, `~()` placeholders consume selected columns by
position, regardless of their labels. The student alert returns the full
`001`-prefixed student DCID as its only selected column. The aggregate count
remains only in the HAVING condition so it cannot become the link's FRN.

86. Attendance-based automatic Not Given: Absent processing is a planned workflow. On September 3, 2026, the user
approved next-morning processing after the overnight attendance refresh, independent of the school's Daily Medication
Cutoff Time. The cutoff continues to control existing Action Required alerts; it does not schedule automatic absence
submission. The school Medication Administration Settings page must explain both timings clearly when the feature
is implemented. No exact morning clock time or execution host has been selected, and this decision does not enable
automatic writes.
87. The annual Medication Administration Chart places its medication filter above the record title and all legends below
the calendar. Medication keys use the uppercase first three letters of the medication name, and staff initials use italic
signature-style text in both administration cells and the staff legend.
88. The chart's compact record header uses one left-aligned line at 16 pixels on screen and 8 points in print, with the same small top gap in both views, for student name, grade, translated gender,
Medication / Dosage, and its immediately adjacent comma-separated list. Entries begin with bold three-letter medication
codes and colons. The month column must fit full month names, weekend `W` and no-school `NS` markers are centered and enlarged, and the `NS`
legend wording is `No School`.
89. Staff initials remain first-and-last initials unless the chart contains a collision. For a collision, available middle
initials are added and middle names appear in the legend. The matching staff member with the most effective Given entries uses
the primary font; staff with fewer entries use Lucida Handwriting, with ties resolved by staff name.
Stable numeric suffixes remain the fallback when middle initials do not resolve a collision. The existing administration
response supplies the middle name so this does not add a page-load request.

## Variable prescribed doses
Variable prescribed doses (October 21, 2026): add `variable_dose` Integer to medication definitions and transaction
snapshots. Use 1 for variable, explicit 0 for new fixed snapshots, and interpret legacy null as fixed. Keep numeric
`dose_amount` blank for variable doses, retain `dose_unit`, and display `Varies · [unit]`. Use existing Medication Notes
for authorized instructions; no separate instructions field in this release. Do not change frequency or calculate an
actual dose. Nurses enter the actual quantity. Clarify historical placeholder values through individual, reason-required
append-only corrections; never interpret 99 globally or rewrite original transactions. Full bulk amendment remains a
possible later enhancement.

## Superseded or rejected approaches

- Do not create a new medication row for every refill.
- Do not store only one mutable inventory quantity that loses refill history.
- Do not use the annual Chart as the primary daily administration interface; the List remains the default workflow.
- Do not allow arbitrary route text.
- Do not use `cc`.
- Do not place timing or an active flag on each inventory lot merely to represent medication scheduling.
- Do not create per-lot transaction allocations or event grouping keys for a single inventory event.
- Do not present medication physically returning to school as a reversal of the earlier removal.
- Do not depend on `/ws/district/codeset` for medication options because the internal custom page cannot be granted that core-resource permission through plugin permission mappings.
- Do not persist `Other` as a medication option or silently truncate an overlong generated option Code.
