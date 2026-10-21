// Local AngularJS 1.4.7 fixture. No authenticated browser or PowerSchool writes.
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const { chromium } = require('playwright')
const root = path.resolve(__dirname, '../..')
const medicationDir = path.join(root, 'web_root/admin/students/medication')
const source = fs.readFileSync(path.join(medicationDir, 'medication.js'), 'utf8')
const helpers = source.slice(source.indexOf('const normalizeDateKey ='), source.indexOf('const secondsToTime12 ='))
const previewDir = process.env.HEALTH_VARIABLE_PREVIEW_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'variable-dose-preview-'))
fs.mkdirSync(previewDir, { recursive: true })

async function main() {
    const browser = await chromium.launch({ channel: 'msedge', headless: true })
    try {
        const page = await browser.newPage({viewport: {width: 1000, height: 1100}})
        const errors = []
        page.on('pageerror', error => errors.push(error.message))
        await page.setContent('<html><head></head><body><div class="ui-dialog" style="width:900px"><h2>Example medication — test fixture</h2><div id="fixture"></div></div></body></html>')
        await page.addStyleTag({path: path.resolve(root, '../cdol_css/web_root/images/css/cdol.css')})
        for (const file of ['angular.js', 'angular-mocks.js']) {
            await page.addScriptTag({path: path.join(process.env.HEALTH_ANGULAR_TEST_DIR, file)})
        }
        await page.evaluate(() => {
            angular.module('powerSchoolModule', [])
            angular.module('healthLogMod', [])
            window.define = factory => { window.healthOptions = factory() }
            window.loadingDialog = window.closeLoading = () => {}
            window.psAlert = value => { throw new Error(JSON.stringify(value)) }
            window.psConfirm = value => value.ok()
        })
        await page.addScriptTag({path: path.join(root, 'web_root/scripts/components/health_log/config/healthOptions.js')})
        await page.evaluate(() => { window.define = (dependencies, factory) => factory(angular, window.healthOptions) })
        await page.addScriptTag({path: path.join(medicationDir, 'medication.js')})
        await page.addScriptTag({content: helpers + '\nwindow.doseHelpers = {isVariableDose, medicationDoseDisplay};'})
        await page.evaluate(() => {
            window.calls = []
            angular.module('variableTest', ['medicationModule', 'ngMock'])
                .value('formatService', { objIterator: () => {}, formatDateForApi: value => value,
                    stripTimeFromIsoDate: value => value, formatDateFromApi: value => value })
                .factory('psApiService', ['$q', $q => ({psApiCall: (table, method, payload) => {
                    calls.push({table, method, payload: angular.copy(payload)})
                    return $q.when([{id: 7}])
                }})])
            window.injector = angular.injector(['ng', 'ngMock', 'variableTest'])
            window.rs = injector.get('$rootScope')
            rs.isVariableDose = doseHelpers.isVariableDose
            rs.medicationDoseDisplay = doseHelpers.medicationDoseDisplay
            rs.medicationOptionDisplayValue = (field, value) => value
            rs.appData = {context: 'inventory', curDate: '10/21/2026', curTime: '12:00 PM', curUserDcid: 6,
                curStudentDCID: 100, curSchoolId: 10, curYearId: 36, medicationOptionsLoaded: true,
                staffList: [{dcid: 6, first_name: 'Example', last_name: 'Nurse'}], medicationOptions: {}}
            for (const [field, value] of Object.entries({dose_unit: 'Units', inventory_unit: 'Units', route: 'Oral', frequency: 'Daily', not_given_reason: 'absent'})) {
                rs.appData.medicationOptions[field] = [{modelValue: value, code: value, displayValue: value}]
            }
            rs.existingMedicationList = []
            rs.reloadData = rs.showAdministrationFeedback = () => {}
            rs.getCurrentTime = () => '12:00 PM'
            window.medication = {medication_id: 7, medication_name: 'Example medicine', dose_amount: 99, dose_unit: 'Units',
                inventory_unit: 'Units', route: 'Oral', frequency: 'Daily', created_date: '10/01/2026', notes: 'See authorized dosing plan.',
                inventory_batches: [{inventory_id: 1, quantity_added: 30, quantity_remaining: 26, added_date: '10/01/2026', users_dcid: 6}],
                inventory_total_remaining: 26}
            window.mount = (html, data) => {
                if (window.fixtureScope) fixtureScope.$destroy()
                window.fixtureScope = rs.$new()
                window.events = {}
                for (const name of ['open.drawer.event', 'save.drawer.event', 'cancel.drawer.event']) {
                    fixtureScope.$on(name, (event, callback) => { events[name] = callback })
                }
                const element = injector.get('$compile')(html)(fixtureScope)
                document.getElementById('fixture').replaceChildren(...Array.from(element))
                rs.$digest()
                if (events['open.drawer.event']) events['open.drawer.event'](() => {}, {data})
                try { injector.get('$timeout').flush() } catch (error) {
                    if (!/No deferred tasks/.test(error.message)) throw error
                }
                rs.$digest()
            }
        })
        const inventory = fs.readFileSync(path.join(medicationDir, 'editInventory.html'), 'utf8')
        await page.evaluate(html => mount(html, {medication: angular.copy(medication)}), inventory)
        assert.equal(await page.locator('#dose-amt-input').inputValue(), '99')
        await page.locator('#variable-dose-input').check()
        assert.equal(await page.locator('#dose-amt-input').count(), 0)
        assert.equal(await page.locator('#dose-unit-select').inputValue(), 'string:Units')
        assert.ok((await page.locator('#dose-input-group').innerText()).includes('Varies'))
        await page.screenshot({path: path.join(previewDir, 'inventory-variable-dose.png'), fullPage: true})
        await page.evaluate(() => { events['save.drawer.event'](() => {}); rs.$digest() })
        const savedMedication = await page.evaluate(() => calls[0])
        assert.equal(savedMedication.method, 'PUT')
        assert.equal(savedMedication.payload.variable_dose, 1)
        assert.equal(savedMedication.payload.dose_amount, '')
        assert.equal(await page.evaluate(() => calls.length), 1)

        const correction = fs.readFileSync(path.join(medicationDir, 'correctAdministration.html'), 'utf8')
        await page.evaluate(html => mount(html, {administration: {...medication, root_transaction_id: 11, quantity_administered: 4,
            event_date: '2026-10-01', event_time: 43200, users_dcid: 6}}), correction)
        await page.locator('#correction-variable-dose').check()
        await page.locator('#administration-correction-reason').fill('Placeholder clarified against authorized plan.')
        await page.screenshot({path: path.join(previewDir, 'correct-variable-dose.png'), fullPage: true})
        await page.evaluate(() => { events['save.drawer.event'](() => {}); rs.$digest() })
        const corrected = await page.evaluate(() => calls[calls.length - 1])
        assert.equal(corrected.payload.quantity_change, 0)
        assert.equal(corrected.payload.variable_dose, 1)
        assert.equal(corrected.payload.administration_quantity, 4)

        const administration = fs.readFileSync(path.join(medicationDir, 'administerMedication.html'), 'utf8')
        await page.evaluate(html => {
            const variable = {...medication, variable_dose: 1, dose_amount: null}
            rs.appData.availableMedicationList = [variable]
            mount(html, {medication: variable})
        }, administration)
        assert.ok((await page.locator('#administration-medication-summary').innerText()).includes('Varies · Units'))
        assert.ok((await page.locator('#administration-medication-summary').innerText()).includes('See authorized dosing plan.'))
        assert.equal(await page.locator('#administration-quantity-input').inputValue(), '')
        await page.screenshot({path: path.join(previewDir, 'administer-variable-dose.png'), fullPage: true})
        assert.deepEqual(errors, [])
        const angularErrors = await page.evaluate(() => injector.get('$exceptionHandler').errors.map(error => String(error)))
        assert.deepEqual(angularErrors, [])
        console.log('PASS: AngularJS controls, numeric field clearing payload, dose-only correction, notes, and console. Previews: ' + previewDir)
    } finally { await browser.close() }
}
main().catch(error => {console.error(error); process.exitCode = 1})
