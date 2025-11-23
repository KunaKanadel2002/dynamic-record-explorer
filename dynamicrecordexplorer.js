
import { LightningElement, track } from 'lwc';
import { ShowToastEvent } from 'lightning/platformShowToastEvent';
import getObjectList from '@salesforce/apex/DynamicRecordController.getObjectList';
import getFieldList from '@salesforce/apex/DynamicRecordController.getFieldList';
import fetchDynamic from '@salesforce/apex/DynamicRecordController.fetchDynamic';

export default class DynamicRecordExplorer extends LightningElement {
    @track objectOptions = [];
    @track records = [];
    @track isLoading = false;
    @track noRecords = false;
    @track showFilters = false;

    @track searchTerm = '';

    // filter-related
    @track filters = []; // [{ id, field, operator, value }]

    // data caches
    selectedObject = '';
    fieldOptions = [];              // [{ label, value }]
    fieldMetadataCache = {};        // { objectName: fieldOptions }
    fullRecords = [];               // unfiltered records
    filteredRecords = [];           // records after applyFilters

    operatorOptions = [
        { label: '=', value: '=' },
        { label: '!=', value: '!=' },
        { label: 'Contains', value: 'LIKE' }
    ];

    essentialFields = ['Name', 'Id', 'Email', 'Phone', 'Status', 'Type', 'Industry'];

    connectedCallback() {
        this.loadObjects();
    }

    /* ---------------- utilities ---------------- */
    showToast(title, message, variant = 'info') {
        this.dispatchEvent(new ShowToastEvent({ title, message, variant }));
    }

    debounce(fn, delay = 250) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn.apply(this, args), delay);
        };
    }

    prettifyFieldLabel(name) {
        if (!name) return '';
        let label = String(name);
        label = label.replace(/__c$/i, '').replace(/__r$/i, '');
        label = label.replace(/_/g, ' ');
        label = label.replace(/([a-z])([A-Z])/g, '$1 $2');
        label = label.replace(/\s+/g, ' ').trim();
        label = label.split(' ').map(w => w ? (w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()) : '').join(' ');
        return label;
    }

    /* ---------------- load objects/fields ---------------- */
    async loadObjects() {
        try {
            const objs = await getObjectList();
            this.objectOptions = (objs || []).map(o => ({ label: o, value: o }));
        } catch (e) {
            console.error('loadObjects error', e);
            this.showToast('Error', e.body?.message || e.message, 'error');
        }
    }

    handleObjectChange(event) {
        const val = event.target.value;
        this.selectedObject = val;

        // reset existing data when object changes
        this.fieldOptions = [];
        this.records = [];
        this.fullRecords = [];
        this.filteredRecords = [];
        this.filters = [];

        if (!val) return;
        this.debouncedLoadFields(val);
    }

    debouncedLoadFields = this.debounce(async (objectName) => {
        try {
            if (this.fieldMetadataCache[objectName]) {
                this.fieldOptions = this.fieldMetadataCache[objectName];
                return;
            }
            const fields = await getFieldList({ objectName }) || [];
            this.fieldOptions = fields.map(f => ({ label: this.prettifyFieldLabel(f), value: f }));
            this.fieldMetadataCache[objectName] = this.fieldOptions;
        } catch (e) {
            console.error('getFieldList error', e);
            this.showToast('Error', e.body?.message || e.message, 'error');
        }
    });

    /* ---------------- search ---------------- */
    debouncedSearch = this.debounce(() => {
        this.applySearch();
    }, 200);

    handleSearch(event) {
        if (!this.fullRecords || this.fullRecords.length === 0) {
            this.showToast('Info', 'Please select an object and click Fetch to load records before searching.', 'info');
            event.target.value = '';
            this.searchTerm = '';
            return;
        }
        this.searchTerm = event.target.value || '';
        this.debouncedSearch();
    }

    applySearch() {
        const q = (this.searchTerm || '').trim().toLowerCase();
        const source = (this.filters && this.filters.length) ? this.filteredRecords : this.fullRecords;

        if (!q) {
            this.records = source.slice();
            this.noRecords = this.records.length === 0;
            return;
        }

        const filtered = source.filter(rec => {
            const name = (rec.Name || rec.Id || '').toString().toLowerCase();
            if (name.includes(q)) return true;
            const allValues = (rec.fullFields || []).map(f => String(f.value || '').toLowerCase());
            return allValues.some(v => v.includes(q));
        });

        this.records = filtered;
        this.noRecords = this.records.length === 0;
    }

    /* ---------------- fetch records ---------------- */
    async fetchRecords() {
        if (!this.selectedObject) {
            this.showToast('Info', 'Please select an object first', 'info');
            return;
        }
        if (!this.fieldOptions || this.fieldOptions.length === 0) {
            this.showToast('Info', 'No fields available for selected object', 'info');
            return;
        }

        this.isLoading = true;
        this.noRecords = false;

        try {
            const raw = await fetchDynamic({ objectName: this.selectedObject });

            this.records = (raw || []).map(rec => {
                const allFields = this.fieldOptions.map(opt => ({
                    name: opt.value,
                    label: opt.label,
                    value: rec[opt.value] ?? ''
                }));

                const essentialList = allFields.filter(f =>
                    this.essentialFields.some(e => e.toLowerCase() === f.name.toLowerCase())
                );

                const numColumns = allFields.length > 15 ? 3 : 2;

                const fieldChunks = this.chunkForTemplate(allFields, numColumns);

                return {
                    Id: rec.Id,
                    Name: (rec && (rec.Name || rec.name || rec.Id)) ? (rec.Name || rec.name || rec.Id) : rec.Id,
                    expanded: false,
                    fieldSearchTerm: '',
                    fullFields: allFields,
                    essentialChunks: this.chunkForTemplate(essentialList, 2),
                    fieldChunks: fieldChunks,
                    fieldChunksFiltered: fieldChunks
                };
            });

            this.fullRecords = this.records.slice();
            this.filteredRecords = this.fullRecords.slice();
            this.applySearch();
            this.noRecords = this.records.length === 0;
        } catch (e) {
            console.error('fetchRecords error', e);
            this.showToast('Error', e.body?.message || e.message, 'error');
        } finally {
            this.isLoading = false;
        }
    }

    chunkForTemplate(arr, numCols) {
        if (!arr || arr.length === 0) {
            return Array.from({ length: numCols }, (_, i) => ({ key: i, fields: [] }));
        }
        const size = Math.ceil(arr.length / numCols);
        return Array.from({ length: numCols }, (_, i) => ({
            key: i,
            fields: arr.slice(i * size, i * size + size)
        }));
    }

    /* ---------------- per-record field search ---------------- */
    handleRecordFieldSearch(event) {
        const recordId = event.currentTarget.dataset.recordId;
        const q = (event.target.value || '').trim().toLowerCase();

        this.records = this.records.map(r => {
            if (r.Id !== recordId) return r;

            const allFields = (r.fullFields || []);

            if (!q) {
                return { ...r, fieldSearchTerm: '', fieldChunksFiltered: r.fieldChunks };
            }

            const filtered = allFields.filter(f => {
                const name = (f.name || '').toString().toLowerCase();
                const label = (f.label || '').toString().toLowerCase();
                const value = (f.value || '').toString().toLowerCase();
                return name.includes(q) || label.includes(q) || value.includes(q);
            });

            const numCols = r.fieldChunks ? r.fieldChunks.length : 2;
            const chunks = this.chunkForTemplate(filtered, numCols);
            return { ...r, fieldSearchTerm: q, fieldChunksFiltered: chunks };
        });
    }

    /* ---------------- expand ---------------- */
    toggleExpand(event) {
        const id = event.currentTarget.dataset.recordId;

        this.records = this.records.map(r => {
            if (r.Id !== id) return r;
            const expanded = !r.expanded;
            return {
                ...r,
                expanded,
                fieldSearchTerm: expanded ? '' : r.fieldSearchTerm,
                fieldChunksFiltered: expanded ? r.fieldChunks : r.fieldChunksFiltered
            };
        });
    }

    /* ---------------- filter bar helpers ---------------- */
    toggleFilterBar() {
        this.showFilters = !this.showFilters;
        // ensure reactivity for template rendering
        this.filters = this.filters.map(f => ({ ...f }));
    }

    addFilter() {
        // default operator '=' for readability
        this.filters = [...this.filters, { id: Date.now(), field: '', operator: '=', value: '' }];
    }

    removeFilter(event) {
        const idx = parseInt(event.currentTarget.dataset.index, 10);
        if (isNaN(idx)) return;
        this.filters = this.filters.filter((_, i) => i !== idx);
    }

    clearFilters() {
        this.filters = [];
        this.filteredRecords = this.fullRecords ? this.fullRecords.slice() : [];
        this.applySearch();
    }

    /* ---------------- filter input handlers (lightning-combobox and lightning-input) ---------------- */
    // combobox & lightning-input use event.detail.value
    handleFilterFieldChange(event) {
        const idx = parseInt(event.target.dataset.index, 10);
        if (isNaN(idx)) return;
        const val = event.detail && event.detail.value !== undefined ? event.detail.value : event.target.value;
        this.filters = this.filters.map((f, i) => i === idx ? { ...f, field: val } : f);
    }

    handleFilterOperatorChange(event) {
        const idx = parseInt(event.target.dataset.index, 10);
        if (isNaN(idx)) return;
        const val = event.detail && event.detail.value !== undefined ? event.detail.value : event.target.value;
        this.filters = this.filters.map((f, i) => i === idx ? { ...f, operator: val } : f);
    }

    handleFilterValueChange(event) {
        const idx = parseInt(event.target.dataset.index, 10);
        if (isNaN(idx)) return;
        const val = event.detail && event.detail.value !== undefined ? event.detail.value : event.target.value;
        this.filters = this.filters.map((f, i) => i === idx ? { ...f, value: val } : f);
    }

    /* ---------------- apply filters client-side ---------------- */
    applyFilters() {
        if (!this.fullRecords || this.fullRecords.length === 0) {
            this.showToast('Info', 'No records loaded to filter. Click Fetch first.', 'info');
            return;
        }

        const filtered = this.fullRecords.filter(record => {
            // build a map of fieldName -> value for the record
            const valueMap = {};
            (record.fullFields || []).forEach(f => { valueMap[f.name] = (f.value === undefined || f.value === null) ? '' : String(f.value).toLowerCase(); });

            // all filters combined with AND
            for (const flt of this.filters) {
                if (!flt || !flt.field) return false;
                const fieldVal = (valueMap[flt.field] || '').toString().toLowerCase();
                const testVal = (flt.value || '').toString().toLowerCase();

                let op = flt.operator;
                if (op === 'eq') op = '=';
                if (op === 'ne') op = '!=';
                if (op === 'like') op = 'LIKE';

                if (op === 'LIKE') {
                    if (!fieldVal.includes(testVal)) return false;
                } else if (op === '=') {
                    if (fieldVal !== testVal) return false;
                } else if (op === '!=') {
                    if (fieldVal === testVal) return false;
                } else {
                    // unknown operator: exclude
                    return false;
                }
            }
            return true;
        });

        this.filteredRecords = filtered;
        this.applySearch(); // applySearch will use filteredRecords when filters exist
        this.showFilters = false;
    }
}