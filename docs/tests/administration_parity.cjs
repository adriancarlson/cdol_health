// Run the actual student-page reducer against fictional fixtures from stdin.
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const source = fs.readFileSync(path.resolve(__dirname, '../../web_root/admin/students/medication/medication.js'), 'utf8')
const between = (start, end) => {
    const from = source.indexOf(start)
    const to = source.indexOf(end, from)
    if (from < 0 || to < 0) throw new Error('Administration reducer source boundaries changed')
    return source.slice(from, to)
}
const reduce = vm.runInNewContext(
    between('const normalizeDateKey =', 'const secondsToTime12 =') +
    '\nconst $rootScope = { medicationDoseDisplay };\n' +
    between('const prepareAdministrationHistory =', 'const prepareAdministrationMedicationOptions =') +
    '\nprepareAdministrationHistory'
)
const fixtures = JSON.parse(fs.readFileSync(0, 'utf8'))
process.stdout.write(JSON.stringify(fixtures.map(fixture => {
    const rows = reduce(fixture.medications, fixture.transactions, fixture.expected)
    const students = new Map(fixture.medications.map(med => [med.medication_id, med.studentsdcid]))
    return new Set(rows.filter(row => row.is_action_required).map(row => students.get(row.medication_id))).size
})))
