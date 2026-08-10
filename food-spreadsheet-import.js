(() => {
  'use strict';

  if (!window.App || App.__foodSpreadsheetImportInstalled) return;
  App.__foodSpreadsheetImportInstalled = true;

  const HEADER_ALIASES = {
    name: ['name', 'food', 'food_name'],
    calories: ['calories', 'calorie', 'cal', 'cals', 'kcal'],
    servingLabel: ['serving_label', 'serving', 'serving_name', 'unit'],
    defaultMealTag: ['default_meal_tag', 'default_meal', 'meal_tag', 'meal', 'default_tag'],
    pinned: ['pinned', 'pin', 'quick_log', 'quicklog'],
    source: ['source', 'brand', 'restaurant'],
    folder: ['folder'],
    tags: ['tags', 'food_tags'],
    aliases: ['aliases', 'alias'],
    portions: ['portions', 'saved_portions'],
    notes: ['notes', 'note'],
  };

  const normalizeHeader = value => String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  const canonicalHeader = value => {
    const normalized = normalizeHeader(value);
    for (const [canonical, aliases] of Object.entries(HEADER_ALIASES)) {
      if (aliases.includes(normalized)) return canonical;
    }
    return normalized;
  };

  const textValue = value => value == null ? '' : String(value).trim();

  const parseList = value => [...new Set(
    textValue(value)
      .split(/[;,]/)
      .map(item => item.trim())
      .filter(Boolean)
  )];

  const parsePinned = value => {
    const text = textValue(value).toLowerCase();
    if (!text) return { value: false };
    if (['yes', 'y', 'true', '1', 'x', 'pinned'].includes(text)) return { value: true };
    if (['no', 'n', 'false', '0', 'unpinned'].includes(text)) return { value: false };
    return { error: `Pinned must be yes/no, true/false, 1/0, or blank` };
  };

  const parsePortions = (value, uid) => {
    const text = textValue(value);
    if (!text) return { portions: [] };

    const pieces = text.split(/\r?\n|;/).map(item => item.trim()).filter(Boolean);
    const portions = [];
    const errors = [];

    for (const piece of pieces) {
      let label = '';
      let caloriesText = '';
      if (piece.includes('|')) {
        const parts = piece.split('|');
        label = parts.shift().trim();
        caloriesText = parts.join('|').trim();
      } else {
        const match = piece.match(/^(.*?)\s*:\s*(-?\d+(?:\.\d+)?)\s*$/);
        if (match) {
          label = match[1].trim();
          caloriesText = match[2];
        }
      }

      const calories = Number(caloriesText);
      if (!label || !Number.isInteger(calories) || calories < 0) {
        errors.push(`Invalid portion “${piece}” (use Label | Calories)`);
        continue;
      }
      portions.push({ id: uid('portion'), name: label, calories });
    }

    return { portions, errors };
  };

  const escapeCsv = value => {
    const text = String(value ?? '');
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };

  const parseCsv = text => {
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (quoted) {
        if (char === '"') {
          if (text[index + 1] === '"') {
            field += '"';
            index += 1;
          } else {
            quoted = false;
          }
        } else {
          field += char;
        }
        continue;
      }

      if (char === '"') quoted = true;
      else if (char === ',') {
        row.push(field);
        field = '';
      } else if (char === '\n') {
        row.push(field.replace(/\r$/, ''));
        rows.push(row);
        row = [];
        field = '';
      } else {
        field += char;
      }
    }

    row.push(field.replace(/\r$/, ''));
    if (row.some(value => textValue(value))) rows.push(row);
    return rows;
  };

  const findEocd = view => {
    const minimum = Math.max(0, view.byteLength - 65557);
    for (let offset = view.byteLength - 22; offset >= minimum; offset -= 1) {
      if (view.getUint32(offset, true) === 0x06054b50) return offset;
    }
    throw new Error('This does not appear to be a valid .xlsx file');
  };

  const unzipXlsx = async arrayBuffer => {
    const view = new DataView(arrayBuffer);
    const decoder = new TextDecoder('utf-8');
    const eocd = findEocd(view);
    const entryCount = view.getUint16(eocd + 10, true);
    let offset = view.getUint32(eocd + 16, true);
    const entries = new Map();

    for (let index = 0; index < entryCount; index += 1) {
      if (view.getUint32(offset, true) !== 0x02014b50) throw new Error('Invalid Excel ZIP directory');
      const compression = view.getUint16(offset + 10, true);
      const compressedSize = view.getUint32(offset + 20, true);
      const fileNameLength = view.getUint16(offset + 28, true);
      const extraLength = view.getUint16(offset + 30, true);
      const commentLength = view.getUint16(offset + 32, true);
      const localOffset = view.getUint32(offset + 42, true);
      const nameBytes = new Uint8Array(arrayBuffer, offset + 46, fileNameLength);
      const name = decoder.decode(nameBytes);
      entries.set(name, { compression, compressedSize, localOffset });
      offset += 46 + fileNameLength + extraLength + commentLength;
    }

    const readEntry = async name => {
      const entry = entries.get(name);
      if (!entry) return null;
      const localOffset = entry.localOffset;
      if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error(`Invalid Excel ZIP entry: ${name}`);
      const fileNameLength = view.getUint16(localOffset + 26, true);
      const extraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + fileNameLength + extraLength;
      const bytes = new Uint8Array(arrayBuffer, dataOffset, entry.compressedSize);

      if (entry.compression === 0) return new Uint8Array(bytes);
      if (entry.compression !== 8) throw new Error(`Unsupported Excel compression method ${entry.compression}`);
      if (typeof DecompressionStream !== 'function') {
        throw new Error('This browser cannot unpack .xlsx files. Save the sheet as CSV and import that instead.');
      }

      const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Uint8Array(await new Response(stream).arrayBuffer());
    };

    return { entries, readEntry, decoder };
  };

  const parseXml = text => {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('Excel workbook XML could not be read');
    return doc;
  };

  const zipPath = target => {
    const raw = String(target || '').replace(/^\//, '');
    if (raw.startsWith('xl/')) return raw;
    const parts = `xl/${raw}`.split('/');
    const normalized = [];
    for (const part of parts) {
      if (!part || part === '.') continue;
      if (part === '..') normalized.pop();
      else normalized.push(part);
    }
    return normalized.join('/');
  };

  const columnIndex = reference => {
    const letters = String(reference || '').match(/^[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
    let value = 0;
    for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
    return value - 1;
  };

  const parseXlsx = async file => {
    const arrayBuffer = await file.arrayBuffer();
    const zip = await unzipXlsx(arrayBuffer);
    const decodeEntry = async name => {
      const bytes = await zip.readEntry(name);
      return bytes ? zip.decoder.decode(bytes) : '';
    };

    const workbookText = await decodeEntry('xl/workbook.xml');
    const relsText = await decodeEntry('xl/_rels/workbook.xml.rels');
    if (!workbookText || !relsText) throw new Error('Excel workbook structure is incomplete');

    const workbook = parseXml(workbookText);
    const rels = parseXml(relsText);
    const sheet = workbook.getElementsByTagName('sheet')[0];
    if (!sheet) throw new Error('The Excel workbook has no worksheets');
    const relationshipId = sheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
      || sheet.getAttribute('r:id');
    const relationship = [...rels.getElementsByTagName('Relationship')]
      .find(item => item.getAttribute('Id') === relationshipId);
    if (!relationship) throw new Error('Could not locate the first Excel worksheet');

    const sheetPath = zipPath(relationship.getAttribute('Target'));
    const sheetText = await decodeEntry(sheetPath);
    if (!sheetText) throw new Error('Could not read the first Excel worksheet');

    const sharedStringsText = await decodeEntry('xl/sharedStrings.xml');
    const sharedStrings = sharedStringsText
      ? [...parseXml(sharedStringsText).getElementsByTagName('si')].map(item =>
          [...item.getElementsByTagName('t')].map(node => node.textContent || '').join('')
        )
      : [];

    const worksheet = parseXml(sheetText);
    const rows = [];
    for (const rowNode of worksheet.getElementsByTagName('row')) {
      const row = [];
      for (const cell of rowNode.getElementsByTagName('c')) {
        const index = columnIndex(cell.getAttribute('r'));
        const type = cell.getAttribute('t');
        let value = '';
        if (type === 'inlineStr') {
          value = [...cell.getElementsByTagName('t')].map(node => node.textContent || '').join('');
        } else {
          const raw = cell.getElementsByTagName('v')[0]?.textContent ?? '';
          if (type === 's') value = sharedStrings[Number(raw)] ?? '';
          else if (type === 'b') value = raw === '1' ? 'TRUE' : 'FALSE';
          else if (type === 'str') value = raw;
          else value = raw === '' ? '' : (Number.isFinite(Number(raw)) ? Number(raw) : raw);
        }
        row[index] = value;
      }
      if (row.some(value => textValue(value))) rows.push(row);
    }
    return rows;
  };

  const rowsToObjects = rows => {
    const firstIndex = rows.findIndex(row => row.some(value => textValue(value)));
    if (firstIndex < 0) throw new Error('The spreadsheet is empty');
    const headers = rows[firstIndex].map(canonicalHeader);
    if (!headers.includes('name')) throw new Error('The spreadsheet needs a “name” column');
    if (!headers.includes('calories')) throw new Error('The spreadsheet needs a “calories” column');

    return rows.slice(firstIndex + 1)
      .map((row, index) => {
        const values = {};
        headers.forEach((header, column) => {
          if (header) values[header] = row[column] ?? '';
        });
        return { rowNumber: firstIndex + index + 2, values };
      })
      .filter(item => Object.values(item.values).some(value => textValue(value)));
  };

  const validateImportRows = rawRows => {
    const tagsByName = new Map(App.cache.tags.map(tag => [tag.name.trim().toLowerCase(), tag]));
    const tagsById = new Map(App.cache.tags.map(tag => [tag.id, tag]));

    return rawRows.map(({ rowNumber, values }) => {
      const errors = [];
      const warnings = [];
      const name = textValue(values.name);
      const calorieNumber = Number(textValue(values.calories).replace(/,/g, ''));
      if (!name) errors.push('Name is required');
      if (!Number.isInteger(calorieNumber) || calorieNumber < 0) errors.push('Calories must be a whole number of 0 or more');

      const pinnedResult = parsePinned(values.pinned);
      if (pinnedResult.error) errors.push(pinnedResult.error);

      let defaultMealTagId = '';
      const requestedTag = textValue(values.defaultMealTag);
      if (requestedTag) {
        const tag = tagsById.get(requestedTag) || tagsByName.get(requestedTag.toLowerCase());
        if (!tag) errors.push(`Default meal tag “${requestedTag}” is not defined in Settings`);
        else defaultMealTagId = tag.id;
      }

      const portionResult = parsePortions(values.portions, prefix => App.uid(prefix));
      if (portionResult.errors?.length) errors.push(...portionResult.errors);

      return {
        rowNumber,
        errors,
        warnings,
        food: {
          name,
          calories: Number.isFinite(calorieNumber) ? calorieNumber : 0,
          servingLabel: textValue(values.servingLabel),
          defaultMealTagId,
          pinned: pinnedResult.value || false,
          source: textValue(values.source),
          folder: textValue(values.folder),
          tags: parseList(values.tags),
          aliases: parseList(values.aliases),
          portions: portionResult.portions || [],
          notes: textValue(values.notes),
        },
      };
    });
  };

  const originalRenderFoods = App.renderFoods;
  App.renderFoods = async function(...args) {
    let html = await originalRenderFoods.apply(this, args);
    const addFoodButton = '<button class="btn primary" onclick="App.openFoodEditor()">Add food</button>';
    if (!html.includes('App.openFoodImport()')) {
      html = html.replace(
        addFoodButton,
        `<button class="btn ghost" onclick="App.openFoodImport()">Import foods</button>${addFoodButton}`
      );
    }
    return html;
  };

  App.openFoodImport = function() {
    this.foodImportState = null;
    const mealTags = this.cache.tags.map(tag => tag.name).join(', ') || 'None defined';
    this.showModal(`
      <div class="row space">
        <div><div class="eyebrow">Bulk add</div><h2>Import foods</h2></div>
        <button class="icon-btn" type="button" onclick="App.closeModal()">×</button>
      </div>
      <p>Import an Excel <strong>.xlsx</strong> file or CSV. The first worksheet is used. You’ll get a preview before anything is saved.</p>
      <div class="card subtle food-import-help">
        <strong>Supported columns</strong>
        <div class="food-import-columns">name · calories · serving_label · default_meal_tag · pinned · source · folder · tags · aliases · portions · notes</div>
        <div class="field-help">Only <strong>name</strong> and <strong>calories</strong> are required. Tags and aliases can be separated with commas or semicolons. Portions use <strong>Label | Calories</strong>, separated by semicolons. Default meal tags must match an existing meal tag name.</div>
        <div class="field-help" style="margin-top:.35rem">Current meal tags: ${this.esc(mealTags)}</div>
      </div>
      <div class="actions" style="margin:.8rem 0">
        <button class="btn ghost" type="button" onclick="App.downloadFoodImportTemplate()">Download template</button>
      </div>
      <div class="form-grid">
        <label>Spreadsheet
          <input id="foodImportFile" type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" onchange="App.handleFoodImportFile(this.files?.[0])" />
        </label>
        <label>When a food name already exists
          <select id="foodImportDuplicateMode" onchange="App.renderFoodImportPreview()">
            <option value="skip">Skip it — add new foods only</option>
            <option value="update">Update the existing food with spreadsheet values</option>
          </select>
        </label>
      </div>
      <div id="foodImportPreview" style="margin-top:.9rem">
        <div class="empty-state">Choose a .xlsx or .csv file to preview the import.</div>
      </div>
    `);
    document.getElementById('modal')?.classList.add('food-import-modal');
  };

  App.downloadFoodImportTemplate = function() {
    const tag = this.cache.tags[0]?.name || '';
    const headers = ['name','calories','serving_label','default_meal_tag','pinned','source','folder','tags','aliases','portions','notes'];
    const examples = [
      ['Example Chicken Breast',165,'100 g',tag,'no','Homemade','Meal Prep','protein; lunch','chicken breast','1 oz | 47; 4 oz | 187','Optional saved note'],
      ['Example Peanut Butter',190,'2 tbsp','','yes','Example Brand','','snack; pantry','PB','1 tbsp | 95',''],
    ];
    const csv = [headers, ...examples].map(row => row.map(escapeCsv).join(',')).join('\r\n');
    this.downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'foodlog-food-import-template.csv');
    this.showToast('Import template downloaded');
  };

  App.handleFoodImportFile = async function(file) {
    const preview = document.getElementById('foodImportPreview');
    if (!file || !preview) return;
    preview.innerHTML = '<div class="muted small">Reading spreadsheet…</div>';

    try {
      const lower = file.name.toLowerCase();
      let rows;
      if (lower.endsWith('.xlsx')) rows = await parseXlsx(file);
      else if (lower.endsWith('.csv')) rows = parseCsv(await file.text());
      else if (lower.endsWith('.xls')) throw new Error('Old .xls files are not supported. Save it as .xlsx or CSV first.');
      else throw new Error('Choose an .xlsx or .csv file');

      const objects = rowsToObjects(rows);
      const validated = validateImportRows(objects);
      this.foodImportState = { fileName: file.name, rows: validated };
      this.renderFoodImportPreview();
    } catch (error) {
      this.foodImportState = null;
      preview.innerHTML = `<div class="empty-state"><strong>Could not read this file.</strong><br>${this.esc(error?.message || error)}</div>`;
    }
  };

  App.renderFoodImportPreview = function() {
    const target = document.getElementById('foodImportPreview');
    if (!target) return;
    const state = this.foodImportState;
    if (!state) return;

    const mode = document.getElementById('foodImportDuplicateMode')?.value || 'skip';
    const existingByName = new Map(this.cache.foods.map(food => [this.normalizeName(food.name), food]));
    let ready = 0;
    let invalid = 0;
    let duplicates = 0;
    let recipes = 0;

    const displayRows = state.rows.map(row => {
      const existing = existingByName.get(this.normalizeName(row.food.name));
      let status = '';
      let className = '';
      if (row.errors.length) {
        invalid += 1;
        status = row.errors.join('; ');
        className = 'error';
      } else if (existing?.recipe) {
        recipes += 1;
        status = 'Skipped: matching food is a recipe';
        className = 'warning';
      } else if (existing && mode === 'skip') {
        duplicates += 1;
        status = 'Skipped: already exists';
        className = 'warning';
      } else {
        ready += 1;
        status = existing ? 'Will update' : 'Will add';
        className = 'ready';
      }
      return { ...row, existing, status, className };
    });

    state.previewRows = displayRows;
    const shown = displayRows.slice(0, 20);
    target.innerHTML = `
      <div class="row space wrap">
        <div>
          <strong>${this.esc(state.fileName)}</strong>
          <div class="tiny muted">${ready} ready · ${invalid} invalid · ${duplicates} duplicate${duplicates === 1 ? '' : 's'}${recipes ? ` · ${recipes} recipe conflict${recipes === 1 ? '' : 's'}` : ''}</div>
        </div>
        ${ready ? `<button class="btn primary" type="button" onclick="App.executeFoodImport()">Import ${ready} food${ready === 1 ? '' : 's'}</button>` : ''}
      </div>
      <div class="food-import-table-wrap">
        <table class="food-import-table">
          <thead><tr><th>Row</th><th>Name</th><th>Calories</th><th>Serving</th><th>Default meal</th><th>Status</th></tr></thead>
          <tbody>${shown.map(row => {
            const tag = this.cache.tags.find(item => item.id === row.food.defaultMealTagId);
            return `<tr class="${row.className}">
              <td>${row.rowNumber}</td>
              <td>${this.esc(row.food.name || '—')}</td>
              <td>${this.formatNumber(row.food.calories)}</td>
              <td>${this.esc(row.food.servingLabel || '—')}</td>
              <td>${this.esc(tag?.name || '—')}</td>
              <td>${this.esc(row.status)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
      ${displayRows.length > shown.length ? `<div class="tiny muted" style="margin-top:.45rem">Showing first ${shown.length} of ${displayRows.length} spreadsheet rows.</div>` : ''}
      ${invalid ? '<div class="field-help" style="margin-top:.55rem">Invalid rows are never imported. Correct them in the spreadsheet and choose the file again.</div>' : ''}
    `;
  };

  App.executeFoodImport = async function() {
    const state = this.foodImportState;
    if (!state) return;
    this.renderFoodImportPreview();
    const mode = document.getElementById('foodImportDuplicateMode')?.value || 'skip';
    const existingByName = new Map(this.cache.foods.map(food => [this.normalizeName(food.name), food]));
    const now = new Date().toISOString();
    const records = [];
    const revisions = [];
    let added = 0;
    let updated = 0;
    let skipped = 0;

    for (const row of state.rows) {
      if (row.errors.length) { skipped += 1; continue; }
      const existing = existingByName.get(this.normalizeName(row.food.name));
      if (existing?.recipe) { skipped += 1; continue; }
      if (existing && mode === 'skip') { skipped += 1; continue; }

      if (existing) {
        revisions.push({
          id: this.uid('revision'),
          entityId: existing.id,
          entityType: 'food',
          snapshot: structuredClone(existing),
          createdAt: now,
        });
      }

      const record = {
        ...(existing || {}),
        id: existing?.id || this.uid('food'),
        name: row.food.name,
        nameLower: this.normalizeName(row.food.name),
        calories: row.food.calories,
        servingLabel: row.food.servingLabel,
        defaultMealTagId: row.food.defaultMealTagId,
        pinned: row.food.pinned,
        source: row.food.source,
        folder: row.food.folder,
        tags: row.food.tags,
        aliases: row.food.aliases,
        portions: row.food.portions,
        notes: row.food.notes,
        useCount: existing?.useCount || 0,
        lastUsedAt: existing?.lastUsedAt || '',
        createdAt: existing?.createdAt || now,
        updatedAt: now,
      };
      delete record.recipe;
      records.push(record);
      existingByName.set(this.normalizeName(record.name), record);
      if (existing) updated += 1; else added += 1;
    }

    if (!records.length) {
      this.showToast('No foods were ready to import');
      return;
    }

    const button = document.querySelector('#foodImportPreview .btn.primary');
    if (button) { button.disabled = true; button.textContent = 'Importing…'; }

    try {
      if (revisions.length) await this.db.putMany('revisions', revisions);
      await this.db.putMany('foods', records);
      await this.refreshCache();
      this.closeModal();
      await this.render();
      const parts = [];
      if (added) parts.push(`${added} added`);
      if (updated) parts.push(`${updated} updated`);
      if (skipped) parts.push(`${skipped} skipped`);
      this.showToast(`Food import complete: ${parts.join(', ')}`);
    } catch (error) {
      if (button) { button.disabled = false; button.textContent = 'Try import again'; }
      this.showToast(`Import failed: ${error?.message || error}`);
    }
  };

  const style = document.createElement('style');
  style.textContent = `
    .food-import-columns { margin:.35rem 0; line-height:1.55; font-size:.86rem; word-break:break-word; }
    .food-import-table-wrap { overflow:auto; margin-top:.75rem; border:1px solid var(--line); border-radius:var(--radius-sm); }
    .food-import-table { width:100%; min-width:720px; border-collapse:collapse; font-size:.78rem; }
    .food-import-table th, .food-import-table td { padding:.5rem .55rem; border-bottom:1px solid var(--line); text-align:left; vertical-align:top; }
    .food-import-table th { position:sticky; top:0; background:var(--panel-2); z-index:1; }
    .food-import-table tr:last-child td { border-bottom:0; }
    .food-import-table tr.error td:last-child { color:var(--danger); }
    .food-import-table tr.warning td:last-child { color:var(--warning); }
    .food-import-table tr.ready td:last-child { color:var(--accent-strong); font-weight:750; }
    @media (min-width:760px) { .modal.food-import-modal { width:min(920px, 96vw); max-height:90vh; } }
  `;
  document.head.appendChild(style);
})();
