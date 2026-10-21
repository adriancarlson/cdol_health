define([
	'angular',
	'components/health_log/config/healthOptions',
	'components/shared/powerschoolModule',
	'components/health_log/module',
	'components/health_log/services/formatService',
	'components/health_log/services/jsonDataService',
	'components/health_log/services/psApiService'
], (angular, healthOptionConfig) => {
	'use strict'
	const medicationModule = angular.module('medicationModule', ['powerSchoolModule', 'healthLogMod'])
	const LOW_INVENTORY_PERCENTAGE = 20
	const CRITICAL_INVENTORY_PERCENTAGE = 10
	const getInventoryStatus = (quantityRemainingValue, baselineQuantityValue) => {
		const quantityRemaining = Math.max(0, Number(quantityRemainingValue) || 0)
		const baselineQuantity = Number(baselineQuantityValue) > 0
			? Number(baselineQuantityValue)
			: quantityRemaining

		if (quantityRemaining <= 0) {
			return {
				inventory_percentage_remaining: 0,
				inventory_status: 'OUT',
				inventory_status_label: 'Out of Inventory',
				inventory_status_row_class: 'inventory-warning-out'
			}
		}

		const percentageRemaining = Math.min(100, Math.max(0, (quantityRemaining / baselineQuantity) * 100))

		if (percentageRemaining <= CRITICAL_INVENTORY_PERCENTAGE) {
			return {
				inventory_percentage_remaining: Number(percentageRemaining.toFixed(1)),
				inventory_status: 'CRITICAL',
				inventory_status_label: 'Critical Inventory',
				inventory_status_row_class: 'inventory-warning-critical'
			}
		}

		if (percentageRemaining <= LOW_INVENTORY_PERCENTAGE) {
			return {
				inventory_percentage_remaining: Number(percentageRemaining.toFixed(1)),
				inventory_status: 'LOW',
				inventory_status_label: 'Low Inventory',
				inventory_status_row_class: 'inventory-warning-low'
			}
		}

		return {
			inventory_percentage_remaining: Number(percentageRemaining.toFixed(1)),
			inventory_status: 'NORMAL',
			inventory_status_label: 'Normal',
			inventory_status_row_class: ''
		}
	}
	const normalizeMedicationNameSpacing = value => {
		const normalizedName = String(value === undefined || value === null ? '' : value)
			.trim()
			.replace(/\s+/g, ' ')
		return normalizedName.charAt(0).toUpperCase() + normalizedName.slice(1)
	}
	const normalizeMedicationIdentityText = value => normalizeMedicationNameSpacing(value).toLowerCase()
	const ADD_HEALTH_OPTION_VALUE = '__ADD_HEALTH_OPTION_VALUE__'
	const HEALTH_OPTION_DISPLAY_VALUE_MAX_LENGTH = healthOptionConfig.displayValueMaxLength
	const HEALTH_OPTION_CODE_MAX_LENGTH = healthOptionConfig.codeMaxLength
	const MEDICATION_OPTION_TYPES = healthOptionConfig.medicationTypes
	const normalizeHealthOptionDisplayValue = healthOptionConfig.normalizeDisplayValue
	const buildHealthOptionCode = healthOptionConfig.buildCode
	const normalizeHealthOptionRecord = healthOptionConfig.normalizeRecord
	const INVENTORY_ENTRY_CORRECTION_TYPES = new Set(['ADDEDINERROR', 'WRONGNUMBERENTERED'])
	const normalizeInventoryTransactionType = value => String(value === undefined || value === null ? '' : value)
		.toUpperCase()
		.replace(/[^A-Z0-9]/g, '')
	const isInventoryEntryCorrection = transaction => INVENTORY_ENTRY_CORRECTION_TYPES.has(
		normalizeInventoryTransactionType(transaction && transaction.transaction_type)
	)
	const roundedInventoryQuantity = value => Number(Number(value || 0).toFixed(10))
	const getInventoryBatchDisplay = (batches, hideDepletedInventory) => {
		const displayBatches = (batches || []).filter(batch =>
			(Number(batch.effective_quantity_added) > 0 || Number(batch.inventory_entry_correction_quantity) <= 0) &&
			(!hideDepletedInventory || Number(batch.quantity_remaining) > 0)
		)
		return {
			displayBatches,
			displayTotalEffective: roundedInventoryQuantity(displayBatches.reduce(
				(total, batch) => total + (Number(batch.effective_quantity_added) || 0),
				0
			)),
			displayTotalRemaining: roundedInventoryQuantity(displayBatches.reduce(
				(total, batch) => total + (Number(batch.quantity_remaining) || 0),
				0
			))
		}
	}
	const normalizeDateKey = value => {
		if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
			return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
		}
		const dateText = String(value || '').trim()
		const isoMatch = dateText.match(/^(\d{4})-(\d{2})-(\d{2})/)
		if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
		const usMatch = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
		if (usMatch) return `${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`
		return dateText
	}
	const isVariableDose = record => Boolean(record && Number(record.variable_dose) === 1)
	const isValidPrescribedDose = record => {
		if (isVariableDose(record)) return true
		const amount = String(record && record.dose_amount !== undefined && record.dose_amount !== null ? record.dose_amount : '').trim()
		return /^(?:\d+\.?\d*|\.\d+)$/.test(amount) && Number.isFinite(Number(amount)) && Number(amount) > 0
	}
	const prescribedDoseFields = record => ({
		variable_dose: isVariableDose(record) ? 1 : 0,
		// psApiService retains empty strings. Verify numeric-field clearing on the installed schema API.
		dose_amount: isVariableDose(record) ? '' : record.dose_amount
	})
	const resolvePrescribedDose = (snapshot, fallback = {}) => {
		const hasFlag = snapshot.variable_dose !== undefined && snapshot.variable_dose !== null && snapshot.variable_dose !== ''
		const hasAmount = snapshot.dose_amount !== undefined && snapshot.dose_amount !== null && snapshot.dose_amount !== ''
		// A legacy numeric snapshot stays fixed even after its medication becomes variable.
		if (hasFlag || hasAmount) return prescribedDoseFields(snapshot)
		// Legacy rows with no prescribed snapshot may use a fixed fallback, never a later variable designation.
		return { variable_dose: 0, dose_amount: isVariableDose(fallback) ? null : fallback.dose_amount }
	}
	const medicationDoseDisplay = (record, unit = record.dose_unit) => {
		const amount = isVariableDose(record) ? 'Varies' : String(record.dose_amount === undefined || record.dose_amount === null ? '' : record.dose_amount)
		if (!amount) return '—'
		return unit ? `${amount}${isVariableDose(record) ? ' · ' : ' '}${unit}` : amount
	}
	const secondsToTime12 = value => {
		const totalSeconds = Number(value)
		if (!Number.isFinite(totalSeconds)) return ''
		const hours24 = Math.floor(totalSeconds / 3600) % 24
		const minutes = Math.floor((totalSeconds % 3600) / 60)
		const hours12 = hours24 % 12 || 12
		return `${String(hours12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${hours24 >= 12 ? 'PM' : 'AM'}`
	}
	const parseDateKeyParts = value => {
		const dateKey = normalizeDateKey(value)
		const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)
		return match
			? { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]), dateKey }
			: null
	}
	const dateKeyFromParts = (year, month, day) =>
		`${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
	const daysInMonth = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate()
	const monthNames = [
		'January', 'February', 'March', 'April', 'May', 'June',
		'July', 'August', 'September', 'October', 'November', 'December'
	]
	const staffInitials = value => {
		const nameParts = String(value || '').trim().split(/\s+/).filter(Boolean)
		if (!nameParts.length) return '—'
		if (nameParts.length === 1) return nameParts[0].charAt(0).toUpperCase()
		return `${nameParts[0].charAt(0)}${nameParts[nameParts.length - 1].charAt(0)}`.toUpperCase()
	}
	const staffInitialsWithMiddle = (value, middleName) => {
		const nameParts = String(value || '').trim().split(/\s+/).filter(Boolean)
		const middleInitial = String(middleName || '').trim().charAt(0).toUpperCase()
		if (nameParts.length < 2 || !middleInitial) return staffInitials(value)
		return `${nameParts[0].charAt(0)}${middleInitial}${nameParts[nameParts.length - 1].charAt(0)}`.toUpperCase()
	}
	const staffDisplayName = (value, middleName) => {
		const nameParts = String(value || '').trim().split(/\s+/).filter(Boolean)
		const middle = String(middleName || '').trim()
		if (nameParts.length < 2 || !middle) return nameParts.join(' ')
		return [nameParts[0], middle].concat(nameParts.slice(1)).join(' ')
	}
	const staffIdentity = row => {
		const dcid = String(row && row.users_dcid || '').trim()
		if (dcid) return `dcid:${dcid}`
		return `name:${String(row && row.user_name || '').trim()}|middle:${String(row && row.user_middle_name || '').trim()}`
	}
	const medicationAbbreviation = value => {
		const letters = String(value || '').match(/[A-Za-z]/g) || []
		return letters.slice(0, 3).join('').toUpperCase() || 'MED'
	}
	const isActiveHealthOption = record => {
		if (record.isVisible === false || record.isVisible === 0 || record.isVisible === '0') return false
		return true
	}
	const buildHealthOptionPayload = (fieldName, option, displayOrder) => ({
		codetype: MEDICATION_OPTION_TYPES[fieldName].codeType,
		code: option.code,
		displayvalue: option.displayValue,
		description: option.displayValue,
		isvisible: 1,
		uidisplayorder: displayOrder
	})

	medicationModule.controller('medicationController', function ($scope, $rootScope, $attrs, $http, $q, jsonDataService, psApiService) {
		const vm = this
		$j(document).dblclick(() => console.log($scope))

		$rootScope.getCurrentTime = () => {
			const now = new Date()
			let hours = now.getHours()
			const minutes = String(now.getMinutes()).padStart(2, '0')
			const meridiem = hours >= 12 ? 'PM' : 'AM'

			hours = hours % 12
			hours = hours === 0 ? 12 : hours
			const hourStr = String(hours).padStart(2, '0')

			return `${hourStr}:${minutes} ${meridiem}`
		}

		vm.appData = {
			context: $attrs.ngContext,
			contextTitle: $attrs.ngContext.charAt(0).toUpperCase() + $attrs.ngContext.slice(1),
			curSchoolId: $attrs.ngCurSchoolId,
			curYearId: $attrs.ngCurYearId,
			curStudentDCID: $attrs.ngCurStudentDcid,
			curStudentName: $attrs.ngCurStudentName,
			curUserDcid: $attrs.ngCurUserDcid,
			curDate: $attrs.ngCurDate,
			curTime: $rootScope.getCurrentTime(),
			districtUser: $attrs.ngCurUserSecurityRoles && ($attrs.ngCurUserSecurityRoles.split(',').includes('9') || $attrs.ngCurUserSecurityRoles.split(',').includes('6')),
			isTestServer: $attrs.ngServerName && $attrs.ngServerName.indexOf('.test.') !== -1,
			medicationOptions: {
				dose_unit: [],
				inventory_unit: [],
				route: [],
				frequency: [],
				removal_type: [],
				not_given_reason: []
			},
			medicationOptionsLoaded: false,
			medicationOptionsLoading: false,
			medicationOptionLoadError: ''
		}

		$rootScope.appData = vm.appData
		$rootScope.isVariableDose = isVariableDose
		$rootScope.medicationDoseDisplay = record => medicationDoseDisplay(record,
			$rootScope.medicationOptionDisplayValue('dose_unit', record.dose_unit))
		const addHealthOptionSentinel = options => options.concat([{
			modelValue: ADD_HEALTH_OPTION_VALUE,
			code: ADD_HEALTH_OPTION_VALUE,
			displayValue: 'Other',
			isAddNew: true
		}])
		const sortHealthOptions = options => options.sort((left, right) => {
			const leftOrder = Number(left.uiDisplayOrder)
			const rightOrder = Number(right.uiDisplayOrder)
			if (Number.isFinite(leftOrder) && Number.isFinite(rightOrder) && leftOrder !== rightOrder) {
				return leftOrder - rightOrder
			}
			if (Number.isFinite(leftOrder) && !Number.isFinite(rightOrder)) return -1
			if (!Number.isFinite(leftOrder) && Number.isFinite(rightOrder)) return 1
			return left.displayValue.localeCompare(right.displayValue)
		})
		const buildMedicationHealthOption = (fieldName, record) => {
			const definition = MEDICATION_OPTION_TYPES[fieldName]
			const displayValue = String(record.displayValue || record.code || '').trim()
			const code = String(record.code || '').trim()
			return {
				id: record.id,
				code,
				displayValue,
				description: record.description,
				uiDisplayOrder: record.uiDisplayOrder,
				modelValue: definition.modelValueField === 'displayValue' ? displayValue : code
			}
		}
		const replaceMedicationOptions = (fieldName, options) => {
			const uniqueOptions = []
			const seenValues = new Set()
			sortHealthOptions(options).forEach(option => {
				const identity = String(option.modelValue || '').toLowerCase()
				if (!identity || seenValues.has(identity)) return
				seenValues.add(identity)
				uniqueOptions.push(option)
			})
			vm.appData.medicationOptions[fieldName] = addHealthOptionSentinel(uniqueOptions)
		}
		$rootScope.addMedicationHealthOption = (fieldName, record) => {
			const existingOptions = (vm.appData.medicationOptions[fieldName] || []).filter(option => !option.isAddNew)
			const newOption = buildMedicationHealthOption(fieldName, normalizeHealthOptionRecord(record))
			const existingOption = existingOptions.find(option =>
				String(option.code).toLowerCase() === String(newOption.code).toLowerCase() ||
				String(option.displayValue).toLowerCase() === String(newOption.displayValue).toLowerCase()
			)
			if (!existingOption) existingOptions.push(newOption)
			replaceMedicationOptions(fieldName, existingOptions)
			return existingOption || newOption
		}
		$rootScope.medicationOptionDisplayValue = (fieldName, value) => {
			const normalizedValue = String(value === undefined || value === null ? '' : value).trim().toLowerCase()
			const option = (vm.appData.medicationOptions[fieldName] || []).find(candidate =>
				!candidate.isAddNew && (
					String(candidate.modelValue).toLowerCase() === normalizedValue ||
					String(candidate.code).toLowerCase() === normalizedValue ||
					String(candidate.displayValue).toLowerCase() === normalizedValue
				)
			)
			return option ? option.displayValue : value
		}
		const loadMedicationOptions = () => {
			if (vm.appData.medicationOptionsLoaded) return $q.when()
			vm.appData.medicationOptionsLoading = true
			vm.appData.medicationOptionLoadError = ''

			return psApiService.psApiCall('u_cdol_health_option', 'GET', { loadAllPages: true })
				.then(records => (Array.isArray(records) ? records : (records ? [records] : []))
					.map(normalizeHealthOptionRecord))
				.then(records => {
					Object.keys(MEDICATION_OPTION_TYPES).forEach(fieldName => {
						const definition = MEDICATION_OPTION_TYPES[fieldName]
						const options = records
							.filter(record =>
								String(record.codeType).toLowerCase() === definition.codeType.toLowerCase() &&
								record.code &&
								isActiveHealthOption(record)
							)
							.map(record => buildMedicationHealthOption(fieldName, record))
						replaceMedicationOptions(fieldName, options)
					})
					vm.appData.medicationOptionsLoaded = true
				})
				.catch(error => {
					vm.appData.medicationOptionLoadError = (error.data && error.data.message) ||
						'Medication options could not be loaded. Try again or contact an administrator.'
					Object.keys(MEDICATION_OPTION_TYPES).forEach(fieldName => {
						vm.appData.medicationOptions[fieldName] = []
					})
				})
				.finally(() => {
					vm.appData.medicationOptionsLoading = false
				})
		}
		let administrationFeedbackTimeout = null
		const clearAdministrationFeedback = () => {
			if (administrationFeedbackTimeout !== null) {
				window.clearTimeout(administrationFeedbackTimeout)
				administrationFeedbackTimeout = null
			}
			vm.appData.administrationFeedback = ''
		}
		$rootScope.showAdministrationFeedback = message => {
			clearAdministrationFeedback()
			vm.appData.administrationFeedback = message
			administrationFeedbackTimeout = window.setTimeout(() => {
				administrationFeedbackTimeout = null
				$scope.$applyAsync(() => {
					vm.appData.administrationFeedback = ''
				})
			}, 5000)
		}
		$rootScope.existingMedicationList = []
		vm.medicationList = []
		vm.availableMedicationList = []
		vm.administrationList = []
		vm.administrationChart = { months: [], medicationLegend: [], staffLegend: [], yearLabel: '' }
		vm.administrationCalendarRows = []
		vm.administrationMedicationOptions = []
		vm.historyMedicationId = ''
		vm.administrationView = String($attrs.ngAdministrationView || '').trim().toLowerCase() === 'chart'
			? 'chart'
			: 'list'
		vm.filterAdministrationByMedication = administration => {
			return !vm.historyMedicationId || String(administration.medication_id) === String(vm.historyMedicationId)
		}
		vm.transactionTypeLabel = transactionType => {
			if (transactionType === 'REVERSAL') return 'Reversal'
			if (transactionType === 'ADMINISTRATION') return 'Administration'
			if (transactionType === 'ADMINISTRATION_CORRECTION') return 'Administration Correction'
			if (transactionType === 'ADMINISTRATION_VOID') return 'Administration Entered in Error'
			if (transactionType === 'NON_ADMINISTRATION') return 'Not Given'
			if (transactionType === 'NON_ADMINISTRATION_CORRECTION') return 'Not-Given Correction'
			return $rootScope.medicationOptionDisplayValue('removal_type', transactionType)
		}
		vm.beginTransactionDrawer = () => loadingDialog()
		vm.clearAdministrationFeedback = clearAdministrationFeedback

		const parseJsonArray = value => {
			if (Array.isArray(value)) return value
			if (typeof value !== 'string') return []
			try {
				return JSON.parse(value)
			} catch (error) {
				return []
			}
		}

		const applyInventoryStatus = medication => {
			const quantityRemaining = Math.max(0, Number(medication.inventory_total_remaining) || 0)
			const storedBaselineQuantity = Number(medication.inventory_baseline_quantity)
			const effectiveInventoryQuantity = Number(medication.inventory_total_effective)
			const historicalInventoryQuantity = Number(medication.inventory_total_initial)
			let baselineQuantity = storedBaselineQuantity > 0
				? storedBaselineQuantity
				: (effectiveInventoryQuantity > 0
					? effectiveInventoryQuantity
					: (historicalInventoryQuantity > 0 ? historicalInventoryQuantity : quantityRemaining))
			if (effectiveInventoryQuantity > 0 && baselineQuantity > effectiveInventoryQuantity) {
				baselineQuantity = effectiveInventoryQuantity
			}

			Object.assign(medication, getInventoryStatus(quantityRemaining, baselineQuantity))
		}

		const prepareMedicationData = (medications, transactions, administrationSettings) => {
			const transactionRows = Array.isArray(transactions) ? transactions : []
			const settingBySchool = new Map()
			;(Array.isArray(administrationSettings) ? administrationSettings : [])
				.filter(Boolean)
				.slice()
				.sort((left, right) => Number(left.id) - Number(right.id))
				.forEach(setting => settingBySchool.set(Number(setting.schoolid), setting))

			return (medications || []).map(medication => {
				medication.inventory_batches = parseJsonArray(medication.inventory_batches)
				medication.inventory_transactions = transactionRows.filter(transaction =>
					Number(transaction.medication_id) === Number(medication.medication_id)
				)

				let inventoryEntryCorrectionQuantity = Math.max(0, -medication.inventory_transactions
					.filter(isInventoryEntryCorrection)
					.reduce(
						(total, transaction) => total + (Number(transaction.quantity_change) || 0),
						0
					))
				let operationalQuantityToConsume = Math.max(0, -medication.inventory_transactions
					.filter(transaction => !isInventoryEntryCorrection(transaction))
					.reduce(
						(total, transaction) => total + (Number(transaction.quantity_change) || 0),
						0
					))
				const sortedBatches = medication.inventory_batches.slice().sort((left, right) => {
					const dateComparison = String(left.added_date || '').localeCompare(String(right.added_date || ''))
					return dateComparison || Number(left.inventory_id) - Number(right.inventory_id)
				})

				sortedBatches.forEach(batch => {
					const quantityAdded = Math.max(0, Number(batch.quantity_added) || 0)
					const correctionQuantity = Math.min(quantityAdded, inventoryEntryCorrectionQuantity)
					const effectiveQuantityAdded = roundedInventoryQuantity(quantityAdded - correctionQuantity)
					const quantityConsumed = Math.min(effectiveQuantityAdded, operationalQuantityToConsume)

					batch.inventory_entry_correction_quantity = roundedInventoryQuantity(correctionQuantity)
					batch.effective_quantity_added = effectiveQuantityAdded
					batch.quantity_remaining = roundedInventoryQuantity(effectiveQuantityAdded - quantityConsumed)
					inventoryEntryCorrectionQuantity = roundedInventoryQuantity(inventoryEntryCorrectionQuantity - correctionQuantity)
					operationalQuantityToConsume = roundedInventoryQuantity(operationalQuantityToConsume - quantityConsumed)
				})
				medication.inventory_total_effective = roundedInventoryQuantity(sortedBatches.reduce(
					(total, batch) => total + (Number(batch.effective_quantity_added) || 0),
					0
				))
				medication.inventory_total_remaining = roundedInventoryQuantity(sortedBatches.reduce(
					(total, batch) => total + (Number(batch.quantity_remaining) || 0),
					0
				))
				const schoolSetting = settingBySchool.get(Number(medication.schoolid))
				const inventoryBatchDisplay = getInventoryBatchDisplay(
					sortedBatches,
					Boolean(schoolSetting && Number(schoolSetting.hide_depleted_inventory) === 1)
				)
				medication.display_inventory_batches = inventoryBatchDisplay.displayBatches
				medication.inventory_total_display_effective = inventoryBatchDisplay.displayTotalEffective
				medication.inventory_total_display_remaining = inventoryBatchDisplay.displayTotalRemaining
				applyInventoryStatus(medication)

				const correctionRowsByOriginal = new Map()
				medication.inventory_transactions
					.filter(transaction => ['REVERSAL', 'ADMINISTRATION_CORRECTION', 'ADMINISTRATION_VOID'].includes(transaction.transaction_type))
					.forEach(transaction => {
						const originalTransactionId = Number(transaction.reversal_of_transaction_id)
						if (!Number.isFinite(originalTransactionId) || originalTransactionId <= 0) return
						if (!correctionRowsByOriginal.has(originalTransactionId)) correctionRowsByOriginal.set(originalTransactionId, [])
						correctionRowsByOriginal.get(originalTransactionId).push(transaction)
					})

				medication.inventory_transactions.forEach(transaction => {
					const correctionRows = (correctionRowsByOriginal.get(Number(transaction.transaction_id)) || [])
						.slice()
						.sort((left, right) => Number(left.transaction_id) - Number(right.transaction_id))
					const latestCorrection = correctionRows[correctionRows.length - 1]
					transaction.is_reversed = Boolean(latestCorrection && latestCorrection.transaction_type === 'REVERSAL')
					transaction.correction_status_label = latestCorrection && latestCorrection.transaction_type === 'ADMINISTRATION_VOID'
						? 'Entered in Error'
						: (latestCorrection && latestCorrection.transaction_type === 'ADMINISTRATION_CORRECTION' ? 'Corrected' : '')
				})

				return medication
			})
		}

		const prepareAdministrationHistory = (medications, transactions, expectedAdministrations) => {
			const medicationById = new Map((medications || []).map(medication => [Number(medication.medication_id), medication]))
			const transactionRows = transactions || []
			const administrationCorrectionsByOriginal = new Map()
			const notGivenCorrectionsByOriginal = new Map()
			const notGivenById = new Map()

			transactionRows.forEach(transaction => {
				const transactionId = Number(transaction.transaction_id)
				const originalTransactionId = Number(transaction.reversal_of_transaction_id)
				if (transaction.transaction_type === 'NON_ADMINISTRATION' && Number.isFinite(transactionId)) {
					notGivenById.set(transactionId, transaction)
				}
				if (['ADMINISTRATION_CORRECTION', 'ADMINISTRATION_VOID'].includes(transaction.transaction_type) && originalTransactionId > 0) {
					if (!administrationCorrectionsByOriginal.has(originalTransactionId)) administrationCorrectionsByOriginal.set(originalTransactionId, [])
					administrationCorrectionsByOriginal.get(originalTransactionId).push(transaction)
				}
				if (transaction.transaction_type === 'NON_ADMINISTRATION_CORRECTION' && originalTransactionId > 0) {
					if (!notGivenCorrectionsByOriginal.has(originalTransactionId)) notGivenCorrectionsByOriginal.set(originalTransactionId, [])
					notGivenCorrectionsByOriginal.get(originalTransactionId).push(transaction)
				}
			})

			const administrationRows = transactionRows
				.filter(transaction => transaction.transaction_type === 'ADMINISTRATION')
				.map(transaction => {
					const medication = medicationById.get(Number(transaction.medication_id)) || {}
					const administration = Object.assign({}, transaction, {
						root_transaction_id: Number(transaction.transaction_id),
						medication_name: transaction.medication_name || medication.medication_name,
						...resolvePrescribedDose(transaction, medication),
						dose_unit: transaction.dose_unit || medication.dose_unit,
						inventory_unit: transaction.inventory_unit || medication.inventory_unit,
						route: transaction.route || medication.route,
						frequency: transaction.frequency || medication.frequency,
						quantity_administered: Number(transaction.administration_quantity) || Math.abs(Number(transaction.quantity_change) || 0),
						inventory_total_remaining: Number(medication.inventory_total_remaining) || 0,
						is_given: true,
						is_corrected: false,
						is_entered_in_error: false,
						status_label: 'Given',
						correction_status_label: '',
						correction_history: []
					})

					const convertedNotGiven = notGivenById.get(Number(transaction.reversal_of_transaction_id))
					if (convertedNotGiven) {
						administration.correction_history.push({
							status_label: 'Previously Not Given',
							correction_date: transaction.correction_date || transaction.recorded_date,
							correction_time: transaction.correction_time || transaction.recorded_time,
							correction_user_name: transaction.correction_user_name || transaction.user_name,
							correction_reason: transaction.correction_reason || convertedNotGiven.not_given_reason_label
						})
					}

					const correctionRows = (administrationCorrectionsByOriginal.get(administration.root_transaction_id) || [])
						.slice()
						.sort((left, right) => Number(left.transaction_id) - Number(right.transaction_id))

					correctionRows.forEach(correction => {
						administration.correction_history.push({
							status_label: correction.transaction_type === 'ADMINISTRATION_VOID' ? 'Entered in Error' : 'Corrected',
							correction_date: correction.correction_date,
							correction_time: correction.correction_time,
							correction_user_name: correction.correction_user_name,
							correction_reason: correction.correction_reason,
							previous_dose_display: $rootScope.medicationDoseDisplay(administration),
							prescribed_dose_display: $rootScope.medicationDoseDisplay(Object.assign({}, administration, resolvePrescribedDose(correction, administration)))
						})
						administration.effective_transaction_id = Number(correction.transaction_id)
						administration.correction_date = correction.correction_date
						administration.correction_time = correction.correction_time
						administration.correction_users_dcid = correction.correction_users_dcid
						administration.correction_user_name = correction.correction_user_name
						administration.correction_reason = correction.correction_reason

						if (correction.transaction_type === 'ADMINISTRATION_VOID') {
							administration.is_entered_in_error = true
							administration.is_corrected = false
							administration.status_label = 'Entered in Error'
							administration.correction_status_label = 'Entered in Error'
							return
						}

						administration.event_date = correction.event_date
						administration.event_time = correction.event_time
						administration.users_dcid = correction.users_dcid
						administration.user_name = correction.user_name
						administration.user_middle_name = correction.user_middle_name
						administration.notes = correction.notes
						administration.medication_name = correction.medication_name || administration.medication_name
						Object.assign(administration, resolvePrescribedDose(correction, administration))
						administration.dose_unit = correction.dose_unit || administration.dose_unit
						administration.inventory_unit = correction.inventory_unit || administration.inventory_unit
						administration.route = correction.route || administration.route
						administration.frequency = correction.frequency || administration.frequency
						administration.quantity_administered = Number(correction.administration_quantity) || administration.quantity_administered
						administration.is_corrected = true
						administration.is_entered_in_error = false
						administration.status_label = 'Corrected'
						administration.correction_status_label = 'Corrected'
					})

					return administration
				})

			const effectiveConvertedNotGivenIds = new Set(administrationRows
				.filter(administration => !administration.is_entered_in_error && notGivenById.has(Number(administration.reversal_of_transaction_id)))
				.map(administration => Number(administration.reversal_of_transaction_id)))

			const notGivenRows = Array.from(notGivenById.entries())
				.filter(([transactionId]) => !effectiveConvertedNotGivenIds.has(transactionId))
				.map(([transactionId, transaction]) => {
					const medication = medicationById.get(Number(transaction.medication_id)) || {}
					const notGiven = Object.assign({}, transaction, {
						root_transaction_id: transactionId,
						medication_name: transaction.medication_name || medication.medication_name,
						...resolvePrescribedDose(transaction, medication),
						dose_unit: transaction.dose_unit || medication.dose_unit,
						inventory_unit: transaction.inventory_unit || medication.inventory_unit,
						route: transaction.route || medication.route,
						frequency: transaction.frequency || medication.frequency,
						inventory_total_remaining: Number(medication.inventory_total_remaining) || 0,
						quantity_administered: null,
						is_not_given: true,
						status_label: 'Not Given',
						correction_history: []
					})

					const correctionRows = (notGivenCorrectionsByOriginal.get(transactionId) || [])
						.slice()
						.sort((left, right) => Number(left.transaction_id) - Number(right.transaction_id))
					correctionRows.forEach(correction => {
						notGiven.correction_history.push({
							status_label: 'Not-Given Entry Corrected',
							correction_date: correction.correction_date,
							correction_time: correction.correction_time,
							correction_user_name: correction.correction_user_name,
							correction_reason: correction.correction_reason,
							previous_dose_display: $rootScope.medicationDoseDisplay(notGiven),
							prescribed_dose_display: $rootScope.medicationDoseDisplay(Object.assign({}, notGiven, resolvePrescribedDose(correction, notGiven)))
						})
						Object.assign(notGiven, resolvePrescribedDose(correction, notGiven))
						notGiven.not_given_reason_code = correction.not_given_reason_code || notGiven.not_given_reason_code
						notGiven.not_given_reason_label = correction.not_given_reason_label || notGiven.not_given_reason_label
						notGiven.notes = correction.notes
						notGiven.is_corrected = true
						notGiven.correction_status_label = 'Corrected'
					})
					return notGiven
				})

			const resolvedOccurrenceKeys = new Set()
			administrationRows.forEach(row => {
				if (!row.is_entered_in_error) resolvedOccurrenceKeys.add(`${Number(row.medication_id)}|${normalizeDateKey(row.event_date)}`)
			})
			notGivenRows.forEach(row => resolvedOccurrenceKeys.add(`${Number(row.medication_id)}|${normalizeDateKey(row.event_date)}`))

			const expectedRowsByOccurrence = new Map()
			;(expectedAdministrations || []).forEach(expected => {
				const medicationId = Number(expected.medication_id)
				const dateKey = normalizeDateKey(expected.expected_date)
				const occurrenceKey = `${medicationId}|${dateKey}`
				if (!medicationId || !dateKey || resolvedOccurrenceKeys.has(occurrenceKey) || expectedRowsByOccurrence.has(occurrenceKey)) return
				const medication = medicationById.get(medicationId) || expected
				expectedRowsByOccurrence.set(occurrenceKey, {
					root_transaction_id: `expected-${medicationId}-${dateKey}`,
					occurrence_key: occurrenceKey,
					medication_id: medicationId,
					schoolid: Number(expected.schoolid || medication.schoolid),
					event_date: dateKey,
					event_time: Number(expected.daily_cutoff_time),
					daily_cutoff_time: Number(expected.daily_cutoff_time),
					medication_name: medication.medication_name,
					dose_amount: medication.dose_amount,
					variable_dose: isVariableDose(medication) ? 1 : 0,
					dose_unit: medication.dose_unit,
					inventory_unit: medication.inventory_unit,
					route: medication.route,
					frequency: medication.frequency,
					inventory_total_remaining: Number(medication.inventory_total_remaining) || 0,
					quantity_administered: null,
					is_action_required: true,
					status_label: 'Action Required',
					correction_history: []
				})
			})

			return administrationRows.concat(notGivenRows, Array.from(expectedRowsByOccurrence.values()))
				.sort((left, right) => {
					const dateComparison = normalizeDateKey(right.event_date).localeCompare(normalizeDateKey(left.event_date))
					if (dateComparison) return dateComparison
					return Number(right.event_time || 0) - Number(left.event_time || 0)
				})
		}

		const prepareAdministrationMedicationOptions = administrations => {
			const optionsByMedication = new Map()
			const administrationRows = administrations || []
			administrationRows.forEach(administration => {
				const medicationId = Number(administration.medication_id)
				if (!Number.isFinite(medicationId) || optionsByMedication.has(medicationId)) return
				optionsByMedication.set(medicationId, {
					medication_id: medicationId,
					label: `${administration.medication_name} - ${$rootScope.medicationDoseDisplay(administration)}`
				})
			})
			return Array.from(optionsByMedication.values()).sort((left, right) => left.label.localeCompare(right.label))
		}

		const prepareAdministrationChart = (medications, administrations, calendarRows) => {
			const normalizedCalendarRows = (calendarRows || []).map(row => Object.assign({}, row, {
				calendar_date: normalizeDateKey(row.calendar_date),
				year_start_date: normalizeDateKey(row.year_start_date),
				year_end_date: normalizeDateKey(row.year_end_date)
			})).filter(row => parseDateKeyParts(row.calendar_date))

			const startDate = normalizedCalendarRows
				.map(row => row.year_start_date)
				.filter(Boolean)
				.sort()[0]
			const endDates = normalizedCalendarRows
				.map(row => row.year_end_date)
				.filter(Boolean)
				.sort()
			const endDate = endDates[endDates.length - 1]
			const startParts = parseDateKeyParts(startDate)
			const endParts = parseDateKeyParts(endDate)
			if (!startParts || !endParts) {
				return { months: [], medicationLegend: [], staffLegend: [], yearLabel: '' }
			}

			const medicationLegend = (medications || [])
				.slice()
				.sort((left, right) => {
					const nameComparison = String(left.medication_name || '').localeCompare(String(right.medication_name || ''))
					if (nameComparison) return nameComparison
					const doseComparison = Number(left.dose_amount || 0) - Number(right.dose_amount || 0)
					return doseComparison || Number(left.medication_id || 0) - Number(right.medication_id || 0)
				})
				.map(medication => Object.assign({}, medication, {
					key: medicationAbbreviation(medication.medication_name),
					label: `${medication.medication_name} — ${medicationDoseDisplay(medication)}`
				}))
			const medicationById = new Map(medicationLegend.map(medication => [Number(medication.medication_id), medication]))

			const effectiveRows = (administrations || []).filter(row => !row.is_entered_in_error)
			const staffMembersByIdentity = effectiveRows
				.filter(row => row.is_given && String(row.user_name || '').trim())
				.reduce((members, row) => {
					const identity = staffIdentity(row)
					if (!members.has(identity)) {
						members.set(identity, {
							identity,
							name: String(row.user_name).trim(),
							middle_name: String(row.user_middle_name || '').trim(),
							entry_count: 0
						})
					}
					const staff = members.get(identity)
					staff.entry_count += 1
					if (!staff.middle_name && row.user_middle_name) {
						staff.middle_name = String(row.user_middle_name).trim()
					}
					return members
				}, new Map())
			const staffMembers = Array.from(staffMembersByIdentity.values())
				.sort((left, right) => left.name.localeCompare(right.name)
					|| left.middle_name.localeCompare(right.middle_name)
					|| left.identity.localeCompare(right.identity))
			const baseInitialCounts = staffMembers.reduce((counts, staff) => {
				const initials = staffInitials(staff.name)
				counts.set(initials, (counts.get(initials) || 0) + 1)
				return counts
			}, new Map())
			const candidateInitialCounts = staffMembers.reduce((counts, staff) => {
				const base = staffInitials(staff.name)
				const candidate = baseInitialCounts.get(base) > 1
					? staffInitialsWithMiddle(staff.name, staff.middle_name)
					: base
				counts.set(candidate, (counts.get(candidate) || 0) + 1)
				return counts
			}, new Map())
			const primaryStaffByBase = staffMembers.reduce((primaryStaff, staff) => {
				const base = staffInitials(staff.name)
				const current = primaryStaff.get(base)
				if (!current || staff.entry_count > current.entry_count) primaryStaff.set(base, staff)
				return primaryStaff
			}, new Map())
			const candidateInitialIndexes = new Map()
			const staffLegend = staffMembers.map(staff => {
				const base = staffInitials(staff.name)
				const hasCollision = baseInitialCounts.get(base) > 1
				const candidate = hasCollision
					? staffInitialsWithMiddle(staff.name, staff.middle_name)
					: base
				const candidateIndex = (candidateInitialIndexes.get(candidate) || 0) + 1
				candidateInitialIndexes.set(candidate, candidateIndex)
				return {
					identity: staff.identity,
					name: hasCollision ? staffDisplayName(staff.name, staff.middle_name) : staff.name,
					key: hasCollision && candidateInitialCounts.get(candidate) > 1
						? `${candidate}${candidateIndex}`
						: candidate,
					signature_class: hasCollision && primaryStaffByBase.get(base).identity !== staff.identity ? 'secondary' : '',
					entry_count: staff.entry_count
				}
			})
			const staffByIdentity = new Map(staffLegend.map(staff => [staff.identity, staff]))

			const eventsByDate = new Map()
			effectiveRows.forEach(row => {
				const dateKey = normalizeDateKey(row.event_date)
				const medication = medicationById.get(Number(row.medication_id))
				if (!medication || !parseDateKeyParts(dateKey) || dateKey < startDate || dateKey > endDate) return

				let detail = ''
				let statusClass = ''
				let accessibleStatus = ''
				let staffSignatureClass = ''
				if (row.is_given) {
					const staffName = String(row.user_name || '').trim()
					const staff = staffByIdentity.get(staffIdentity(row))
					detail = staff ? staff.key : '—'
					staffSignatureClass = staff ? staff.signature_class : ''
					statusClass = 'administration-chart-given'
					accessibleStatus = `given by ${staff ? staff.name : staffName || 'unknown staff'}`
				} else if (row.is_not_given) {
					detail = row.not_given_reason_label || 'Not Given'
					statusClass = 'administration-chart-not-given'
					accessibleStatus = `not given: ${detail}`
				} else if (row.is_action_required) {
					detail = 'Missed'
					statusClass = 'administration-chart-missed'
					accessibleStatus = 'missed administration'
				} else {
					return
				}

				if (!eventsByDate.has(dateKey)) eventsByDate.set(dateKey, [])
				eventsByDate.get(dateKey).push({
					medication_key: medication.key,
					medication_order: medicationLegend.indexOf(medication),
					event_time: Number(row.event_time || 0),
					detail,
					is_given: Boolean(row.is_given),
					staff_signature_class: staffSignatureClass,
					label: `${medication.key} ${detail}`,
					status_class: statusClass,
					aria_label: `${medication.medication_name}, ${accessibleStatus}`
				})
			})
			eventsByDate.forEach(events => events.sort((left, right) =>
				left.medication_order - right.medication_order || left.event_time - right.event_time
			))

			const calendarByDate = new Map()
			normalizedCalendarRows.forEach(row => {
				const existing = calendarByDate.get(row.calendar_date)
				const normalized = {
					in_session: Number(row.in_session) === 1,
					is_enrolled: Number(row.is_enrolled) === 1,
					note: String(row.calendar_note || '').trim()
				}
				if (!existing) {
					calendarByDate.set(row.calendar_date, normalized)
					return
				}
				existing.in_session = existing.in_session || normalized.in_session
				existing.is_enrolled = existing.is_enrolled || normalized.is_enrolled
				if (!existing.note && normalized.note) existing.note = normalized.note
			})

			const months = []
			let year = startParts.year
			let month = startParts.month
			while (year < endParts.year || (year === endParts.year && month <= endParts.month)) {
				const maximumDay = daysInMonth(year, month)
				const cells = []
				for (let day = 1; day <= 31; day += 1) {
					const dateKey = dateKeyFromParts(year, month, day)
					const invalid = day > maximumDay
					const outsideYear = !invalid && (dateKey < startDate || dateKey > endDate)
					const calendar = calendarByDate.get(dateKey) || { in_session: false, is_enrolled: false, note: '' }
					const weekday = invalid ? null : new Date(Date.UTC(year, month - 1, day)).getUTCDay()
					const weekend = !invalid && (weekday === 0 || weekday === 6)
					let marker = ''
					let dayType = 'In session'
					if (invalid || outsideYear) {
						dayType = 'Not part of the selected school year'
					} else if (weekend) {
						marker = 'W'
						dayType = 'Weekend'
					} else if (!invalid && !outsideYear && !calendar.in_session) {
						marker = 'NS'
						dayType = calendar.note || 'Not in session'
					} else if (!invalid && !outsideYear && !calendar.is_enrolled) {
						marker = 'NE'
						dayType = 'Student not enrolled'
					}
					const events = invalid || outsideYear ? [] : (eventsByDate.get(dateKey) || [])
					const eventLabels = events.map(event => event.aria_label)
					cells.push({
						day,
						date_key: dateKey,
						is_unavailable: invalid || outsideYear,
						is_weekend: weekend && !outsideYear,
						is_non_session: !invalid && !outsideYear && !weekend && !calendar.in_session,
						is_not_enrolled: !invalid && !outsideYear && !weekend && calendar.in_session && !calendar.is_enrolled,
						marker,
						events,
						aria_label: invalid || outsideYear
							? `${monthNames[month - 1]} ${day}: not part of the selected school year`
							: `${monthNames[month - 1]} ${day}, ${year}: ${[dayType].concat(eventLabels).join('; ')}`
					})
				}
				months.push({ label: monthNames[month - 1], year, cells })
				month += 1
				if (month > 12) {
					month = 1
					year += 1
				}
			}

			return {
				months,
				medicationLegend,
				staffLegend,
				yearLabel: startParts.year === endParts.year
					? String(startParts.year)
					: `${startParts.year}–${endParts.year}`
			}
		}
		vm.rebuildAdministrationChart = () => {
			const selectedMedicationId = Number(vm.historyMedicationId)
			const hasSelectedMedication = Number.isFinite(selectedMedicationId) && selectedMedicationId > 0
			const chartMedications = hasSelectedMedication
				? vm.medicationList.filter(medication => Number(medication.medication_id) === selectedMedicationId)
				: vm.medicationList
			const chartAdministrations = hasSelectedMedication
				? vm.administrationList.filter(administration => Number(administration.medication_id) === selectedMedicationId)
				: vm.administrationList
			vm.administrationChart = prepareAdministrationChart(
				chartMedications,
				chartAdministrations,
				vm.administrationCalendarRows
			)
		}

		$rootScope.loadData = () => {
			loadingDialog()
			const paramValues = {
				curStudentDCID: vm.appData.curStudentDCID,
				curSchoolID: vm.appData.curSchoolId,
				yearID: vm.appData.curYearId
			}

			vm[`${$rootScope.appData.context}List`] = []

			const staffPromise = $q.when(jsonDataService.getData('staff', { curSchoolID: paramValues.curSchoolID })).then(staffList => {
				$rootScope.appData.staffList = staffList
			})

			const medicationDataName = $rootScope.appData.context === 'administration' ? 'inventory' : $rootScope.appData.context
			const medicationPromise = $http({
				url: `./data/${medicationDataName}.json`,
				method: 'GET',
				params: paramValues
			}).then(res => Array.isArray(res?.data) ? psUtils.htmlEntitiesToCharCode(res.data) : [])

			const transactionPromise = $http({
				url: './data/inventoryTransactions.json',
				method: 'GET',
				params: paramValues
			}).then(res => Array.isArray(res?.data) ? psUtils.htmlEntitiesToCharCode(res.data) : [])

			const medicationOptionsPromise = loadMedicationOptions()
			const settingsPromise = ['administration', 'inventory'].includes($rootScope.appData.context)
				? psApiService.psApiCall('u_cdol_med_admin_setting', 'GET', {})
				: $q.when([])
			const expectedAdministrationsPromise = $rootScope.appData.context === 'administration'
				? $http({
					url: './data/expectedAdministrations.json',
					method: 'GET',
					params: paramValues
				}).then(res => {
					const rows = parseJsonArray(res && res.data)
					return psUtils.htmlEntitiesToCharCode(rows)
				})
				: $q.when([])
			const administrationCalendarPromise = $rootScope.appData.context === 'administration' && vm.administrationView === 'chart'
				? $http({
					url: './data/administrationCalendar.json',
					method: 'GET',
					params: paramValues
				}).then(res => {
					const rows = parseJsonArray(res && res.data)
					return psUtils.htmlEntitiesToCharCode(rows)
				})
				: $q.when([])

			const dataPromise = $q.all([
				medicationPromise,
				transactionPromise,
				medicationOptionsPromise,
				settingsPromise,
				expectedAdministrationsPromise,
				administrationCalendarPromise
			]).then(results => {
				const medicationList = prepareMedicationData(results[0], results[1], results[3])
				vm.medicationList = medicationList
				vm.availableMedicationList = medicationList.filter(medication => Number(medication.inventory_total_remaining) > 0)
				$rootScope.appData.availableMedicationList = vm.availableMedicationList
				if ($rootScope.appData.context === 'administration') {
					const settings = (Array.isArray(results[3]) ? results[3] : [results[3]]).filter(Boolean)
					const settingBySchool = new Map()
					settings
						.slice()
						.sort((left, right) => Number(left.id) - Number(right.id))
						.forEach(setting => settingBySchool.set(Number(setting.schoolid), setting))
					vm.appData.medicationAdministrationSettings = settings
					const dailyMedicationSchoolIds = Array.from(new Set(medicationList
						.filter(medication => String(medication.frequency || '').trim().toLowerCase() === 'daily')
						.map(medication => Number(medication.schoolid))))
					vm.missingCutoffSchoolIds = dailyMedicationSchoolIds.filter(schoolId => !settingBySchool.has(schoolId))
					vm.hasMissingDailyCutoff = vm.missingCutoffSchoolIds.length > 0
					const displaySetting = settingBySchool.get(Number(vm.appData.curSchoolId)) ||
						(dailyMedicationSchoolIds.length === 1 ? settingBySchool.get(dailyMedicationSchoolIds[0]) : null)
					vm.dailyCutoffLabel = displaySetting
						? secondsToTime12(displaySetting.daily_cutoff_time)
						: ''
					vm.administrationList = prepareAdministrationHistory(medicationList, results[1], results[4])
					vm.administrationCalendarRows = results[5]
					vm.appData.activeNotGivenByOccurrence = vm.administrationList
						.filter(row => row.is_not_given)
						.reduce((rows, row) => {
							rows[`${Number(row.medication_id)}|${normalizeDateKey(row.event_date)}`] = row
							return rows
						}, {})
					vm.administrationMedicationOptions = prepareAdministrationMedicationOptions(vm.administrationList)
					vm.rebuildAdministrationChart()
				} else {
					vm[`${$rootScope.appData.context}List`] = medicationList
				}
				$rootScope.existingMedicationList = medicationList
			})

			$q.all([staffPromise, dataPromise]).finally(() => {
				closeLoading()
			})
		}

		$rootScope.reloadData = () => {
			vm[`${$rootScope.appData.context}List`] = []
			vm.medicationList = []
			vm.availableMedicationList = []
			$rootScope.appData.availableMedicationList = []
			if ($rootScope.appData.context === 'administration') {
				vm.administrationList = []
				vm.administrationChart = { months: [], medicationLegend: [], staffLegend: [], yearLabel: '' }
				vm.administrationCalendarRows = []
				vm.administrationMedicationOptions = []
				vm.appData.activeNotGivenByOccurrence = {}
			}
			$rootScope.loadData()
		}

		$rootScope.loadData()
	})

	medicationModule.controller('editController', function ($scope, $rootScope, $q, $timeout, formatService, psApiService) {
		const vm = this
		const recordKey = `${$rootScope.appData.context}Record`
		vm[recordKey] = {}
		vm.medicationRecord = vm[recordKey]
		vm.currentMedicationId = null
		vm.isEditMode = false
		vm.removalMedication = null
		vm.drawerMode = 'edit'
		vm.transactionOpenedFromEdit = false
		vm.transactionRecord = {}
		vm.optionEditors = Object.keys(MEDICATION_OPTION_TYPES).reduce((editors, fieldName) => {
			editors[fieldName] = {
				visible: false,
				value: '',
				error: '',
				saving: false
			}
			return editors
		}, {})
		vm.transactionTypeLabel = transactionType => {
			if (transactionType === 'REVERSAL') return 'Reversal'
			if (transactionType === 'ADMINISTRATION') return 'Administration'
			if (transactionType === 'ADMINISTRATION_CORRECTION') return 'Administration Correction'
			if (transactionType === 'ADMINISTRATION_VOID') return 'Administration Entered in Error'
			if (transactionType === 'NON_ADMINISTRATION') return 'Not Given'
			if (transactionType === 'NON_ADMINISTRATION_CORRECTION') return 'Not-Given Correction'
			return $rootScope.medicationOptionDisplayValue('removal_type', transactionType)
		}
		vm.transactionAffectsInventory = transaction => {
			return Math.abs(Number(transaction && transaction.quantity_change) || 0) > 0.0000000001
		}
		const createInventoryRow = () => ({
			added_date: $rootScope.appData.curDate,
			users_dcid: $rootScope.appData.curUserDcid,
			_isExisting: false
		})

		const withInventoryDefaults = row => Object.assign(createInventoryRow(), row || {})

		const normalizeInventoryRows = () => {
			vm.inventoryRecord = [withInventoryDefaults((vm.inventoryRecord && vm.inventoryRecord[0]) || {})]
			vm.additionalInventoryRows = (vm.additionalInventoryRows || []).map(withInventoryDefaults)
		}

		const ensureFirstInventoryRowDefaults = () => {
			normalizeInventoryRows()
			vm.inventoryRecord[0].added_date = vm.inventoryRecord[0].added_date || $rootScope.appData.curDate
			vm.inventoryRecord[0].users_dcid = vm.inventoryRecord[0].users_dcid || $rootScope.appData.curUserDcid
		}

		const resetInventoryRows = () => {
			vm.inventoryRecord = [createInventoryRow()]
			vm.additionalInventoryRows = []
			ensureFirstInventoryRowDefaults()
		}

		const parseInventoryBatches = inventoryBatches => {
			if (typeof inventoryBatches === 'string') {
				try {
					return JSON.parse(inventoryBatches)
				} catch (e) {
					return []
				}
			}
			return Array.isArray(inventoryBatches) ? inventoryBatches : []
		}

		const sortInventoryBatches = inventoryBatches => {
			const rows = Array.isArray(inventoryBatches) ? inventoryBatches.slice() : []
			return rows.sort((a, b) => {
				const aDate = ((a && a.added_date) || '').toString()
				const bDate = ((b && b.added_date) || '').toString()

				if (aDate === bDate) return 0
				return aDate < bDate ? -1 : 1
			})
		}

		const normalizeIncomingInventoryRow = row => {
			const normalizedRow = Object.assign({}, row || {})
			const addedDate = normalizedRow.added_date
			const inventoryId = normalizedRow.inventory_id

			if (addedDate) {
				normalizedRow.added_date = formatService.formatDateFromApi(formatService.stripTimeFromIsoDate(addedDate))
			}

			if (normalizedRow.users_dcid !== undefined && normalizedRow.users_dcid !== null && normalizedRow.users_dcid !== '') {
				normalizedRow.users_dcid = String(normalizedRow.users_dcid)
			}

			if (inventoryId !== undefined && inventoryId !== null && inventoryId !== '') {
				normalizedRow.inventory_id = Number(inventoryId)
			}

			normalizedRow._isExisting = true

			return normalizedRow
		}

		const hydrateInventoryRowsForEdit = inventoryBatches => {
			resetInventoryRows()
			if (inventoryBatches.length > 0) {
				vm.inventoryRecord[0] = withInventoryDefaults(inventoryBatches[0])
				vm.additionalInventoryRows = inventoryBatches.slice(1).map(withInventoryDefaults)
			}
			ensureFirstInventoryRowDefaults()
		}
		resetInventoryRows()

		const hasValue = value => value !== undefined && value !== null && value !== ''
		const isDecimalNumber = value => {
			if (!hasValue(value)) return false
			const normalizedValue = String(value).trim()
			return /^(?:\d+\.?\d*|\.\d+)$/.test(normalizedValue) && Number.isFinite(Number(normalizedValue))
		}
		const isPositiveNumber = value => isDecimalNumber(value) && Number(value) > 0
		vm.normalizeMedicationName = () => {
			const record = vm.medicationRecord || vm[recordKey] || {}
			record.medication_name = normalizeMedicationNameSpacing(record.medication_name)
			vm.checkReqFields()
		}
		const resetOptionEditor = fieldName => {
			vm.optionEditors[fieldName] = {
				visible: false,
				value: '',
				error: '',
				saving: false,
				similarOption: null
			}
		}
		const resetOptionEditors = () => {
			Object.keys(MEDICATION_OPTION_TYPES).forEach(resetOptionEditor)
		}
		const findMedicationOption = (fieldName, value) => {
			const identity = String(value === undefined || value === null ? '' : value).trim().toLowerCase()
			return ($rootScope.appData.medicationOptions[fieldName] || []).find(option =>
				!option.isAddNew && (
					String(option.modelValue).toLowerCase() === identity ||
					String(option.code).toLowerCase() === identity ||
					String(option.displayValue).toLowerCase() === identity
				)
			)
		}
		const enforceMedicationOptionSelections = record => {
			Object.keys(MEDICATION_OPTION_TYPES).forEach(fieldName => {
				if (fieldName === 'removal_type') return
				const currentValue = record[fieldName]
				if (!hasValue(currentValue)) return
				const existingOption = findMedicationOption(fieldName, currentValue)
				if (existingOption) {
					record[fieldName] = existingOption.modelValue
					return
				}
				record[fieldName] = ''
			})
		}
		const medicationOptionRecord = fieldName => fieldName === 'removal_type'
			? vm.transactionRecord
			: (vm.medicationRecord || vm[recordKey] || {})
		const medicationOptionRecordField = fieldName => fieldName === 'removal_type'
			? 'transaction_type'
			: fieldName
		vm.onMedicationOptionSelectionChanged = fieldName => {
			const record = medicationOptionRecord(fieldName)
			const recordField = medicationOptionRecordField(fieldName)
			if (record[recordField] === ADD_HEALTH_OPTION_VALUE) {
				record[recordField] = ''
				resetOptionEditor(fieldName)
				vm.optionEditors[fieldName].visible = true
			} else {
				resetOptionEditor(fieldName)
			}
			vm.checkReqFields()
		}
		vm.normalizeMedicationOptionInput = fieldName => {
			const editor = vm.optionEditors[fieldName]
			editor.value = normalizeHealthOptionDisplayValue(editor.value)
			vm.updateMedicationOptionSimilarity(fieldName)
		}
		vm.updateMedicationOptionSimilarity = fieldName => {
			const editor = vm.optionEditors[fieldName]
			const existingOptions = ($rootScope.appData.medicationOptions[fieldName] || [])
				.filter(option => !option.isAddNew)
			editor.similarOption = healthOptionConfig.findSimilarOption(editor.value, existingOptions)
		}
		vm.cancelMedicationOptionValue = fieldName => {
			const record = medicationOptionRecord(fieldName)
			record[medicationOptionRecordField(fieldName)] = ''
			resetOptionEditor(fieldName)
			vm.checkReqFields()
		}
		vm.addMedicationOptionValue = fieldName => {
			const editor = vm.optionEditors[fieldName]
			const record = medicationOptionRecord(fieldName)
			const recordField = medicationOptionRecordField(fieldName)
			const displayValue = normalizeHealthOptionDisplayValue(editor.value)
			const code = buildHealthOptionCode(displayValue)
			editor.value = displayValue
			editor.error = ''
			vm.updateMedicationOptionSimilarity(fieldName)

			if (!displayValue) {
				editor.error = 'Enter a value to add.'
				return
			}
			if (displayValue.length > HEALTH_OPTION_DISPLAY_VALUE_MAX_LENGTH) {
				editor.error = `The value must be ${HEALTH_OPTION_DISPLAY_VALUE_MAX_LENGTH} characters or fewer.`
				return
			}
			if (!code) {
				editor.error = 'The value must contain at least one non-space character.'
				return
			}
			if (code.length > HEALTH_OPTION_CODE_MAX_LENGTH) {
				editor.error = `The lowercase code is ${code.length} characters. Shorten the value so its code is ${HEALTH_OPTION_CODE_MAX_LENGTH} characters or fewer.`
				return
			}

			const existingOptions = ($rootScope.appData.medicationOptions[fieldName] || []).filter(option => !option.isAddNew)
			const existingOption = existingOptions.find(option =>
				(
					String(option.code).toLowerCase() === code ||
					String(option.displayValue).toLowerCase() === displayValue.toLowerCase()
				)
			)
			if (existingOption) {
				record[recordField] = existingOption.modelValue
				resetOptionEditor(fieldName)
				vm.checkReqFields()
				return
			}

			const displayOrder = existingOptions.reduce((highestOrder, option) => {
				const optionOrder = Number(option.uiDisplayOrder)
				return Number.isFinite(optionOrder) ? Math.max(highestOrder, optionOrder) : highestOrder
			}, 0) + 10
			const payload = buildHealthOptionPayload(fieldName, { code, displayValue }, displayOrder)

			editor.saving = true
			vm.checkReqFields()
			return psApiService.psApiCall('u_cdol_health_option', 'POST', payload)
				.then(() => {
					const option = $rootScope.addMedicationHealthOption(fieldName, payload)
					record[recordField] = option.modelValue
					resetOptionEditor(fieldName)
				})
				.catch(error => {
					editor.error = (error.data && error.data.message) ||
						'PowerSchool could not add this medication option. Try again or contact an administrator.'
					editor.saving = false
				})
				.finally(() => vm.checkReqFields())
		}
		vm.duplicateMedicationExists = () => {
			const record = vm.medicationRecord || vm[recordKey] || {}
			const medicationName = normalizeMedicationIdentityText(record.medication_name)
			const doseUnit = normalizeMedicationIdentityText(record.dose_unit)
			const doseAmount = Number(record.dose_amount)
			const currentMedicationId = record.medication_id || vm.currentMedicationId

			if (!medicationName || !doseUnit || !isValidPrescribedDose(record)) return false

			return ($rootScope.existingMedicationList || []).some(existingMedication => {
				if (currentMedicationId && Number(existingMedication.medication_id) === Number(currentMedicationId)) return false

				return normalizeMedicationIdentityText(existingMedication.medication_name) === medicationName &&
					isVariableDose(existingMedication) === isVariableDose(record) &&
					(isVariableDose(record) || Number(existingMedication.dose_amount) === doseAmount) &&
					normalizeMedicationIdentityText(existingMedication.dose_unit) === doseUnit
			})
		}
		const isInventoryRowValid = row => {
			if (row && row._isExisting) return true
			if (!row || !isPositiveNumber(row.quantity_added) || !row.added_date || !row.users_dcid) return false
			return true
		}

		vm.isFormValid = () => {
			const record = vm.medicationRecord || vm[recordKey] || {}
			const inventoryRows = [vm.inventoryRecord && vm.inventoryRecord[0]].concat(vm.additionalInventoryRows || [])
			const medicationOptionsAreAvailable = $rootScope.appData.medicationOptionsLoaded &&
				!$rootScope.appData.medicationOptionLoadError
			const medicationIsValid = normalizeMedicationNameSpacing(record.medication_name) && record.created_date && isValidPrescribedDose(record) &&
				record.dose_unit && record.inventory_unit && record.route && record.frequency

			return Boolean(medicationOptionsAreAvailable && medicationIsValid && !vm.duplicateMedicationExists() && inventoryRows.length && inventoryRows.every(isInventoryRowValid))
		}

		const resetTransactionRecord = () => {
			vm.transactionRecord = {
				transaction_type: '',
				event_date: $rootScope.appData.curDate,
				users_dcid: $rootScope.appData.curUserDcid,
				notes: ''
			}
		}

		const drawerTitleForMode = mode => {
			if (mode === 'remove') return 'Remove Inventory'
			return vm.isEditMode ? 'Edit Inventory' : 'Add Medication'
		}

		const updateDrawerTitle = mode => {
			const formElement = document.getElementById('med-inv-form')
			const drawerElement = formElement && formElement.closest ? formElement.closest('.ui-dialog') : null
			const titleElement = drawerElement ? drawerElement.querySelector('.ui-dialog-title') : null
			if (titleElement) titleElement.textContent = drawerTitleForMode(mode)
		}

		const buildTransactionPayload = () => {
			return {
				u_student_medication_id: vm.removalMedication.medication_id,
				transaction_type: vm.transactionRecord.transaction_type,
				quantity_change: -Number(vm.transactionRecord.quantity),
				event_date: vm.transactionRecord.event_date,
				users_dcid: vm.transactionRecord.users_dcid,
				notes: vm.transactionRecord.notes,
				dateKeys: ['_date']
			}
		}

		vm.isTransactionValid = () => {
			const record = vm.transactionRecord || {}
			const commonFieldsAreValid = record.event_date && record.users_dcid && record.notes && record.notes.trim()
			if (!commonFieldsAreValid) return false

			const quantityText = String(record.quantity === undefined || record.quantity === null ? '' : record.quantity).trim()
			const quantity = Number(quantityText)
			const quantityIsValid = /^(?:\d+\.?\d*|\.\d+)$/.test(quantityText) && Number.isFinite(quantity) && quantity > 0
			const removalTypeIsValid = Boolean(findMedicationOption('removal_type', record.transaction_type))
			return Boolean(removalTypeIsValid && quantityIsValid && quantity <= Number(vm.removalMedication.inventory_total_remaining))
		}

		vm.removalQuantityExceedsAvailable = () => {
			const record = vm.transactionRecord || {}
			const quantityText = String(record.quantity === undefined || record.quantity === null ? '' : record.quantity).trim()
			if (!/^(?:\d+\.?\d*|\.\d+)$/.test(quantityText)) return false
			return Number(quantityText) > Number(vm.removalMedication && vm.removalMedication.inventory_total_remaining)
		}

		vm.enterRemovalMode = () => {
			loadingDialog()
			vm.transactionOpenedFromEdit = true
			vm.drawerMode = 'remove'
			resetTransactionRecord()
			resetOptionEditor('removal_type')
			$timeout(() => {
				updateDrawerTitle(vm.drawerMode)
				vm.checkReqFields()
				closeLoading()
			})
		}

		vm.returnToEditMode = () => {
			vm.drawerMode = 'edit'
			vm.transactionOpenedFromEdit = false
			resetTransactionRecord()
			resetOptionEditor('removal_type')
			updateDrawerTitle(vm.drawerMode)
			vm.checkReqFields()
		}

		vm.hasExistingInventory = () => Boolean(vm.isEditMode)
		vm.onVariableDoseChanged = () => {
			if (isVariableDose(vm.medicationRecord)) vm.medicationRecord.dose_amount = ''
			vm.checkReqFields()
		}
		vm.hasExistingInventoryLines = () => Boolean(
			vm.isEditMode &&
			vm.removalMedication &&
			Array.isArray(vm.removalMedication.inventory_batches) &&
			vm.removalMedication.inventory_batches.length
		)
		vm.hasPendingInventoryRows = () => (vm.additionalInventoryRows || []).some(row => row && !row._isExisting)

		vm.addInventoryRecord = () => {
			vm.additionalInventoryRows.push(createInventoryRow())
			ensureFirstInventoryRowDefaults()
			vm.checkReqFields()
		}

		vm.cancelAdditionalInventory = row => {
			if (!row || row._isExisting) return
			vm.additionalInventoryRows = (vm.additionalInventoryRows || []).filter(candidate => candidate !== row)
			vm.checkReqFields()
		}

		$scope.$watch(
			() => vm.medicationRecord,
			() => {
				vm.checkReqFields()
			},
			true
		)

		const initalizeDrawer = () => {
			$scope.$emit('open.drawer.event', openDrawer)
			$scope.$emit('cancel.drawer.event', cancelDrawer)
			$scope.$emit('save.drawer.event', saveDrawer)
		}

		const formatKeys = {
			dateKeys: ['_date', 'added_date'],
			timeKeys: ['_time']
		}

		const cancelDrawer = closeDrawer => {
			if (vm.drawerMode !== 'edit' && vm.transactionOpenedFromEdit) {
				$timeout(() => vm.returnToEditMode())
				return
			}

			loadingDialog()
			vm[recordKey] = {}
			vm.medicationRecord = vm[recordKey]
			vm.currentMedicationId = null
			vm.isEditMode = false
			vm.removalMedication = null
			vm.drawerMode = 'edit'
			vm.transactionOpenedFromEdit = false
			resetOptionEditors()
			resetInventoryRows()
			$rootScope.reloadData()
			closeLoading()
			closeDrawer(true)
			closeDrawer()
		}

		const openDrawer = (openCallBack, data) => {
			const drawerData = (data && data.data) || {}
			const requestedMode = drawerData.mode === 'remove' ? 'remove' : 'edit'
			const medicationData = drawerData.medication || drawerData
			vm.drawerMode = requestedMode
			vm.transactionOpenedFromEdit = false
			resetTransactionRecord()
			resetOptionEditors()

			if (medicationData.medication_id == null) {
				vm.currentMedicationId = null
				vm.isEditMode = false
				vm.removalMedication = null
				vm.drawerMode = 'edit'
				const record = vm.medicationRecord || vm[recordKey] || {}
				resetInventoryRows()
				ensureFirstInventoryRowDefaults()
				delete record.inventory
				record.created_date = $rootScope.appData.curDate
				record.users_dcid = $rootScope.appData.curUserDcid
				record.studentsdcid = $rootScope.appData.curStudentDCID
				record.schoolid = $rootScope.appData.curSchoolId
				record.yearid = $rootScope.appData.curYearId
				vm[recordKey] = record
				vm.medicationRecord = record
			} else {
				vm.removalMedication = medicationData
				const sourceRecord = Object.assign({}, medicationData)
				vm.currentMedicationId = sourceRecord.medication_id || null
				vm.isEditMode = true
				formatService.objIterator(sourceRecord, formatKeys.dateKeys, 'stripTimeFromIsoDate')
				formatService.objIterator(sourceRecord, formatKeys.dateKeys, 'formatDateFromApi')

				const inventoryBatches = sortInventoryBatches(parseInventoryBatches(sourceRecord.inventory_batches)).map(normalizeIncomingInventoryRow)
				hydrateInventoryRowsForEdit(inventoryBatches)

				delete sourceRecord.inventory
				delete sourceRecord.inventory_batches
				delete sourceRecord.inventory_transactions
				vm[recordKey] = sourceRecord
				vm.medicationRecord = vm[recordKey]
				enforceMedicationOptionSelections(vm.medicationRecord)

				vm._lastOpenedInventoryBatches = inventoryBatches
			}
			vm.medicationRecord.variable_dose = isVariableDose(vm.medicationRecord) ? 1 : 0
			if (isVariableDose(vm.medicationRecord)) vm.medicationRecord.dose_amount = ''
			vm.checkReqFields()
			openCallBack()
			$timeout(() => {
				if (vm.hasExistingInventory() && Array.isArray(vm._lastOpenedInventoryBatches)) {
					hydrateInventoryRowsForEdit(vm._lastOpenedInventoryBatches)
				}
				ensureFirstInventoryRowDefaults()
				updateDrawerTitle(vm.drawerMode)
				vm.checkReqFields()
				closeLoading()
			})
		}

		const saveInventoryTransaction = closeDrawer => {
			if (!vm.isTransactionValid()) {
				psAlert({
					title: 'Invalid Inventory Transaction',
					message: 'Enter a valid quantity that does not exceed the available inventory and complete the date, staff member, and notes.'
				})
				return
			}

			const payload = buildTransactionPayload()

			loadingDialog()
			return psApiService.psApiCall('u_student_med_inv_txn', 'POST', payload)
				.then(() => {
					$rootScope.reloadData()
					closeLoading()
					closeDrawer(true)
				})
				.catch(() => closeLoading())
		}

		const saveDrawer = (closeDrawer, data) => {
			if (vm.drawerMode !== 'edit') return saveInventoryTransaction(closeDrawer)
			vm.normalizeMedicationName()
			loadingDialog()

			if (vm.duplicateMedicationExists()) {
				closeLoading()
				$scope.$emit('drawer.disable.save.button')
				return
			}

			if (!vm.isFormValid()) {
				closeLoading()
				$scope.$emit('drawer.disable.save.button')
				psAlert({
					title: 'Invalid Medication Inventory',
					message: 'Enter a valid positive dosage or select Variable dose, and complete inventory information. Inventory quantities must be numeric and quantity added must be greater than zero.'
				})
				return
			}

			const medicationPayload = Object.assign({}, vm.medicationRecord || vm[recordKey] || {})
			Object.assign(medicationPayload, prescribedDoseFields(medicationPayload))
			const existingMedicationId = medicationPayload.medication_id || vm.currentMedicationId || (data && data.data && data.data.medication_id) || null
			const inventoryRows = [vm.inventoryRecord && vm.inventoryRecord[0]].concat(vm.additionalInventoryRows || [])
			const newInventoryQuantity = inventoryRows.reduce((total, row) => {
				if (!row || row._isExisting) return total
				return total + (Number(row.quantity_added) || 0)
			}, 0)
			const currentInventoryRemaining = existingMedicationId && vm.removalMedication
				? Number(vm.removalMedication.inventory_total_remaining) || 0
				: 0

			if (!existingMedicationId || newInventoryQuantity > 0) {
				medicationPayload.inventory_baseline_quantity = Number((currentInventoryRemaining + newInventoryQuantity).toFixed(10))
			} else if (!(Number(medicationPayload.inventory_baseline_quantity) > 0) && currentInventoryRemaining > 0) {
				medicationPayload.inventory_baseline_quantity = currentInventoryRemaining
			}
			delete medicationPayload.inventory
			delete medicationPayload.inventory_batches
			delete medicationPayload.inventory_total_initial
			delete medicationPayload.inventory_total_effective
			delete medicationPayload.inventory_total_remaining
			delete medicationPayload.inventory_total_display_effective
			delete medicationPayload.inventory_total_display_remaining
			delete medicationPayload.display_inventory_batches
			delete medicationPayload.inventory_transactions
			delete medicationPayload.inventory_percentage_remaining
			delete medicationPayload.inventory_status
			delete medicationPayload.inventory_status_label
			delete medicationPayload.inventory_status_row_class
			formatService.objIterator(medicationPayload, formatKeys.dateKeys, 'formatDateForApi')

			const getMedicationIdFromResponse = response => {
				if (!response) return null

				if (Array.isArray(response)) {
					const first = response[0] || {}
					return (first.success_message && first.success_message.id) || first.id || null
				}

				if (response.result && response.result[0] && response.result[0].success_message && response.result[0].success_message.id) {
					return response.result[0].success_message.id
				}

				if (response.success_message && response.success_message.id) return response.success_message.id
				if (response.id) return response.id
				return null
			}

			const buildInventoryPayloads = medicationId => {
				const inventoryRows = [vm.inventoryRecord[0]].concat(vm.additionalInventoryRows || [])
				return inventoryRows
					.filter(row => row && row.quantity_added !== undefined && row.quantity_added !== null && row.quantity_added !== '')
					.map(row => {
						const inventoryPayload = {
							inventory_id: row.inventory_id,
							_isExisting: !!row._isExisting,
							u_student_medication_id: medicationId,
							added_date: row.added_date,
							users_dcid: row.users_dcid,
							quantity_added: row.quantity_added,
							notes: row.notes
						}
						return inventoryPayload
					})
			}

			const normalizeInventoryDatesForApi = payloads => {
				return (payloads || []).map(payload => {
					const normalized = Object.assign({}, payload)
					const value = normalized.added_date

					if (value && typeof value === 'string') {
						if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
							normalized.added_date = formatService.formatDateForApi(value)
						}
					} else if (value) {
						normalized.added_date = formatService.formatDateForApi(value)
					}

					return normalized
				})
			}

			let savePromise

			if (existingMedicationId) {
				let recordId = existingMedicationId
				delete medicationPayload['medication_id']
				delete medicationPayload['studentsdcid']

				savePromise = psApiService.psApiCall('u_student_medication', 'PUT', medicationPayload, recordId)
			} else {
				savePromise = psApiService.psApiCall('u_student_medication', 'POST', medicationPayload)
			}

			return $q
				.when(savePromise)
				.then(response => {
					const medicationId = existingMedicationId || getMedicationIdFromResponse(response)
					const inventoryPayloads = buildInventoryPayloads(medicationId)
					const inventoryPayloadsForApi = normalizeInventoryDatesForApi(inventoryPayloads)

					if (!medicationId || !inventoryPayloadsForApi.length) {
						console.warn('Inventory submit skipped', {
							medicationId,
							inventoryRecord: vm.inventoryRecord,
							additionalInventoryRows: vm.additionalInventoryRows
						})
						return null
					}

					if (!existingMedicationId) {
						return $q.all(
							inventoryPayloadsForApi.map(payload => {
								const createPayload = Object.assign({}, payload)
								delete createPayload.inventory_id
								delete createPayload._isExisting
								return psApiService.psApiCall('u_student_medication_inventory', 'POST', createPayload)
							})
						)
					}

					const createCalls = []

					inventoryPayloadsForApi.forEach(payload => {
						if (!payload._isExisting) {
							const createPayload = Object.assign({}, payload)
							delete createPayload.inventory_id
							delete createPayload._isExisting
							createCalls.push(psApiService.psApiCall('u_student_medication_inventory', 'POST', createPayload))
						}
					})

					return $q.all(createCalls)
				})
				.then(() => {
					vm[recordKey] = {}
					vm.medicationRecord = vm[recordKey]
					vm.currentMedicationId = null
					vm.isEditMode = false
					vm.removalMedication = null
					vm.drawerMode = 'edit'
					resetOptionEditors()
					resetInventoryRows()
					$rootScope.reloadData()
					closeLoading()
					closeDrawer(true)
				})
				.catch(() => {
					closeLoading()
				})
		}
		// checks required fields and enables save button if all required fields are filled out
		vm.checkReqFields = () => {
			const isValid = vm.drawerMode === 'edit' ? vm.isFormValid() : vm.isTransactionValid()
			$scope.$emit(isValid ? 'drawer.enable.save.button' : 'drawer.disable.save.button')
		}

		vm.resetSeasonForm = closeDrawer => {
			vm[recordKey] = {}
			vm.medicationRecord = vm[recordKey]
			vm.currentMedicationId = null
			vm.isEditMode = false
			vm.removalMedication = null
			vm.drawerMode = 'edit'
			resetOptionEditors()
			resetInventoryRows()
			$rootScope.reloadData()
			closeLoading()
			closeDrawer()
		}
		initalizeDrawer()
	})

	medicationModule.controller('administrationEditController', function ($scope, $rootScope, psApiService) {
		const vm = this
		vm.medication = null
		vm.administrationRecord = {}
		vm.saveInProgress = false
		vm.projectedInventoryStatus = null

		const resetRecord = () => {
			vm.administrationRecord = {
				quantity: '',
				event_date: $rootScope.appData.curDate,
				event_time: $rootScope.appData.curTime,
				users_dcid: $rootScope.appData.curUserDcid,
				notes: ''
			}
		}

		const normalizedQuantity = () => {
			const quantityText = String(vm.administrationRecord.quantity === undefined || vm.administrationRecord.quantity === null ? '' : vm.administrationRecord.quantity).trim()
			if (!/^(?:\d+\.?\d*|\.\d+)$/.test(quantityText)) return null
			const quantity = Number(quantityText)
			return Number.isFinite(quantity) && quantity > 0 ? quantity : null
		}

		const normalizeTime = value => {
			const match = String(value || '').trim().toUpperCase().match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/)
			if (!match) return ''
			return `${match[1].padStart(2, '0')}:${match[2]} ${match[3]}`
		}

		const timeToSeconds = value => {
			const normalizedTime = normalizeTime(value)
			if (!normalizedTime) return null
			const hours = Number(normalizedTime.slice(0, 2)) % 12 + (normalizedTime.endsWith('PM') ? 12 : 0)
			const minutes = Number(normalizedTime.slice(3, 5))
			return hours * 3600 + minutes * 60
		}

		vm.quantityExceedsAvailable = () => {
			const quantity = normalizedQuantity()
			return quantity !== null && quantity > Number(vm.medication && vm.medication.inventory_total_remaining)
		}

		vm.isFormValid = () => {
			const record = vm.administrationRecord || {}
			const quantity = normalizedQuantity()
			return Boolean(
				vm.medication &&
				quantity !== null &&
				quantity <= Number(vm.medication.inventory_total_remaining) &&
				record.event_date &&
				normalizeTime(record.event_time) &&
				record.users_dcid &&
				!vm.saveInProgress
			)
		}

		const updateProjectedInventoryStatus = () => {
			if (!vm.medication) {
				vm.projectedInventoryStatus = null
				return
			}

			const quantityText = String(vm.administrationRecord.quantity === undefined || vm.administrationRecord.quantity === null ? '' : vm.administrationRecord.quantity).trim()
			const quantity = normalizedQuantity()
			const availableQuantity = Number(vm.medication.inventory_total_remaining)

			if ((quantityText && quantity === null) || quantity > availableQuantity) {
				vm.projectedInventoryStatus = null
				return
			}

			const storedBaselineQuantity = Number(vm.medication.inventory_baseline_quantity)
			const historicalInventoryQuantity = Number(vm.medication.inventory_total_initial)
			const baselineQuantity = storedBaselineQuantity > 0
				? storedBaselineQuantity
				: (historicalInventoryQuantity > 0 ? historicalInventoryQuantity : availableQuantity)
			const projectedQuantity = quantity === null ? availableQuantity : availableQuantity - quantity

			vm.projectedInventoryStatus = getInventoryStatus(projectedQuantity, baselineQuantity)
			if (quantity !== null && vm.projectedInventoryStatus.inventory_status === 'OUT') {
				vm.projectedInventoryStatus.inventory_status_label = 'Last of Inventory'
			}
		}

		vm.checkReqFields = () => {
			updateProjectedInventoryStatus()
			$scope.$emit(vm.isFormValid() ? 'drawer.enable.save.button' : 'drawer.disable.save.button')
		}

		vm.medicationChanged = () => {
			vm.administrationRecord.quantity = ''
			vm.checkReqFields()
		}

		const openDrawer = (openCallBack, data) => {
			const drawerData = (data && data.data) || {}
			vm.medication = drawerData.medication || null
			vm.saveInProgress = false
			resetRecord()
			vm.checkReqFields()
			openCallBack()
		}

		const cancelDrawer = closeDrawer => {
			vm.medication = null
			vm.saveInProgress = false
			resetRecord()
			closeDrawer(true)
		}

		const buildPayload = () => {
			const occurrenceKey = `${Number(vm.medication.medication_id)}|${normalizeDateKey(vm.administrationRecord.event_date)}`
			const existingNotGiven = ($rootScope.appData.activeNotGivenByOccurrence || {})[occurrenceKey]
			const payload = {
				u_student_medication_id: vm.medication.medication_id,
				transaction_type: 'ADMINISTRATION',
				quantity_change: -normalizedQuantity(),
				event_date: vm.administrationRecord.event_date,
				event_time: timeToSeconds(vm.administrationRecord.event_time),
				users_dcid: vm.administrationRecord.users_dcid,
				notes: String(vm.administrationRecord.notes || '').trim(),
				medication_name: vm.medication.medication_name,
				...prescribedDoseFields(vm.medication),
				dose_unit: vm.medication.dose_unit,
				inventory_unit: vm.medication.inventory_unit,
				route: vm.medication.route,
				frequency: vm.medication.frequency,
				administration_quantity: normalizedQuantity(),
				recorded_date: $rootScope.appData.curDate,
				recorded_time: timeToSeconds($rootScope.getCurrentTime()),
				dateKeys: ['_date']
			}
			if (existingNotGiven) {
				Object.assign(payload, {
					reversal_of_transaction_id: existingNotGiven.root_transaction_id,
					correction_date: $rootScope.appData.curDate,
					correction_time: timeToSeconds($rootScope.getCurrentTime()),
					correction_users_dcid: $rootScope.appData.curUserDcid,
					correction_reason: 'Administration recorded after the day was documented as Not Given.'
				})
			}
			return payload
		}

		const saveDrawer = closeDrawer => {
			if (!vm.isFormValid()) {
				psAlert({
					title: 'Invalid Medication Administration',
					message: 'Enter a valid quantity that does not exceed the available inventory and complete the date, time, and administered-by fields.'
				})
				return
			}

			const medicationName = vm.medication.medication_name
			vm.saveInProgress = true
			vm.checkReqFields()
			loadingDialog()
			psApiService.psApiCall('u_student_med_inv_txn', 'POST', buildPayload())
				.then(() => {
					$rootScope.showAdministrationFeedback(`${medicationName} administration saved.`)
					$rootScope.reloadData()
					vm.medication = null
					resetRecord()
					closeLoading()
					closeDrawer(true)
				})
				.catch(() => {
					vm.saveInProgress = false
					vm.checkReqFields()
					closeLoading()
				})
		}

		$scope.$emit('open.drawer.event', openDrawer)
		$scope.$emit('cancel.drawer.event', cancelDrawer)
		$scope.$emit('save.drawer.event', saveDrawer)
		resetRecord()
	})

	medicationModule.controller('expectedAdministrationController', function ($scope, $rootScope, psApiService) {
		const vm = this
		vm.administration = null
		vm.isCorrection = false
		vm.record = {}
		vm.saveInProgress = false
		vm.projectedInventoryStatus = null
		vm.reasonEditor = {
			visible: false,
			value: '',
			error: '',
			saving: false,
			similarOption: null
		}

		const formatDateForInput = value => {
			const dateKey = normalizeDateKey(value)
			const match = dateKey.match(/^(\d{4})-(\d{2})-(\d{2})$/)
			return match ? `${match[2]}/${match[3]}/${match[1]}` : value
		}
		const normalizeTime = value => {
			const match = String(value || '').trim().toUpperCase().match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/)
			if (!match) return ''
			return `${match[1].padStart(2, '0')}:${match[2]} ${match[3]}`
		}
		const timeToSeconds = value => {
			const normalizedTime = normalizeTime(value)
			if (!normalizedTime) return null
			const hours = Number(normalizedTime.slice(0, 2)) % 12 + (normalizedTime.endsWith('PM') ? 12 : 0)
			return hours * 3600 + Number(normalizedTime.slice(3, 5)) * 60
		}
		const normalizedQuantity = () => {
			const quantityText = String(vm.record.quantity === undefined || vm.record.quantity === null ? '' : vm.record.quantity).trim()
			if (!/^(?:\d+\.?\d*|\.\d+)$/.test(quantityText)) return null
			const quantity = Number(quantityText)
			return Number.isFinite(quantity) && quantity > 0 ? quantity : null
		}
		const activeReasonOptions = () => ($rootScope.appData.medicationOptions.not_given_reason || [])
		const selectedReasonOption = () => activeReasonOptions().find(option =>
			!option.isAddNew && String(option.modelValue) === String(vm.record.not_given_reason_code)
		)
		const resetReasonEditor = () => {
			vm.reasonEditor = {
				visible: false,
				value: '',
				error: '',
				saving: false,
				similarOption: null
			}
		}
		const updateProjectedInventoryStatus = () => {
			if (!vm.administration || vm.record.resolution_type !== 'given') {
				vm.projectedInventoryStatus = null
				return
			}
			const quantity = normalizedQuantity()
			const available = Number(vm.administration.inventory_total_remaining) || 0
			if (quantity === null || quantity > available) {
				vm.projectedInventoryStatus = null
				return
			}
			const projected = available - quantity
			vm.projectedInventoryStatus = getInventoryStatus(projected, available)
			if (vm.projectedInventoryStatus.inventory_status === 'OUT') {
				vm.projectedInventoryStatus.inventory_status_label = 'Last of Inventory'
			}
		}

		vm.quantityExceedsAvailable = () => {
			const quantity = normalizedQuantity()
			return quantity !== null && quantity > Number(vm.administration && vm.administration.inventory_total_remaining)
		}
		vm.onResolutionChanged = () => {
			resetReasonEditor()
			vm.checkReqFields()
		}
		vm.onReasonChanged = () => {
			if (vm.record.not_given_reason_code === ADD_HEALTH_OPTION_VALUE) {
				vm.record.not_given_reason_code = ''
				resetReasonEditor()
				vm.reasonEditor.visible = true
			} else {
				resetReasonEditor()
			}
			vm.checkReqFields()
		}
		vm.normalizeReasonInput = () => {
			vm.reasonEditor.value = normalizeHealthOptionDisplayValue(vm.reasonEditor.value)
			vm.updateReasonSimilarity()
		}
		vm.updateReasonSimilarity = () => {
			vm.reasonEditor.similarOption = healthOptionConfig.findSimilarOption(
				vm.reasonEditor.value,
				activeReasonOptions().filter(option => !option.isAddNew)
			)
		}
		vm.cancelReasonValue = () => {
			vm.record.not_given_reason_code = ''
			resetReasonEditor()
			vm.checkReqFields()
		}
		vm.addReasonValue = () => {
			const displayValue = normalizeHealthOptionDisplayValue(vm.reasonEditor.value)
			const code = buildHealthOptionCode(displayValue)
			vm.reasonEditor.value = displayValue
			vm.reasonEditor.error = ''
			vm.updateReasonSimilarity()

			if (!displayValue) {
				vm.reasonEditor.error = 'Enter a reason to add.'
				return
			}
			if (displayValue.length > HEALTH_OPTION_DISPLAY_VALUE_MAX_LENGTH) {
				vm.reasonEditor.error = `The reason must be ${HEALTH_OPTION_DISPLAY_VALUE_MAX_LENGTH} characters or fewer.`
				return
			}
			if (!code || code.length > HEALTH_OPTION_CODE_MAX_LENGTH) {
				vm.reasonEditor.error = `Shorten the reason so its code is ${HEALTH_OPTION_CODE_MAX_LENGTH} characters or fewer.`
				return
			}

			const existingOptions = activeReasonOptions().filter(option => !option.isAddNew)
			const existing = existingOptions.find(option =>
				String(option.code).toLowerCase() === code ||
				String(option.displayValue).toLowerCase() === displayValue.toLowerCase()
			)
			if (existing) {
				vm.record.not_given_reason_code = existing.modelValue
				resetReasonEditor()
				vm.checkReqFields()
				return
			}

			const displayOrder = existingOptions.reduce((highestOrder, option) => {
				const order = Number(option.uiDisplayOrder)
				return Number.isFinite(order) ? Math.max(highestOrder, order) : highestOrder
			}, 0) + 10
			const payload = buildHealthOptionPayload('not_given_reason', { code, displayValue }, displayOrder)
			vm.reasonEditor.saving = true
			vm.checkReqFields()
			return psApiService.psApiCall('u_cdol_health_option', 'POST', payload)
				.then(() => {
					const option = $rootScope.addMedicationHealthOption('not_given_reason', payload)
					vm.record.not_given_reason_code = option.modelValue
					resetReasonEditor()
				})
				.catch(error => {
					vm.reasonEditor.error = (error.data && error.data.message) ||
						'PowerSchool could not add this reason. Try again or contact an administrator.'
					vm.reasonEditor.saving = false
				})
				.finally(() => vm.checkReqFields())
		}

		const hasChangedNotGiven = () => {
			if (!vm.isCorrection || vm.record.resolution_type === 'given') return true
			return String(vm.record.not_given_reason_code || '') !== String(vm.administration.not_given_reason_code || '') ||
				String(vm.record.notes || '').trim() !== String(vm.administration.notes || '').trim()
		}
		vm.isFormValid = () => {
			if (!vm.administration || vm.saveInProgress || vm.reasonEditor.saving || vm.reasonEditor.visible) return false
			if (vm.isCorrection && !String(vm.record.correction_reason || '').trim()) return false
			if (vm.record.resolution_type === 'given') {
				const quantity = normalizedQuantity()
				return Boolean(
					quantity !== null &&
					quantity <= Number(vm.administration.inventory_total_remaining) &&
					normalizeTime(vm.record.event_time) &&
					vm.record.users_dcid
				)
			}
			return vm.record.resolution_type === 'not_given' && Boolean(selectedReasonOption()) && hasChangedNotGiven()
		}
		vm.checkReqFields = () => {
			updateProjectedInventoryStatus()
			$scope.$emit(vm.isFormValid() ? 'drawer.enable.save.button' : 'drawer.disable.save.button')
		}

		const initializeRecord = administration => {
			const notGiven = Boolean(administration && administration.is_not_given)
			vm.record = {
				resolution_type: notGiven ? 'not_given' : '',
				quantity: '',
				event_date: formatDateForInput(administration && administration.event_date),
				event_time: $rootScope.getCurrentTime(),
				users_dcid: $rootScope.appData.curUserDcid,
				not_given_reason_code: notGiven ? administration.not_given_reason_code : '',
				notes: notGiven ? String(administration.notes || '') : '',
				correction_reason: ''
			}
			resetReasonEditor()
		}
		const openDrawer = (openCallBack, data) => {
			const drawerData = (data && data.data) || {}
			vm.administration = drawerData.notGiven || drawerData.expected || null
			vm.isCorrection = Boolean(drawerData.notGiven)
			vm.saveInProgress = false
			initializeRecord(vm.administration)
			vm.checkReqFields()
			openCallBack()
		}
		const cancelDrawer = closeDrawer => {
			vm.administration = null
			vm.isCorrection = false
			vm.saveInProgress = false
			vm.record = {}
			resetReasonEditor()
			closeDrawer(true)
		}

		const snapshotFields = () => ({
			medication_name: vm.administration.medication_name,
			...prescribedDoseFields(vm.administration),
			dose_unit: vm.administration.dose_unit,
			inventory_unit: vm.administration.inventory_unit,
			route: vm.administration.route,
			frequency: vm.administration.frequency
		})
		const auditFields = () => ({
			recorded_date: $rootScope.appData.curDate,
			recorded_time: timeToSeconds($rootScope.getCurrentTime())
		})
		const correctionFields = () => vm.isCorrection ? {
			reversal_of_transaction_id: vm.administration.root_transaction_id,
			correction_date: $rootScope.appData.curDate,
			correction_time: timeToSeconds($rootScope.getCurrentTime()),
			correction_users_dcid: $rootScope.appData.curUserDcid,
			correction_reason: String(vm.record.correction_reason || '').trim()
		} : {}
		const buildPayload = () => {
			const common = Object.assign({
				u_student_medication_id: vm.administration.medication_id,
				event_date: vm.record.event_date,
				notes: String(vm.record.notes || '').trim(),
				dateKeys: ['_date']
			}, snapshotFields(), auditFields(), correctionFields())

			if (vm.record.resolution_type === 'given') {
				return Object.assign(common, {
					transaction_type: 'ADMINISTRATION',
					quantity_change: -normalizedQuantity(),
					event_time: timeToSeconds(vm.record.event_time),
					users_dcid: vm.record.users_dcid,
					administration_quantity: normalizedQuantity()
				})
			}

			const reason = selectedReasonOption()
			return Object.assign(common, {
				transaction_type: vm.isCorrection ? 'NON_ADMINISTRATION_CORRECTION' : 'NON_ADMINISTRATION',
				quantity_change: 0,
				event_time: Number(vm.administration.daily_cutoff_time || vm.administration.event_time),
				users_dcid: $rootScope.appData.curUserDcid,
				not_given_reason_code: reason.code,
				not_given_reason_label: reason.displayValue
			})
		}
		const saveDrawer = closeDrawer => {
			if (!vm.isFormValid()) {
				psAlert({
					title: 'Incomplete Missed Administration',
					message: vm.record.resolution_type === 'given'
						? 'Enter a valid quantity, time, and staff member. The quantity cannot exceed available inventory.'
						: 'Select a not-given reason and complete any required correction information.'
				})
				return
			}

			vm.saveInProgress = true
			vm.checkReqFields()
			loadingDialog()
			const resolutionLabel = vm.record.resolution_type === 'given' ? 'administration' : 'not-given entry'
			psApiService.psApiCall('u_student_med_inv_txn', 'POST', buildPayload())
				.then(() => {
					$rootScope.showAdministrationFeedback(`${vm.administration.medication_name} ${resolutionLabel} saved for ${vm.record.event_date}.`)
					$rootScope.reloadData()
					vm.administration = null
					vm.record = {}
					closeLoading()
					closeDrawer(true)
				})
				.catch(() => {
					vm.saveInProgress = false
					vm.checkReqFields()
					closeLoading()
				})
		}

		$scope.$emit('open.drawer.event', openDrawer)
		$scope.$emit('cancel.drawer.event', cancelDrawer)
		$scope.$emit('save.drawer.event', saveDrawer)
	})

	medicationModule.controller('administrationCorrectionController', function ($scope, $rootScope, psApiService) {
		const vm = this
		vm.mode = 'edit'
		vm.administration = null
		vm.correctionRecord = {}
		vm.saveInProgress = false

		const formatDateForInput = value => {
			const dateText = String(value || '').trim()
			const isoMatch = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/)
			return isoMatch ? `${isoMatch[2]}/${isoMatch[3]}/${isoMatch[1]}` : dateText
		}

		const normalizeDateForComparison = value => {
			if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
				return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
			}
			const dateText = String(value || '').trim()
			const isoMatch = dateText.match(/^(\d{4})-(\d{2})-(\d{2})$/)
			if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`
			const usMatch = dateText.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/)
			if (usMatch) return `${usMatch[3]}-${usMatch[1].padStart(2, '0')}-${usMatch[2].padStart(2, '0')}`
			return dateText
		}

		const normalizeTime = value => {
			const match = String(value || '').trim().toUpperCase().match(/^(0?[1-9]|1[0-2]):([0-5]\d)\s*(AM|PM)$/)
			if (!match) return ''
			return `${match[1].padStart(2, '0')}:${match[2]} ${match[3]}`
		}

		const secondsToTime12 = value => {
			const totalSeconds = Number(value)
			if (!Number.isFinite(totalSeconds)) return ''
			const hours24 = Math.floor(totalSeconds / 3600) % 24
			const minutes = Math.floor((totalSeconds % 3600) / 60)
			const hours12 = hours24 % 12 || 12
			return `${String(hours12).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${hours24 >= 12 ? 'PM' : 'AM'}`
		}

		const timeToSeconds = value => {
			const normalizedTime = normalizeTime(value)
			if (!normalizedTime) return null
			const hours = Number(normalizedTime.slice(0, 2)) % 12 + (normalizedTime.endsWith('PM') ? 12 : 0)
			const minutes = Number(normalizedTime.slice(3, 5))
			return hours * 3600 + minutes * 60
		}

		const normalizedQuantity = () => {
			const quantityText = String(vm.correctionRecord.quantity === undefined || vm.correctionRecord.quantity === null ? '' : vm.correctionRecord.quantity).trim()
			if (!/^(?:\d+\.?\d*|\.\d+)$/.test(quantityText)) return null
			const quantity = Number(quantityText)
			return Number.isFinite(quantity) && quantity > 0 ? quantity : null
		}

		const correctionReason = () => String(vm.correctionRecord.correction_reason || '').trim()

		const quantityIncrease = () => {
			const quantity = normalizedQuantity()
			if (quantity === null || !vm.administration) return 0
			return Math.max(0, quantity - Number(vm.administration.quantity_administered))
		}

		vm.quantityIncreaseExceedsAvailable = () => {
			if (!vm.administration || vm.mode !== 'edit') return false
			return quantityIncrease() > Number(vm.administration.inventory_total_remaining)
		}

		const recordHasChanges = () => {
			if (!vm.administration || vm.mode !== 'edit') return false
			const quantity = normalizedQuantity()
			return Boolean(
				quantity !== null &&
				(
					quantity !== Number(vm.administration.quantity_administered) ||
					normalizeDateForComparison(vm.correctionRecord.event_date) !== normalizeDateForComparison(vm.administration.event_date) ||
					normalizeTime(vm.correctionRecord.event_time) !== secondsToTime12(vm.administration.event_time) ||
					String(vm.correctionRecord.users_dcid) !== String(vm.administration.users_dcid) ||
					String(vm.correctionRecord.notes || '').trim() !== String(vm.administration.notes || '').trim()
				)
			)
		}

		vm.isFormValid = () => {
			if (!vm.administration || vm.administration.is_entered_in_error || !correctionReason() || vm.saveInProgress) return false
			if (vm.mode === 'void') return true

			return Boolean(
				normalizedQuantity() !== null &&
				!vm.quantityIncreaseExceedsAvailable() &&
				vm.correctionRecord.event_date &&
				normalizeTime(vm.correctionRecord.event_time) &&
				vm.correctionRecord.users_dcid &&
				recordHasChanges()
			)
		}

		vm.checkReqFields = () => {
			$scope.$emit(vm.isFormValid() ? 'drawer.enable.save.button' : 'drawer.disable.save.button')
		}

		const initializeRecord = administration => {
			vm.correctionRecord = {
				quantity: administration ? administration.quantity_administered : '',
				event_date: administration ? formatDateForInput(administration.event_date) : '',
				event_time: administration ? secondsToTime12(administration.event_time) : '',
				users_dcid: administration ? administration.users_dcid : '',
				notes: administration ? administration.notes : '',
				correction_reason: ''
			}
		}

		const openDrawer = (openCallBack, data) => {
			const drawerData = (data && data.data) || {}
			vm.mode = drawerData.mode === 'void' ? 'void' : 'edit'
			vm.administration = drawerData.administration || null
			vm.saveInProgress = false
			initializeRecord(vm.administration)
			vm.checkReqFields()
			openCallBack()
		}

		const cancelDrawer = closeDrawer => {
			vm.administration = null
			vm.saveInProgress = false
			vm.correctionRecord = {}
			closeDrawer(true)
		}

		const buildCorrectionPayload = () => {
			const originalQuantity = Number(vm.administration.quantity_administered)
			const correctedQuantity = vm.mode === 'void' ? originalQuantity : normalizedQuantity()
			const quantityChange = vm.mode === 'void'
				? originalQuantity
				: Number((originalQuantity - correctedQuantity).toFixed(10))

			return {
				u_student_medication_id: vm.administration.medication_id,
				transaction_type: vm.mode === 'void' ? 'ADMINISTRATION_VOID' : 'ADMINISTRATION_CORRECTION',
				quantity_change: quantityChange,
				event_date: vm.correctionRecord.event_date,
				event_time: timeToSeconds(vm.correctionRecord.event_time),
				users_dcid: vm.correctionRecord.users_dcid,
				notes: String(vm.correctionRecord.notes || '').trim(),
				medication_name: vm.administration.medication_name,
				...prescribedDoseFields(vm.administration),
				dose_unit: vm.administration.dose_unit,
				inventory_unit: vm.administration.inventory_unit,
				route: vm.administration.route,
				frequency: vm.administration.frequency,
				reversal_of_transaction_id: vm.administration.root_transaction_id,
				administration_quantity: correctedQuantity,
				correction_date: $rootScope.appData.curDate,
				correction_time: timeToSeconds($rootScope.getCurrentTime()),
				correction_users_dcid: $rootScope.appData.curUserDcid,
				correction_reason: correctionReason(),
				dateKeys: ['_date']
			}
		}

		const postCorrection = closeDrawer => {
			vm.saveInProgress = true
			vm.checkReqFields()
			loadingDialog()
			psApiService.psApiCall('u_student_med_inv_txn', 'POST', buildCorrectionPayload())
				.then(() => {
					$rootScope.showAdministrationFeedback(vm.mode === 'void'
						? `${vm.administration.medication_name} administration marked Entered in Error.`
						: `${vm.administration.medication_name} administration corrected.`)
					$rootScope.reloadData()
					vm.administration = null
					vm.correctionRecord = {}
					closeLoading()
					closeDrawer(true)
				})
				.catch(() => {
					vm.saveInProgress = false
					vm.checkReqFields()
					closeLoading()
				})
		}

		const saveDrawer = closeDrawer => {
			if (!vm.isFormValid()) {
				psAlert({
					title: vm.mode === 'void' ? 'Invalid Entered-in-Error Correction' : 'Invalid Administration Correction',
					message: vm.mode === 'void'
						? 'Enter a reason for marking this administration as entered in error.'
						: 'Change at least one administration value, enter a correction reason, and make sure any additional quantity does not exceed available inventory.'
				})
				return
			}

			if (vm.mode !== 'void') {
				postCorrection(closeDrawer)
				return
			}

			psConfirm({
				title: 'Mark Administration as Entered in Error',
				message: `<div class="cdol-health-administration-confirmation">This will preserve the original record, mark it Entered in Error, and restore ${vm.administration.quantity_administered} ${vm.administration.inventory_unit} to calculated inventory. Continue only if this administration should not count as medication given.</div>`,
				oktext: 'Mark Entered in Error',
				canceltext: 'Cancel',
				ok: () => postCorrection(closeDrawer)
			})
		}

		$scope.$emit('open.drawer.event', openDrawer)
		$scope.$emit('cancel.drawer.event', cancelDrawer)
		$scope.$emit('save.drawer.event', saveDrawer)
	})

	medicationModule.filter('pluralize', () => (val, quantity) => {
		if (!val) return val
		const hasQuantity = quantity !== undefined && quantity !== null && String(quantity).trim() !== ''
		const numericQuantity = Number(quantity)
		if (hasQuantity && Number.isFinite(numericQuantity) && numericQuantity <= 1) {
			// Default options include both singular labels (Pill) and plural labels (Units).
			// Only singularize recognized units; preserve custom labels and abbreviations.
			return val.replace(/\b(pill|tablet|capsule|milliliter|milligram|unit)s$/i, '$1')
		}
		return val.slice(-1) === 's' ? val : val + 's'
	})

	medicationModule.filter('medTime12', () => value => {
		const totalSeconds = Number(value)
		if (!Number.isFinite(totalSeconds)) return ''
		let hours = Math.floor(totalSeconds / 3600)
		const minutes = Math.floor((totalSeconds - hours * 3600) / 60)
		const meridiem = hours >= 12 ? 'PM' : 'AM'
		hours = hours % 12
		hours = hours === 0 ? 12 : hours
		return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')} ${meridiem}`
	})

})
