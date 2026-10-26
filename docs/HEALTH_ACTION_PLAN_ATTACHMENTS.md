# Action Plan attachment access

## Document preview modal (26.9.8.1)

Local validation passed: the AngularJS browser suite with source and simulated
PowerSchool field names, request-reuse/date-order tests, JavaScript syntax, XML,
and diff checks. Browser console checks passed and the synthetic modal layout was
visually inspected. All three installer ZIPs passed integrity and source-byte
comparisons; this does not establish installed PowerSchool behavior.

View document buttons now sit to the right of the saved return-method options.
Clicking one opens a native modal dialog and automatically previews the most
recent accessible upload in that section's categories. The dialog shows the
filename, native upload date and time, Open student attachments (new tab), and
Close document. Escape also closes it and returns focus to the button. The native
modal keeps background controls inert; narrow screens allow the row to wrap.

All metadata pages are loaded before sorting by the native US-formatted upload
information. Known dates sort first; ties or unavailable dates use descending
attachment ID. This selects a recent upload, not a clinically current plan.
Existing category and download authorization checks, content-type checks,
no-write behavior, and Blob URL cleanup remain in place. The attachments link
also remains available on lookup/preview failure. Close and reopen refreshes
metadata after any one-use discovery result has been consumed.

Install CDOL CSS 26.9.1.1 before CDOL Health and CDOL Health - Data Access
26.9.8.1. The application was already at 26.9.8 before this change; older entries
below describe historical releases. Installed PowerSchool validation remains
pending, including actual timestamp formatting and native PDF viewer behavior.

The versioned inline-picker descriptions below are historical and superseded by
this modal workflow.

## Request reuse and refresh (26.9.7.60)

District category requests are shared within the page for 60 seconds, including
concurrent requests from separate sections. Failures are not cached. Successful
discovery metadata may be consumed once when opening the same section within
30 seconds. Context changes or disabling a section clear that metadata; late
responses cannot replace the current context. Lists and document content are
not stored in browser persistent storage.

The document panel includes Refresh documents, which fetches fresh categories
and document metadata. Reopening after consuming discovery also reloads document
metadata. Every preview still requests content from PowerSchool, preserving
server authorization and existing Blob URL cleanup.

The Prescription Authorization Form block uses category Prescription and native
RX_COLLECTION_METHOD. Its custom saved options are Upload, Return to school office, and
Student does not require prescription medication to be administered at school.
The last choice remains visible even when the medication card is hidden; an
existing matching document can still show the icon. Preview and permission rules
are shared with the other blocks, and return-method values never enter API writes.

Medical Authorization's OTC block uses this same integration with the exact
category Non-Prescription. Its saved NON_RX_COLLECTION_METHOD is rendered through
a native page token into read-only tags. Upload or a matching active document
shows the icon; no-match, denied download, and lookup failure use the existing
fallback behavior. Metadata discovery waits until the form has loaded. Document
viewing does not submit or change medication authorizations.

School 104's Dental Examination block also uses this shared integration with the
exact category Dental. Its DENTAL_PLAN_COLLECTION_METHOD remains read-only. Upload
or matching active metadata shows the icon, with the same download-permission
checks, preview, and native-page fallback. Leaving school 104 clears the preview
and disables metadata discovery. Installed Dental-category validation is pending.

## Supplied plugins reviewed

### Student Document Attachments Preview 2025.08.25.2

The supplied archive contains a page fragment for
`/admin/students/studentattachments.html`, published by Vance M. Allen.
It appends a preview button to the native attachment table before Angular compiles
the rows. The native `fileMetaData` record supplies the attachment ID, filename,
status, creator, and `permission.download` flag. The button is disabled unless the
status is `A`, download permission is present, and the creator is not PowerSchool
Registration Signature.

The preview requests `/ws/k12drive/document/content/<id>` as an array buffer and
opens a Blob URL in an iframe within PowerSchool's `psAlert` dialog. It does not
include the native attachment-list request, category filtering, or a way to find
an authorized Diabetes attachment from another page. Its response handler also
lacks explicit HTTP-error handling and revokes the Blob URL immediately after
assigning it to the iframe. The preview fragment was inspected, not installed or
executed against student documents.

### Document Attachment Alert 22.5

The supplied archive is published by Jay Lindler / Bridgewood Consulting. Its
student-header wildcard checks for `docmetadata` rows for the selected student.
Its dialog groups counts by category using `docmetadatadistrictcategory` and
`districtcategory`, then links to the student's native Attachments page. It does
not resolve a specific document to open or check per-document download permission.

The requested `WEB_ROOT/images/bc-document-icon.png` was copied byte for byte to
`web_root/images/cdol_health_log/bc-document-icon.png`. The namespaced destination
avoids competing with the original plugin's `/images/bc-document-icon.png` path.
SHA-256: `5c1e681a0b6623c86ce161a1b340aa35b24bdfdf020f57a0a5f92b4532727706`.

## Implemented behavior (26.9.7.29)

When Diabetes is Yes and the saved `DIABETES_COLLECTION_METHOD` equals `Upload`,
the Action Plan return-method display shows the copied icon and an **Open student
attachments** link. The accompanying instruction is **Look for category: Diabetes.**
The icon and text open `/admin/students/studentattachments.html?frn=~(studentfrn)`
in a new tab with `rel="noopener"`, preserving unsaved Health History changes.

This is the user-authorized navigation fallback. The page is not automatically
filtered to Diabetes and the link does not claim an upload exists. Return to school
office, blank, and unrecognized values do not show it. Other return-method displays
have no attachment link unless explicitly configured. The parent choice remains
read-only and is never included in form submission.

The native Attachments page handles attachment access and document selection. If
the Preview plugin is installed, its existing preview buttons remain available on
that page. No new SQL, metadata endpoint, document-content request, or permission
grant is added here. A direct preview would require verifying the native category
lookup and per-document permission contract, plus behavior when multiple Diabetes
documents exist; those details are not supplied by either archive.

## Validation

Local AngularJS tests cover Upload-only visibility, blank/unknown/office choices,
the selected-student FRN, icon-click navigation to a mocked Attachments page in a
new tab, a null opener, and the unchanged read-only parent-choice contract. Package
checks compare the icon bytes with the supplied archive and verify the manifest.

Installed PowerSchool verification remains required for the actual field value,
native page permission checks, the Diabetes category, attachment availability,
and the separately installed Preview plugin. No real documents were accessed.

## Production source inspection (2026-09-24)

Read-only inspection of the user-selected native Attachments page confirmed the
following contract in the scripts loaded by production. No attachment content was
requested, and no student records or attachment metadata were changed. This
inspection does not validate a direct preview from Health History.

### Metadata and category lookup

`/scripts/components/docattach/services/docattachSearchService.js` uses:

- `GET /ws/districtcategory`, returning `categories` (an object or array).
- `GET /ws/k12drive/document/aggregates` with `entityname=STCM`, `entityid`,
  and `q`. The result is `documentAggregates`, including `count` and `time`.
- `GET /ws/k12drive/document` with `entityname=STCM`, `entityid`, `page`,
  `pagesize`, `order`, `q`, and a cache-busting `_` timestamp. The result is
  `documents.documentList` (an object or array).

The controller obtains `entityid` by removing the first three characters of the
page's `#frn` value. Follow that native derivation; do not substitute the full FRN
or assume it is the same as another student identifier used by Health History.

`/scripts/docattach/filterdata.js` constructs the category filter as
`category==(<category-id>);status==active`. With the aggregate timestamp, it adds
`lastmodifiedon=le=<time>` before the status clause. Resolve the Diabetes category
by name from the category response instead of hard-coding its production ID.
The native service passes the filter through Angular `$http` query parameters.

### Document fields and access checks

The already-loaded records contain `id`, `status`, `permission.download`,
`documentLocation`, `mimeType`, `name`, `categories`, and `changeList`.
`categories` can be a single object or an array; each category has `id` and `name`.
Normalize both list response shapes and category shapes before filtering.

The native single-download button requires `status === 'A'` and
`permission.download`. The controller additionally marks documents unavailable
when `documentLocation` is present and differs from `L`. The installed preview
fragment uses the content endpoint described above and excludes documents created
by PowerSchool Registration Signature. Its `createdby` field is derived by the
controller from `changeList`, rather than supplied directly by the metadata API.

The inspected account had download permission for both displayed active, local
documents. A denied account and server-side content authorization were not tested;
client-side flags are not a replacement for the content endpoint's authorization.
Handle rejected requests without attempting an alternative access path.

### Selection caveat and proposed integration

The sample showed an older plan tagged Diabetes and a newer plan tagged Medical
and Other. A strict Diabetes-category lookup would return the older plan. Do not
infer the latest valid plan from the filename or silently include other categories.
An upload date also does not establish the doctor's plan date.

For direct preview, look up the current student's authorized Diabetes documents
when the icon is clicked. Display filename and upload information so the admin can
identify the document; allow selection if there are multiple matches. Retain the
native Attachments link for missing matches, unsupported previews, or errors. Only
request content after selection, check HTTP success and content type, and revoke
the Blob URL when the preview closes. These changes were not implemented in
26.9.7.29; the implementation below supersedes that navigation-only behavior.

## Direct picker and preview (26.9.7.30)

The user confirmed that future parent uploads will be categorized Diabetes.
`healthAttachments` now performs the verified native category, aggregate, and
paginated metadata GET requests on icon click, scoped to the explicit student FRN.
An inline picker always asks the administrator to select a document, including
when only one matches. It shows the filename and native formatted upload date;
it does not judge whether the plan satisfies the doctor's date requirement.

The picker excludes inactive documents, documents without an explicit boolean
download permission, unavailable document locations, and Registration Signature
documents. It rechecks category membership in the metadata, deduplicates IDs across
pages, normalizes object/array responses, and uses the aggregate snapshot timestamp.
Malformed responses and request failures show the native-page fallback. An unusually
large result exceeding 10,000 documents also uses that fallback.

Selecting a document requests its content using the current session. Successful,
nonempty PDF or PNG/JPEG/GIF/WebP responses become a Blob iframe preview. Other
types, HTML login responses, and rejected requests never become previews. Blob
URLs stay alive during viewing and are released when replaced, closed, hidden by
a Diabetes answer change, or destroyed. Late content responses after closure have
their Blob URLs revoked without reopening the panel. Metadata/content requests
have a 30-second timeout. No automatic preview, cross-category search, direct S3
request, metadata write, new permission grant, or audit stamp is introduced.

The icon remains Upload-only, and Open student attachments remains a separate new
tab link. Every picker button is `type="button"`; display-only data has no form
submission names. The original native form and saved parent method are preserved.

Local AngularJS 1.4.7 coverage exercises multiple pages, singleton/list shapes,
category and permission exclusions, empty results, missing categories, denied
list/content requests, login/unsupported/empty content, preview cleanup, closure
during an outstanding request, and absence of form submissions or student writes.
Content fixtures are synthetic. Installed preview from Health History and
server-side denied-account behavior still require live verification after install.

Validation completed: the full health-form suite passes with both source and
PowerSchool-rendered field names; JavaScript syntax, repository XML, and diff
whitespace checks pass. Both 26.9.7.30 ZIPs were built, their manifest versions
verified, and the packaged JS/CSS/HTML/icon compared byte for byte with source.
The local picker layout was inspected using synthetic data. The headless tests
verify PDF/image response handling and iframe creation, not the installed browser's
PDF viewer rendering or real production content authorization.

## Seizure integration (26.9.7.35)

The same directive now serves SEIZURE_PLAN_COLLECTION_METHOD in the Action Plan
section whenever SEIZURE_AGREE is Yes. It resolves the exact category name Seizure;
the diabetes instance still resolves Diabetes. Independent directive scopes keep
the lists, return methods, and Blob URLs separate when both plans are displayed.
Changing Seizures to No closes and releases its preview, while leaving an applicable
diabetes plan available. The previous school-limited seizure section is removed.

Local tests cover personalized seizure instructions, provider underline, highlighted
deadline, one saved return-method display, category isolation, preview creation and
cleanup, both conditions together, and applicability across the ten school fixtures.
Installed Seizure-category resolution and access remain live validation steps.

## Icon visibility from attachment presence (26.9.7.37)

The Upload-only visibility rule is superseded for both plans. When a plan applies,
Upload always shows its icon. Other saved methods trigger the native metadata lookup
and show the icon if an active document is returned in the exact matching category.
Existence is determined from metadata rows, not inferred from aggregate counts.
The lookup result separates `hasMatches` from the downloadable `documents` list,
so icon visibility does not bypass preview access checks. Opening the picker
refreshes metadata before presenting eligible files.

Discovery does not open the picker or request file content. It is skipped for
unconfigured return-method displays and inapplicable conditions. Context/method
changes clear previous results, close previews, and invalidate outstanding discovery
responses. Failed discovery for non-Upload values leaves the native Attachments
link with an explicit availability-check message; it does not report no matches.

Local tests pass for both categories across Upload/office/blank/historical choices,
matching and absent documents, wrong categories, metadata without download
permission, denied metadata, preview from an office-return choice, and no automatic
content requests. Installed metadata access and visual validation remain pending.

## Allergy or Asthma documents (26.9.7.41)

The shared Asthma/Severe Allergy block uses ALLERGY_PLAN_COLLECTION_METHOD and is
enabled by INHALER OR EPIPEN. Its display label is Asthma/Severe Allergy; its lookup
names are Allergy and Asthma, confirmed by the user. `attachment-categories`
supports this explicit list while existing single-category instances keep using
`attachment-category`. Names resolve to IDs through the native category endpoint.
The native filter accepts comma-separated IDs (`category==(id1,id2)`), as constructed
by the inspected native filter builder. Client-side membership checks accept either
ID, and the existing ID deduplication handles documents in both categories.

Local tests cover Allergy-only, Asthma-only, dual-category, duplicate, and unrelated
documents, plus both trigger fields and existing icon/preview access checks.
Installed multi-category query semantics and access still require live validation.

## Meal Accommodation direct link (26.9.7.45)

The separate Meal Accommodation section uses a plain icon/text link to
`/admin/students/studentattachments.html?frn=~(studentfrn)` with `target="_blank"`
and `rel="noopener"`. No attachment category exists for this workflow, so it does
not use discovery or the document picker. The link is available whenever the
section is shown (current SchoolID 130/131 and ALLERGY_AGREE = 1), independent of
the saved FOOD_PLAN_COLLECTION_METHOD. The shared return-method directive is used
only for its read-only text display. Local tests confirm direct navigation and no
additional category requests.
