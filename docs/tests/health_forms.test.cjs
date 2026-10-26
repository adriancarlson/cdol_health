// Run with HEALTH_ANGULAR_TEST_DIR pointing to AngularJS 1.4.7 and angular-mocks.js.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '../../web_root/admin/students/health');
const angularDir = process.env.HEALTH_ANGULAR_TEST_DIR;
const renderedNames = process.env.HEALTH_RENDERED_NAMES === '1';
function postedName(name) {
    if (!renderedNames) return name;
    return name.replace(/^\[students\.([^\]]+)\](.+)$/i, 'EF-001123-$1.$2')
        .replace(/^\[students\](.+)$/i, 'UF-001123-$1')
        .replace(/^\[01\](.+)$/i, 'UF-001123-$1');
}
if (!angularDir) throw new Error('Set HEALTH_ANGULAR_TEST_DIR to the AngularJS 1.4.7 test runtime.');

function fixture(file) {
    return fs.readFileSync(path.join(root, file), 'utf8')
        .replace('<head>', '<head><base href="http://localhost/">')
        .replace(/~\[tlist_sql;[\s\S]*?\[\/tlist_sql\]/g, '')
        .replace(/~\[x:insertfile;[^\n]+/g, '')
        .replace(/~\[if\.[^\n]+/g, '')
        .replace(/~\[if#.*?\]/g, '')
        .replace(/\[(?:else|\/if)[^\]]*\]/g, '')
        .replace(/~\(\[students.U_STUDENT_ADDITIONAL_INFO\]MED_SIG_DATE\)/gi, '09/22/2026')
        .replace(/~\(\[students.U_STUDENT_ADDITIONAL_INFO\]MED_SIG\)/gi, 'Example Guardian')
        .replace(/~\(\[students.U_STUDENT_ADDITIONAL_INFO\]RX_COLLECTION_METHOD\)/gi, 'Return to school office')
        .replace(/~\(\[students.U_STUDENT_ADDITIONAL_INFO\][A-Z_]*COLLECTION_METHOD\)/gi, 'Return to school office')
        .replace(/~\[x:username;firstlast\]/g, 'Test Admin')
        .replace(/~\[date\]/g, '09/22/2026')
        .replace(/~\(rn\)/g, '123')
        .replace(/~\(studentfrn\)/g, '001123')
        .replace(/~\(first_name\)/g, 'Example')
        .replace(/~\(last_name\)/g, 'Student')
        .replace(/~\(schoolname\)/g, 'Example School')
        .replace(/~\[[^\]]*\]/g, '')
        .replace(/<link[^>]*>/g, '')
        .replace(/action="[^"]*"/, 'action="http://localhost/fixture.html?frn=001123&changesSaved=true"')
        .replace('value="" size="40"', 'value="Example Hospital" size="40"')
        .replace('name="[01]Doctor_Name" value=""', 'name="[01]Doctor_Name" value="Example Doctor"')
        .replace('name="[01]Doctor_Phone" value=""', 'name="[01]Doctor_Phone" value="402-555-0100"')
        .replace('id="healthCanPlaySportsYes"', 'id="healthCanPlaySportsYes" checked')
        .replace('id="healthActionPlanAlert"', 'id="healthActionPlanAlert" checked')
        .replace(/(id="healthMedicalAlert"[^>]*>)/, '$1Existing medical alert')
        .replace(/(id="healthMedicalAlertExpires"\s+name="[^"]+"\s+value=")"/, '$10/0/0"')
        .replace(/(name="\[students.U_STUDENT_ADDITIONAL_INFO\]ACETAMINOPHEN" value="1")/g, '$1 checked')
        .replace(/(name="\[students.U_STUDENT_ADDITIONAL_INFO\]MED_SHARE_CONSENT" value="1")/g, '$1 checked')
        .replace(/(name="\[students.U_STUDENT_ADDITIONAL_INFO\]MED_FIRST_AID_CONSENT" value="1")/g, '$1 checked')
        .replace(/(id="hospitalConsentValue"\s+name="[^"]+" value=")"/, '$11"')
        .replace(/~\[self.page\]/g, 'fixture.html');
}

async function checkAttachments(page, method) {
    const trigger = method.locator('.health-document-link');
    const dialog = method.locator('dialog');
    async function close() {
        if (await dialog.count()) await method.getByRole('button', { name: 'Close document', exact: true }).click();
    }
    async function load(mode, waitPreview = true) {
        await close();
        await page.evaluate(mode => { window.attachmentMode = mode; window.attachmentReads = []; }, mode);
        await trigger.click();
        await dialog.waitFor();
        await page.waitForFunction(() => !angular.element(document.querySelector('#diabetesPlanMethod')).isolateScope().loading);
        if (waitPreview) await page.waitForFunction(() => !angular.element(document.querySelector('#diabetesPlanMethod')).isolateScope().previewLoading);
    }
    assert.equal(await page.evaluate(() => window.attachmentReads.filter(url => url.includes('/content/')).length), 0, 'discovery never requests content');
    const writesBefore = await page.evaluate(() => window.testWrites.length);
    const submitsBefore = await page.evaluate(() => window.formSubmissions.length);
    const placement = await method.evaluate(el => {
        const options = el.querySelector('.health-return-unselected').getBoundingClientRect();
        const button = el.querySelector('.health-document-link').getBoundingClientRect();
        return button.left >= options.right && Math.abs(button.y - options.y) < 20;
    });
    assert.equal(placement, true, 'button is to the right of the return options');
    await load('multiple');
    assert.match(await dialog.innerText(), /Example additional plan.png/);
    assert.match(await dialog.innerText(), /Uploaded: 09\/01\/2026 01:25 PM/);
    assert.equal(await method.locator('iframe').count(), 1, 'newest upload automatically previews');
    assert.equal(await dialog.evaluate(el => el.matches(':modal')), true, 'native modal makes background inert');
    const reads = await page.evaluate(() => window.attachmentReads);
    assert.equal(reads.filter(url => url.includes('/document?')).length, 2);
    assert.equal(reads.filter(url => url.includes('/content/')).length, 1);
    assert.match(reads.find(url => url.includes('/content/')), /content\/102$/);
    reads.filter(url => url.includes('/document?') || url.includes('/aggregates')).forEach(url => {
        const query = new URL(url, 'http://localhost').searchParams;
        assert.equal(query.get('entityid'), '123');
        assert.equal(query.get('entityname'), 'STCM');
        assert.match(query.get('q'), /category==\(9\)/);
    });
    const firstUrl = await method.locator('iframe').getAttribute('src');
    assert.match(firstUrl, /^blob:/);
    const closeButton = dialog.getByRole('button', { name: 'Close document', exact: true });
    await closeButton.focus();
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => !!document.activeElement.closest('dialog')), true, 'keyboard focus stays in modal');
    await closeButton.focus();
    await page.keyboard.press('Escape');
    assert.equal(await dialog.count(), 0);
    assert.equal(await page.evaluate(url => window.revokedAttachmentUrls.includes(url), firstUrl), true);
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
    for (const mode of ['deniedContent', 'htmlContent', 'unsupportedContent', 'emptyContent']) {
        await load(mode);
        assert.equal(await method.locator('iframe').count(), 0, mode + ' does not become a preview');
        assert.match(await dialog.innerText(), /Open student attachments to/);
    }
    await load('pdfContent');
    await method.locator('iframe').waitFor();
    if (process.env.HEALTH_ATTACHMENT_SCREENSHOT) await page.screenshot({ path: process.env.HEALTH_ATTACHMENT_SCREENSHOT });
    await page.setViewportSize({ width: 390, height: 700 });
    const bounds = await dialog.boundingBox();
    assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.height <= 700, 'modal fits narrow viewport');
    await page.setViewportSize({ width: 1280, height: 720 });
    const hiddenUrl = await method.locator('iframe').getAttribute('src');
    await page.evaluate(() => {
        window.mainVm.values['[students.u_student_additional_info]diabetes'] = '0';
        angular.element(document.querySelector('.cdol-health-forms')).scope().$apply();
    });
    assert.equal(await dialog.count(), 0, 'disabling the section removes modal');
    assert.equal(await page.evaluate(url => window.revokedAttachmentUrls.includes(url), hiddenUrl), true);
    await page.evaluate(() => {
        window.mainVm.values['[students.u_student_additional_info]diabetes'] = '1';
        angular.element(document.querySelector('.cdol-health-forms')).scope().$apply();
    });
    for (const mode of ['empty', 'missingCategory', 'deniedList', 'loginResponse']) {
        await load(mode);
        // Exercise category failures without waiting for the normal 60-second cache expiry.
        await method.evaluate(el => { const scope = angular.element(el).isolateScope(); scope.$apply(() => scope.loadDocuments(true)); });
        await page.waitForFunction(() => !angular.element(document.querySelector('#diabetesPlanMethod')).isolateScope().loading);
        assert.equal(await method.locator('iframe').count(), 0);
        assert.match(await dialog.innerText(), /No available Diabetes documents|Documents could not be loaded/);
        assert.equal(await dialog.locator('.health-attachments-fallback').isVisible(), true);
    }
    await close();
    await page.evaluate(() => { window.attachmentMode = 'single'; });
    await method.evaluate(el => { const scope = angular.element(el).isolateScope(); scope.$apply(() => scope.loadDocuments(true)); });
    await method.locator('iframe').waitFor();
    await close();
    const createdBefore = await page.evaluate(() => window.createdAttachmentUrls.length);
    await load('delayedContent', false);
    await close();
    await page.waitForFunction(count => window.createdAttachmentUrls.length > count && window.createdAttachmentUrls.every(url => window.revokedAttachmentUrls.includes(url)), createdBefore);
    assert.equal(await method.locator('iframe').count(), 0);
    assert.equal(await page.evaluate(() => window.testWrites.length), writesBefore);
    assert.equal(await page.evaluate(() => window.formSubmissions.length), submitsBefore);
    console.log('PASS attachment modal: newest across pages, date/time, placement, keyboard, responsive layout, permissions, cleanup, no writes');
}

async function checkAttachmentVisibility(page, method, field, category) {
    const scenarios = [
        ['Upload', 'empty', true], ['Upload', 'single', true],
        ['Return to school office', 'empty', false], ['Return to school office', 'single', true],
        ['', 'empty', false], ['', 'single', true],
        ['Historical choice', 'empty', false], ['Historical choice', 'single', true],
        ['Return to school office', 'unrelatedOnly', false],
        ['Return to school office', 'deniedOnly', true],
        ['Return to school office', 'deniedList', false]
    ];
    if (category === 'Prescription') {
        scenarios.push(['Student does not require prescription medication to be administered at school', 'empty', false],
            ['Student does not require prescription medication to be administered at school', 'single', true]);
    }
    for (const [value, mode, visible] of scenarios) {
        await method.evaluate((element, config) => {
            const scope = angular.element(element).isolateScope();
            window.attachmentMode = config.mode; window.attachmentCategory = config.category; window.attachmentReads = [];
            const enable = value => {
                if (config.category === 'Prescription') scope.attachmentCategory = value ? 'Prescription' : '';
                else if (config.category === 'Non-Prescription') window.mainVm.loaded = value;
                else if (config.field) window.mainVm.values['[students.u_student_additional_info]' + config.field] = value ? '1' : '0';
                else window.mainVm.currentSchool = value ? '104' : '120';
            };
            scope.$apply(() => enable(false));
            scope.$apply(() => { scope.method = config.value; enable(true); });
        }, { value, mode, field, category });
        await page.waitForFunction(id => !angular.element(document.getElementById(id)).isolateScope().checkingDocuments, await method.getAttribute('id'));
        assert.equal(await method.locator('.health-document-link').count(), visible ? 1 : 0, `${category}: ${value}/${mode}`);
        assert.equal(await page.evaluate(() => window.attachmentReads.some(url => url.includes('/content/'))), false, 'discovery is metadata-only');
        if (mode === 'deniedOnly') {
            await method.locator('.health-document-link').click();
            await page.waitForFunction(id => !angular.element(document.getElementById(id)).isolateScope().loading, await method.getAttribute('id'));
            assert.equal(await method.evaluate(el => angular.element(el).isolateScope().documents.length), 0, 'matching metadata does not grant download permission');
            await method.locator('dialog').waitFor();
            assert.equal(await method.locator('.health-attachments-fallback').isVisible(), true);
        }
        if (mode === 'single' && value === 'Return to school office') {
            const readsBeforeOpen = await page.evaluate(() => window.attachmentReads.length);
            await method.locator('.health-document-link').click();
            await method.locator('iframe').waitFor();
            assert.equal(await page.evaluate(() => window.attachmentReads.filter(url => !url.includes('/content/')).length), readsBeforeOpen, 'opening reuses recent discovery metadata');
            await method.locator('iframe').waitFor();
            await method.getByRole('button', { name: 'Close document', exact: true }).click();
        }
        if (mode === 'deniedList') {
            assert.equal(await method.locator('.health-attachments-fallback').isVisible(), true, 'failed discovery retains native-page access');
            assert.match(await method.innerText(), /Document availability could not be checked/);
        }
    }
    await method.evaluate(element => {
        const scope = angular.element(element).isolateScope();
        window.attachmentMode = 'single'; window.attachmentReads = [];
        scope.$apply(() => { scope.method = 'Upload'; });
        scope.$apply(() => { scope.method = 'Return to school office'; });
    });
    await page.waitForFunction(id => !angular.element(document.getElementById(id)).isolateScope().checkingDocuments, await method.getAttribute('id'));
    console.log('PASS ' + category + ' icon: Upload OR matching category, blank/office/historical choices, no matches, permissions, lookup failure');
}

async function main() {
    const browser = await chromium.launch({ channel: 'msedge', headless: true });
    try {
        for (const [scenario, file] of ['medical_authorization.html', 'health_history.html', 'medical_authorization.html'].entries()) {
            const page = await browser.newPage();
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            // Use real XHR and synthetic bytes to exercise binary content handling.
            await page.route('http://localhost/ws/k12drive/document/content/*', async route => {
                const mode = await page.evaluate(url => { window.attachmentReads.push(url); return window.attachmentMode; }, route.request().url());
                const type = mode === 'htmlContent' ? 'text/html' : mode === 'unsupportedContent' ? 'application/msword' : mode === 'pdfContent' ? 'application/pdf' : 'image/png';
                let body = mode === 'emptyContent' || mode === 'deniedContent' ? Buffer.alloc(0) :
                    Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jX1sAAAAASUVORK5CYII=', 'base64');
                if (mode === 'pdfContent') {
                    // A synthetic one-page PDF; no student or health information.
                    const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
                        '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] >>'];
                    let pdf = '%PDF-1.4\n', offsets = [0];
                    objects.forEach((object, i) => { offsets.push(Buffer.byteLength(pdf)); pdf += `${i + 1} 0 obj\n${object}\nendobj\n`; });
                    const xref = Buffer.byteLength(pdf);
                    pdf += 'xref\n0 4\n0000000000 65535 f \n' + offsets.slice(1).map(offset => String(offset).padStart(10, '0') + ' 00000 n \n').join('');
                    body = Buffer.from(pdf + `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
                }
                await route.fulfill({ status: mode === 'deniedContent' ? 403 : 200, contentType: type,
                    headers: { 'Access-Control-Allow-Origin': '*' }, body });
            });
            await page.route('http://localhost/images/cdol_health_log/bc-document-icon.png', route => route.fulfill({ path: path.resolve(root, '../../../images/cdol_health_log/bc-document-icon.png'), contentType: 'image/png' }));
            await page.setContent(fixture(file));
            if (renderedNames) {
                // Reproduce server rendering, including native unchecked companions.
                await page.evaluate(() => {
                    document.querySelectorAll('input[name^="["], select[name^="["], textarea[name^="["]').forEach(field => {
                        const sourceName = field.name;
                        const key = sourceName.replace(/^\[01\]/, 'students.').replace(/^\[([^\]]+)\]/, '$1.').toLowerCase();
                        field.name = sourceName.replace(/^\[students\.([^\]]+)\](.+)$/i, 'EF-001123-$1.$2').replace(/^\[students\](.+)$/i, 'UF-001123-$1').replace(/^\[01\](.+)$/i, 'UF-001123-$1');
                        field.setAttribute('data-validation', JSON.stringify({ key, type: field.type === 'checkbox' || field.type === 'radio' ? 'boolean' : 'text' }));
                        if (field.type === 'checkbox') {
                            const companion = document.createElement('input');
                            companion.type = 'hidden';
                            companion.name = field.name;
                            companion.value = '';
                            field.before(companion);
                        }
                    });
                });
            }
            await page.addStyleTag({ path: path.resolve(__dirname, '../../../cdol_css/web_root/images/css/cdol.css') });
            await page.addScriptTag({ path: path.join(angularDir, 'angular.js') });
            // Angular 1.4's E2E passThrough drops responseType. Forward it to the
            // real backend so content tests use the same ArrayBuffer path as production.
            await page.addScriptTag({ content: fs.readFileSync(path.join(angularDir, 'angular-mocks.js'), 'utf8')
                .replace('function $httpBackend(method, url, data, callback, headers, timeout, withCredentials)',
                    'function $httpBackend(method, url, data, callback, headers, timeout, withCredentials, responseType)')
                .replace('$delegate(method, url, data, callback, headers, timeout, withCredentials);',
                    '$delegate(method, url, data, callback, headers, timeout, withCredentials, responseType);') });
            await page.evaluate(() => {
                angular.module('powerSchoolModule', []).config(['$provide', function ($provide) {
                    // Reproduce the installed PowerSchool decorator's no-pssValidationForm branch.
                    $provide.decorator('ngSubmitDirective', ['$delegate', function (directives) {
                        const originalCompile = directives[0].compile;
                        directives[0].compile = function () { return originalCompile; };
                        return directives;
                    }]);
                }]);
                window.dialogVisible = false;
                window.dialogOpens = 0;
                window.dialogCloses = 0;
                window.loadingDialog = () => { window.dialogVisible = true; window.dialogOpens++; };
                window.closeLoading = () => { window.dialogVisible = false; window.dialogCloses++; };
                // PowerSchool adds its automatic native loading handler to forms without this opt-out.
                document.querySelectorAll('form:not(.noSubmitLoading)').forEach(form => form.addEventListener('submit', window.loadingDialog));
                window.define = (dependencies, factory) => factory(angular);
                window.psConfirm = config => { window.pendingConfirmation = config; };
            });
            await page.addScriptTag({ path: path.join(root, 'healthForms.js') });
            await page.evaluate(startEmpty => {
                window.testWrites = [];
                window.auditFails = false;
                window.loadFails = false;
                window.ignoreSave = false;
                window.studentData = { student_dcid: '123', record_exists: 1, today: '2026-09-23',
                    med_share_consent: '1', med_first_aid_consent: '1', hospital_consent: '1', student_medication: '1',
                    acetaminophen: '1', ibuprofen: '0', antihistamine: null, antacid: '1', antibiotic: '0', hydrocortisone: '1', cough_drop: '0',
                    parent_name: 'Example Guardian', parent_date: '09/22/2026', last_updated_message: 'Last Updated by Parent: Example Guardian - 09/22/2026' };
                window.medications = [{ medication_id: '10', studentsdcid: '123', name: 'Example Medicine', dosage: '5', dosage_units: 'mg', frequency_taken: 'Daily' }];
                if (startEmpty) { window.medications = []; window.studentData.student_medication = null; }
                angular.module('healthTest', ['cdolHealthForms', 'ngMockE2E']).run(['$httpBackend', 'healthAttachments', '$timeout', function (backend, attachmentApi, $timeout) {
                    window.attachmentReads = [];
                    window.createdAttachmentUrls = [];
                    window.revokedAttachmentUrls = [];
                    const createUrl = URL.createObjectURL.bind(URL), revokeUrl = URL.revokeObjectURL.bind(URL);
                    URL.createObjectURL = blob => { const url = createUrl(blob); window.createdAttachmentUrls.push(url); return url; };
                    URL.revokeObjectURL = url => { window.revokedAttachmentUrls.push(url); revokeUrl(url); };
                    const doc = { id: 101, status: 'A', permission: { download: true }, documentLocation: 'L',
                        categories: { id: 9, name: 'Diabetes' }, name: 'Example plan.pdf',
                        changeList: { whenChangedFormatted: '09/01/2026 09:00 AM', whoChangedName: 'Example Guardian' } };
                    backend.whenGET(/\/ws\/districtcategory/).respond((m, url) => {
                        window.attachmentReads.push(url);
                        if (window.attachmentMode === 'loginResponse') return [200, '<html>Sign in</html>'];
                        return [200, { categories: window.attachmentMode === 'missingCategory' ? [] : [
                            { id: 9, name: 'Diabetes' }, { id: 10, name: 'Seizure' },
                            { id: 11, name: 'Allergy' }, { id: 12, name: 'Asthma' },
                            { id: 13, name: 'Dental' }, { id: 14, name: 'Non-Prescription' }, { id: 15, name: 'Prescription' }
                        ] }];
                    });
                    backend.whenGET(/\/ws\/k12drive\/document\/aggregates/).respond((m, url) => {
                        window.attachmentReads.push(url);
                        return [200, { documentAggregates: { count: window.attachmentMode === 'empty' ? 0 : window.attachmentMode === 'multiple' ? 101 : 1, time: 123456789 } }];
                    });
                    backend.whenGET(/\/ws\/k12drive\/document\?/).respond((m, url) => {
                        window.attachmentReads.push(url);
                        if (window.attachmentMode === 'deniedList') return [403, {}];
                        let documents = doc;
                        if (window.attachmentCategory === 'Prescription') {
                            documents = [{ ...doc, id: 601, name: 'Example prescription authorization.pdf', categories: { id: 15, name: 'Prescription' } },
                                { ...doc, id: 501, name: 'Example OTC authorization.pdf', categories: { id: 14, name: 'Non-Prescription' } }];
                        }
                        if (window.attachmentCategory === 'Non-Prescription') {
                            documents = [{ ...doc, id: 501, name: 'Example OTC authorization.pdf', categories: { id: 14, name: 'Non-Prescription' } }, doc];
                        }
                        if (window.attachmentCategory === 'Dental') {
                            documents = [{ ...doc, id: 401, name: 'Example dental report.pdf', categories: { id: 13, name: 'Dental' } }, doc];
                        }
                        if (window.attachmentCategory === 'Seizure') {
                            documents = [{ ...doc, id: 201, name: 'Example seizure plan.pdf', categories: { id: 10, name: 'Seizure' } }, doc];
                        }
                        if (window.attachmentCategory === 'Asthma/Severe Allergy') {
                            const shared = { ...doc, id: 303, name: 'Example combined plan.pdf', categories: [{ id: 11 }, { id: 12 }] };
                            documents = [{ ...doc, id: 301, name: 'Example allergy plan.pdf', categories: { id: 11 } },
                                { ...doc, id: 302, name: 'Example asthma plan.pdf', categories: { id: 12 } }, shared, shared, doc];
                        }
                        if (window.attachmentMode === 'unrelatedOnly') documents = { ...doc, categories: { id: 99, name: 'Other' } };
                        if (window.attachmentMode === 'deniedOnly') documents = { ...doc, permission: { download: false },
                            categories: { id: window.attachmentCategory === 'Prescription' ? 15 : window.attachmentCategory === 'Non-Prescription' ? 14 : window.attachmentCategory === 'Dental' ? 13 : window.attachmentCategory === 'Seizure' ? 10 : window.attachmentCategory === 'Asthma/Severe Allergy' ? 11 : 9 } };
                        if (window.attachmentMode === 'multiple') {
                            documents = new URL(url, 'http://localhost').searchParams.get('page') === '2' ?
                                [doc, { ...doc, id: 102, name: 'Example additional plan.png', categories: [doc.categories], changeList: [{ ...doc.changeList, whenChangedFormatted: '09/01/2026 01:25 PM' }] }] :
                                [doc, { ...doc, id: 103, permission: { download: false } }, { ...doc, id: 104, status: 'P' },
                                    { ...doc, id: 105, categories: { id: 10, name: 'Medical' } }, { ...doc, id: 106, documentLocation: 'R' },
                                    { ...doc, id: 107, changeList: { whoChangedName: 'PowerSchool Registration Signature' } }];
                        }
                        return [200, { documents: { documentList: documents } }];
                    });
                    backend.whenGET(/\/ws\/k12drive\/document\/content\//).passThrough();
                    // Make closure-before-response deterministic using a delayed mock service promise.
                    const nativePreview = attachmentApi.preview;
                    attachmentApi.preview = id => window.attachmentMode === 'delayedContent' ?
                        $timeout(() => {}, 150).then(() => nativePreview(id)) : nativePreview(id);
                    backend.whenGET(/medicalAuthorization\.json/).respond(() => window.loadFails ? [200, '<html>Sign in</html>'] : [200, [window.studentData]]);
                    ['POST', 'PUT'].forEach(method => backend.when(method, /\/ws\/schema\/table\/u_student_additional_info/).respond((m, url, body) => {
                        window.testWrites.push({ method: m, url, body });
                        if (window.auditFails) return [200, { result: [{ error_message: 'Permission denied' }] }];
                        const values = JSON.parse(body).tables.u_student_additional_info;
                        if (!window.ignoreSave) {
                            Object.entries(values).forEach(([key, value]) => {
                                window.studentData[key] = value === 'true' ? '1' : value === 'false' ? '0' : value;
                            });
                            Object.assign(window.studentData, { record_exists: 1, audit_name: values.med_last_updated_by,
                                audit_user_type: values.med_last_updated_user_type, audit_date: values.med_last_updated_date,
                                last_updated_message: 'Last Updated by Admin: Test Admin - 09/23/2026' });
                        }
                        return [200, { result: [{ status: 'SUCCESS' }] }];
                    }));
                    backend.whenPOST(/\/ws\/schema\/query\//).respond(() => [200, window.medicationResponseOverride || (window.medications.length ?
                        { record: window.medications } : { name: 'students', '@extensions': 'u_student_additional_info' })]);
                    backend.whenGET(/medicationDoseUnits\.json/).respond(200, [
                        { code: 'mg', displayvalue: '(MG) Milligrams', uidisplayorder: 1 },
                        { code: 'ml', displayvalue: '(ML) Milliliters', uidisplayorder: 2 }
                    ]);
                    ['POST', 'PUT', 'DELETE'].forEach(method => backend.when(method, /\/ws\/schema\/table\/u_fb_medications/).respond((m, url, body) => {
                        window.testWrites.push({ method: m, url, body });
                        if (m === 'DELETE') window.medications = [];
                        else if (m === 'PUT') Object.assign(window.medications[0], JSON.parse(body).tables.u_fb_medications);
                        else window.medications.push(Object.assign({ medication_id: '11' }, JSON.parse(body).tables.u_fb_medications));
                        return [200, { result: [{ status: 'SUCCESS' }] }];
                    }));
                    backend.whenPOST(/healthAuditSaved/).respond((m, url, body) => {
                        window.testWrites.push({ method: m, url, body });
                        return [200, window.auditFails ? '<html>Sign in</html>' : '<span id="healthAuditReceipt" data-type="Admin" data-user="Test Admin" data-date="09/22/2026"></span>'];
                    });
                }]);
                angular.bootstrap(document.querySelector('.cdol-health-forms'), ['healthTest']);
                window.mainVm = angular.element(document.querySelector('.cdol-health-forms')).scope().vm;
                window.initialLoadingState = {
                    hidden: document.querySelector('.cdol-health-forms').classList.contains('ng-hide'),
                    dialog: window.dialogVisible
                };
                window.formSubmissions = [];
                document.querySelector('form').addEventListener('submit', event => {
                    window.formSubmissions.push({ prevented: event.defaultPrevented, values: Array.from(new FormData(event.target)) });
                    event.preventDefault();
                });
            }, scenario === 2);
            assert.equal(await page.evaluate(() => angular.version.full), '1.4.7');
            await page.waitForFunction(() => !window.mainVm.medicationBlocked);
            assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false, 'initial values are pristine');
            if (file === 'medical_authorization.html') await page.waitForFunction(() => window.mainVm.loaded && !window.mainVm.busy);
            if (file === 'medical_authorization.html' && scenario === 0) {
                const otcBlock = page.locator('#otcMedicationSection .health-otc-document');
                const otcMethod = otcBlock.locator('#otcAuthorizationMethod');
                assert.equal(await otcBlock.evaluate(el => el.previousElementSibling.classList.contains('otc-medications')), true, 'authorization follows the OTC medication grid');
                assert.equal(await otcBlock.locator('p').innerText(), "Parent/Guardian is responsible for submitting Example's Over-the-Counter (OTC) Medication Authorization Form to Example School annually by the end of the first week of school. This form authorizes school staff to administer OTC medication according to the directions on the original bottle or container.");
                assert.equal(await otcBlock.locator('mark').innerText(), 'by the end of the first week of school.');
                assert.equal(await otcMethod.locator('.health-return-value').innerText(), 'Return to school office');
                assert.equal(await otcMethod.locator('input').count(), 0, 'OTC return choice is display-only');
                const before = await page.evaluate(() => ({ writes: window.testWrites.length, submits: window.formSubmissions.length }));
                await checkAttachmentVisibility(page, otcMethod, null, 'Non-Prescription');
                await otcMethod.getByRole('button', { name: 'View Non-Prescription documents' }).click();
                await otcMethod.locator('.health-attachment-details strong').filter({ hasText: 'Example OTC authorization.pdf' }).waitFor();
                assert.equal(await otcMethod.evaluate(el => angular.element(el).isolateScope().documents.length), 1, 'OTC picker excludes unrelated categories');
                assert.equal(await page.evaluate(() => window.attachmentReads.filter(url => (url.includes('/document?') || url.includes('/aggregates'))).every(url =>
                    new URL(url, 'http://localhost').searchParams.get('q').includes('category==(14)'))), true);

                await otcMethod.locator('iframe').waitFor();
                const preview = await otcMethod.locator('iframe').getAttribute('src');
                await otcMethod.getByRole('button', { name: 'Close document', exact: true }).click();
                assert.equal(await page.evaluate(url => window.revokedAttachmentUrls.includes(url), preview), true);
                assert.deepEqual(await page.evaluate(() => ({ writes: window.testWrites.length, submits: window.formSubmissions.length })), before, 'OTC document access never saves the form');
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false);
            }
            if (file === 'medical_authorization.html' && scenario === 0) {
                const block = page.locator('#prescriptionMedicationSection .health-prescription-document');
                const method = block.locator('#prescriptionAuthorizationMethod');
                assert.equal(await page.locator('.health-prescription-card #addPrescriptionMedicationButton').count(), 1);
                assert.equal(await page.locator('.health-prescription-card #prescriptionMedicationsTable').count(), 1);
                assert.equal(await block.evaluate(el => Boolean(el.previousElementSibling.querySelector('.health-prescription-card'))), true);
                assert.equal(await page.locator('.health-prescription-card p').count(), 0, 'instructions sit outside the medication card');
                assert.equal(await block.locator('p').innerText(), "Parent/Guardian is responsible for submitting Example's diocesan-approved Prescription Medication Authorization Form to Example School annually by the end of the first week of school if Example requires prescription medication to be administered at school. This form authorizes school staff to administer prescription medication according to the health care provider’s orders.");
                assert.equal(await block.locator('em').innerText(), 'if Example requires prescription medication to be administered at school.');
                assert.equal(await block.locator('p a').getAttribute('href'), 'https://cdolinc.sharepoint.com/:b:/s/EnrollmentFiles/IQCmGhLAp31YQpsIqD6L3xZlAVLBs9GuI5elHdrD4fvi0Io?e=MfKczj');
                const choices = ['Upload', 'Return to school office', 'Student does not require prescription medication to be administered at school'];
                for (const choice of choices) {
                    await method.evaluate((el, value) => {
                        const scope = angular.element(el).isolateScope();
                        scope.$apply(() => { scope.method = value; });
                    }, choice);
                    assert.equal(await method.locator('.health-return-value').innerText(), choice);
                    assert.deepEqual(await method.locator('.health-return-unselected').allTextContents(), choices.filter(value => value !== choice));
                }
                assert.equal(await method.locator('input').count(), 0);
                const before = await page.evaluate(() => ({ writes: window.testWrites.length, submits: window.formSubmissions.length }));
                await checkAttachmentVisibility(page, method, null, 'Prescription');
                await method.getByRole('button', { name: 'View Prescription documents' }).click();
                await method.locator('.health-attachment-details strong').filter({ hasText: 'Example prescription authorization.pdf' }).waitFor();
                assert.equal(await method.evaluate(el => angular.element(el).isolateScope().documents.length), 1, 'Prescription category excludes OTC files');
                assert.equal(await page.evaluate(() => window.attachmentReads.filter(url => (url.includes('/document?') || url.includes('/aggregates'))).every(url =>
                    new URL(url, 'http://localhost').searchParams.get('q').includes('category==(15)'))), true);

                await method.locator('iframe').waitFor();
                const preview = await method.locator('iframe').getAttribute('src');
                await method.getByRole('button', { name: 'Close document', exact: true }).click();
                assert.equal(await page.evaluate(url => window.revokedAttachmentUrls.includes(url), preview), true);
                assert.deepEqual(await page.evaluate(() => ({ writes: window.testWrites.length, submits: window.formSubmissions.length })), before);
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false);
            }
            if (file === 'medical_authorization.html') {
                assert.deepEqual(await page.evaluate(() => window.initialLoadingState), { hidden: true, dialog: true }, 'hide sections while native loading dialog is open');
                assert.equal(await page.locator('.cdol-health-forms').isVisible(), true);
                assert.equal(await page.evaluate(() => window.dialogVisible), false);
                assert.equal(await page.getByText('Loading or saving medical authorizations...', { exact: true }).count(), 0);
                assert.equal(await page.getByText('Loading prescription medications...', { exact: true }).count(), 0);
                for (const name of [null, '', '   ', 'null']) {
                    await page.evaluate(name => {
                        const scope = angular.element(document.querySelector('.cdol-health-forms')).scope();
                        scope.$apply(() => { scope.vm.record.parent_name = name; });
                    }, name);
                    assert.equal(await page.locator('#parentGuardianSignatureSection').count(), 0);
                }
                await page.evaluate(() => {
                    const scope = angular.element(document.querySelector('.cdol-health-forms')).scope();
                    scope.$apply(() => { scope.vm.record.parent_name = 'Example Guardian'; });
                });
                assert.equal(await page.locator('#parentGuardianSignatureSection').isVisible(), true);
                assert.equal(await page.evaluate(() => {
                    const form = document.querySelector('#medicalForm');
                    const submit = form.querySelector('button[type="submit"]');
                    const signature = document.querySelector('#parentGuardianSignatureSection');
                    const add = document.querySelector('#addPrescriptionMedicationButton');
                    const table = document.querySelector('#prescriptionMedicationsTable');
                    return form.contains(document.querySelector('input[name="student_medication"]')) &&
                        Boolean(signature.compareDocumentPosition(submit) & Node.DOCUMENT_POSITION_FOLLOWING) &&
                        !add.closest('.medical-section-banner') &&
                        Boolean(add.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING);
                }), true, 'question belongs to main form; Add is above the table; Submit follows all sections');
            }
            if (scenario === 2) {
                assert.equal(await page.locator('#prescriptionMedicationsTable').isVisible(), false, 'blank answer hides the table');
                assert.equal(await page.locator('.health-prescription-document').isVisible(), true, 'saved return method remains available without prescription rows');
                assert.equal(await page.locator('#addPrescriptionMedicationButton').isVisible(), false);
                assert.equal(await page.locator('input[name="student_medication"]:checked').count(), 0);
                await page.evaluate(() => {
                    window.studentData.student_medication = '0';
                    angular.element(document.querySelector('.cdol-health-forms')).scope().$apply(() => window.mainVm.load());
                });
                await page.waitForFunction(() => window.mainVm.loaded && !window.mainVm.busy);
                assert.equal(await page.locator('input[name="student_medication"][value="0"]').isChecked(), true);
                assert.equal(await page.locator('#prescriptionMedicationsTable').isVisible(), false, 'saved No hides the table');
                await page.locator('input[name="student_medication"][value="1"]').check();
                assert.equal(await page.getByText('No Prescription Medications for Example Student.', { exact: true }).isVisible(), true);
                assert.equal(await page.locator('#prescriptionMedicationFeedback').count(), 0, 'empty response is not a load error');
                assert.equal(await page.locator('#addPrescriptionMedicationButton').isEnabled(), true);
                await page.locator('#addPrescriptionMedicationButton').click();
                const row = page.locator('tr.prescription-medication-editing');
                await row.getByLabel('Medication Name', { exact: true }).fill('First Example Medicine');
                await row.getByLabel('Dosage', { exact: true }).fill('5');
                await row.getByLabel('Dosage Units', { exact: true }).selectOption({ label: '(MG) Milligrams' });
                await row.getByLabel('Frequency Taken', { exact: true }).fill('Daily');
                await row.getByRole('button', { name: 'Submit', exact: true }).click();
                await page.waitForFunction(() => window.testWrites.length === 2 && !window.mainVm.medicationBlocked);
                assert.equal(await page.getByText('First Example Medicine', { exact: true }).isVisible(), true);
                assert.equal(await page.evaluate(() => window.testWrites[0].method), 'POST');
                assert.equal(await page.evaluate(() => JSON.parse(window.testWrites[0].body).tables.u_fb_medications.studentsdcid), '123');
                assert.equal(await page.locator('#addPrescriptionMedicationButton').isEnabled(), true);
                assert.equal(await page.evaluate(() => window.mainVm.appData.student_medication), '1', 'medication audit preserves the unsaved Yes answer');
                await page.locator('form button[type="submit"]').click();
                await page.waitForFunction(() => !window.mainVm.busy && !window.mainVm.hasChanges());
                assert.equal(await page.evaluate(() => JSON.parse(window.testWrites[2].body).tables.u_student_additional_info.student_medication), 'true');
                await page.locator('input[name="student_medication"][value="0"]').check();
                await page.locator('form button[type="submit"]').click();
                await page.waitForFunction(() => !window.mainVm.busy && !window.mainVm.hasChanges());
                assert.equal(await page.evaluate(() => JSON.parse(window.testWrites[3].body).tables.u_student_additional_info.student_medication), 'false');
                assert.equal(await page.locator('#prescriptionMedicationsTable').isVisible(), false);
                assert.equal(await page.evaluate(() => window.medications.length), 1, 'No preserves saved medication records');
                assert.equal(await page.evaluate(() => window.testWrites.some(write => write.method === 'DELETE')), false);
                await page.evaluate(() => angular.element(document.querySelector('.cdol-health-forms')).scope().$apply(() => window.mainVm.load()));
                await page.waitForFunction(() => window.mainVm.loaded && !window.mainVm.busy);
                assert.equal(await page.locator('input[name="student_medication"][value="1"]').isChecked(), true, 'existing medication overrides saved No on loading');
                assert.equal(await page.locator('#prescriptionMedicationsTable').isVisible(), true);
                assert.equal(await page.evaluate(() => window.mainVm.original.student_medication), '0', 'saved baseline is preserved for change tracking');
                assert.equal(await page.evaluate(() => window.testWrites.length), 4, 'loading performs no automatic save');
                await page.locator('form button[type="submit"]').click();
                await page.waitForFunction(() => !window.mainVm.busy && !window.mainVm.hasChanges());
                assert.equal(await page.evaluate(() => JSON.parse(window.testWrites[4].body).tables.u_student_additional_info.student_medication), 'true');
                const defaultCases = await page.evaluate(() => {
                    const injector = angular.element(document.querySelector('.cdol-health-forms')).injector();
                    const $q = injector.get('$q'), $controller = injector.get('$controller'), $rootScope = injector.get('$rootScope');
                    const results = [];
                    for (const rowsFirst of [true, false]) {
                        for (const saved of ['0', '', '1']) {
                            for (const rows of [[{ studentsdcid: '123', medication_id: '99' }], [], [{ studentsdcid: '999', medication_id: '98' }], null]) {
                                const scope = $rootScope.$new();
                                const root = document.createElement('div'), child = document.createElement('div');
                                root.className = 'cdol-health-forms'; root.setAttribute('data-student-dcid', '123'); root.appendChild(child);
                                const authorization = $q.defer(), medications = $q.defer();
                                const vm = $controller('medicalAuthorizationController', { $scope: scope, $element: angular.element(root),
                                    medicalAuthorizationApi: { fields: ['student_medication'], load: () => authorization.promise } });
                                scope.vm = vm;
                                $controller('prescriptionController', { $scope: scope.$new(), $element: angular.element(child),
                                    prescriptionApi: { list: () => medications.promise, options: () => $q.when([{ code: 'mg' }]) } });
                                const loadAuthorization = () => { authorization.resolve({ record: {}, values: { student_medication: saved } }); $rootScope.$digest(); };
                                const loadRows = () => { if (rows) medications.resolve(rows); else medications.reject(new Error('Unavailable')); $rootScope.$digest(); };
                                if (rowsFirst) { loadRows(); loadAuthorization(); } else { loadAuthorization(); loadRows(); }
                                results.push({ rowsFirst, saved, ownRows: Boolean(rows && rows.some(row => row.studentsdcid === '123')),
                                    answer: vm.appData.student_medication, original: vm.original.student_medication, changed: vm.hasChanges() });
                                scope.$destroy();
                            }
                        }
                    }
                    return results;
                });
                for (const result of defaultCases) {
                    assert.equal(result.answer, result.ownRows ? '1' : result.saved, JSON.stringify(result));
                    assert.equal(result.original, result.saved);
                    assert.equal(result.changed, result.ownRows && result.saved !== '1');
                }
                // A malformed/error envelope must still reject instead of permitting writes.
                for (const response of ['<html>Sign in</html>', {}, { name: 'students', '@extensions': '', error_message: 'Permission denied' }]) {
                    assert.equal(await page.evaluate(async response => {
                        window.medicationResponseOverride = response;
                        const element = angular.element(document.querySelector('.cdol-health-forms'));
                        const api = element.injector().get('prescriptionApi');
                        return new Promise(resolve => element.scope().$apply(() => {
                            api.list('123').then(() => resolve(false), () => resolve(true));
                        }));
                    }, response), true);
                }
                assert.deepEqual(errors, []);
                assert.equal(await page.evaluate(() => window.dialogVisible), false);
                assert.equal(await page.evaluate(() => window.dialogOpens === window.dialogCloses), true);
                console.log('PASS prescription question: blank/No/Yes visibility, Boolean saves, preserved medication records, first medication creation, audit, malformed-response rejection');
                await page.close();
                continue;
            }
            if (file === 'health_history.html') {
                assert.equal(await page.locator('.health-alerts + section #sportsParticipationHeading').count(), 1);
                assert.equal(await page.locator('#healthAllergies').count(), 1, 'only one allergy input is submitted');
                assert.equal(await page.locator('#healthMedicalAlert').inputValue(), 'Existing medical alert');
                assert.equal(await page.locator('#healthMedicalAlertExpires').inputValue(), '0/0/0');
                assert.equal(await page.locator('#healthActionPlanAlert').isChecked(), true, 'saved checked alert initializes');
                assert.equal(await page.locator('#healthConcussionAlert').isChecked(), false);
                for (const [id, key, initial] of [
                    ['healthActionPlanAlert', 'ihp_alert', '1'],
                    ['healthConcussionAlert', 'concussion_alert', '0']
                ]) {
                    const checkbox = page.locator('#' + id);
                    await checkbox.setChecked(initial !== '1');
                    assert.equal(await page.evaluate(key => window.mainVm.answer(key), key), initial === '1' ? '0' : '1');
                    assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), true);
                    await checkbox.setChecked(initial === '1');
                    assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false, 'reverted alert checkbox does not stamp an audit');
                }
                await page.locator('#healthMedicalAlert').fill('Changed medical alert');
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), true);
                await page.locator('#healthMedicalAlert').fill('Existing medical alert');
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false);
                assert.equal(await page.locator('#healthDoctorName').inputValue(), 'Example Doctor');
                await page.locator('#healthDoctorName').fill('New Doctor');
                assert.equal(await page.evaluate(() => window.mainVm.form.$dirty), true);
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), true);
                await page.locator('#healthDoctorName').fill('Example Doctor');
                assert.equal(await page.evaluate(() => window.mainVm.form.$dirty), true);
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false, 'reverted edit is not a data change');
                const setDaycareSchool = async school => page.evaluate(school => {
                    window.mainVm.formSchool = school;
                    angular.element(document.querySelector('.cdol-health-forms')).scope().$apply();
                }, school);
                await setDaycareSchool('110');
                assert.equal(await page.locator('#healthDaycareCard').isVisible(), true);
                await page.locator('#healthDaycareProvider').fill('Example Daycare');
                await page.locator('#healthDaycarePhone').fill('402-555-0123');
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), true);
                assert.equal(await page.evaluate(name => new FormData(document.querySelector('form')).get(name), postedName('[students.U_STUDENT_ADDITIONAL_INFO]STUDENT_DAYCARE')), 'Example Daycare');
                assert.equal(await page.evaluate(name => new FormData(document.querySelector('form')).get(name), postedName('[students.U_STUDENT_ADDITIONAL_INFO]STUDENT_DAYCARE_PHONE')), '402-555-0123');
                for (const school of ['101', '999', '']) {
                    await setDaycareSchool(school);
                    assert.equal(await page.locator('#healthDaycareCard').isVisible(), false);
                    assert.equal(await page.locator('.health-contact-column:visible').count(), 2);
                    for (const [id, field] of [['healthDaycareProvider', 'STUDENT_DAYCARE'], ['healthDaycarePhone', 'STUDENT_DAYCARE_PHONE']]) {
                        assert.equal(await page.locator('#' + id).isDisabled(), true);
                        assert.equal(await page.evaluate(name => new FormData(document.querySelector('form')).has(name), postedName('[students.U_STUDENT_ADDITIONAL_INFO]' + field)), false);
                    }
                    assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false, 'hidden daycare edits do not cause an audit');
                }
                for (const width of [1200, 480]) {
                    await page.setViewportSize({ width, height: 900 });
                    const cards = await page.locator('.health-contact-column:visible').evaluateAll(cards => cards.map(card => {
                        const rect = card.getBoundingClientRect();
                        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, radius: getComputedStyle(card).borderBottomRightRadius };
                    }));
                    assert.ok(Math.abs(width > 900 ? cards[0].right - cards[1].left : cards[0].bottom - cards[1].top) < 1, 'remaining cards stay joined');
                    assert.equal(cards[1].radius, '10px', 'Dentist retains the rounded outer edge');
                }
                await page.setViewportSize({ width: 1280, height: 720 });
                await setDaycareSchool('110');
                assert.equal(await page.locator('#healthDaycareProvider').inputValue(), 'Example Daycare');
                assert.equal(await page.locator('#healthDaycarePhone').inputValue(), '402-555-0123');
                await page.locator('#healthDaycareProvider').fill('');
                await page.locator('#healthDaycarePhone').fill('');
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false);
                const sports = value => page.locator('input[name="' + postedName('[students.U_STUDENT_ADDITIONAL_INFO]CAN_PLAY_SPORTS') + '"][value="' + value + '"]');
                assert.equal(await sports('1').isChecked(), true);
                assert.equal(await page.locator('#healthSportsAccommodations').isVisible(), false);
                assert.equal(await page.locator('#healthSportsAccommodations').isDisabled(), true);
                assert.equal(await page.locator('#healthUnapprovedActivities').isVisible(), false);
                await sports('Yes - With Accommodations').check();
                assert.equal(await page.locator('#healthSportsAccommodations').isVisible(), true);
                assert.equal(await page.locator('#healthUnapprovedActivities').isVisible(), true);
                await page.locator('#healthSportsAccommodations').fill('Rest breaks');
                await page.locator('#healthUnapprovedActivities').fill('Physical Education');
                await sports('0').check();
                assert.equal(await page.locator('#healthSportsAccommodations').isVisible(), false);
                assert.equal(await page.locator('#healthUnapprovedActivities').isVisible(), true);
                assert.equal(await page.evaluate(name => new FormData(document.querySelector('form')).get(name), postedName('[students.U_STUDENT_ADDITIONAL_INFO]CAN_PLAY_SPORTS')), '0');
                assert.equal(await page.evaluate(name => new FormData(document.querySelector('form')).get(name), postedName('[Students.U_STUDENT_ADDITIONAL_INFO]UNAPPROVED_ACTIVITES')), 'Physical Education');
                await sports('1').check();
                assert.equal(await page.locator('#healthUnapprovedActivities').isVisible(), false);
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false, 'hidden dependent edits do not cause a false audit');
                assert.equal(await page.evaluate(name => new FormData(document.querySelector('form')).has(name), postedName('[Students.U_STUDENT_ADDITIONAL_INFO]SPORTS_ACCOMODATIONS')), false);
                assert.equal(await page.evaluate(name => new FormData(document.querySelector('form')).has(name), postedName('[Students.U_STUDENT_ADDITIONAL_INFO]UNAPPROVED_ACTIVITES')), false);
                await sports('Yes - With Accommodations').check();
                assert.equal(await page.locator('#healthSportsAccommodations').inputValue(), 'Rest breaks', 'hidden values are preserved');
                assert.equal(await page.locator('#healthUnapprovedActivities').inputValue(), 'Physical Education');
                assert.equal(await page.evaluate(name => new FormData(document.querySelector('form')).get(name), postedName('[students.U_STUDENT_ADDITIONAL_INFO]CAN_PLAY_SPORTS')), 'Yes - With Accommodations');
                await sports('1').check();
                const setQuestion = async (name, value) => page.locator('input[name="' + postedName('[students.U_STUDENT_ADDITIONAL_INFO]' + name) + '"][value="' + value + '"]').check();
                const dentalSection = page.locator('.health-dental');
                assert.equal(await dentalSection.count(), 1);
                assert.equal(await dentalSection.evaluate(el => el.nextElementSibling.classList.contains('health-alerts')), true);
                await page.evaluate(() => {
                    window.mainVm.currentSchool = '120'; window.mainVm.formSchool = '104';
                    angular.element(document.querySelector('.cdol-health-forms')).scope().$apply();
                });
                assert.equal(await dentalSection.isVisible(), true);
                assert.equal(await page.locator('#dentalAgreementHeading').isVisible(), true);
                assert.equal(await page.locator('#dentalPlanHeading').isVisible(), false);
                assert.match(await dentalSection.locator('.consent-option').innerText(), /Parent\/Guardian confirms that Example is under the care of a dentist and is being seen at least annually/);
                await page.locator('#healthDentalAgree').check();
                assert.equal(await page.evaluate(() => window.mainVm.answer('dental_agree')), '1');
                assert.equal(await page.evaluate(name => new FormData(document.querySelector('form')).getAll(name).includes('1'), postedName('[students.U_STUDENT_ADDITIONAL_INFO]DENTAL_AGREE')), true);
                await page.locator('#healthDentalAgree').uncheck();
                assert.equal(await page.evaluate(() => window.mainVm.answer('dental_agree')), '0');
                await page.locator('#healthDentalAgree').check();
                await page.evaluate(() => { window.mainVm.currentSchool = '104'; angular.element(document.querySelector('.cdol-health-forms')).scope().$apply(); });
                assert.equal(await page.locator('#dentalPlanHeading').isVisible(), true);
                const dentalMethod = page.locator('#dentalPlanMethod');
                assert.match(await page.locator('#dentalPlanInstructions').innerText(), /Parent\/Guardian is responsible for submitting an updated Report of Dental Examination for Example annually by the end of the first week of school\./);
                assert.equal(await page.locator('#dentalPlanInstructions mark').innerText(), 'by the end of the first week of school.');
                assert.equal(await dentalMethod.locator('input').count(), 0, 'saved dental return method is display-only');
                await checkAttachmentVisibility(page, dentalMethod, null, 'Dental');
                await dentalMethod.getByRole('button', { name: 'View Dental documents' }).click();
                await dentalMethod.locator('.health-attachment-details strong').filter({ hasText: 'Example dental report.pdf' }).waitFor();
                assert.equal(await dentalMethod.evaluate(el => angular.element(el).isolateScope().documents.length), 1, 'Dental picker excludes other categories');
                assert.equal(await page.evaluate(() => window.attachmentReads.filter(url => (url.includes('/document?') || url.includes('/aggregates'))).every(url =>
                    new URL(url, 'http://localhost').searchParams.get('q').includes('category==(13)'))), true);

                await dentalMethod.locator('iframe').waitFor();
                const dentalPreviewUrl = await dentalMethod.locator('iframe').getAttribute('src');
                assert.equal(await page.locator('#healthDentalAgree').isVisible(), false);
                assert.equal(await page.locator('#healthDentalAgree').isDisabled(), true);
                assert.equal(await page.evaluate(name => new FormData(document.querySelector('form')).has(name), postedName('[students.U_STUDENT_ADDITIONAL_INFO]DENTAL_AGREE')), false, 'hidden dental agreement never posts');
                await page.evaluate(() => { window.mainVm.currentSchool = '999'; window.mainVm.formSchool = '120'; angular.element(document.querySelector('.cdol-health-forms')).scope().$apply(); });
                assert.equal(await dentalSection.isVisible(), false, 'uses current SchoolID instead of enrollment workflow school');
                assert.equal(await dentalMethod.locator('iframe').count(), 0, 'leaving school 104 closes the dental preview');
                assert.equal(await page.evaluate(url => window.revokedAttachmentUrls.includes(url), dentalPreviewUrl), true);
                await page.evaluate(() => { window.attachmentCategory = 'Diabetes'; window.attachmentReads = []; });
                await page.evaluate(() => { window.mainVm.currentSchool = '120'; angular.element(document.querySelector('.cdol-health-forms')).scope().$apply(); });
                assert.equal(await page.locator('#healthDentalAgree').isChecked(), true, 'hidden value remains preserved');
                await page.locator('#healthDentalAgree').uncheck();
                await page.evaluate(() => { window.mainVm.formSchool = '311'; angular.element(document.querySelector('.cdol-health-forms')).scope().$apply(); });
                await setQuestion('ASTHMA', '1');
                assert.equal(await page.evaluate(() => window.mainVm.show('asthmaAllergyPlan')), false);
                assert.equal(await page.locator('#actionPlanHeading').isVisible(), false, 'Asthma alone does not show Action Plan');
                await setQuestion('INHALER', '1');
                assert.equal(await page.evaluate(() => window.mainVm.show('asthmaAllergyPlan')), true);
                assert.equal(await page.evaluate(() => window.mainVm.show('inhalerContract')), true);
                const asthmaMethod = page.locator('.health-action-plan #asthmaAllergyPlanMethod');
                assert.equal(await page.locator('#asthmaAllergyPlanHeading').count(), 0, 'old standalone plan is replaced');
                assert.equal(await asthmaMethod.count(), 1);
                assert.equal(await asthmaMethod.isVisible(), true);
                assert.equal(await page.locator('#actionPlanHeading').isVisible(), true);
                const asthmaInstructions = page.locator('#asthmaAllergyActionPlanInstructions');
                assert.match(await asthmaInstructions.innerText(), /Example's Asthma\/Severe Allergy Action Plan to Example School using\s+Example's health care provider’s form/);
                assert.match(await asthmaInstructions.innerText(), /An updated plan from Example's doctor/);
                assert.equal(await asthmaInstructions.locator('sup').innerText(), 'st');
                assert.equal(await asthmaInstructions.locator('u').innerText(), "Example's health care provider’s form");
                assert.equal(await asthmaInstructions.locator('mark').innerText(), 'by the end of the first week of school.');
                await checkAttachmentVisibility(page, asthmaMethod, 'inhaler', 'Asthma/Severe Allergy');
                await asthmaMethod.locator('.health-document-link').click();
                await page.waitForFunction(() => !angular.element(document.querySelector('#asthmaAllergyPlanMethod')).isolateScope().loading);
                assert.equal(await asthmaMethod.evaluate(el => angular.element(el).isolateScope().documents.length), 3, 'either category qualifies and duplicate IDs appear once');
                assert.equal(await page.evaluate(() => window.attachmentReads.filter(url => (url.includes('/document?') || url.includes('/aggregates'))).every(url =>
                    new URL(url, 'http://localhost').searchParams.get('q').includes('category==(11,12)'))), true);
                await asthmaMethod.getByRole('button', { name: 'Close document', exact: true }).click();
                await setQuestion('EPIPEN', '1');
                assert.equal(await page.locator('#asthmaAllergyPlanMethod').count(), 1, 'both Yes share one return method');
                await setQuestion('INHALER', '0');
                await setQuestion('EPIPEN', '1');
                assert.equal(await page.evaluate(() => window.mainVm.show('asthmaAllergyPlan')), true);
                assert.equal(await page.evaluate(() => window.mainVm.show('inhalerContract')), false);
                assert.equal(await asthmaMethod.isVisible(), true, 'EpiPen alone shows the shared plan');
                await setQuestion('EPIPEN', '0');
                assert.equal(await asthmaMethod.isVisible(), false);
                assert.equal(await page.locator('#actionPlanHeading').isVisible(), false);
                await page.evaluate(() => { window.attachmentCategory = 'Diabetes'; window.attachmentReads = []; });
                await setQuestion('SEIZURE_AGREE', '1');
                assert.equal(await page.locator('#actionPlanHeading').isVisible(), true, 'seizures show Action Plan');
                assert.equal(await page.locator('#diabetesActionPlanInstructions').isVisible(), false, 'seizures alone do not show DMMP instructions');
                assert.equal(await page.locator('#diabetesPlanMethod').isVisible(), false, 'seizures alone do not show the diabetes return method');
                const seizureMethod = page.locator('.health-action-plan #seizurePlanMethod');
                assert.equal(await seizureMethod.count(), 1, 'seizure return method appears once');
                assert.equal(await seizureMethod.isVisible(), true);
                await checkAttachmentVisibility(page, seizureMethod, 'seizure_agree', 'Seizure');
                assert.equal(await page.locator('#seizurePlanHeading').count(), 0, 'the previous school-limited seizure section is removed');
                const seizureInstructions = await page.locator('#seizureActionPlanInstructions').innerText();
                assert.match(seizureInstructions, /Example's Seizure Action Plan to Example School using\s+Example's health care provider’s form/);
                assert.match(seizureInstructions, /An updated plan from Example's doctor,\s+dated after May 1/);
                assert.equal(await page.locator('#seizureActionPlanInstructions u').innerText(), "Example's health care provider’s form");
                assert.equal(await page.locator('#seizureActionPlanInstructions mark').innerText(), 'by the end of the first week of school.');
                await seizureMethod.evaluate(element => angular.element(element).isolateScope().$apply(function () {
                    angular.element(element).isolateScope().method = 'Upload';
                }));
                await page.evaluate(() => { window.attachmentCategory = 'Seizure'; window.attachmentMode = 'single'; window.attachmentReads = []; });
                await seizureMethod.getByRole('button', { name: 'View Seizure documents' }).click();
                await seizureMethod.locator('.health-attachment-details strong').filter({ hasText: 'Example seizure plan.pdf' }).waitFor();
                assert.equal(await seizureMethod.evaluate(el => angular.element(el).isolateScope().documents.length), 1, 'seizure picker excludes Diabetes documents');
                assert.equal(await page.evaluate(() => window.attachmentReads.filter(url => (url.includes('/document?') || url.includes('/aggregates'))).every(url =>
                    new URL(url, 'http://localhost').searchParams.get('q').includes('category==(10)'))), true);

                await seizureMethod.locator('iframe').waitFor();
                const seizurePreviewUrl = await seizureMethod.locator('iframe').getAttribute('src');
                await seizureMethod.getByRole('button', { name: 'Close document', exact: true }).click();
                await setQuestion('DIABETES', '1');
                assert.equal(await page.locator('#diabetesPlanMethod').isVisible(), true, 'both plans can appear together');
                assert.equal(await seizureMethod.isVisible(), true);
                await setQuestion('DIABETES', '0');
                await page.evaluate(() => { window.mainVm.formSchool = '130'; angular.element(document.querySelector('.cdol-health-forms')).scope().$apply(); });
                assert.equal(await seizureMethod.isVisible(), true);
                await setQuestion('SEIZURE_AGREE', '0');
                assert.equal(await seizureMethod.isVisible(), false);
                assert.equal(await seizureMethod.locator('iframe').count(), 0);
                assert.equal(await page.evaluate(url => window.revokedAttachmentUrls.includes(url), seizurePreviewUrl), true);
                await seizureMethod.evaluate(element => angular.element(element).isolateScope().$apply(function () {
                    angular.element(element).isolateScope().method = 'Return to school office';
                }));
                await page.evaluate(() => { window.attachmentCategory = 'Diabetes'; window.attachmentReads = []; });
                assert.equal(await page.locator('#actionPlanHeading').isVisible(), false, 'blank diabetes and No seizures hide the notice');
                await setQuestion('DIABETES', '1');
                await page.evaluate(() => { window.mainVm.formSchool = '101'; angular.element(document.querySelector('.cdol-health-forms')).scope().$apply(); });
                assert.equal(await page.locator('#actionPlanHeading').isVisible(), true, 'Diabetes Yes shows the notice at school 101 too');
                assert.equal(await page.locator('#diabetesPlanHeading').count(), 0, 'Action Plan replaces the old Diabetes Documentation section');
                assert.equal(await page.locator('#actionPlanHeading').innerText(), 'Action Plan');
                const diabetesInstructions = await page.locator('#diabetesActionPlanInstructions').innerText();
                assert.match(diabetesInstructions, /Example's Diabetes Medical Management Plan \(DMMP\)/);
                assert.match(diabetesInstructions, /to Example School using\s+Example's health care provider’s form/);
                assert.match(diabetesInstructions, /dated after May 1/);
                assert.match(diabetesInstructions, /by the end of the first week of school/);
                assert.equal(await page.locator('#diabetesActionPlanInstructions u').innerText(), "Example's health care provider’s form");
                assert.equal(await page.locator('#diabetesActionPlanInstructions mark').innerText(), 'by the end of the first week of school.');
                assert.equal(await page.locator('#diabetesActionPlanInstructions mark').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(255, 242, 204)');
                const diabetesMethod = page.locator('.health-action-plan #diabetesPlanMethod');
                assert.equal(await page.locator('#diabetesPlanMethod').count(), 1, 'the return method appears only once');
                assert.equal(await diabetesMethod.isVisible(), true, 'school 101 also displays the saved parent choice');
                assert.equal(await diabetesMethod.locator('.health-return-value').innerText(), 'Return to school office');
                assert.equal(await diabetesMethod.locator('input').count(), 0, 'saved method is plain text, not an input');
                await checkAttachmentVisibility(page, diabetesMethod, 'diabetes', 'Diabetes');
                for (const method of ['Upload', '', 'Unrecognized historical choice', 'Return to school office']) {
                    await diabetesMethod.evaluate((element, method) => {
                        const scope = angular.element(element).isolateScope();
                        scope.$apply(() => { scope.method = method; });
                    }, method);
                    assert.equal(await diabetesMethod.locator('.health-return-value').innerText(), method || 'Not recorded');
                    const documentLink = diabetesMethod.locator('.health-attachments-fallback');
                    await page.waitForFunction(() => !angular.element(document.querySelector('#diabetesPlanMethod')).isolateScope().checkingDocuments);
                    assert.equal(await diabetesMethod.locator('.health-document-link').count(), 1, 'matching Diabetes document also qualifies non-Upload choices');
                    if (method === 'Upload') {
                        await diabetesMethod.locator('.health-document-link').click();
                        await diabetesMethod.locator('dialog').waitFor();
                        assert.equal(await documentLink.getAttribute('href'), '/admin/students/studentattachments.html?frn=001123');
                        assert.equal(await documentLink.getAttribute('target'), '_blank');
                        assert.equal(await documentLink.getAttribute('rel'), 'noopener');
                        assert.equal(await diabetesMethod.locator('.health-document-link img').getAttribute('src'), '/images/cdol_health_log/bc-document-icon.png');
                        await diabetesMethod.getByRole('button', { name: 'Close document', exact: true }).click();
                        await page.evaluate(() => { window.attachmentReads = []; });
                        await checkAttachments(page, diabetesMethod);
                        await diabetesMethod.locator('.health-document-link').click();
                        await diabetesMethod.locator('dialog').waitFor();
                        await page.context().route('http://localhost/admin/students/studentattachments.html?frn=001123', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Example student attachments</h1>' }));
                        const [attachmentPage] = await Promise.all([page.waitForEvent('popup'), documentLink.click()]);
                        await attachmentPage.waitForURL('http://localhost/admin/students/studentattachments.html?frn=001123');
                        assert.equal(await attachmentPage.evaluate(() => window.opener), null);
                        await attachmentPage.close();
                        await diabetesMethod.getByRole('button', { name: 'Close document', exact: true }).click();
                        await page.context().unroute('http://localhost/admin/students/studentattachments.html?frn=001123');
                    }
                }
                assert.equal(await page.locator('[health-parent-return]:not(#diabetesPlanMethod) .health-document-link').count(), 0, 'other parent choices do not gain unrelated attachment links');
                if (process.env.HEALTH_ACTION_PLAN_SCREENSHOT) {
                    await page.locator('.health-action-plan').screenshot({ path: process.env.HEALTH_ACTION_PLAN_SCREENSHOT });
                }
                await page.evaluate(() => { window.mainVm.formSchool = '104'; angular.element(document.querySelector('.cdol-health-forms')).scope().$apply(); });
                assert.equal(await page.evaluate(() => window.mainVm.show('actionPlan')), true);
                await setQuestion('DIABETES', '0');
                assert.equal(await page.locator('#actionPlanHeading').isVisible(), false);
                assert.equal(await page.locator('#dentalPlanMethod').getAttribute('name'), null, 'parent return method is not posted');
                for (const group of await page.locator('[health-parent-return]').all()) {
                    assert.equal(await group.locator('input').count(), 0);
                    assert.equal(await group.locator('.health-return-value').innerText(), 'Return to school office');
                }
                assert.equal(await page.evaluate(() => Array.from(new FormData(document.querySelector('form')).keys()).some(key => /collection_method/i.test(key))), false);
                assert.equal(await page.locator('input[type="file"]').count(), 0);
                assert.equal(await page.locator('a[href*="formid=24779195"]').count(), 0, 'no upload links');
                await setQuestion('ALLERGY_AGREE', '1');
                const mealSection = page.locator('.health-meal-plan');
                assert.equal(await mealSection.count(), 1, 'only one Meal Accommodation section');
                assert.equal(await mealSection.evaluate(el => el.previousElementSibling.classList.contains('health-action-plan')), true);
                await page.evaluate(() => {
                    window.mainVm.currentSchool = '130'; window.mainVm.formSchool = '110';
                    angular.element(document.querySelector('.cdol-health-forms')).scope().$apply();
                });
                assert.equal(await mealSection.isVisible(), true, 'meal plan uses current SchoolID rather than enrollment workflow school');
                assert.match(await mealSection.locator('p').innerText(), /Parent\/Guardian is responsible for submitting an updated Request for Meal Accommodation for Example annually by the end of the first week of school/);
                assert.equal(await mealSection.getByRole('link', { name: 'Request for Meal Accommodation', exact: true }).getAttribute('href'), 'https://cdolinc.sharepoint.com/:b:/s/EnrollmentFiles/EZUf0I9b9J1BsVBUbjMsiBkB-6c_WmAjHZ-i0re3cfLg6g?e=FcFKyd');
                assert.equal(await mealSection.locator('mark').innerText(), 'by the end of the first week of school.');
                const mealLink = mealSection.locator('.health-document-link');
                const mealReads = await page.evaluate(() => window.attachmentReads.length);
                for (const method of ['Upload', 'Return to school office', '', 'Historical choice']) {
                    await page.locator('#mealPlanMethod').evaluate((el, value) => {
                        const scope = angular.element(el).isolateScope(); scope.$apply(() => { scope.method = value; });
                    }, method);
                    assert.equal(await mealLink.isVisible(), true, 'direct link is available for every return method');
                }
                assert.equal(await page.evaluate(() => window.attachmentReads.length), mealReads, 'meal plan does not query attachment categories');
                assert.equal(await mealLink.getAttribute('href'), '/admin/students/studentattachments.html?frn=001123');
                assert.equal(await mealLink.getAttribute('rel'), 'noopener');
                await page.context().route('http://localhost/admin/students/studentattachments.html?frn=001123', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<h1>Example student attachments</h1>' }));
                const [mealPage] = await Promise.all([page.waitForEvent('popup'), mealLink.locator('img').click()]);
                await mealPage.waitForURL('http://localhost/admin/students/studentattachments.html?frn=001123');
                assert.equal(await mealPage.evaluate(() => window.opener), null);
                await mealPage.close();
                await page.context().unroute('http://localhost/admin/students/studentattachments.html?frn=001123');
                await page.evaluate(() => { window.mainVm.currentSchool = '110'; window.mainVm.formSchool = '130'; angular.element(document.querySelector('.cdol-health-forms')).scope().$apply(); });
                assert.equal(await mealSection.isVisible(), false, 'school 110 is excluded even with workflow school 130');
                await page.evaluate(() => { window.mainVm.currentSchool = '131'; angular.element(document.querySelector('.cdol-health-forms')).scope().$apply(); });
                assert.equal(await mealSection.isVisible(), true);
                await setQuestion('ALLERGY_AGREE', '0');
                assert.equal(await mealSection.isVisible(), false, 'allergy No hides the whole meal section');
                await setQuestion('ALLERGY_AGREE', '1');
                assert.equal(await page.locator('#healthAllergyTable').count(), 0, 'no allergy collection UI');
                await page.locator('#healthAllergies').fill('Peanuts');
                assert.equal(await page.evaluate(name => new FormData(document.querySelector('form')).get(name), postedName('[students.StudentCoreFields]allergies')), 'Peanuts');
                await setQuestion('ALLERGY_AGREE', '0');
                assert.equal(await page.locator('#healthAllergies').isDisabled(), false, 'Allergy Alert remains available independently of the history answer');
                await setQuestion('ALLERGY_AGREE', '1');
                assert.equal(await page.locator('#healthAllergies').inputValue(), 'Peanuts');
                assert.equal(await page.evaluate(() => window.testWrites.length), 0, 'no independent allergy requests');
                await page.locator('#healthMedicalAlert').fill('Example medical alert instructions');
                await page.locator('#healthMedicalAlertExpires').fill('06/01/2027');
                await page.locator('#healthActionPlanNote').fill('Example action plan instructions');
                await page.locator('#healthConcussionAlert').check();
                await page.locator('#healthConcussionNote').fill('Example concussion instructions');
                const schoolResults = await page.evaluate(() => {
                    const scope = angular.element(document.querySelector('.cdol-health-forms')).scope();
                    const results = [];
                    ['diabetes', 'seizure_agree', 'inhaler', 'epipen', 'allergy_agree'].forEach(key => { window.mainVm.values['[students.u_student_additional_info]' + key] = '1'; });
                    for (const school of ['101', '104', '110', '120', '130', '131', '210', '211', '311', '999']) {
                        window.mainVm.formSchool = school;
                        window.mainVm.currentSchool = school;
                        scope.$apply();
                        const shown = id => !document.getElementById(id).closest('[health-when]').classList.contains('ng-hide');
                        results.push({ school, dental: shown('dentalPlanHeading'), agreement: shown('dentalAgreementHeading'), actionPlan: shown('actionPlanHeading'),
                            seizure: shown('seizureActionPlanInstructions'), inhaler: shown('inhalerContractHeading'), meal: shown('mealPlanHeading'), notice: shown('medicalCareNoticeHeading') });
                    }
                    return results;
                });
                for (const result of schoolResults) {
                    assert.equal(result.dental, result.school === '104');
                    assert.equal(result.agreement, result.school === '120');
                    assert.equal(result.actionPlan, true, 'Action Plan applies at every school');
                    assert.equal(result.seizure, true, 'seizure plan applies at every school');
                    assert.equal(result.inhaler, result.school === '311');
                    assert.equal(result.meal, ['130', '131'].includes(result.school));
                    assert.equal(result.notice, ['210', '211'].includes(result.school));
                }
            } else {
                assert.equal(await page.locator('#hospitalConsentCheckbox').isChecked(), true, 'hospital consent seeded');
                const consent = page.locator('input[type="checkbox"][name="' + 'med_share_consent' + '"]');
                assert.equal(await consent.isChecked(), true);
                const firstAid = page.locator('input[type="checkbox"][name="' + 'med_first_aid_consent' + '"]');
                assert.equal(await firstAid.isChecked(), true, 'saved first aid consent seeded');
                await firstAid.uncheck();
                assert.equal(await page.evaluate(() => window.mainVm.appData.med_first_aid_consent), '0');
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), true);
                await firstAid.check();
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false);
                await page.locator('input[name="' + 'acetaminophen' + '"][value="0"]').check();
                assert.equal(await page.evaluate(() => window.mainVm.appData.acetaminophen), '0');
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), true);
                await page.locator('input[name="' + 'acetaminophen' + '"][value="1"]').check();
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false);
                await consent.uncheck();
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), true);
                await consent.check();
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false);
                await page.evaluate(() => { window.mainVm.submit(); });
                assert.equal(await page.evaluate(() => window.testWrites.length), 0, 'reverted edits do not save or stamp audit');
                await page.locator('#hospitalConsentCheckbox').uncheck();
                await page.getByRole('button', { name: 'Edit Prescription Medication', exact: true }).click();
                assert.equal(await page.getByRole('button', { name: 'Delete Prescription Medication', exact: true }).isVisible(), false);
                const row = page.locator('tr.prescription-medication-editing');
                assert.equal(await row.getByRole('button', { name: 'Submit', exact: true }).isDisabled(), true);
                await row.getByLabel('Dosage', { exact: true }).fill('6');
                await row.getByLabel('Dosage', { exact: true }).fill('5');
                assert.equal(await row.getByRole('button', { name: 'Submit', exact: true }).isDisabled(), true);
                await row.getByLabel('Dosage', { exact: true }).fill('6');
                await row.getByRole('button', { name: 'Submit', exact: true }).click();
                await page.waitForFunction(() => window.testWrites.length === 2 && !window.mainVm.medicationBlocked).catch(async error => {
                    console.error(await page.evaluate(() => ({ writes: window.testWrites, feedback: document.querySelector('#prescriptionMedicationFeedback') && document.querySelector('#prescriptionMedicationFeedback').textContent, action: document.querySelector('form').action })), errors);
                    throw error;
                });
                const writes = await page.evaluate(() => window.testWrites);
                assert.equal(writes[0].method, 'PUT');
                assert.equal(JSON.parse(writes[0].body).tables.u_fb_medications.dosage, '6');
                assert.deepEqual(Object.keys(JSON.parse(writes[1].body).tables.u_student_additional_info).sort(),
                    ['med_last_updated_by', 'med_last_updated_date', 'med_last_updated_user_type'], 'prescription audit excludes unsaved authorizations');
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), true, 'audit keeps the unsaved consent edit');
                assert.equal(await page.locator('#hospitalConsentCheckbox').isChecked(), false);
                assert.equal(await page.evaluate(() => window.studentData.hospital_consent), '1');
                await page.locator('#hospitalConsentCheckbox').check();
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false);
                await page.getByRole('button', { name: 'Add Medication', exact: true }).click();
                assert.equal(await row.getByRole('button', { name: 'Submit', exact: true }).isDisabled(), true);
                await row.getByLabel('Medication Name', { exact: true }).fill('Another Medicine');
                await row.getByLabel('Dosage', { exact: true }).fill('2');
                await row.getByLabel('Dosage Units', { exact: true }).selectOption({ label: '(ML) Milliliters' });
                await row.getByLabel('Frequency Taken', { exact: true }).fill('Daily');
                await page.evaluate(() => { window.auditFails = true; });
                await row.getByRole('button', { name: 'Submit', exact: true }).click();
                await page.getByRole('button', { name: 'Retry Audit Stamp' }).waitFor();
                assert.equal(await page.evaluate(() => window.mainVm.medicationBlocked), true);
                await page.evaluate(() => { window.auditFails = false; });
                await page.getByRole('button', { name: 'Retry Audit Stamp' }).click();
                await page.waitForFunction(() => !window.mainVm.medicationBlocked);
                assert.equal((await page.evaluate(() => window.testWrites)).filter(w => w.url.includes('u_fb_medications') && w.method === 'POST').length, 1, 'audit retry never repeats medication creation');
                await page.getByRole('button', { name: 'Delete Prescription Medication', exact: true }).first().click();
                await page.evaluate(() => window.pendingConfirmation.ok());
                await page.waitForFunction(() => window.testWrites.some(w => w.method === 'DELETE') && !window.mainVm.medicationBlocked);
                assert.equal(await page.getByText('No Prescription Medications for Example Student.').isVisible(), true);
                await page.locator('#hospitalConsentCheckbox').uncheck();
                assert.equal(await page.evaluate(() => window.mainVm.appData.hospital_consent), '0');
            }
            const field = file === 'health_history.html' ? page.locator('#healthDoctorName') : page.locator('#hospitalConsentCheckbox');
            if (file === 'health_history.html') {
                await field.fill('Changed Doctor');
                await page.evaluate(() => {
                    const root = document.querySelector('.cdol-health-forms');
                    const panel = document.createElement('div');
                    panel.id = 'content-main';
                    panel.style.cssText = 'height:350px;overflow:auto';
                    root.parentNode.insertBefore(panel, root);
                    panel.appendChild(root);
                    document.querySelector('form button[type="submit"]').scrollIntoView();
                    window.scrollSamples = [];
                    panel.addEventListener('scroll', () => window.scrollSamples.push(panel.scrollTop));
                    window.initialPanelTop = panel.scrollTop;
                });
                assert.ok(await page.locator('#content-main').evaluate(panel => panel.scrollTop > 0));
            }
            await page.locator('form button[type="submit"]').click();

            if (file === 'health_history.html') {
                assert.equal(await page.locator('#medLastUpdatedBy').inputValue(), 'Test Admin');
                assert.equal(await page.evaluate(() => window.formSubmissions[0].prevented), false, 'Health History retains native submission');
                const submitted = new Map(await page.evaluate(() => window.formSubmissions[0].values));
                assert.equal(submitted.get(postedName('[students.StudentCoreFields]allergies')), 'Peanuts');
                assert.equal(submitted.get(postedName('[students]alert_Medical')), 'Example medical alert instructions');
                assert.equal(submitted.get(postedName('[01]Alert_MedicalExpires')), '06/01/2027');
                assert.equal(submitted.get(postedName('[students.U_STUDENT_ADDITIONAL_INFO]IHP_ALERT')), '1');
                assert.equal(submitted.get(postedName('[students.U_STUDENT_ADDITIONAL_INFO]IHP_DESCRIPTION')), 'Example action plan instructions');
                assert.equal(submitted.get(postedName('[students.U_STUDENT_ADDITIONAL_INFO]CONCUSSION_ALERT')), '1');
                assert.equal(submitted.get(postedName('[students.U_STUDENT_ADDITIONAL_INFO]CONCUSSION_DESC')), 'Example concussion instructions');
                assert.equal(submitted.get(postedName('[students.U_STUDENT_ADDITIONAL_INFO]MED_LAST_UPDATED_BY')), 'Test Admin');
                assert.equal([...submitted.keys()].some(key => /collection_method/i.test(key)), false);
                await page.waitForFunction(() => document.querySelector('#content-main').scrollTop === 0, null, { timeout: 2000 });
                assert.equal(await page.evaluate(() => window.scrollSamples.filter(top => top > 0 && top < window.initialPanelTop).length > 5), true, 'Health History submit scrolls smoothly');
                // Recreate the controller as on a native POST response with its saved marker.
                for (const saved of [false, true]) {
                    await page.evaluate(saved => {
                        const root = document.querySelector('.cdol-health-forms');
                        root.setAttribute('data-changes-saved', String(saved));
                        const panel = document.querySelector('#content-main');
                        panel.scrollTop = panel.scrollHeight;
                        window.returnPanelTop = panel.scrollTop;
                        const injector = angular.element(root).injector();
                        window.returnScope = injector.get('$rootScope').$new();
                        window.returnVm = injector.get('$controller')('healthFormController', {
                            $element: angular.element(root), $scope: window.returnScope
                        });
                        window.returnPrevented = false;
                        if (!saved) window.returnVm.submit({ preventDefault: () => { window.returnPrevented = true; } });
                    }, saved);
                    if (saved) {
                        await page.waitForFunction(() => document.querySelector('#content-main').scrollTop === 0, null, { timeout: 2000 });
                    } else {
                        await page.waitForTimeout(700);
                        assert.equal(await page.evaluate(() => document.querySelector('#content-main').scrollTop === window.returnPanelTop), true, 'ordinary load and unchanged submit do not scroll');
                        assert.equal(await page.evaluate(() => window.returnPrevented), true);
                    }
                    await page.evaluate(() => window.returnScope.$destroy());
                }
            } else {
                await page.waitForFunction(() => window.mainVm.loaded && !window.mainVm.busy && !window.mainVm.hasChanges());
                assert.equal(await page.evaluate(() => window.formSubmissions[0].prevented), true, 'Medical Authorization never posts the native form');
                const saved = await page.evaluate(() => JSON.parse(window.testWrites[window.testWrites.length - 1].body).tables.u_student_additional_info);
                assert.deepEqual(saved, { hospital_consent: '0', med_last_updated_user_type: 'Admin', med_last_updated_by: 'Test Admin', med_last_updated_date: '2026-09-23' });
                assert.equal(await page.locator('#medicalLastUpdated').innerText(), 'Last Updated by Admin: Test Admin - 09/23/2026');

                // Real Boolean API payloads, explicit false, blank values, and no inferred consent.
                await page.evaluate(() => {
                    Object.assign(window.studentData, { med_share_consent: '0', med_first_aid_consent: null, hospital_consent: null });
                    window.mainVm.load();
                });
                await page.waitForFunction(() => !window.mainVm.busy);
                assert.equal(await page.getByLabel('Parent/Guardian consents to Emergency Treatment').isChecked(), false);
                assert.equal(await page.getByLabel('Parent/Guardian consents to Basic First Aid Care').isChecked(), false);
                assert.equal(await page.locator('#hospitalConsentCheckbox').isChecked(), false);
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false);
                await page.getByLabel('Parent/Guardian consents to Basic First Aid Care').check();
                await page.locator('form button[type="submit"]').click();
                await page.waitForFunction(() => !window.mainVm.busy);
                assert.equal(await page.evaluate(() => JSON.parse(window.testWrites[window.testWrites.length - 1].body).tables.u_student_additional_info.med_first_aid_consent), 'true');
                assert.equal(await page.evaluate(() => window.studentData.hospital_consent), null, 'an unrelated save preserves blank hospital consent');

                // A success-shaped response is insufficient when read-back does not match.
                await page.evaluate(() => { window.ignoreSave = true; });
                await page.getByLabel('Parent/Guardian consents to Basic First Aid Care').uncheck();
                await page.locator('form button[type="submit"]').click();
                await page.waitForFunction(() => !window.mainVm.busy);
                assert.equal(await page.evaluate(() => window.mainVm.loaded), false);
                assert.equal(await page.locator('form button[type="submit"]').isDisabled(), true);
                assert.equal(await page.evaluate(() => JSON.parse(window.testWrites[window.testWrites.length - 1].body).tables.u_student_additional_info.med_first_aid_consent), 'false');
                await page.evaluate(() => { window.ignoreSave = false; window.loadFails = true; window.mainVm.load(); });
                await page.waitForFunction(() => !window.mainVm.busy);
                assert.equal(await page.evaluate(() => window.mainVm.loaded), false, 'login HTML is not a successful load');
                await page.evaluate(() => { window.loadFails = false; window.studentData.student_dcid = '999'; window.mainVm.load(); });
                await page.waitForFunction(() => !window.mainVm.busy);
                assert.equal(await page.evaluate(() => window.mainVm.loaded), false, 'wrong student is rejected');
                await page.evaluate(() => { window.studentData.student_dcid = '123'; window.studentData.record_exists = 0; window.mainVm.load(); });
                await page.waitForFunction(() => !window.mainVm.busy);
                await page.locator('#hospitalConsentCheckbox').check();
                await page.locator('form button[type="submit"]').click();
                await page.waitForFunction(() => !window.mainVm.busy);
                const created = await page.evaluate(() => window.testWrites[window.testWrites.length - 1]);
                assert.equal(created.method, 'POST');
                assert.equal(JSON.parse(created.body).tables.u_student_additional_info.studentsdcid, '123');
                assert.equal(await page.evaluate(() => window.mainVm.loaded), true);
            }
            assert.deepEqual(errors, []);
            if (file === 'medical_authorization.html') {
                assert.equal(await page.evaluate(() => window.dialogVisible), false, 'native dialog closes after loads, saves, and failures');
                assert.equal(await page.evaluate(() => window.dialogOpens === window.dialogCloses), true);
                // OTC submits use the bound event even with PowerSchool's decorated ngSubmit.
                await page.locator('input[name="acetaminophen"][value="0"]').check();
                // The PowerSchool student shell scrolls content-main, not the window.
                await page.evaluate(() => {
                    const root = document.querySelector('.cdol-health-forms');
                    const panel = document.createElement('div');
                    panel.id = 'content-main';
                    panel.style.cssText = 'height:350px;overflow:auto';
                    root.parentNode.insertBefore(panel, root);
                    panel.appendChild(root);
                    document.querySelector('form button[type="submit"]').scrollIntoView();
                    window.scrollSamples = [];
                    panel.addEventListener('scroll', () => window.scrollSamples.push(panel.scrollTop));
                    window.initialPanelTop = panel.scrollTop;
                });
                assert.ok(await page.locator('#content-main').evaluate(panel => panel.scrollTop > 0));
                await page.locator('form button[type="submit"]').click();
                await page.waitForFunction(() => !window.mainVm.busy);
                await page.waitForFunction(() => document.querySelector('#content-main').scrollTop === 0, null, { timeout: 2000 });
                assert.equal(await page.evaluate(() => window.scrollSamples.filter(top => top > 0 && top < window.initialPanelTop).length > 5), true, 'scroll progresses through intermediate positions instead of jumping');
                assert.equal(await page.evaluate(() => window.studentData.acetaminophen), '0');
                assert.equal(await page.evaluate(() => window.mainVm.hasChanges()), false);
                assert.equal(await page.evaluate(() => window.dialogVisible), false);
            }
            if (process.env.HEALTH_FORM_SCREENSHOT_DIR) {
                await page.evaluate(() => {
                    const panel = document.querySelector('#content-main');
                    if (panel) panel.style.height = 'auto';
                });
                await page.screenshot({ path: path.join(process.env.HEALTH_FORM_SCREENSHOT_DIR, file + '.png'), fullPage: true });
            }
            console.log('PASS ' + file + (renderedNames ? ' (PowerSchool rendered names)' : ' (source names)') + ': initialization, dirty/reverted changes' + (file.startsWith('medical_') ? ', JSON load, changed-field API saves, read-back verification, blank values, failure handling, CRUD, independent audit, audit retry' : ', native submission, ten school branches, hidden-field preservation, read-only parent radio choices, native allergy field'));
            await page.close();
        }
    } finally { await browser.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
