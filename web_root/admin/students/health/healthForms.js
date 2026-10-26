/* PowerSchool supplies AngularJS 1.4.7 through RequireJS. */
define(['angular', 'components/shared/index'], function (angular) {
    'use strict';
    var app = angular.module('cdolHealthForms', ['powerSchoolModule']);

    // PowerSchool decorates ngSubmit; bind directly so both API and native forms
    // run their controller handler regardless of that decorator's implementation.
    app.directive('healthSubmit', ['$parse', function ($parse) {
        return function (scope, element, attrs) {
            var submit = $parse(attrs.healthSubmit);
            function onSubmit(event) {
                var invoke = function () { submit(scope, { $event: event }); };
                if (scope.$root.$$phase) { invoke(); } else { scope.$apply(invoke); }
            }
            element.on('submit', onSubmit);
            scope.$on('$destroy', function () { element.off('submit', onSubmit); });
        };
    }]);

    app.factory('healthChangeTracking', function () {
        function normalize(value) {
            if (angular.isArray(value)) { return value.map(normalize); }
            return value === null || value === undefined ? '' : String(value).replace(/\r\n/g, '\n');
        }
        return {
            normalize: normalize,
            changed: function (current, original) { return !angular.equals(current, original); }
        };
    });

    // Seed ngModel from PowerSchool's rendered values before Angular renders the controls.
    app.directive('healthBoundForm', function () {
        function fieldKey(field) {
            if (field.name.charAt(0) === '[') { return field.name.toLowerCase(); }
            // PowerSchool replaces source names with record-specific EF-/UF- names.
            // Its validation key preserves the table/field identity. Generated
            // checkbox companion inputs have no key and must not seed ngModel.
            var validation;
            try { validation = JSON.parse(field.getAttribute('data-validation') || '{}'); }
            catch (error) { return ''; }
            var key = String(validation.key || '').toLowerCase();
            var separator = key.lastIndexOf('.');
            return separator > 0 ? '[' + key.slice(0, separator) + ']' + key.slice(separator + 1) : '';
        }
        return {
            priority: 100,
            compile: function (element) {
                angular.forEach(element[0].querySelectorAll('input[name], select[name], textarea[name]'), function (field) {
                    if (/^medLastUpdated/.test(field.id)) { return; }
                    var key = fieldKey(field);
                    if (!key) { return; }
                    var control = angular.element(field);
                    control.attr('ng-model', 'vm.values[' + JSON.stringify(key) + ']');
                    control.attr('health-initial-value', key);
                    var conditions = [];
                    var parent = field.parentNode;
                    while (parent && parent !== element[0]) {
                        if (parent.getAttribute && parent.getAttribute('health-when')) {
                            conditions.push('(' + parent.getAttribute('health-when') + ')');
                        }
                        parent = parent.parentNode;
                    }
                    if (conditions.length) {
                        var condition = conditions.join(' && ');
                        control.attr('health-field-condition', condition);
                        control.attr('ng-disabled', '!(' + condition + ')');
                        if (field.hasAttribute('required')) {
                            control.removeAttr('required');
                            control.attr('ng-required', condition);
                        }
                    }
                    if (field.type === 'checkbox') {
                        control.attr('ng-true-value', JSON.stringify(field.value || '1'));
                        control.attr('ng-false-value', "'0'");
                    }
                });
                // PowerSchool's hidden checkbox companions post the unchecked
                // value. Disable them with their conditional checkbox, without binding
                // them to ngModel or allowing them to seed/overwrite its saved value.
                var conditionalCheckboxes = element[0].querySelectorAll('input[type="checkbox"][health-field-condition]');
                angular.forEach(element[0].querySelectorAll('input[type="hidden"][name]'), function (field) {
                    if (fieldKey(field)) { return; }
                    angular.forEach(conditionalCheckboxes, function (checkbox) {
                        if (checkbox.name === field.name) {
                            angular.element(field).attr('ng-disabled', '!(' + checkbox.getAttribute('health-field-condition') + ')');
                        }
                    });
                });
            }
        };
    });

    // Reuse the native Attachments metadata contract and current user's session.
    // Content authorization remains enforced by PowerSchool; never fall back to S3.
    app.factory('healthAttachments', ['$http', '$q', '$window', function ($http, $q, $window) {
        function list(value) { return value == null ? [] : (angular.isArray(value) ? value : [value]); }
        function get(url, params) { return $http.get(url, { params: params, cache: false, timeout: 30000 }); }
        var categoryRequest, categoryExpires = 0;
        function categories(refresh) {
            if (refresh || (categoryExpires && Date.now() >= categoryExpires)) { categoryRequest = null; }
            if (!categoryRequest) {
                categoryExpires = 0;
                var request = get('/ws/districtcategory').then(function (response) {
                    if (!response.data || !response.data.categories) { throw new Error('Invalid category response.'); }
                    if (categoryRequest === request) { categoryExpires = Date.now() + 60000; }
                    return list(response.data.categories);
                }).catch(function (error) {
                    if (categoryRequest === request) { categoryRequest = null; categoryExpires = 0; }
                    return $q.reject(error);
                });
                categoryRequest = request;
            }
            return categoryRequest;
        }
        function matches(doc, categoryIds) {
            return /^\d+$/.test(String(doc.id)) && doc.status === 'A' &&
                list(doc.categories).some(function (category) { return categoryIds.indexOf(String(category.id)) !== -1; });
        }
        function eligible(doc, categoryIds) {
            var change = list(doc.changeList)[0] || {};
            return matches(doc, categoryIds) && doc.permission && doc.permission.download === true &&
                (!doc.documentLocation || doc.documentLocation === 'L') &&
                change.whoChangedName !== 'PowerSchool Registration Signature';
        }
        function uploadTime(value) {
            // Use the native US-formatted upload date, including its time when supplied.
            var parts = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?)?$/i.exec(String(value || '').trim());
            if (!parts) { return -Infinity; }
            var hour = Number(parts[4] || 0);
            if (parts[7]) { hour = hour % 12 + (parts[7].toUpperCase() === 'PM' ? 12 : 0); }
            return new Date(Number(parts[3]), Number(parts[1]) - 1, Number(parts[2]), hour, Number(parts[5] || 0), Number(parts[6] || 0)).getTime();
        }
        function find(frn, categoryName, refresh) {
            if (!/^001\d+$/.test(frn || '') || !categoryName) { return $q.reject(new Error('Student attachment context is unavailable.')); }
            var params = { entityname: 'STCM', entityid: frn.substring(3) };
            return categories(refresh).then(function (available) {
                var names = list(categoryName);
                var selected = available.filter(function (category) { return names.indexOf(category.name) !== -1; });
                if (!selected.length) { return { documents: [], hasMatches: false }; }
                var categoryIds = selected.map(function (category) { return String(category.id); });
                if (!categoryIds.every(function (id) { return /^\d+$/.test(id); })) { throw new Error('Invalid category IDs.'); }
                params.q = 'category==(' + categoryIds.join(',') + ');status==active';
                return get('/ws/k12drive/document/aggregates', params).then(function (aggregateResponse) {
                    var aggregate = aggregateResponse.data && aggregateResponse.data.documentAggregates;
                    var count = aggregate && Number(aggregate.count);
                    if (!aggregate || !isFinite(count) || count < 0 || Math.floor(count) !== count || count > 10000) {
                        throw new Error('Invalid attachment count.');
                    }
                    if (!count) { return { documents: [], hasMatches: false }; }
                    if (!/^\d+$/.test(String(aggregate.time))) { throw new Error('Invalid attachment snapshot.'); }
                    params.q = 'category==(' + categoryIds.join(',') + ');lastmodifiedon=le=' + aggregate.time + ';status==active';
                    params.pagesize = 100;
                    params.order = 'filename;asc';
                    var documents = [], seen = {}, hasMatches = false;
                    function page(number) {
                        return get('/ws/k12drive/document', angular.extend({}, params, { page: number })).then(function (response) {
                            if (!response.data || !response.data.documents || !response.data.documents.documentList) {
                                throw new Error('Invalid attachment response.');
                            }
                            list(response.data.documents.documentList).forEach(function (doc) {
                                if (matches(doc, categoryIds)) { hasMatches = true; }
                                if (eligible(doc, categoryIds) && !seen[doc.id]) {
                                    seen[doc.id] = true;
                                    var change = list(doc.changeList)[0] || {};
                                    documents.push({ id: doc.id, name: doc.name || 'Untitled document',
                                        uploaded: change.whenChangedFormatted || 'Not available',
                                        uploadedTime: uploadTime(change.whenChangedFormatted) });
                                }
                            });
                            if (number * params.pagesize < count) { return page(number + 1); }
                            documents.sort(function (a, b) {
                                return (b.uploadedTime - a.uploadedTime) || (Number(b.id) - Number(a.id));
                            });
                            return { documents: documents, hasMatches: hasMatches };
                        });
                    }
                    return page(1);
                });
            });
        }
        return {
            find: find,
            preview: function (id) {
                if (!/^\d+$/.test(String(id))) { return $q.reject(new Error('Invalid attachment ID.')); }
                return $http.get('/ws/k12drive/document/content/' + id, { responseType: 'arraybuffer', cache: false, timeout: 30000 })
                    .then(function (response) {
                        var type = (response.headers('Content-Type') || '').split(';')[0].trim().toLowerCase();
                        if (['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'].indexOf(type) === -1 ||
                                !response.data || !response.data.byteLength) {
                            throw new Error('This file cannot be previewed here. Open student attachments to view or download it.');
                        }
                        return $window.URL.createObjectURL(new $window.Blob([response.data], { type: type }));
                    });
            },
            release: function (url) { if (url) { $window.URL.revokeObjectURL(url); } }
        };
    }]);

    // Display the parent's answer without posting or modifying it.
    app.directive('healthParentReturn', ['healthAttachments', '$sce', '$q', '$timeout', function (attachments, $sce, $q, $timeout) {
        return {
            scope: { method: '@healthParentReturn', returnOptions: '=?', attachmentUrl: '@?', attachmentCategory: '@?', attachmentCategories: '@?', attachmentFrn: '@?', attachmentEnabled: '=?' },
            template: '<div class="health-parent-return" role="group" aria-label="Parent/Guardian\'s Stated Return Method">' +
                '<span class="health-return-value" ng-bind="method || \'Not recorded\'"></span>' +
                '<span class="health-return-unselected" ng-repeat="option in (returnOptions || [\'Upload\', \'Return to school office\']) track by $index" ng-if="method !== option" ng-bind="option"></span>' +
                '<div class="health-parent-attachment" ng-if="attachmentUrl && attachmentEnabled !== false && (method === \'Upload\' || hasMatches || lookupFailed || opened)">' +
                '<button class="health-document-link" ng-if="method === \'Upload\' || hasMatches" type="button" ng-click="loadDocuments()" ng-disabled="loading" aria-haspopup="dialog" aria-expanded="{{!!opened}}">' +
                '<img src="/images/cdol_health_log/bc-document-icon.png" alt="" width="24" height="24">' +
                '<span>View {{attachmentCategory}} documents</span></button>' +
                '<a class="health-attachments-fallback" ng-if="lookupFailed" ng-href="{{attachmentUrl}}" target="_blank" rel="noopener">Open student attachments</a>' +
                '<span ng-if="lookupFailed" role="status">Document availability could not be checked.</span></div></div>' +
                '<dialog class="health-attachment-panel" ng-if="opened" aria-label="{{attachmentCategory}} document preview" aria-modal="true" ng-keydown="modalKeydown($event)">' +
                '<div class="health-attachment-heading"><strong>{{attachmentCategory}} document</strong>' +
                '<button type="button" ng-click="closeDocuments(true)" autofocus>Close document</button></div>' +
                '<div class="health-attachment-details" ng-if="previewName"><strong ng-bind="previewName"></strong>' +
                '<span>Uploaded: <span ng-bind="previewUploaded"></span></span></div>' +
                '<a class="health-attachments-fallback" ng-href="{{attachmentUrl}}" target="_blank" rel="noopener">Open student attachments</a>' +
                '<p role="status" aria-live="polite" ng-if="loading || message">{{loading ? "Loading documents..." : message}}</p>' +
                '<p role="status" aria-live="polite" ng-if="previewLoading || previewMessage">{{previewLoading ? "Loading preview..." : previewMessage}}</p>' +
                '<iframe ng-if="previewUrl" class="health-attachment-preview" ng-src="{{previewUrl}}" title="{{attachmentCategory}} document preview"></iframe></dialog>',
            link: function (scope, element) {
                var request = 0, discovery = 0, blobUrl, discovered, dialogTimer;
                function categoryNames() { return scope.attachmentCategories ? scope.attachmentCategories.split(',').map(function (name) { return name.trim(); }) : scope.attachmentCategory; }
                function release() { attachments.release(blobUrl); blobUrl = null; scope.previewUrl = null; }
                scope.modalKeydown = function (event) {
                    if (event.keyCode !== 9) { return; }
                    var controls = event.currentTarget.querySelectorAll('button:not([disabled]), a[href], iframe');
                    var first = controls[0], last = controls[controls.length - 1];
                    if (event.shiftKey && event.target === first) { event.preventDefault(); last.focus(); }
                    else if (!event.shiftKey && event.target === last) { event.preventDefault(); first.focus(); }
                };
                scope.closePreview = function () { request++; release(); scope.previewLoading = false; scope.previewMessage = ''; scope.previewName = ''; scope.previewUploaded = ''; };
                scope.closeDocuments = function (restoreFocus) {
                    $timeout.cancel(dialogTimer);
                    var dialog = element[0].querySelector('dialog');
                    if (dialog && dialog.open) { dialog.close(); }
                    scope.closePreview(); scope.opened = false; scope.loading = false; scope.documents = [];
                    var button = element[0].querySelector('.health-document-link');
                    if (restoreFocus && button) { button.focus(); }
                };
                scope.loadDocuments = function (refresh) {
                    if ((scope.method !== 'Upload' && !scope.hasMatches && !scope.opened) || scope.attachmentEnabled === false || scope.loading) { return; }
                    scope.closePreview();
                    var current = ++request;
                    scope.opened = true; scope.loading = true; scope.documents = []; scope.message = '';
                    dialogTimer = $timeout(function () {
                        var dialog = element[0].querySelector('dialog');
                        if (!scope.opened || !dialog || dialog.open) { return; }
                        dialog.addEventListener('cancel', function (event) {
                            event.preventDefault();
                            scope.$apply(function () { scope.closeDocuments(true); });
                        });
                        dialog.showModal();
                    });
                    var pending = !refresh && discovered && Date.now() < discovered.expires ?
                        $q.when(discovered.result) : attachments.find(scope.attachmentFrn, categoryNames(), refresh);
                    discovered = null;
                    pending.then(function (result) {
                        if (current !== request) { return; }
                        scope.documents = result.documents; scope.hasMatches = result.hasMatches; scope.lookupFailed = false;
                        scope.loading = false;
                        scope.message = result.documents.length ? '' :
                            'No available ' + scope.attachmentCategory + ' documents were found. Open student attachments to review the files.';
                        if (result.documents.length) { scope.previewDocument(result.documents[0]); }
                    }, function () {
                        if (current === request) { scope.message = 'Documents could not be loaded. Open student attachments to review access and available files.'; }
                    }).finally(function () { if (current === request) { scope.loading = false; } });
                };
                scope.previewDocument = function (document) {
                    if (scope.documents.indexOf(document) === -1 || scope.previewLoading) { return; }
                    release();
                    var current = ++request;
                    scope.previewLoading = true; scope.previewMessage = ''; scope.previewName = document.name; scope.previewUploaded = document.uploaded;
                    attachments.preview(document.id).then(function (url) {
                        if (current !== request) { attachments.release(url); return; }
                        blobUrl = url; scope.previewUrl = $sce.trustAsResourceUrl(url);
                    }, function (error) {
                        if (current === request) { scope.previewMessage = error.message || 'The preview could not be loaded. Open student attachments to review access and available files.'; }
                    }).finally(function () { if (current === request) { scope.previewLoading = false; } });
                };
                scope.$watchGroup(['method', 'attachmentFrn', 'attachmentCategory', 'attachmentCategories', 'attachmentEnabled'], function () {
                    scope.closeDocuments();
                    discovered = null;
                    var current = ++discovery;
                    scope.hasMatches = false; scope.lookupFailed = false; scope.checkingDocuments = false;
                    // Upload already qualifies. Other choices need a metadata-only lookup;
                    // no document content is requested until the administrator opens the modal.
                    if (!scope.attachmentUrl || !scope.attachmentCategory || !scope.attachmentFrn ||
                            scope.attachmentEnabled === false || scope.method === 'Upload') { return; }
                    scope.checkingDocuments = true;
                    attachments.find(scope.attachmentFrn, categoryNames()).then(function (result) {
                        if (current === discovery) {
                            scope.hasMatches = result.hasMatches;
                            discovered = { result: result, expires: Date.now() + 30000 };
                        }
                    }, function () {
                        if (current === discovery) { scope.lookupFailed = true; }
                    }).finally(function () { if (current === discovery) { scope.checkingDocuments = false; } });
                });
                scope.$on('$destroy', function () { scope.closeDocuments(); discovery++; discovered = null; });
            }
        };
    }]);

    // Keep dependent controls in the DOM so their saved values can be initialized
    // and restored when a question is re-enabled. Hidden controls are not posted.
    app.directive('healthWhen', function () {
        return function (scope, element, attrs) {
            scope.$watch(attrs.healthWhen, function (visible) {
                element.toggleClass('ng-hide', !visible);
                element.attr('aria-hidden', visible ? 'false' : 'true');
            });
        };
    });

    app.directive('healthInitialValue', ['healthChangeTracking', function (tracking) {
        return {
            priority: 2,
            require: 'ngModel',
            compile: function () {
                return { pre: function (scope, element, attrs) {
                    var field = element[0];
                    var key = attrs.healthInitialValue;
                    if (attrs.healthFieldCondition) { scope.vm.fieldConditions[key] = attrs.healthFieldCondition; }
                    var value = field.type === 'checkbox' ? (field.checked ? (field.value || '1') : '0') : element.val();
                    if (field.type === 'radio' && !field.checked) {
                        if (scope.vm.values[key] !== undefined) { return; }
                        value = '';
                    }
                    scope.vm.values[key] = tracking.normalize(value);
                    scope.vm.original[key] = angular.copy(scope.vm.values[key]);
                }, post: function (scope, element, attrs, model) {
                    if (element[0].type === 'hidden') {
                        model.$render = function () { element.val(model.$viewValue || ''); };
                    }
                } };
            }
        };
    }]);

    app.factory('healthAudit', ['$http', '$q', function ($http, $q) {
        var fieldIds = ['medLastUpdatedUserType', 'medLastUpdatedBy', 'medLastUpdatedDate'];
        function values(root) {
            return ['Admin', root.getAttribute('data-audit-user'), root.getAttribute('data-audit-date')];
        }
        function stamp(root) {
            var data = values(root);
            angular.forEach(fieldIds, function (id, i) { root.querySelector('#' + id).value = data[i]; });
        }
        return {
            stamp: stamp,
            save: function (root) {
                var data = values(root);
                var body = ['ac=prim'];
                angular.forEach(fieldIds, function (id, i) {
                    body.push(encodeURIComponent(root.querySelector('#' + id).name) + '=' + encodeURIComponent(data[i]));
                });
                var url = root.querySelector('form').action.replace('changesSaved=true', 'healthAuditSaved=true');
                return $http.post(url, body.join('&'), {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    transformResponse: angular.identity
                }).then(function (response) {
                    // A login/error page can return HTTP 200. Verify the saved server values.
                    var document = new DOMParser().parseFromString(response.data, 'text/html');
                    var receipt = document.getElementById('healthAuditReceipt');
                    if (!receipt || receipt.getAttribute('data-user') !== data[1] ||
                            receipt.getAttribute('data-date') !== data[2] || receipt.getAttribute('data-type') !== 'Admin') {
                        return $q.reject(new Error('Audit stamp could not be verified.'));
                    }
                    stamp(root);
                    return 'Last Updated by Admin: ' + data[1] + ' - ' + data[2];
                });
            }
        };
    }]);

    // Scroll PowerSchool's inner student panel as well as the browser window.
    app.factory('healthConfirmationScroll', ['$timeout', '$window', function ($timeout, $window) {
        return function (root) {
            var scrollFrame, scrollTimer;
            function scrollToConfirmation() {
                var content = root.ownerDocument.getElementById('content-main');
                var panelTop = content ? content.scrollTop : 0;
                var windowTop = $window.pageYOffset, windowLeft = $window.pageXOffset;
                var started;
                $window.cancelAnimationFrame(scrollFrame);
                function step(timestamp) {
                    if (started === undefined) { started = timestamp; }
                    var progress = Math.min((timestamp - started) / 600, 1);
                    var remaining = (1 + Math.cos(Math.PI * progress)) / 2;
                    if (content) { content.scrollTop = Math.round(panelTop * remaining); }
                    $window.scrollTo(windowLeft, Math.round(windowTop * remaining));
                    if (progress < 1) { scrollFrame = $window.requestAnimationFrame(step); }
                }
                scrollFrame = $window.requestAnimationFrame(step);
            }
            function cancel() {
                $timeout.cancel(scrollTimer);
                $window.cancelAnimationFrame(scrollFrame);
                $window.removeEventListener('load', start);
            }
            function start() {
                cancel();
                scrollTimer = $timeout(scrollToConfirmation, 0, false);
            }
            return {
                start: start,
                afterLoad: function () {
                    if (root.ownerDocument.readyState === 'complete') { start(); }
                    else { $window.addEventListener('load', start); }
                },
                cancel: cancel
            };
        };
    }]);

    app.controller('healthFormController', ['$element', '$scope', 'healthChangeTracking', 'healthAudit', 'healthConfirmationScroll', function ($element, $scope, tracking, audit, createScroll) {
        var vm = this;
        vm.values = {};
        vm.original = {};
        vm.fieldConditions = {};
        var confirmationScroll = createScroll($element[0]);
        $scope.$on('$destroy', confirmationScroll.cancel);
        if ($element[0].getAttribute('data-changes-saved') === 'true') {
            confirmationScroll.afterLoad();
        }
        vm.message = '';
        vm.formSchool = $element[0].getAttribute('data-form-school') || '';
        vm.currentSchool = $element[0].getAttribute('data-current-school') || '';
        vm.answer = function (field) { return vm.values['[students.u_student_additional_info]' + field.toLowerCase()] || ''; };
        vm.show = function (section) {
            var yes = function (field) { return vm.answer(field) === '1'; };
            var school = String(vm.formSchool);
            switch (section) {
            case 'daycareProvider': return school === '110';
            case 'dental': return ['120', '104'].indexOf(String(vm.currentSchool)) !== -1;
            case 'dentalAgreement': return String(vm.currentSchool) === '120';
            case 'dentalPlan': return String(vm.currentSchool) === '104';
            case 'actionPlan': return yes('diabetes') || yes('seizure_agree') || vm.show('asthmaAllergyPlan');
            case 'asthmaAllergyPlan': return yes('inhaler') || yes('epipen');
            case 'inhalerContract': return school === '311' && yes('inhaler');
            case 'medicalCareNotice': return ['210', '211'].indexOf(school) !== -1 && (yes('inhaler') || yes('epipen'));
            case 'allergies': return yes('allergy_agree');
            case 'mealPlan': return yes('allergy_agree') && ['130', '131'].indexOf(String(vm.currentSchool)) !== -1;
            case 'sportsAccommodations': return vm.answer('can_play_sports').toLowerCase() === 'yes - with accommodations';
            case 'restrictedActivities': return vm.answer('can_play_sports') === '0' || vm.show('sportsAccommodations');
            default: return false;
            }
        };
        vm.hasChanges = function () {
            for (var key in vm.values) {
                if (Object.prototype.hasOwnProperty.call(vm.values, key) &&
                        (!vm.fieldConditions[key] || $scope.$eval(vm.fieldConditions[key])) &&
                        tracking.changed(vm.values[key], vm.original[key])) {
                    return true;
                }
            }
            return false;
        };
        vm.submit = function (event) {
            if (vm.medicationBlocked || (vm.form && vm.form.$invalid)) {
                event.preventDefault();
                vm.message = vm.medicationBlocked ? 'Finish the prescription medication change first.' : 'Review the highlighted fields before submitting.';
                return;
            }
            if (!vm.hasChanges()) {
                event.preventDefault();
                vm.message = 'There are no changes to submit.';
                return;
            }
            audit.stamp($element[0]);
            vm.message = '';
            confirmationScroll.start();
        };
    }]);

    app.factory('medicalAuthorizationApi', ['$http', '$q', function ($http, $q) {
        var fields = ['med_share_consent', 'med_first_aid_consent', 'hospital_consent',
            'acetaminophen', 'ibuprofen', 'antihistamine', 'antacid', 'antibiotic', 'hydrocortisone', 'cough_drop', 'student_medication'];
        function flag(value) {
            if (value === null || value === undefined || value === '') { return ''; }
            if (value === true || value === 1 || value === '1' || value === 'true') { return '1'; }
            if (value === false || value === 0 || value === '0' || value === 'false') { return '0'; }
            throw new Error('An authorization has an unsupported saved value.');
        }
        function load(context) {
            return $http.get('/admin/students/health/data/medicalAuthorization.json', {
                params: { frn: context.frn, studentDcid: context.dcid }, cache: false
            }).then(function (response) {
                var rows = typeof psUtils !== 'undefined' && psUtils.htmlEntitiesToCharCode ?
                    psUtils.htmlEntitiesToCharCode(response.data) : response.data;
                if (typeof rows === 'string') { rows = JSON.parse(rows); }
                if (!angular.isArray(rows) || rows.length !== 1 || String(rows[0].student_dcid) !== context.dcid ||
                        !/^[01]$/.test(String(rows[0].record_exists)) || !/^\d{4}-\d{2}-\d{2}$/.test(rows[0].today || '')) {
                    throw new Error('The student authorization response could not be verified.');
                }
                var record = rows[0], values = {};
                fields.forEach(function (field) {
                    if (!Object.prototype.hasOwnProperty.call(record, field)) { throw new Error('Missing authorization field.'); }
                    values[field] = flag(record[field]);
                });
                return { record: record, values: values };
            });
        }
        return {
            fields: fields,
            load: load,
            save: function (context, record, changes) {
                var payload = {};
                fields.forEach(function (field) {
                    if (Object.prototype.hasOwnProperty.call(changes, field)) {
                        var value = flag(changes[field]);
                        if (value === '') { throw new Error('Choose Yes or No before saving.'); }
                        // Schema Boolean fields use true/false; Hospital Consent is String(100).
                        payload[field] = field === 'hospital_consent' ? value : (value === '1' ? 'true' : 'false');
                    }
                });
                payload.med_last_updated_user_type = 'Admin';
                payload.med_last_updated_by = context.user;
                payload.med_last_updated_date = record.today;
                var exists = String(record.record_exists) === '1';
                if (!exists) { payload.studentsdcid = context.dcid; }
                return $http({
                    method: exists ? 'PUT' : 'POST',
                    url: '/ws/schema/table/u_student_additional_info' + (exists ? '/' + encodeURIComponent(context.dcid) : ''),
                    data: { tables: { u_student_additional_info: payload } }
                }).then(function (response) {
                    var result = response.data && response.data.result;
                    if (!angular.isArray(result) || !result.length || !result.every(function (row) {
                        return !row.error_message && (row.status === 'SUCCESS' || Boolean(row.success_message));
                    })) { return $q.reject(new Error('PowerSchool did not confirm the authorization save.')); }
                    return load(context).then(function (saved) {
                        if (String(saved.record.record_exists) !== '1' || saved.record.audit_name !== payload.med_last_updated_by ||
                                saved.record.audit_user_type !== 'Admin' || saved.record.audit_date !== payload.med_last_updated_date ||
                                Object.keys(changes).some(function (field) { return saved.values[field] !== changes[field]; })) {
                            throw new Error('The saved authorizations could not be verified.');
                        }
                        return saved;
                    });
                });
            }
        };
    }]);

    app.controller('medicalAuthorizationController', ['$element', '$scope', '$q', 'healthConfirmationScroll', 'medicalAuthorizationApi', function ($element, $scope, $q, createScroll, api) {
        var vm = this, root = $element[0];
        var context = { dcid: root.getAttribute('data-student-dcid'), frn: root.getAttribute('data-student-frn'),
            user: root.getAttribute('data-audit-user') };
        vm.appData = {};
        vm.original = {};
        vm.record = {};
        vm.loaded = false;
        vm.busy = false;
        vm.initializing = true;
        vm.prescriptionBusy = true;
        vm.message = '';
        var dialogOpen = false;
        var confirmationScroll = createScroll(root);
        $scope.$watch(function () { return vm.busy || vm.prescriptionBusy; }, function (busy) {
            if (busy && !dialogOpen) { loadingDialog(); dialogOpen = true; }
            if (!busy) {
                vm.initializing = false;
                if (dialogOpen) { closeLoading(); dialogOpen = false; }
            }
        });
        $scope.$on('$destroy', function () {
            if (dialogOpen) { closeLoading(); }
            confirmationScroll.cancel();
        });
        vm.hasParentSignature = function () {
            var name = vm.record.parent_name;
            return typeof name === 'string' && name.trim() !== '' && name.trim().toLowerCase() !== 'null';
        };
        function changedValues() {
            var changes = {};
            api.fields.forEach(function (field) {
                if (vm.appData[field] !== vm.original[field]) { changes[field] = vm.appData[field]; }
            });
            return changes;
        }
        function accept(saved) {
            vm.record = saved.record;
            vm.appData = saved.values;
            vm.original = angular.copy(saved.values);
            vm.loaded = true;
            vm.applyPrescriptionDefault();
            if (vm.form) { vm.form.$setPristine(); vm.form.$setUntouched(); }
        }
        vm.hasChanges = function () {
            return vm.loaded && api.fields.some(function (field) { return vm.appData[field] !== vm.original[field]; });
        };
        vm.applyPrescriptionDefault = function () {
            // Wait for both independent loads. Keep the saved baseline so the
            // corrected Yes value is persisted only through normal Submit.
            if (!vm.loaded || !angular.isArray(vm.prescriptionRows) || vm.prescriptionDefaultApplied) { return; }
            vm.prescriptionDefaultApplied = true;
            if (vm.prescriptionRows.length) { vm.appData.student_medication = '1'; }
        };
        vm.load = function () {
            if (vm.busy) { return; }
            vm.busy = true; vm.loaded = false; vm.initializing = true; vm.message = '';
            vm.prescriptionDefaultApplied = false;
            return api.load(context).then(accept, function () {
                vm.error = true;
                vm.message = 'Medical authorizations could not be loaded. Retry loading before making changes.';
            }).finally(function () { vm.busy = false; });
        };
        vm.submit = function (event) {
            if (event) { event.preventDefault(); }
            if (!vm.loaded || vm.busy || vm.medicationBlocked || !vm.hasChanges() || (vm.form && vm.form.$invalid)) { return; }
            vm.busy = true; vm.message = '';
            return api.save(context, vm.record, changedValues()).then(function (saved) {
                accept(saved);
                vm.error = false; vm.message = 'Medical authorizations saved.';
                // Wait for the loading dialog to close before scrolling to the confirmation.
                confirmationScroll.start();
            }, function () {
                vm.loaded = false; vm.error = true;
                vm.message = 'The save could not be verified. Reload the saved values before making another change.';
            }).finally(function () { vm.busy = false; });
        };
        // Prescription changes stamp only audit fields and preserve unsaved consent edits.
        vm.saveAudit = function () {
            if (vm.busy) { return $q.reject(new Error('Authorizations are busy.')); }
            vm.busy = true;
            // Re-read first: a previous audit request may have saved despite a lost response.
            return api.load(context).then(function (saved) {
                return api.save(context, saved.record, {});
            }).then(function (saved) {
                vm.record = saved.record;
                return saved.record.last_updated_message;
            }).finally(function () { vm.busy = false; });
        };
        vm.load();
    }]);

    app.factory('prescriptionApi', ['$http', '$q', function ($http, $q) {
        return {
            options: function () {
                return $http.get('/admin/students/health/data/medicationDoseUnits.json', { cache: false, timeout: 30000 }).then(function (response) {
                    var rows = typeof psUtils !== 'undefined' && psUtils.htmlEntitiesToCharCode ?
                        psUtils.htmlEntitiesToCharCode(response.data) : response.data;
                    if (typeof rows === 'string') { rows = JSON.parse(rows); }
                    if (!angular.isArray(rows) || !rows.every(function (row) {
                        return row && typeof row.code === 'string' && Object.prototype.hasOwnProperty.call(row, 'displayvalue') &&
                            Object.prototype.hasOwnProperty.call(row, 'uidisplayorder');
                    })) { throw new Error('Invalid medication dose unit response.'); }
                    var seen = {};
                    return rows.map(function (row) {
                        return {
                            code: String(row.code || '').trim(),
                            label: row.displayvalue || row.code,
                            order: Number(row.uidisplayorder) || 0
                        };
                    }).filter(function (row) {
                        var key = row.code.toLowerCase();
                        if (!key || seen[key]) { return false; }
                        seen[key] = true;
                        return true;
                    }).sort(function (a, b) { return a.order - b.order || String(a.label).localeCompare(String(b.label)); });
                });
            },
            list: function (studentDcid) {
                return $http.post('/ws/schema/query/net.cdolinc.studentinfo.prescription.medications?pagesize=0', { studentsDCID: studentDcid }).then(function (response) {
                    var data = response.data;
                    if (data && angular.isArray(data.record)) { return data.record; }
                    // A zero-row PowerQuery returns only its core-table metadata.
                    // Accept that known envelope, but never treat a login/error response as empty.
                    if (data && data.name === 'students' && typeof data['@extensions'] === 'string' &&
                            Object.keys(data).every(function (key) { return key === 'name' || key === '@extensions'; })) {
                        return [];
                    }
                    return $q.reject(new Error('Invalid medication response.'));
                });
            },
            write: function (method, id, record) {
                return $http({
                    method: method,
                    url: '/ws/schema/table/u_fb_medications' + (id ? '/' + encodeURIComponent(id) : ''),
                    data: method === 'DELETE' ? undefined : { tables: { u_fb_medications: record } }
                }).then(function (response) {
                    var result = response.data && response.data.result;
                    if ((result && result.length && result.every(function (row) { return row.status === 'SUCCESS'; })) ||
                            response.data === '' || response.data === null || response.status === 204) { return; }
                    return $q.reject(new Error('PowerSchool did not confirm the medication change.'));
                });
            }
        };
    }]);

    // Share the controls while retaining each row's ngIf/ngForm scope and position.
    app.directive('prescriptionEditor', function () {
        return {
            restrict: 'A',
            template: "<td><input type=\"text\" name=\"medicationName\" ng-model=\"rx.editor.name\" ng-disabled=\"vm.busy || !vm.loaded || rx.busy\" aria-label=\"Medication Name\" required></td>" +
                "<td><input type=\"text\" name=\"dosage\" ng-model=\"rx.editor.dosage\" ng-disabled=\"vm.busy || !vm.loaded || rx.busy\" aria-label=\"Dosage\" required></td>" +
                "<td><select name=\"doseUnit\" ng-model=\"rx.editor.dosage_units\" ng-disabled=\"vm.busy || !vm.loaded || rx.busy\" ng-options=\"unit.code as unit.label for unit in rx.units\" aria-label=\"Dosage Units\" required>" +
                "<option value=\"\">Select a Dosage Unit</option>" +
                "</select><small ng-if=\"rx.originalUnit && !rx.editor.dosage_units\">Previous value: {{rx.originalUnit}}. Select an active unit.</small></td>" +
                "<td><input type=\"text\" name=\"frequency\" ng-model=\"rx.editor.frequency_taken\" ng-disabled=\"vm.busy || !vm.loaded || rx.busy\" aria-label=\"Frequency Taken\" required></td>" +
                "<td class=\"prescription-medication-actions actions center\">" +
                "<button type=\"button\" ng-click=\"rx.cancel()\" ng-disabled=\"vm.busy || !vm.loaded || rx.busy\">Cancel</button>" +
                "<button type=\"button\" ng-click=\"rx.save()\" ng-disabled=\"vm.busy || !vm.loaded || rx.busy || !rx.valid() || !rx.changed() || !rx.loaded\">Submit</button>" +
                "</td>"
        };
    });

    app.controller('prescriptionController', ['$scope', '$element', '$q', 'prescriptionApi', 'healthAudit', function ($scope, $element, $q, api, audit) {
        var rx = this;
        var root = $element[0].closest('.cdol-health-forms');
        var vm = $scope.vm;
        var studentDcid = root.getAttribute('data-student-dcid');
        rx.rows = [];
        rx.units = [];
        var unitsByValue = Object.create(null);
        rx.busy = true;
        rx.loaded = false;
        rx.feedback = '';
        rx.auditPending = false;
        function feedback(message, error) { rx.feedback = message; rx.error = Boolean(error); }
        function belongs(row) { return row && String(row.studentsdcid) === String(studentDcid); }
        function block() {
            vm.medicationBlocked = rx.busy || Boolean(rx.editor) || rx.auditPending;
            vm.prescriptionBusy = rx.busy;
        }
        function findUnit(value) {
            var key = String(value || '').trim().toLowerCase();
            return unitsByValue[key];
        }
        rx.unitLabel = function (value) { var unit = findUnit(value); return unit ? unit.label : value; };
        function normalized(row) {
            var unit = findUnit(row.dosage_units);
            return {
                name: String(row.name || '').trim(),
                dosage: String(row.dosage === null || row.dosage === undefined ? '' : row.dosage).trim(),
                dosage_units: unit ? unit.code : '',
                frequency_taken: String(row.frequency_taken || '').trim()
            };
        }
        rx.changed = function () { return rx.editor && (!rx.editingId || !angular.equals(normalized(rx.editor), rx.original)); };
        rx.valid = function () {
            if (!rx.editor) { return false; }
            var row = normalized(rx.editor);
            return Boolean(row.name && row.dosage && row.dosage_units && row.frequency_taken);
        };
        rx.edit = function (row) {
            if (vm.busy || vm.loaded === false || rx.busy || rx.editor || rx.auditPending || !rx.loaded || !rx.units.length || (row && !belongs(row))) { return; }
            rx.editingId = row ? String(row.medication_id) : null;
            rx.editor = normalized(row || {});
            rx.original = angular.copy(rx.editor);
            rx.originalUnit = row && row.dosage_units;
            feedback('');
            block();
        };
        rx.cancel = function () {
            if (rx.busy) { return; }
            rx.editor = null;
            rx.editingId = null;
            if (rx.editorForm) { rx.editorForm.$setPristine(); rx.editorForm.$setUntouched(); }
            block();
        };
        function reload() {
            return api.list(studentDcid).then(function (rows) {
                rx.rows = rows.filter(belongs);
                rx.loaded = true;
                vm.prescriptionRows = rx.rows;
                if (vm.applyPrescriptionDefault) { vm.applyPrescriptionDefault(); }
            }, function () {
                rx.loaded = false;
                feedback('Prescription medications could not be loaded. Reload the page to try again.', true);
            });
        }
        function saveAudit(message) {
            return (vm.saveAudit ? vm.saveAudit() : audit.save(root)).then(function (text) {
                rx.auditPending = false;
                var banner = root.querySelector('#medicalLastUpdated');
                if (banner && !vm.saveAudit) { banner.textContent = text; banner.classList.add('cdol-health-audit-pending'); }
                feedback(message);
            }, function () {
                rx.auditPending = true;
                feedback('The medication change was saved, but the audit stamp could not be verified. Retry the audit stamp before continuing.', true);
            });
        }
        rx.retryAudit = function () {
            if (rx.busy || !rx.auditPending) { return; }
            rx.busy = true; block();
            saveAudit('Medical audit stamp updated.').finally(function () { rx.busy = false; block(); });
        };
        function write(method, id, data, message) {
            rx.busy = true; block();
            return api.write(method, id, data).then(function () {
                rx.editor = null;
                rx.editingId = null;
                if (rx.editorForm) { rx.editorForm.$setPristine(); rx.editorForm.$setUntouched(); }
                return saveAudit(message).then(reload);
            }, function () {
                feedback('The medication change could not be confirmed. Reload the list before retrying to avoid a duplicate record.', true);
                rx.loaded = false;
            }).finally(function () { rx.busy = false; block(); });
        }
        rx.save = function () {
            if (vm.busy || vm.loaded === false || rx.busy || !rx.valid() || !rx.changed() || !rx.loaded || rx.auditPending) { return; }
            var data = normalized(rx.editor);
            if (rx.editingId && !rx.rows.some(function (row) { return String(row.medication_id) === rx.editingId && belongs(row); })) { return; }
            if (!rx.editingId) { data.studentsdcid = studentDcid; }
            return write(rx.editingId ? 'PUT' : 'POST', rx.editingId, data, rx.editingId ? 'Prescription medication updated.' : 'Prescription medication added.');
        };
        rx.remove = function (row) {
            if (vm.busy || vm.loaded === false || rx.busy || rx.editor || rx.auditPending || !rx.loaded || !belongs(row)) { return; }
            psConfirm({
                title: 'Delete Prescription Medication',
                message: 'Delete this prescription medication? This action cannot be undone.',
                oktext: 'Delete', canceltext: 'Cancel',
                ok: function () { $scope.$evalAsync(function () {
                    if (!vm.busy && vm.loaded !== false && !rx.busy && !rx.editor && !rx.auditPending && rx.loaded) {
                        write('DELETE', row.medication_id, null, 'Prescription medication deleted.');
                    }
                }); }
            });
        };
        rx.keydown = function (event) {
            if (event.keyCode === 13) { event.preventDefault(); rx.save(); }
            if (event.keyCode === 27) { event.preventDefault(); rx.cancel(); }
        };
        block();
        $q.all([reload(), api.options().then(function (units) {
            rx.units = units;
            unitsByValue = Object.create(null);
            units.forEach(function (unit) {
                [unit.code.toLowerCase(), String(unit.label).toLowerCase()].forEach(function (key) {
                    if (!Object.prototype.hasOwnProperty.call(unitsByValue, key)) { unitsByValue[key] = unit; }
                });
            });
            if (!units.length) { feedback('No active Medication Dose Units are configured in CDOL Health Code Sets.', true); }
        }, function () { feedback('Medication Dose Units could not be loaded. Adding and editing are unavailable.', true); })]).finally(function () { rx.busy = false; block(); });
    }]);
    return app;
});
