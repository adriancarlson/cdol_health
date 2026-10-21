# Data Model

## Repository schema

The repository XML defines four medication-related tables plus one shared Health option table. Installation in PowerSchool must be validated after packaging.

### `u_student_medication`

PowerSchool child extension of `students`.

| Field | Type | Purpose |
|---|---|---|
| `medication_name` | String(250) | Free-form medication name |
| `dose_amount` | Double | Fixed prescribed dose amount; blank when variable |
| `variable_dose` | Integer | 1 for variable prescribed dose; 0 or legacy null for fixed dose |
| `dose_unit` | String(250) | Dose unit |
| `inventory_unit` | String(250) | Unit used to count inventory |
| `inventory_baseline_quantity` | Double | Total available quantity immediately after inventory was most recently added |
| `frequency` | String(250) | Daily, PRN, or other instruction |
| `route` | String(250) | Controlled route value |
| `created_date` | Date | Date medication definition was added |
| `users_dcid` | Integer | User associated with creation or maintenance |
| `notes` | String(4000) | Medication notes |
| `schoolid` | Integer | School context captured when the definition was created |
| `yearid` | Integer | School-year context captured when the definition was created |

PowerSchool supplies the child-table relationship to the student. Prior discussion indicated `studentdcid` is handled automatically for this child table.

The application resolves `dose_unit`, `inventory_unit`, `route`, and `frequency` against active records in `u_cdol_health_option`. The existing medication fields remain strings and all four store the selected option's stable code.

### `u_cdol_health_option`

PowerSchool standalone table for shared, categorized choices used by CDOL Health workflows. Its field names intentionally resemble the useful subset of PowerSchool Code Set fields without depending on the restricted `/ws/district/codeset` core resource.

| Field | Type | Purpose |
|---|---|---|
| `codetype` | String(20) | Category key, such as `MED_DOSE_UNIT` or `HEALTH_COMPLAINT` |
| `code` | String(40) | Stable lowercase, whitespace-free value identity |
| `displayvalue` | String(100) | Nurse-facing dropdown label |
| `description` | String(1000) | Description; currently matches the display value for user additions |
| `isvisible` | Integer | `1` when the option appears in the dropdown |
| `uidisplayorder` | Integer | Sort order within one category |

PowerSchool supplies the record ID plus its standard created/modified user and timestamp columns automatically. Those audit fields are not declared in the extension XML and are not included in application POST or PUT payloads.

Medication uses `MED_DOSE_UNIT`, `MED_INVENTORY_UNIT`, `MED_ROUTE`, `MED_FREQUENCY`, `MED_REMOVAL_TYPE`, and `MED_NOT_GIVEN_REASON`. Health Logs use `HEALTH_COMPLAINT`, `HEALTH_DESTINATION`, and `HEALTH_CONVERSATION`. Sport remains connected to PowerSchool's native `Sports` Code Set; there is no custom `HEALTH_SPORT` category. The table begins empty; no initial option rows are created during installation or page loading. District administrators can import the approved CSV defaults and maintain the categories through the district CDOL Health Code Sets page. The workflow marks values Inactive instead of deleting them, so separate modifiable and deletable flags are not stored. The client suppresses duplicate code or display values within a category. New rows receive display order automatically; administrators reorder rows with Move up and Move down controls or alphabetize the selected code set while preserving separate Active and Inactive groups.

Medication option fields and new Health Log complaint and destination fields store one stable option `code`. New Health Log communication methods store one or more stable codes in the existing `conversation_type` field, separated by commas, such as `email,phone`. Display pages resolve known codes to the current `displayvalue`, allowing an administrator to improve a label later without changing saved identities.

The district code-set manager computes each option's usage count at request time; the count is not stored in `u_cdol_health_option`. It includes references in medication definitions, medication transaction snapshots and removal types, and Health Log complaint, destination, and communication fields. Matching includes the stable code and legacy case-insensitive display values.

Existing Health Log rows are not migrated. When an existing stored value matches Active options by code or case-insensitive display value, the edit drawer shows the controlled dropdown or checkboxes but preserves the original stored value unless the user deliberately changes it. For `conversation_type`, the application attempts an exact single-option match before splitting on commas and accepts a multi-value interpretation only when every segment resolves. This prevents historical narrative text containing commas from being partially converted. Inactive matches and unmatched historical values are shown read-only and are preserved when unrelated fields are saved. List pages resolve known values and otherwise display the original text. Medication removal rows likewise store the selected `MED_REMOVAL_TYPE` code and resolve its current display label, while system-owned administration and correction transaction codes remain application-controlled.

### `u_student_medication_inventory`

PowerSchool standalone table.

| Field | Type | Purpose |
|---|---|---|
| `u_student_medication_id` | Integer | Link to medication definition |
| `quantity_added` | Double | Original quantity received |
| `added_date` | Date | Date received or added |
| `users_dcid` | Integer | User who added or counted the lot |
| `notes` | String(4000) | Lot or count-in notes |

The inventory unit is stored on the medication definition and is shared by its lots. Lots are immutable records of medication received. The application derives each lot's remaining quantity by applying transaction quantities to its lots in FIFO order.

`Added in Error` and `Wrong Number Entered` removal transactions reduce the effective quantity received before ordinary deductions are applied. The stored `quantity_added` value remains unchanged for audit purposes. The main Inventory display uses the effective quantity as its denominator and hides only lots whose effective quantity is reduced to zero by an entry correction. The low-inventory calculation also caps the replenishment baseline at the effective received quantity. The original lot and correction remain available through Edit Inventory and Inventory Activity. Transaction codes are normalized for this classification so the standard `ADDED_IN_ERROR` and `WRONG_NUMBER_ENTERED` codes and the previously generated `wrongnumberentered` code behave consistently.

The inventory-alert baseline is reset automatically to the total available inventory after one or more new inventory rows are saved. It is not reset by a deduction and is not entered by the nurse. The percentage remaining is calculated rather than stored. It compares current inventory quantity against the replenishment baseline. Normal is above 20%, Low is above 10% through 20%, Critical is above zero through 10%, and Out is zero.

### `u_student_med_inv_txn`

Append-only standalone inventory transaction table. Each real-world removal creates exactly one row.

| Field | Type | Purpose |
|---|---|---|
| `u_student_medication_id` | Integer | Medication affected by the event |
| `transaction_type` | String(50) | Stable `MED_REMOVAL_TYPE` code for removals, or an application-controlled administration/correction type |
| `quantity_change` | Double | Signed change applied to the medication's total inventory |
| `event_date` | Date | Date the event occurred |
| `event_time` | Integer | Administration time in PowerSchool seconds-from-midnight format; blank for removal-only events |
| `users_dcid` | Integer | Staff member who processed the event |
| `notes` | String(4000) | Required audit explanation |
| `medication_name` | String(250) | Medication-name snapshot for an administration |
| `dose_amount` | Double | Prescribed-dose snapshot for an administration |
| `variable_dose` | Integer | Prescribed-dose mode snapshot; explicit 1 or 0 on new transactions |
| `dose_unit` | String(250) | Prescribed-dose-unit snapshot for an administration |
| `inventory_unit` | String(250) | Inventory-unit snapshot for an administration |
| `route` | String(250) | Route snapshot for an administration |
| `frequency` | String(250) | Frequency snapshot for an administration |
| `reversal_of_transaction_id` | Integer | Links an administration correction or entered-in-error transaction to the immutable original administration |
| `administration_quantity` | Double | Full administered quantity snapshot; correction rows use this while `quantity_change` stores only the inventory delta |
| `correction_date` | Date | Date a correction or entered-in-error action was recorded |
| `correction_time` | Integer | Time the correction was recorded in PowerSchool seconds-from-midnight format |
| `correction_users_dcid` | Integer | User who recorded the correction |
| `correction_reason` | String(4000) | Required explanation for the correction |
| `not_given_reason_code` | String(40) | Stable `MED_NOT_GIVEN_REASON` code stored for a Not Given event |
| `not_given_reason_label` | String(100) | Reason-label snapshot retained for historical reporting |
| `recorded_date` | Date | Date the administration or Not Given documentation was entered |
| `recorded_time` | Integer | Time the documentation was entered in seconds from midnight |

Removal rows use the common transaction fields. `ADDED_IN_ERROR` and `WRONG_NUMBER_ENTERED` are inventory-entry correction types; all other configurable removal types are ordinary deductions. A given dose uses `transaction_type = ADMINISTRATION`, stores the administration details in the snapshot fields, and records the administered inventory quantity as a negative `quantity_change`. One row therefore serves as both the administration audit record and the inventory deduction, avoiding a partial two-record save.

Administration corrections remain append-only:

- `ADMINISTRATION_CORRECTION` references the original administration with `reversal_of_transaction_id`, stores the corrected administration snapshot, and applies only the inventory difference in `quantity_change`.
- `ADMINISTRATION_VOID` references the original administration, restores the current effective administered quantity with a positive `quantity_change`, and marks the original history entry Entered in Error.
- The original `ADMINISTRATION` row is never updated or deleted.
- Multiple corrections reference the original row and are applied in transaction-ID order. History presents the latest effective values once while preserving every underlying transaction.
- `NON_ADMINISTRATION` records a resolved Not Given event with zero inventory change, the expected school date, the
  school cutoff time, the documenting user, and both reason identity fields.
- `NON_ADMINISTRATION_CORRECTION` references the original Not Given row, stores its corrected reason snapshot and
  notes, and leaves inventory unchanged.
- An `ADMINISTRATION` row may reference a `NON_ADMINISTRATION` row when a previously documented Not Given event is
  converted to Given. Effective Not Given reporting excludes the converted event while the original audit row remains.

### `u_cdol_med_admin_setting`

PowerSchool standalone table. The effective row for a school is the highest record ID for that school.

| Field | Type | Purpose |
|---|---|---|
| `schoolid` | Integer | School whose daily medication cutoff is being configured |
| `daily_cutoff_time` | Integer | Seconds from midnight after which today's unresolved daily doses require action |

### Calculated expected administrations

Expected daily rows are derived at request time rather than persisted. The query joins the medication's school and
year to `Terms`, `Calendar_Day`, and the student's current or historical enrollment. It includes only the `daily`
frequency code, dates after the first inventory-added date, weekdays, and days where the school calendar reports
`InSession = 1`. A past qualifying day, or today's qualifying day after the configured cutoff, remains Action Required
until an effective Given or Not Given transaction exists for the same medication and date.

## Required relationship behavior

- One student can have many medication definitions.
- One medication definition can have many inventory lots.
- A refill adds an inventory lot.
- Inventory consumption is applied to lots oldest-first when remaining quantities are derived.
- Quantity history must not be overwritten.
- Each inventory removal creates one transaction row rather than updating an original lot.
- Saved inventory and administration transactions remain append-only. The nurse-facing workflow calls administration corrections `Corrected` or `Entered in Error`; it does not expose reversal terminology.

## Effective administration model

The administration page resolves original Given and Not Given rows together with their append-only corrections and
shows one effective history row per stored event. It then merges unresolved calculated expected rows. Entered-in-error
Given rows remain visible and clearly marked but do not resolve an expected daily occurrence. Student and school-year
context are derived through the linked medication definition.

The administration form collects the actual quantity used in the medication's inventory unit and shows the prescribed dose amount and unit in parentheses for reference. That entered quantity becomes the transaction's negative `quantity_change`.

Variable prescribed doses display `Varies · [dose unit]`. Their numeric `dose_amount` is blank; the unit is retained.
Medication Notes holds the authorized dosing instructions or plan reference and is shown when entering a variable-dose
administration. These medication notes are not added to historical administration notes or snapshotted as instructions.
Every new Given, Not Given, conversion, correction, and void snapshots the prescribed-dose mode. Historical numeric
snapshots remain fixed regardless of later medication edits. A dose-only correction appends the existing correction
transaction type with zero `quantity_change`; its effective mode replaces the original, whose data remains immutable.
Corrections show the previous and corrected prescribed descriptions in the administration audit when they differ.
The UI sends an empty string to clear `dose_amount` because the API service omits null values. Installed schema API
clearing and Oracle execution must be verified on the test server.

Because unresolved gaps are calculated, they do not appear in transaction-only reports until the nurse documents a
reason. Documented Not Given transactions are directly reportable by student, medication, event date, stable reason
code, label snapshot, and documenting user. Reports that need current effective results must apply the same correction
and conversion relationships used by the administration page.
