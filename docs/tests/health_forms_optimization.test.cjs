// Uses the same AngularJS 1.4.7 and Playwright runtime as health_forms.test.cjs.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const angularDir = process.env.HEALTH_ANGULAR_TEST_DIR;

async function main() {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        const page = await browser.newPage();
        const errors = [];
        page.on('pageerror', error => errors.push(error.message));
        await page.setContent('<html><head></head><body></body></html>');
        await page.addScriptTag({ path: path.join(angularDir, 'angular.js') });
        await page.addScriptTag({ path: path.join(angularDir, 'angular-mocks.js') });
        await page.evaluate(() => {
            angular.module('powerSchoolModule', []);
            window.define = (dependencies, factory) => factory(angular);
        });
        await page.addScriptTag({ path: path.resolve(__dirname, '../../web_root/admin/students/health/healthForms.js') });
        const results = await page.evaluate(() => {
            const results = [];
            const check = (condition, message) => { if (!condition) throw new Error(message); results.push(message); };
            angular.module('optimizationTest', ['cdolHealthForms']).config(['$exceptionHandlerProvider', function (provider) { provider.mode('log'); }]);
            const injector = angular.injector(['ng', 'ngMock', 'optimizationTest']);
            const backend = injector.get('$httpBackend'), rootScope = injector.get('$rootScope');
            const attachments = injector.get('healthAttachments');
            const originalNow = Date.now;
            let now = 100000;
            Date.now = () => now;
            const categoryList = { categories: [{ id: 9, name: 'Diabetes' }, { id: 10, name: 'Seizure' }] };
            let aggregateReads = 0;
            backend.whenGET(/\/document\/aggregates/).respond(() => { aggregateReads++; return [200, { documentAggregates: { count: 0 } }]; });
            backend.expectGET('/ws/districtcategory').respond(200, categoryList);
            let completed = 0;
            attachments.find('001123', 'Diabetes').then(() => completed++);
            attachments.find('001456', 'Seizure').then(() => completed++);
            backend.flush();
            check(completed === 2 && aggregateReads === 2, 'simultaneous category lookup is shared; student queries remain separate');
            attachments.find('001123', 'Diabetes');
            backend.flush();
            check(aggregateReads === 3, 'category cache does not cache document permissions or student lists');
            now += 60001;
            backend.expectGET('/ws/districtcategory').respond(200, categoryList);
            attachments.find('001123', 'Diabetes');
            backend.flush();
            backend.expectGET('/ws/districtcategory').respond(200, categoryList);
            attachments.find('001123', 'Diabetes', true);
            backend.flush();
            check(aggregateReads === 5, 'expired categories and explicit refresh fetch categories again');
            backend.expectGET('/ws/districtcategory').respond(200, '<html>Sign in</html>');
            let rejected = false;
            attachments.find('001123', 'Diabetes', true).catch(() => { rejected = true; });
            backend.flush();
            backend.expectGET('/ws/districtcategory').respond(200, categoryList);
            attachments.find('001123', 'Diabetes');
            backend.flush();
            check(rejected, 'failed category lookup is rejected and can be retried');

            // Native metadata order is alphabetical; newest selection must use upload times.
            backend.expectGET(/\/document\/aggregates/).respond(200, { documentAggregates: { count: 6, time: 123456789 } });
            backend.expectGET(/\/document\?/).respond(200, { documents: { documentList: [
                [1, '12/31/2025 11:59 PM'], [2, '01/01/2026 12:00 AM'],
                [3, '01/01/2026 12:00 PM'], [4, '01/01/2026 12:00 PM'],
                [99, ''], [100, 'Unavailable']
            ].map(([id, uploaded]) => ({ id, name: 'Example ' + id, status: 'A',
                categories: { id: 9 }, permission: { download: true },
                changeList: { whenChangedFormatted: uploaded } })) } });
            let ordered;
            attachments.find('001123', 'Diabetes').then(result => { ordered = result.documents.map(doc => doc.id); });
            backend.flush();
            check(JSON.stringify(ordered) === '[4,3,2,1,100,99]', 'upload ordering handles years, noon, midnight, ties, and missing dates');

            const api = injector.get('prescriptionApi');
            const endpoint = '/admin/students/health/data/medicationDoseUnits.json';
            const options = Array.from({ length: 105 }, (_, i) => ({ code: 'unit' + i, displayvalue: 'Unit ' + i, uidisplayorder: 105 - i }));
            options.push({ code: ' UNIT0 ', displayvalue: 'Duplicate', uidisplayorder: 0 });
            backend.expectGET(endpoint).respond(200, options);
            let units;
            api.options().then(value => { units = value; });
            backend.flush();
            check(units.length === 105 && units[0].code === 'unit104' && units[104].code === 'unit0', 'one dose-unit request handles more than 100 options, ordering, and duplicate codes');
            for (const response of ['<html>Sign in</html>', {}, [{ code: 'mg' }]]) {
                let failed = false;
                backend.expectGET(endpoint).respond(200, response);
                api.options().catch(() => { failed = true; });
                backend.flush();
                check(failed, 'malformed dose-unit response rejects');
            }
            backend.expectGET(endpoint).respond(200, []);
            api.options().then(value => { units = value; });
            backend.flush();
            check(units.length === 0, 'empty dose-unit response remains empty');
            backend.verifyNoOutstandingExpectation();
            backend.verifyNoOutstandingRequest();

            // Isolate the directive's short-lived discovery result from the HTTP service.
            const calls = [];
            let deferNext = false, delayed;
            angular.module('attachmentReuseTest', ['cdolHealthForms']).factory('healthAttachments', ['$q', function ($q) {
                return {
                    find: (frn, category, refresh) => {
                        calls.push({ frn, category, refresh });
                        if (deferNext) { deferNext = false; delayed = $q.defer(); return delayed.promise; }
                        return $q.when({ hasMatches: true, documents: [{ id: frn, name: category, uploaded: 'Today' }] });
                    },
                    preview: () => $q.when('blob:test-preview'),
                    release: () => {}
                };
            }]);
            const ui = angular.injector(['ng', 'ngMock', 'attachmentReuseTest']);
            const scope = ui.get('$rootScope').$new();
            scope.frn = '001123'; scope.category = 'Diabetes'; scope.enabled = true;
            const element = ui.get('$compile')('<div health-parent-return="Return to school office" attachment-url="/attachments" attachment-category="{{category}}" attachment-frn="{{frn}}" attachment-enabled="enabled"></div>')(scope);
            document.body.appendChild(element[0]);
            scope.$digest();
            const picker = element.isolateScope();
            picker.loadDocuments(); scope.$digest();
            check(calls.length === 1 && picker.documents[0].id === '001123', 'opening a discovered list sends no extra request');
            picker.loadDocuments(true); scope.$digest();
            check(calls.length === 2 && calls[1].refresh === true, 'Refresh documents bypasses discovery metadata');
            scope.frn = '001456'; scope.$digest();
            picker.loadDocuments(); scope.$digest();
            check(calls.length === 3 && picker.documents[0].id === '001456', 'student change cannot reuse the previous student list');
            scope.category = 'Seizure'; scope.$digest();
            now += 30001;
            picker.loadDocuments(); scope.$digest();
            check(calls.length === 5 && picker.documents[0].name === 'Seizure', 'expired discovery result is fetched again');
            scope.enabled = false; scope.$digest();
            picker.loadDocuments(); scope.$digest();
            check(calls.length === 5 && !picker.opened && picker.documents.length === 0, 'disabled section clears the list and does not load documents');
            deferNext = true;
            scope.enabled = true; scope.$digest();
            scope.frn = '001789'; scope.$digest();
            delayed.resolve({ hasMatches: true, documents: [{ id: 'stale' }] }); scope.$digest();
            picker.loadDocuments(); scope.$digest();
            check(picker.documents[0].id === '001789', 'late discovery cannot overwrite a newer student context');
            scope.$destroy(); element.remove();

            const q = injector.get('$q');
            const rxScope = rootScope.$new();
            rxScope.vm = { loaded: true };
            const parent = document.createElement('div'), child = document.createElement('div');
            parent.className = 'cdol-health-forms'; parent.setAttribute('data-student-dcid', '123'); parent.appendChild(child);
            const rx = injector.get('$controller')('prescriptionController', {
                $scope: rxScope, $element: angular.element(child),
                prescriptionApi: { list: () => q.when([]), options: () => q.when([
                    { code: 'mg', label: '(MG) Milligrams' }, { code: 'ml', label: 'mg' }
                ]) }
            });
            rootScope.$digest();
            check(rx.unitLabel(' MG ') === '(MG) Milligrams' && rx.unitLabel('(mg) milligrams') === '(MG) Milligrams', 'unit index preserves code, legacy label, and first-match precedence');
            check(rx.unitLabel('Historical unit') === 'Historical unit', 'unknown unit remains readable');
            rxScope.$destroy();
            Date.now = originalNow;
            return results;
        });
        assert.deepEqual(errors, []);
        results.forEach(result => console.log('PASS ' + result));
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
