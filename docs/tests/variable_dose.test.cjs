const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const test = require('node:test')
const vm = require('node:vm')
const root = path.resolve(__dirname, '../..')
const source = fs.readFileSync(path.join(root, 'web_root/admin/students/medication/medication.js'), 'utf8')
const between = (start, end) => {
    const from = source.indexOf(start)
    const to = source.indexOf(end, from)
    assert.ok(from >= 0 && to > from)
    return source.slice(from, to)
}
const helpers = between('const normalizeDateKey =', 'const secondsToTime12 =')
const dose = vm.runInNewContext(helpers + '\n({isVariableDose, isValidPrescribedDose, prescribedDoseFields, resolvePrescribedDose, medicationDoseDisplay})')
const reduce = vm.runInNewContext(helpers + '\nconst $rootScope = {medicationDoseDisplay};\n' +
    between('const prepareAdministrationHistory =', 'const prepareAdministrationMedicationOptions =') + '\nprepareAdministrationHistory')
const prepareInventory = vm.runInNewContext(
    between('const getInventoryStatus =', 'const normalizeMedicationNameSpacing =') +
    between('const INVENTORY_ENTRY_CORRECTION_TYPES =', 'const normalizeDateKey =') +
    'const parseJsonArray = value => value || []; const applyInventoryStatus = () => {};\n' +
    between('const prepareMedicationData =', 'const prepareAdministrationHistory =') + '\nprepareMedicationData')

// Execute the shipped controller code with a fake transport; no PowerSchool calls.
let options
vm.runInNewContext(fs.readFileSync(path.join(root, 'web_root/scripts/components/health_log/config/healthOptions.js'), 'utf8'), {
    define: factory => { options = factory() }
})
const controllers = {}
const moduleStub = { controller: (name, factory) => { controllers[name] = factory }, filter: () => {} }
vm.runInNewContext(source, {
    define: (dependencies, factory) => factory({ module: () => moduleStub }, options),
    loadingDialog: () => {}, closeLoading: () => {}, psAlert: () => {},
    psConfirm: value => value.ok(), document: {getElementById: () => null}, console
})
const fixture = (overrides = {}) => ({
    medication_id: 7, medication_name: 'Example medicine', dose_amount: 99, dose_unit: 'Units',
    inventory_unit: 'Units', route: 'oral', frequency: 'daily', inventory_total_remaining: 40,
    ...overrides
})
const transaction = (overrides = {}) => ({
    ...fixture(), transaction_id: 11, transaction_type: 'ADMINISTRATION', quantity_change: -4,
    administration_quantity: 4, event_date: '2026-10-01', event_time: 43200, users_dcid: 6,
    notes: 'Example event', ...overrides
})
const instantiate = name => {
    const events = {}, calls = []
    const scope = { $emit: (name, callback) => { events[name] = callback }, $watch: () => {} }
    const rootScope = {
        appData: { context: 'inventory', curDate: '10/21/2026', curTime: '12:00 PM', curUserDcid: 6,
            curStudentDCID: 100, curSchoolId: 10, curYearId: 36, medicationOptionsLoaded: true,
            medicationOptions: { not_given_reason: [{ code: 'absent', modelValue: 'absent', displayValue: 'Absent' }] } },
        getCurrentTime: () => '12:00 PM', reloadData: () => {}, showAdministrationFeedback: () => {},
        medicationOptionDisplayValue: (field, value) => value, existingMedicationList: []
    }
    const api = { psApiCall: (table, method, payload, id) => {
        calls.push({ table, method, payload: JSON.parse(JSON.stringify(payload)), id })
        return Promise.resolve([{ id: 7 }])
    } }
    const instance = {}
    if (name === 'editController') {
        controllers[name].call(instance, scope, rootScope, { when: Promise.resolve.bind(Promise), all: Promise.all.bind(Promise) },
            callback => callback(), { objIterator: () => {}, formatDateForApi: value => value }, api)
    } else controllers[name].call(instance, scope, rootScope, api)
    return { instance, events, calls, rootScope }
}

test('fixed doses, variable flags, and blank numeric snapshots have distinct meanings', () => {
    for (const flag of [1, '1', true]) assert.equal(dose.medicationDoseDisplay(fixture({variable_dose: flag})), 'Varies · Units')
    for (const flag of [0, '0', null, undefined, false]) assert.equal(dose.medicationDoseDisplay(fixture({variable_dose: flag})), '99 Units')
    assert.equal(dose.isValidPrescribedDose(fixture({variable_dose: 1, dose_amount: ''})), true)
    for (const amount of ['', null, 0, -1, 'abc', 'Infinity']) assert.equal(dose.isValidPrescribedDose(fixture({dose_amount: amount})), false)
    assert.equal(dose.isValidPrescribedDose(fixture({dose_amount: '.5'})), true)
    assert.equal(dose.prescribedDoseFields(fixture({variable_dose: 1})).dose_amount, '')
    assert.equal(dose.resolvePrescribedDose({variable_dose: 1, dose_amount: null}, fixture()).dose_amount, '')
    assert.equal(dose.resolvePrescribedDose({dose_amount: 99}, fixture({variable_dose: 1})).variable_dose, 0)
})

test('changing the medication does not relabel past Given or Not Given entries', () => {
    const medication = fixture({variable_dose: 1, dose_amount: null})
    const rows = reduce([medication], [transaction(), transaction({transaction_id: 12, transaction_type: 'NON_ADMINISTRATION', quantity_change: 0})], [])
    assert.equal(rows.length, 2)
    assert.ok(rows.every(row => row.variable_dose === 0 && row.dose_amount === 99))
    const variableRows = reduce([fixture()], [transaction({variable_dose: 1, dose_amount: null})], [])
    assert.equal(variableRows[0].variable_dose, 1)
    assert.equal(variableRows[0].dose_amount, '')
})

test('dose corrections preserve quantity, audit, FIFO, and effective dose across repeated corrections', () => {
    const original = transaction()
    const correction = transaction({transaction_id: 12, transaction_type: 'ADMINISTRATION_CORRECTION',
        reversal_of_transaction_id: 11, quantity_change: 0, variable_dose: 1, dose_amount: null,
        correction_reason: 'Placeholder clarified', correction_users_dcid: 6})
    const medication = fixture({inventory_batches: [{inventory_id: 1, quantity_added: 10, added_date: '2026-09-01'},
        {inventory_id: 2, quantity_added: 20, added_date: '2026-10-01'}]})
    const prepared = prepareInventory([medication], [original, correction], [])[0]
    assert.equal(prepared.inventory_total_remaining, 26)
    assert.equal(prepared.inventory_batches[0].quantity_remaining, 6)
    const history = reduce([prepared], [original, correction], [])
    assert.equal(history[0].quantity_administered, 4)
    assert.equal(history[0].variable_dose, 1)
    assert.equal(history[0].correction_history[0].previous_dose_display, '99 Units')
    assert.equal(history[0].correction_history[0].prescribed_dose_display, 'Varies · Units')
    const fixedCorrection = {...correction, transaction_id: 13, variable_dose: 0, dose_amount: 5}
    assert.equal(reduce([prepared], [original, correction, fixedCorrection], [])[0].dose_amount, 5)
    assert.equal(original.dose_amount, 99)
})

test('Not Given dose-only correction stays Not Given and does not create an expected gap', () => {
    const original = transaction({transaction_type: 'NON_ADMINISTRATION', quantity_change: 0, not_given_reason_code: 'absent'})
    const correction = transaction({transaction_id: 12, transaction_type: 'NON_ADMINISTRATION_CORRECTION',
        reversal_of_transaction_id: 11, quantity_change: 0, variable_dose: 1, dose_amount: null})
    const rows = reduce([fixture()], [original, correction], [{medication_id: 7, expected_date: '2026-10-01'}])
    assert.equal(rows.length, 1)
    assert.equal(rows[0].is_not_given, true)
    assert.equal(rows[0].variable_dose, 1)
})

test('inventory validation accepts variable doses, rejects duplicate variable definitions, and clears saved amount', async () => {
    const {instance: edit, events, calls, rootScope} = instantiate('editController')
    events['open.drawer.event'](() => {}, {})
    Object.assign(edit.medicationRecord, fixture({medication_id: undefined, variable_dose: 1, dose_amount: ''}))
    edit.inventoryRecord[0].quantity_added = 30
    assert.equal(edit.isFormValid(), true)
    rootScope.existingMedicationList = [fixture({variable_dose: 1, dose_amount: null})]
    assert.equal(edit.duplicateMedicationExists(), true)
    rootScope.existingMedicationList = [fixture({dose_amount: 99})]
    assert.equal(edit.duplicateMedicationExists(), false)
    await events['save.drawer.event'](() => {}, {})
    assert.equal(calls[0].payload.variable_dose, 1)
    assert.equal(calls[0].payload.dose_amount, '')
    assert.equal(calls[1].table, 'u_student_medication_inventory')
    assert.equal(calls[1].payload.quantity_added, 30)
})

test('new administrations snapshot variable dose and deduct only the actual entered quantity', async () => {
    const {instance: admin, events, calls} = instantiate('administrationEditController')
    events['open.drawer.event'](() => {}, {data: {medication: fixture({variable_dose: 1, dose_amount: null})}})
    assert.equal(admin.administrationRecord.quantity, '')
    assert.equal(admin.isFormValid(), false)
    admin.administrationRecord.quantity = 3.5
    assert.equal(admin.isFormValid(), true)
    events['save.drawer.event'](() => {})
    assert.equal(calls.length, 1)
    assert.equal(calls[0].payload.variable_dose, 1)
    assert.equal(calls[0].payload.dose_amount, '')
    assert.equal(calls[0].payload.quantity_change, -3.5)
})

test('Given dose-only correction requires a reason and POSTs zero inventory change', () => {
    const {instance: correction, events, calls} = instantiate('administrationCorrectionController')
    events['open.drawer.event'](() => {}, {data: {administration: transaction({root_transaction_id: 11, quantity_administered: 4})}})
    correction.correctionRecord.variable_dose = 1
    assert.equal(correction.isFormValid(), false)
    correction.correctionRecord.correction_reason = 'Placeholder clarified'
    assert.equal(correction.isFormValid(), true)
    events['save.drawer.event'](() => {})
    assert.equal(calls[0].method, 'POST')
    assert.equal(calls[0].payload.variable_dose, 1)
    assert.equal(calls[0].payload.quantity_change, 0)
    assert.equal(calls[0].payload.administration_quantity, 4)
    assert.equal(calls[0].payload.reversal_of_transaction_id, 11)
})

test('Not Given dose-only correction POSTs zero change without requiring a changed reason code', () => {
    const {instance: expected, events, calls} = instantiate('expectedAdministrationController')
    events['open.drawer.event'](() => {}, {data: {notGiven: transaction({root_transaction_id: 11, is_not_given: true, not_given_reason_code: 'absent'})}})
    expected.record.variable_dose = 1
    expected.record.correction_reason = 'Placeholder clarified'
    assert.equal(expected.isFormValid(), true)
    events['save.drawer.event'](() => {})
    assert.equal(calls[0].payload.transaction_type, 'NON_ADMINISTRATION_CORRECTION')
    assert.equal(calls[0].payload.variable_dose, 1)
    assert.equal(calls[0].payload.quantity_change, 0)
    assert.equal(calls[0].payload.not_given_reason_code, 'absent')
})
