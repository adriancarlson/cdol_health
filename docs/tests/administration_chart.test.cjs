const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')

const medicationDir = path.resolve(__dirname, '../../web_root/admin/students/medication')
const source = fs.readFileSync(path.join(medicationDir, 'medication.js'), 'utf8')
const between = (start, end) => {
    const from = source.indexOf(start)
    const to = source.indexOf(end, from)
    if (from < 0 || to < 0) throw new Error(`Source boundary changed: ${start}`)
    return source.slice(from, to)
}

const prepareAdministrationChart = vm.runInNewContext(
    between('const normalizeDateKey =', 'const isActiveHealthOption =') +
    between('const prepareAdministrationChart =', 'vm.rebuildAdministrationChart =') +
    '\nprepareAdministrationChart'
)

const calendarRow = (date, overrides = {}) => ({
    year_start_date: '2024-08-15',
    year_end_date: '2025-05-23',
    calendar_date: date,
    in_session: 1,
    is_enrolled: 1,
    ...overrides
})

const medications = [
    { medication_id: 20, medication_name: 'Zeta', dose_amount: 5, dose_unit: 'mg' },
    { medication_id: 10, medication_name: 'Alpha', dose_amount: 1, dose_unit: 'pill' }
]

test('variable-dose chart legend does not expose a numeric placeholder', () => {
    const chart = prepareAdministrationChart([
        {medication_id: 7, medication_name: 'Example', variable_dose: 1, dose_amount: 99, dose_unit: 'Units'}
    ], [], [calendarRow('2024-08-15')])
    assert.equal(chart.medicationLegend[0].label, 'Example — Varies')
})

test('builds one 31-day row per school-year month with boundary and day classifications', () => {
    const chart = prepareAdministrationChart(medications, [], [
        calendarRow('2024-08-15'),
        calendarRow('2024-08-16', { in_session: 0, calendar_note: 'Teacher workday' }),
        calendarRow('2024-08-19', { is_enrolled: 0 }),
        calendarRow('2025-05-23')
    ])

    assert.equal(chart.yearLabel, '2024–2025')
    assert.deepEqual(Array.from(chart.months, month => month.label), [
        'August', 'September', 'October', 'November', 'December',
        'January', 'February', 'March', 'April', 'May'
    ])
    assert.ok(chart.months.every(month => month.cells.length === 31))

    const august = chart.months[0]
    assert.equal(august.cells[0].is_unavailable, true)
    assert.equal(august.cells[15].marker, 'NS')
    assert.match(august.cells[15].aria_label, /Teacher workday/)
    assert.equal(august.cells[17].marker, 'W')
    assert.equal(august.cells[18].marker, 'NE')

    const february = chart.months.find(month => month.label === 'February')
    assert.equal(february.cells[28].is_unavailable, true)
    assert.equal(february.cells[28].marker, '')
})

test('uses first-three-letter medication abbreviations and effective chart-only event labels', () => {
    const chart = prepareAdministrationChart(medications, [
        { medication_id: 10, event_date: '2024-08-15', event_time: 36000, is_given: true, users_dcid: 101, user_name: 'Alex Brown', user_middle_name: 'Charles' },
        { medication_id: 20, event_date: '2024-08-15', event_time: 37000, is_given: true, is_corrected: true, users_dcid: 102, user_name: 'Amy Baker', user_middle_name: 'Diane' },
        { medication_id: 10, event_date: '2024-08-16', is_not_given: true, not_given_reason_label: 'Absent' },
        { medication_id: 20, event_date: '2024-08-19', is_action_required: true },
        { medication_id: 10, event_date: '2024-08-20', is_entered_in_error: true, is_given: true, user_name: 'Alex Brown' }
    ], [
        calendarRow('2024-08-15'),
        calendarRow('2024-08-16'),
        calendarRow('2024-08-19'),
        calendarRow('2024-08-20'),
        calendarRow('2025-05-23')
    ])

    assert.deepEqual(Array.from(chart.medicationLegend, medication => `${medication.key}:${medication.medication_name}`), [
        'ALP:Alpha', 'ZET:Zeta'
    ])
    assert.deepEqual(Array.from(chart.staffLegend, staff => [staff.key, staff.name, staff.signature_class]), [
        ['ACB', 'Alex Charles Brown', ''],
        ['ADB', 'Amy Diane Baker', 'secondary']
    ])

    const august = chart.months[0]
    assert.deepEqual(Array.from(august.cells[14].events, event => event.label), ['ALP ACB', 'ZET ADB'])
    assert.deepEqual(Array.from(august.cells[14].events, event => [event.detail, event.is_given, event.staff_signature_class]), [['ACB', true, ''], ['ADB', true, 'secondary']])
    assert.deepEqual(Array.from(august.cells[15].events, event => event.label), ['ALP Absent'])
    assert.deepEqual(Array.from(august.cells[18].events, event => event.label), ['ZET Missed'])
    assert.equal(august.cells[19].events.length, 0)
})

test('uses stable numeric fallbacks when matching middle initials still collide', () => {
    const chart = prepareAdministrationChart(medications, [
        { medication_id: 10, event_date: '2024-08-15', is_given: true, users_dcid: 201, user_name: 'Alex Brown', user_middle_name: 'Dale' },
        { medication_id: 10, event_date: '2024-08-15', is_given: true, users_dcid: 202, user_name: 'Amy Baker', user_middle_name: 'Dawn' },
        { medication_id: 10, event_date: '2024-08-16', is_given: true, users_dcid: 202, user_name: 'Amy Baker', user_middle_name: 'Dawn' },
        { medication_id: 10, event_date: '2024-08-15', is_given: true, users_dcid: 203, user_name: 'Avery Baker', user_middle_name: 'Drew' },
        { medication_id: 10, event_date: '2024-08-15', is_given: true, users_dcid: 204, user_name: 'Holly Steinbach', user_middle_name: 'Marie' }
    ], [calendarRow('2024-08-15'), calendarRow('2025-05-23')])

    assert.deepEqual(Array.from(chart.staffLegend, staff => [staff.key, staff.name, staff.signature_class]), [
        ['ADB1', 'Alex Dale Brown', 'secondary'],
        ['ADB2', 'Amy Dawn Baker', ''],
        ['ADB3', 'Avery Drew Baker', 'secondary'],
        ['HS', 'Holly Steinbach', '']
    ])
})

test('page uses PowerSchool tabs, the chart query parameter, and built-in printing', () => {
    const html = fs.readFileSync(path.join(medicationDir, 'administration.html'), 'utf8')
    const css = fs.readFileSync(path.resolve(__dirname, '../../../cdol_css/web_root/images/css/cdol.css'), 'utf8')
    assert.match(html, /class="tabs shown_tabs administration-tabs"/)
    assert.match(html, /administration\.html\?frn=~\(studentfrn\)&amp;view=chart/)
    assert.match(html, /ng-administration-view="~\(gpv\.view;onlyalpha\)"/)
    assert.match(html, /id="administration-chart-medication-filter"/)
    assert.match(html, /ng-change="vm\.rebuildAdministrationChart\(\)"/)
    assert.match(html, /<option value="">All Medications<\/option>/)
    assert.match(css, /@page cdol-health-administration-chart\s*{[\s\S]*size:\s*letter landscape/)
    assert.match(html, /id="administration-chart-print-boundary"/)
    assert.match(html, /administration-chart-hide-before-boundary/)
    assert.match(html, /new URLSearchParams\(window\.location\.search\)\.get\('view'\)/)
    assert.match(html, /class="administration-chart-key administration-chart-staff-initials"/)
    assert.match(css, /font-family:\s*"Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive/)
    assert.match(css, /\.administration-chart-staff-initials-secondary\s*{[\s\S]*font-family:\s*"Lucida Handwriting", "Segoe Print", "Comic Sans MS", cursive[\s\S]*font-style:\s*normal/)
    assert.match(html, /event\.staff_signature_class === 'secondary'/)
    assert.match(html, /staff\.signature_class === 'secondary'/)
    assert.match(html, /<strong>Grade:<\/strong> ~\(\[students\]grade_level\)/)
    assert.match(html, /<strong>Gender:<\/strong> ~\(decode;~\(gender\);M;Male;F;Female;Not Specified\)/)
    assert.match(html, /class="administration-chart-medication-summary">[\s\S]*<strong>Medication \/ Dosage<\/strong>/)
    assert.match(html, /class="administration-chart-medication-list"/)
    assert.match(html, /class="administration-chart-medication-item"/)
    assert.match(html, /<strong>\{\{medication\.key\}\}:<\/strong> \{\{medication\.medication_name\}\}/)
    assert.match(html, /<span ng-if="!\$last">,<\/span>/)
    assert.match(css, /\.administration-chart-student-line\s*{[\s\S]*margin-top:\s*4px[\s\S]*font-size:\s*16px/)
    assert.match(css, /\.administration-chart-active \.administration-chart-record-details \.administration-chart-student-line\s*{[\s\S]*gap:\s*4px 24px[\s\S]*margin-top:\s*4px[\s\S]*font-size:\s*8pt[\s\S]*line-height:\s*1\.2/)
    assert.match(html, /ng-class="\{ 'administration-chart-centered-marker': cell\.marker === 'W' \|\| cell\.marker === 'NS' \}"/)
    assert.match(css, /\.administration-chart-centered-marker\s*{[\s\S]*left:\s*50%[\s\S]*font-size:\s*12px/)
    assert.match(css, /\.administration-chart-active \.administration-chart-month\s*{[\s\S]*width:\s*0\.55in/)
    assert.match(html, /<span class="administration-chart-key">NS<\/span> No School/)
    const chartMarkup = html.slice(html.indexOf('<section id="administration-chart-view"'))
    assert.ok(chartMarkup.indexOf('administration-chart-toolbar') < chartMarkup.indexOf('administration-chart-heading'))
    assert.ok(chartMarkup.indexOf('<strong>Gender:</strong>') < chartMarkup.indexOf('administration-chart-medication-summary'))
    assert.ok(chartMarkup.indexOf('<strong>Medication / Dosage</strong>') < chartMarkup.indexOf('administration-chart-medication-list'))
    assert.ok(chartMarkup.indexOf('administration-chart-record-details') < chartMarkup.indexOf('administration-chart-table-wrap'))
    assert.ok(chartMarkup.indexOf('administration-chart-table-wrap') < chartMarkup.indexOf('administration-chart-legends'))
    assert.doesNotMatch(html, /Print Chart/)
})

test('calendar endpoint is read-only and preserves term, session, and enrollment boundaries', () => {
    const endpoint = fs.readFileSync(path.join(medicationDir, 'data/administrationCalendar.json'), 'utf8')
    for (const expected of ['terms.isyearrec = 1', 'calendar_day.insession', 'student_enrollment', 'year_start_date', 'year_end_date']) {
        assert.ok(endpoint.includes(expected), expected)
    }
    assert.doesNotMatch(endpoint, /\b(?:INSERT|UPDATE|DELETE|MERGE)\b/i)
})

test('administration feed supplies middle names without adding a chart request', () => {
    const endpoint = fs.readFileSync(path.join(medicationDir, 'data/inventoryTransactions.json'), 'utf8')
    assert.match(endpoint, /'user_middle_name' VALUE users\.middle_name/)
    assert.equal((source.match(/getData\('staff'/g) || []).length, 1)
})
