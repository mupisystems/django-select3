/*
  Select3 Widgets JS (isolated; no Alpine)
  ---------------------------------------
  This file intentionally does NOT touch the existing Select3 implementation
  (static/js/alpine-components.js).

  Contract:
  - Initializes elements with `data-select3`.
  - Uses hidden inputs for POST values (single: one hidden; multi: repeated hidden inputs).
  - AJAX endpoints return JSON like:
      { results: [{ id, text, ... }], pagination?: { more?: boolean }, next?: string|null, next_page?: number|null }
    If no pagination metadata is returned, widgets fall back to a length-based heuristic.
*/

(function () {
  const NS = (window.select3Widgets = window.select3Widgets || {});

  // Optional global config hook.
  // Example:
  //   window.select3WidgetsConfig = { observe: false };
  const CONFIG = (window.select3WidgetsConfig = window.select3WidgetsConfig || {});

  function parseJsonSafe(raw, fallback) {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function normalizeOptionsFromDal(data) {
    const results = data && data.results ? data.results : Array.isArray(data) ? data : [];
    return results
      .map((item) => ({
        value: String(item.id ?? item.value ?? ''),
        label: String(item.text ?? item.label ?? ''),
      }))
      .filter((o) => o.value !== '');
  }

  function getPaginationMore(data) {
    // Select2/DAL style: { pagination: { more: true/false } }
    try {
      return !!(data && data.pagination && data.pagination.more);
    } catch {
      return false;
    }
  }

  function getPaginationState(data, incomingCount, requestedPage, defaultPageSize) {
    const count = typeof incomingCount === 'number' ? incomingCount : 0;
    const page = typeof requestedPage === 'number' ? requestedPage : parseInt(String(requestedPage || '1'), 10) || 1;
    const pageSize =
      (data && typeof data.page_size === 'number' && data.page_size > 0 && data.page_size < 1000)
        ? data.page_size
        : (typeof defaultPageSize === 'number' && defaultPageSize > 0 ? defaultPageSize : 20);

    // 1) Explicit boolean flag.
    if (data && data.pagination && typeof data.pagination.more === 'boolean') {
      return { more: data.pagination.more, nextUrl: null, nextPage: null, pageSize };
    }

    // 2) DRF-style next URL.
    if (data && Object.prototype.hasOwnProperty.call(data, 'next')) {
      const nextUrl = typeof data.next === 'string' && data.next ? data.next : null;
      return { more: !!nextUrl, nextUrl, nextPage: null, pageSize };
    }

    // 3) Next page number.
    if (data && Object.prototype.hasOwnProperty.call(data, 'next_page')) {
      const nextPage = typeof data.next_page === 'number' ? data.next_page : null;
      return { more: typeof nextPage === 'number' && !Number.isNaN(nextPage), nextUrl: null, nextPage, pageSize };
    }

    // 4) Total pages.
    if (data && typeof data.page === 'number' && typeof data.total_pages === 'number') {
      return { more: data.page < data.total_pages, nextUrl: null, nextPage: null, pageSize };
    }

    // 5) Count-based.
    if (data && typeof data.count === 'number' && typeof data.page === 'number' && typeof data.page_size === 'number') {
      return { more: data.page * data.page_size < data.count, nextUrl: null, nextPage: null, pageSize };
    }

    // 6) Fallback heuristic: if we got a "full page", assume there might be more.
    // This can cause one extra request when total results are an exact multiple of pageSize.
    if (count <= 0) return { more: false, nextUrl: null, nextPage: null, pageSize };
    if (count < pageSize) return { more: false, nextUrl: null, nextPage: null, pageSize };
    return { more: true, nextUrl: null, nextPage: page + 1, pageSize };
  }

  function mergeUniqueByValue(existing, incoming) {
    const seen = new Set(existing.map((o) => String(o.value)));
    const out = existing.slice();
    for (const opt of incoming || []) {
      const v = String(opt && opt.value);
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(opt);
    }
    return out;
  }

  function isNearBottom(el, thresholdPx) {
    const t = typeof thresholdPx === 'number' ? thresholdPx : 40;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - t;
  }

  function preserveScrollTop(scrollEl, fn) {
    const prev = scrollEl.scrollTop;
    fn();
    scrollEl.scrollTop = prev;
  }

  function calculateDropdownStyle(anchorEl, dropDirection) {
    const rect = anchorEl.getBoundingClientRect();
    const width = rect.width;
    const left = rect.left;
    if (dropDirection === 'up') {
      const bottom = window.innerHeight - rect.top + 4;
      return `width: ${width}px; left: ${left}px; bottom: ${bottom}px; top: auto; z-index: 99999;`;
    }
    const top = rect.bottom + 4;
    return `width: ${width}px; left: ${left}px; top: ${top}px; bottom: auto; z-index: 99999;`;
  }

  function chooseDropDirection(anchorEl, dropdownHeight) {
    const rect = anchorEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    return spaceBelow < dropdownHeight && spaceAbove > spaceBelow ? 'up' : 'down';
  }

  function buildForwardData(forwardConfig) {
    if (!forwardConfig) return null;
    const data = {};
    for (const [key, fieldName] of Object.entries(forwardConfig)) {
      const input = document.querySelector(`input[name="${fieldName}"]`);
      if (input && input.value) data[key] = input.value;
    }
    return Object.keys(data).length > 0 ? data : null;
  }

  function onClickOutside(targetEls, handler) {
    function listener(ev) {
      for (const el of targetEls) {
        if (el && el.contains(ev.target)) return;
      }
      handler(ev);
    }
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }

  function createDropdownPanel() {
    const panel = document.createElement('div');
    panel.className = 'fixed bg-white border border-gray-200 rounded-lg shadow-xl';
    panel.style.display = 'none';
    const ul = document.createElement('ul');
    ul.className = 'overflow-y-auto py-1';
    ul.style.maxHeight = '240px';
    ul.setAttribute('role', 'listbox');
    panel.appendChild(ul);
    return { panel, ul };
  }

  function setHiddenValue(hiddenInput, value) {
    hiddenInput.value = value == null ? '' : String(value);
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function initComboboxStatic(root) {
    const hiddenInput = root.querySelector('[data-select3-hidden]');
    const searchInput = root.querySelector('[data-select3-input]');
    const display = root.querySelector('[data-select3-display]');
    const displayText = root.querySelector('[data-select3-display-text]');
    const clearBtn = root.querySelector('[data-select3-clear]');

    const placeholder = root.dataset.placeholder || 'Selecione uma opção';
    const allowClear = root.dataset.allowClear !== 'false';

    let options = [];
    const optionsElementId = root.dataset.optionsElementId || '';
    if (optionsElementId) {
      const el = document.getElementById(optionsElementId);
      if (el && el.textContent) options = parseJsonSafe(el.textContent, []);
    }
    if (!options.length) {
      options = parseJsonSafe(root.dataset.optionsJson || '[]', []);
    }

    let isOpen = false;
    let selected = hiddenInput.value ? String(hiddenInput.value) : '';
    let selectedLabel = '';
    const initial = options.find((o) => String(o.value) === selected);
    if (initial) selectedLabel = String(initial.label);

    const { panel, ul } = createDropdownPanel();
    document.body.appendChild(panel);

    function close() {
      isOpen = false;
      panel.style.display = 'none';
      display.hidden = !(selected && !isOpen);
      searchInput.hidden = !!(selected && !isOpen);
      if (selected && !isOpen) {
        displayText.textContent = selectedLabel;
      }
      searchInput.value = '';
    }

    function open() {
      isOpen = true;
      const anchor = searchInput.hidden ? display : searchInput;
      const dir = chooseDropDirection(anchor, 280);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ';');
      panel.style.display = 'block';
      display.hidden = true;
      searchInput.hidden = false;
      searchInput.placeholder = placeholder;
      searchInput.focus();
      renderList(searchInput.value || '');
    }

    function renderList(q) {
      const qLower = (q || '').toLowerCase();
      const filtered = options.filter((o) => (o.label || '').toLowerCase().includes(qLower));
      ul.innerHTML = '';
      if (!filtered.length) {
        const li = document.createElement('li');
        li.className = 'px-3 py-6 text-sm text-gray-500 text-center';
        li.textContent = q ? 'Nenhum resultado encontrado' : 'Nenhuma opção disponível';
        ul.appendChild(li);
        return;
      }
      for (const opt of filtered) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition-colors duration-150 cursor-pointer';
        if (String(opt.value) === selected) {
          btn.className += ' bg-brand-primary/10 text-brand-primary font-semibold';
          btn.setAttribute('aria-selected', 'true');
        }
        btn.textContent = opt.label;
        btn.addEventListener('click', () => {
          selected = String(opt.value);
          selectedLabel = String(opt.label);
          setHiddenValue(hiddenInput, selected);
          if (allowClear) clearBtn.hidden = !selected;
          close();
        });
        li.appendChild(btn);
        ul.appendChild(li);
      }
    }

    function updateUIInitial() {
      display.hidden = !(selected && !isOpen);
      searchInput.hidden = !!(selected && !isOpen);
      if (selected && !isOpen) displayText.textContent = selectedLabel;
      clearBtn.hidden = !(allowClear && selected);
    }

    // Events
    display.addEventListener('click', () => open());
    searchInput.addEventListener('focus', () => open());
    searchInput.addEventListener('input', () => renderList(searchInput.value));
    if (allowClear) {
      clearBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selected = '';
        selectedLabel = '';
        setHiddenValue(hiddenInput, '');
        updateUIInitial();
      });
    }

    // External set-value (future portability)
    root.addEventListener('combobox:set-value', (e) => {
      const { value, label } = e.detail || {};
      if (value === undefined) return;
      selected = String(value);
      selectedLabel = label || '';
      setHiddenValue(hiddenInput, selected);
      updateUIInitial();
      close();
    });

    const removeOutside = onClickOutside([display, searchInput, panel], () => close());
    const onResize = () => {
      if (!isOpen) return;
      const anchor = searchInput.hidden ? display : searchInput;
      const dir = chooseDropDirection(anchor, 280);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ';');
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);

    // Cleanup not exposed yet (demo/dev use)
    root._select3Cleanup = () => {
      removeOutside();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      panel.remove();
    };

    updateUIInitial();
    root.removeAttribute('data-select3-cloak');
  }

  function initComboboxAjax(root) {
    const hiddenInput = root.querySelector('[data-select3-hidden]');
    const searchInput = root.querySelector('[data-select3-input]');
    const display = root.querySelector('[data-select3-display]');
    const displayText = root.querySelector('[data-select3-display-text]');
    const clearBtn = root.querySelector('[data-select3-clear]');
    const spinner = root.querySelector('[data-select3-loading]');

    const placeholder = root.dataset.placeholder || 'Busque...';
    const allowClear = root.dataset.allowClear !== 'false';
    const ajaxUrl = root.dataset.ajaxUrl || '';
    const minSearchLength = parseInt(root.dataset.minSearchLength || '0', 10);
    const forwardConfig = parseJsonSafe(root.dataset.forwardJson || '', null);
    const initialLabel = root.dataset.initialLabel || '';

    let isOpen = false;
    let selected = hiddenInput.value ? String(hiddenInput.value) : '';
    let selectedLabel = selected ? initialLabel : '';
    let debounceTimer = null;
    let loading = false;
    let filteredOptions = [];
    let page = 1;
    let more = false;
    let nextPage = null;
    let nextUrl = null;
    let lastQuery = '';

    const { panel, ul } = createDropdownPanel();
    ul.style.maxHeight = '200px';
    document.body.appendChild(panel);

    function setLoading(v) {
      loading = v;
      if (spinner) spinner.hidden = !v;
    }

    function close() {
      isOpen = false;
      panel.style.display = 'none';
      display.hidden = !(selected && !isOpen);
      searchInput.hidden = !!(selected && !isOpen);
      if (selected && !isOpen) displayText.textContent = selectedLabel;
      clearBtn.hidden = !(allowClear && selected && !loading);
    }

    function clearUl() {
      ul.innerHTML = '';
    }

    function removeFooter() {
      const footer = ul.querySelector('[data-select3-footer]');
      if (footer) footer.remove();
    }

    function setFooter(text) {
      removeFooter();
      if (!text) return;
      const li = document.createElement('li');
      li.setAttribute('data-select3-footer', '1');
      li.className = 'px-3 py-3 text-xs text-gray-500 text-center';
      li.textContent = text;
      ul.appendChild(li);
    }

    function buildOptionRow(opt) {
      const li = document.createElement('li');
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className =
        'w-full text-left px-3 py-2 text-sm hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition-colors duration-150 cursor-pointer';
      if (String(opt.value) === selected) {
        btn.className += ' bg-brand-primary/10 text-brand-primary font-semibold';
        btn.setAttribute('aria-selected', 'true');
      }
      btn.textContent = opt.label;
      btn.addEventListener('click', () => {
        selected = String(opt.value);
        selectedLabel = String(opt.label);
        setHiddenValue(hiddenInput, selected);
        clearBtn.hidden = !(allowClear && selected && !loading);
        searchInput.value = '';
        close();
      });
      li.appendChild(btn);
      return li;
    }

    function renderListEmptyState() {
      clearUl();
      if (loading) {
        const li = document.createElement('li');
        li.className = 'px-3 py-8 text-sm text-gray-500 text-center';
        li.textContent = 'Buscando...';
        ul.appendChild(li);
        return;
      }

      const q = searchInput.value || '';
      if (minSearchLength > 0 && q.length < minSearchLength) {
        const li = document.createElement('li');
        li.className = 'px-3 py-6 text-sm text-gray-500 text-center';
        li.textContent = `Digite pelo menos ${minSearchLength} caracteres para buscar`;
        ul.appendChild(li);
        return;
      }

      if (!filteredOptions.length) {
        const li = document.createElement('li');
        li.className = 'px-3 py-6 text-sm text-gray-500 text-center';
        li.textContent = q ? 'Nenhum resultado encontrado' : 'Nenhuma opção disponível';
        ul.appendChild(li);
        return;
      }

      clearUl();
      for (const opt of filteredOptions) ul.appendChild(buildOptionRow(opt));
      setFooter(more ? 'Role para carregar mais...' : '');
    }

    async function loadOptions(opts) {
      const q = searchInput.value || '';
      if (q.length < minSearchLength && minSearchLength > 0) {
        filteredOptions = [];
        more = false;
        page = 1;
        nextPage = null;
        nextUrl = null;
        // Here we want to show the min-length helper, so we do render.
        renderListEmptyState();
        return;
      }

      const requestedPage = (opts && opts.page) ? opts.page : 1;
      const requestedUrl = (opts && opts.url) ? String(opts.url) : '';
      const append = !!(opts && opts.append);

      if (append && loading) return;

      setLoading(true);
      if (!append) {
        // New query: don't clear the list immediately; keep UX stable while loading.
        filteredOptions = [];
        page = 1;
        more = false;
        nextPage = null;
        nextUrl = null;
        removeFooter();
      } else {
        // Infinite scroll: show a footer but don't rebuild/reset the list.
        preserveScrollTop(ul, () => setFooter('Carregando mais...'));
      }
      try {
        let url = requestedUrl;
        if (!url) {
          url = `${ajaxUrl}?q=${encodeURIComponent(q)}&page=${encodeURIComponent(String(requestedPage))}`;
          const forwardData = buildForwardData(forwardConfig);
          if (forwardData) url += `&forward=${encodeURIComponent(JSON.stringify(forwardData))}`;
        }
        const res = await fetch(url);
        const data = await res.json();
        const incoming = normalizeOptionsFromDal(data);
        if (append) {
          const beforeLen = filteredOptions.length;
          filteredOptions = mergeUniqueByValue(filteredOptions, incoming);
          const newUnique = filteredOptions.slice(beforeLen);
          preserveScrollTop(ul, () => {
            removeFooter();
            // Append only the new unique options to avoid DOM rebuild.
            for (const opt of newUnique) ul.appendChild(buildOptionRow(opt));
          });
        } else {
          filteredOptions = incoming;
        }
        page = requestedPage;
        const state = getPaginationState(data, incoming.length, requestedPage, 20);
        more = !!state.more;
        nextPage = state.nextPage;
        nextUrl = state.nextUrl;
      } catch (e) {
        console.error('select3Widgets comboboxAjax fetch error', e);
        filteredOptions = [];
        more = false;
        page = 1;
        nextPage = null;
        nextUrl = null;
      }
      setLoading(false);

      if (append) {
        preserveScrollTop(ul, () => setFooter(more ? 'Role para carregar mais...' : ''));
      } else {
        // Render fresh results at once (single rebuild) after load.
        renderListEmptyState();
        ul.scrollTop = 0;
      }
    }

    function open() {
      isOpen = true;
      const anchor = searchInput.hidden ? display : searchInput;
      const dir = chooseDropDirection(anchor, 280);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ';');
      panel.style.display = 'block';
      display.hidden = true;
      searchInput.hidden = false;
      searchInput.placeholder = placeholder;
      searchInput.focus();
      renderListEmptyState();
      if (minSearchLength === 0) {
        lastQuery = searchInput.value || '';
        loadOptions({ page: 1, append: false });
      }
    }

    function debounceSearch() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        lastQuery = searchInput.value || '';
        loadOptions({ page: 1, append: false });
      }, 300);
    }

    // Initial UI
    display.hidden = !(selected && !isOpen);
    searchInput.hidden = !!(selected && !isOpen);
    if (selected && !isOpen) displayText.textContent = selectedLabel;
    clearBtn.hidden = !(allowClear && selected);
    if (spinner) spinner.hidden = true;

    // Events
    display.addEventListener('click', () => open());
    searchInput.addEventListener('focus', () => open());
    searchInput.addEventListener('input', () => debounceSearch());

    ul.addEventListener('scroll', () => {
      const q = searchInput.value || '';
      if (!isOpen || loading || !more) return;
      if (minSearchLength > 0 && q.length < minSearchLength) return;
      if ((lastQuery || '') !== q) return;
      if (!isNearBottom(ul, 40)) return;
      if (nextUrl) loadOptions({ url: nextUrl, page: (page || 1) + 1, append: true });
      else if (typeof nextPage === 'number') loadOptions({ page: nextPage, append: true });
      else loadOptions({ page: (page || 1) + 1, append: true });
    });
    if (allowClear) {
      clearBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selected = '';
        selectedLabel = '';
        setHiddenValue(hiddenInput, '');
        display.hidden = true;
        searchInput.hidden = false;
        clearBtn.hidden = true;
      });
    }

    root.addEventListener('combobox:set-value', (e) => {
      const { value, label } = e.detail || {};
      if (value === undefined) return;
      selected = String(value);
      selectedLabel = label || '';
      setHiddenValue(hiddenInput, selected);
      displayText.textContent = selectedLabel;
      close();
    });

    const removeOutside = onClickOutside([display, searchInput, panel], () => close());
    const onResize = () => {
      if (!isOpen) return;
      const anchor = searchInput.hidden ? display : searchInput;
      const dir = chooseDropDirection(anchor, 280);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ';');
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);

    root._select3Cleanup = () => {
      removeOutside();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      panel.remove();
    };

    root.removeAttribute('data-select3-cloak');
  }

  function initMultiselectStatic(root) {
    const hiddenContainer = root.querySelector('[data-select3-hidden-container]');
    const input = root.querySelector('[data-select3-input]');
    const badges = root.querySelector('[data-select3-badges]');
    const clearBtn = root.querySelector('[data-select3-clear]');

    const name = root.dataset.name || '';
    const placeholder = root.dataset.placeholder || 'Digite para buscar...';
    const allowClear = root.dataset.allowClear !== 'false';

    const options = parseJsonSafe(root.dataset.optionsJson || '[]', []);
    let selected = parseJsonSafe(root.dataset.values || '[]', []).map(String);
    let isOpen = false;

    const { panel, ul } = createDropdownPanel();
    document.body.appendChild(panel);

    function syncHiddenInputs() {
      hiddenContainer.innerHTML = '';
      for (const id of selected) {
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = name;
        inp.value = id;
        hiddenContainer.appendChild(inp);
      }
      // dispatch change on first hidden to be consistent
      const first = hiddenContainer.querySelector('input[type="hidden"]');
      if (first) first.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function renderBadges() {
      badges.innerHTML = '';
      for (const id of selected) {
        const opt = options.find((o) => String(o.value) === String(id));
        const badge = document.createElement('span');
        badge.className = 'inline-flex items-center gap-1 px-2 rounded text-xs font-medium transition-all duration-150 bg-brand-primary/10 text-brand-primary h-[26px] min-h-[26px]';

        const text = document.createElement('span');
        text.className = 'max-w-[160px] truncate flex items-center';
        text.textContent = opt ? opt.label : 'Item';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-black/10 transition-colors ml-0.5';
        btn.title = 'Remover';
        btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>';
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          selected = selected.filter((x) => x !== String(id));
          syncHiddenInputs();
          renderBadges();
          renderList(input.value || '');
          updatePlaceholder();
        });

        badge.appendChild(text);
        badge.appendChild(btn);
        badges.appendChild(badge);
      }
    }

    function updatePlaceholder() {
      // Match AJAX widget: keep input visible and keep its placeholder consistent.
      input.style.display = '';
      input.placeholder = placeholder;
      clearBtn.hidden = !(allowClear && selected.length > 0);
    }

    function close() {
      isOpen = false;
      panel.style.display = 'none';
      updatePlaceholder();
    }

    function open() {
      isOpen = true;
      const anchor = root.querySelector('[data-select3-anchor]') || root;
      const dir = chooseDropDirection(anchor, 320);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ';');
      panel.style.display = 'block';
      updatePlaceholder();
      input.focus();
      renderList(input.value || '');
    }

    function renderList(q) {
      const qLower = (q || '').toLowerCase();
      const filtered = options.filter((o) => (o.label || '').toLowerCase().includes(qLower));
      ul.innerHTML = '';
      if (!filtered.length) {
        const li = document.createElement('li');
        li.className = 'px-3 py-6 text-sm text-gray-500 text-center';
        li.textContent = q ? 'Nenhum resultado encontrado' : 'Nenhuma opção disponível';
        ul.appendChild(li);
        return;
      }
      for (const opt of filtered) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition-colors duration-150 cursor-pointer flex items-center gap-3';
        const checked = selected.includes(String(opt.value));
        if (checked) btn.className += ' bg-gray-50';
        const checkboxClass = checked ? 'bg-brand-primary border-brand-primary' : 'border-gray-300';
        btn.innerHTML = `
          <div class="shrink-0 w-4 h-4 border-2 rounded flex items-center justify-center transition-colors ${checkboxClass}">
            ${checked ? '<svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>' : ''}
          </div>
          <div class="flex items-center gap-2 flex-1 min-w-0" data-select3-option-content></div>
        `;

        const content = btn.querySelector('[data-select3-option-content]');
        if (content) {
          const labelEl = document.createElement('span');
          labelEl.className = 'truncate';
          labelEl.textContent = opt.label;
          content.appendChild(labelEl);
        }
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const v = String(opt.value);
          if (selected.includes(v)) selected = selected.filter((x) => x !== v);
          else selected = [...selected, v];
          syncHiddenInputs();
          renderBadges();
          renderList(input.value || '');
          updatePlaceholder();
        });
        li.appendChild(btn);
        ul.appendChild(li);
      }
    }

    // Setup
    input.placeholder = placeholder;
    renderBadges();
    syncHiddenInputs();
    updatePlaceholder();

    const anchor = root.querySelector('[data-select3-anchor]') || root;
    anchor.addEventListener('click', () => {
      if (!isOpen) open();
    });
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('focus', () => open());
    input.addEventListener('input', () => renderList(input.value || ''));
    if (allowClear) {
      clearBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selected = [];
        syncHiddenInputs();
        renderBadges();
        renderList(input.value || '');
        updatePlaceholder();
      });
    }

    const removeOutside = onClickOutside([anchor, panel], () => close());
    const onResize = () => {
      if (!isOpen) return;
      const dir = chooseDropDirection(anchor, 320);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ';');
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);

    root._select3Cleanup = () => {
      removeOutside();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      panel.remove();
    };

    root.removeAttribute('data-select3-cloak');
  }

  function initMultiselectAjax(root) {
    const hiddenContainer = root.querySelector('[data-select3-hidden-container]');
    const input = root.querySelector('[data-select3-input]');
    const badges = root.querySelector('[data-select3-badges]');
    const clearBtn = root.querySelector('[data-select3-clear]');
    const spinner = root.querySelector('[data-select3-loading]');

    const name = root.dataset.name || '';
    const placeholder = root.dataset.placeholder || 'Digite para buscar...';
    const allowClear = root.dataset.allowClear !== 'false';
    const ajaxUrl = root.dataset.ajaxUrl || '';
    const minSearchLength = parseInt(root.dataset.minSearchLength || '2', 10);
    const forwardConfig = parseJsonSafe(root.dataset.forwardJson || '', null);

    let selected = parseJsonSafe(root.dataset.values || '[]', []).map(String);
    let selectedOptions = {};
    let filteredOptions = [];
    let isOpen = false;
    let loading = false;
    let debounceTimer = null;
    let page = 1;
    let more = false;
    let nextPage = null;
    let nextUrl = null;
    let lastQuery = '';

    const { panel, ul } = createDropdownPanel();
    document.body.appendChild(panel);

    function removeFooter() {
      const footer = ul.querySelector('[data-select3-footer]');
      if (footer) footer.remove();
    }

    function setFooter(text) {
      removeFooter();
      if (!text) return;
      const li = document.createElement('li');
      li.setAttribute('data-select3-footer', '1');
      li.className = 'px-3 py-3 text-xs text-gray-500 text-center';
      li.textContent = text;
      ul.appendChild(li);
    }

    function setLoading(v) {
      loading = v;
      if (spinner) spinner.hidden = !v;
    }

    function syncHiddenInputs() {
      hiddenContainer.innerHTML = '';
      for (const id of selected) {
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = name;
        inp.value = id;
        hiddenContainer.appendChild(inp);
      }
      const first = hiddenContainer.querySelector('input[type="hidden"]');
      if (first) first.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function getSelectedOption(id) {
      return selectedOptions[String(id)] || null;
    }

    function renderBadges() {
      badges.innerHTML = '';
      for (const id of selected) {
        const opt = getSelectedOption(id);
        const badge = document.createElement('span');
        badge.className = 'inline-flex items-center gap-1 px-2 rounded text-xs font-medium transition-all duration-150 bg-brand-primary/10 text-brand-primary h-[26px] min-h-[26px]';

        const text = document.createElement('span');
        text.className = 'max-w-[160px] truncate flex items-center';
        text.textContent = opt ? opt.label : 'Carregando...';

        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'inline-flex items-center justify-center w-4 h-4 rounded-full hover:bg-black/10 transition-colors ml-0.5';
        btn.title = 'Remover';
        btn.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>';
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          selected = selected.filter((x) => x !== String(id));
          syncHiddenInputs();
          renderBadges();
          renderList({ preserveScroll: true });
          updateUI();
        });

        badge.appendChild(text);
        badge.appendChild(btn);
        badges.appendChild(badge);
      }
    }

    function updateUI() {
      clearBtn.hidden = !(allowClear && selected.length > 0 && !loading);
    }

    function close() {
      isOpen = false;
      panel.style.display = 'none';
      updateUI();
    }

    function open() {
      isOpen = true;
      const anchor = root.querySelector('[data-select3-anchor]') || root;
      const dir = chooseDropDirection(anchor, 320);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ';');
      panel.style.display = 'block';
      input.focus();
      renderList();
      updateUI();
    }

    function renderList(opts) {
      const preserveScroll = !!(opts && opts.preserveScroll);
      const prevScrollTop = preserveScroll ? ul.scrollTop : 0;
      ul.innerHTML = '';
      const q = input.value || '';
      if (loading) {
        const li = document.createElement('li');
        li.className = 'px-3 py-8 text-sm text-gray-500 text-center';
        li.textContent = 'Buscando...';
        ul.appendChild(li);
        if (preserveScroll) ul.scrollTop = prevScrollTop;
        return;
      }
      if (q.length < minSearchLength && !filteredOptions.length) {
        const li = document.createElement('li');
        li.className = 'px-3 py-6 text-sm text-gray-500 text-center';
        li.textContent = `Digite pelo menos ${minSearchLength} caracteres para buscar`;
        ul.appendChild(li);
        if (preserveScroll) ul.scrollTop = prevScrollTop;
        return;
      }
      if (!filteredOptions.length) {
        const li = document.createElement('li');
        li.className = 'px-3 py-6 text-sm text-gray-500 text-center';
        li.textContent = 'Nenhum resultado encontrado';
        ul.appendChild(li);
        if (preserveScroll) ul.scrollTop = prevScrollTop;
        return;
      }
      for (const opt of filteredOptions) {
        const li = document.createElement('li');
        const btn = document.createElement('button');
        btn.type = 'button';
        const checked = selected.includes(String(opt.value));
        btn.className = 'w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition-colors duration-150 cursor-pointer flex items-center gap-3';
        if (checked) btn.className += ' bg-gray-50';
        const checkboxClass = checked ? 'bg-brand-primary border-brand-primary' : 'border-gray-300';
        btn.innerHTML = `
          <div class="shrink-0 w-4 h-4 border-2 rounded flex items-center justify-center transition-colors ${checkboxClass}">
            ${checked ? '<svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>' : ''}
          </div>
          <div class="flex items-center gap-2 flex-1 min-w-0" data-select3-option-content></div>
        `;

        const content = btn.querySelector('[data-select3-option-content]');
        if (content) {
          const labelEl = document.createElement('span');
          labelEl.className = 'truncate';
          labelEl.textContent = opt.label;
          content.appendChild(labelEl);
        }
        btn.addEventListener('click', (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          const v = String(opt.value);
          if (selected.includes(v)) selected = selected.filter((x) => x !== v);
          else selected = [...selected, v];
          selectedOptions[v] = opt;
          syncHiddenInputs();
          renderBadges();
          renderList({ preserveScroll: true });
          updateUI();
        });
        li.appendChild(btn);
        ul.appendChild(li);
      }

      setFooter(more ? 'Role para carregar mais...' : '');

      if (preserveScroll) ul.scrollTop = prevScrollTop;
    }

    async function loadOptions(opts) {
      const q = input.value || '';
      if (q.length < minSearchLength) {
        filteredOptions = [];
        more = false;
        page = 1;
        nextPage = null;
        nextUrl = null;
        renderList();
        return;
      }

      const requestedPage = (opts && opts.page) ? opts.page : 1;
      const requestedUrl = (opts && opts.url) ? String(opts.url) : '';
      const append = !!(opts && opts.append);

      if (append && loading) return;

      setLoading(true);
      if (!append) {
        // New query: keep existing list while loading.
        filteredOptions = [];
        page = 1;
        more = false;
        nextPage = null;
        nextUrl = null;
        removeFooter();
      } else {
        // Infinite scroll: show footer loading indicator without clearing.
        preserveScrollTop(ul, () => setFooter('Carregando mais...'));
      }
      try {
        let url = requestedUrl;
        if (!url) {
          url = `${ajaxUrl}?q=${encodeURIComponent(q)}&page=${encodeURIComponent(String(requestedPage))}`;
          const forwardData = buildForwardData(forwardConfig);
          if (forwardData) url += `&forward=${encodeURIComponent(JSON.stringify(forwardData))}`;
        }
        const res = await fetch(url);
        const data = await res.json();
        const incoming = normalizeOptionsFromDal(data);
        if (append) {
          const beforeLen = filteredOptions.length;
          filteredOptions = mergeUniqueByValue(filteredOptions, incoming);
          const newUnique = filteredOptions.slice(beforeLen);
          preserveScrollTop(ul, () => {
            removeFooter();

            for (const opt of newUnique) {
              const li = document.createElement('li');
              const btn = document.createElement('button');
              btn.type = 'button';
              const checked = selected.includes(String(opt.value));
              btn.className =
                'w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 focus:bg-gray-50 focus:outline-none transition-colors duration-150 cursor-pointer flex items-center gap-3';
              if (checked) btn.className += ' bg-gray-50';
              const checkboxClass = checked ? 'bg-brand-primary border-brand-primary' : 'border-gray-300';
              btn.innerHTML = `
              <div class="shrink-0 w-4 h-4 border-2 rounded flex items-center justify-center transition-colors ${checkboxClass}">
                ${checked ? '<svg class="w-3 h-3 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>' : ''}
              </div>
              <div class="flex items-center gap-2 flex-1 min-w-0" data-select3-option-content></div>
            `;

              const content = btn.querySelector('[data-select3-option-content]');
              if (content) {
                const labelEl = document.createElement('span');
                labelEl.className = 'truncate';
                labelEl.textContent = opt.label;
                content.appendChild(labelEl);
              }

              btn.addEventListener('click', (ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                const v = String(opt.value);
                if (selected.includes(v)) selected = selected.filter((x) => x !== v);
                else selected = [...selected, v];
                selectedOptions[v] = opt;
                syncHiddenInputs();
                renderBadges();
                renderList({ preserveScroll: true });
                updateUI();
              });
              li.appendChild(btn);
              ul.appendChild(li);
            }
          });
        } else {
          filteredOptions = incoming;
        }
        page = requestedPage;
        const state = getPaginationState(data, incoming.length, requestedPage, 20);
        more = !!state.more;
        nextPage = state.nextPage;
        nextUrl = state.nextUrl;
      } catch (e) {
        console.error('select3Widgets multiselectAjax fetch error', e);
        filteredOptions = [];
        more = false;
        page = 1;
        nextPage = null;
        nextUrl = null;
      }
      setLoading(false);

      if (append) {
        preserveScrollTop(ul, () => setFooter(more ? 'Role para carregar mais...' : ''));
      } else {
        renderList();
        ul.scrollTop = 0;
      }
      updateUI();
    }

    async function resolveSelectedLabels() {
      if (!selected.length) return;
      try {
        let url = `${ajaxUrl}?q=`;
        const forwardData = buildForwardData(forwardConfig);
        if (forwardData) url += `&forward=${encodeURIComponent(JSON.stringify(forwardData))}`;
        const res = await fetch(url);
        const data = await res.json();
        const opts = normalizeOptionsFromDal(data);
        for (const opt of opts) {
          if (selected.includes(String(opt.value))) selectedOptions[String(opt.value)] = opt;
        }
      } catch {
        // ignore
      }
      renderBadges();
    }

    function debounceSearch() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        lastQuery = input.value || '';
        loadOptions({ page: 1, append: false });
      }, 300);
    }

    // Setup
    if (spinner) spinner.hidden = true;
    input.placeholder = placeholder;
    syncHiddenInputs();
    resolveSelectedLabels();
    renderBadges();
    updateUI();

    const anchor = root.querySelector('[data-select3-anchor]') || root;
    anchor.addEventListener('click', () => {
      if (!isOpen) open();
    });
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('focus', () => open());
    input.addEventListener('input', () => debounceSearch());

    ul.addEventListener('scroll', () => {
      const q = input.value || '';
      if (!isOpen || loading || !more) return;
      if (q.length < minSearchLength) return;
      if ((lastQuery || '') !== q) return;
      if (!isNearBottom(ul, 40)) return;
      if (nextUrl) loadOptions({ url: nextUrl, page: (page || 1) + 1, append: true });
      else if (typeof nextPage === 'number') loadOptions({ page: nextPage, append: true });
      else loadOptions({ page: (page || 1) + 1, append: true });
    });
    if (allowClear) {
      clearBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selected = [];
        syncHiddenInputs();
        renderBadges();
        filteredOptions = [];
        renderList();
        updateUI();
      });
    }

    const removeOutside = onClickOutside([anchor, panel], () => close());
    const onResize = () => {
      if (!isOpen) return;
      const dir = chooseDropDirection(anchor, 320);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ';');
    };
    window.addEventListener('resize', onResize);
    window.addEventListener('scroll', onResize, true);

    root._select3Cleanup = () => {
      removeOutside();
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onResize, true);
      panel.remove();
    };

    root.removeAttribute('data-select3-cloak');
  }

  function initRoot(root) {
    const kind = root.dataset.select3;
    if (kind === 'combobox') return initComboboxStatic(root);
    if (kind === 'combobox-ajax') return initComboboxAjax(root);
    if (kind === 'multiselect') return initMultiselectStatic(root);
    if (kind === 'multiselect-ajax') return initMultiselectAjax(root);
  }

  function destroyRoot(root) {
    try {
      if (root && typeof root._select3Cleanup === 'function') {
        root._select3Cleanup();
      }
    } catch (e) {
      console.error('select3Widgets destroy error', e);
    } finally {
      if (root) {
        root._select3Cleanup = null;
        root._select3Initialized = false;
      }
    }
  }

  function initAll(container) {
    const scope = container || document;
    const roots = [];

    // If the scope itself is a widget root, include it.
    if (scope && scope.nodeType === 1 && scope.matches && scope.matches('[data-select3]')) {
      roots.push(scope);
    }

    // Also include any children widget roots.
    if (scope && scope.querySelectorAll) {
      scope.querySelectorAll('[data-select3]').forEach((el) => roots.push(el));
    }

    roots.forEach((el) => {
      try {
        if (el._select3Initialized) return;
        el._select3Initialized = true;
        initRoot(el);
      } catch (e) {
        console.error('select3Widgets init error', e);
      }
    });
  }

  function destroyAll(container) {
    const scope = container || document;
    const roots = [];

    if (scope && scope.nodeType === 1 && scope.matches && scope.matches('[data-select3]')) {
      roots.push(scope);
    }
    if (scope && scope.querySelectorAll) {
      scope.querySelectorAll('[data-select3]').forEach((el) => roots.push(el));
    }

    roots.forEach((el) => {
      if (!el || !el._select3Initialized) return;
      destroyRoot(el);
    });
  }

  // Public API
  NS.initAll = initAll;
  NS.destroyAll = destroyAll;
  NS.destroy = destroyRoot;

  function startObserver() {
    if (CONFIG.observe === false) return null;
    if (!document.body || !window.MutationObserver) return null;

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        // Removed nodes: try to cleanup.
        if (m.removedNodes && m.removedNodes.length) {
          m.removedNodes.forEach((n) => {
            if (!n || n.nodeType !== 1) return;
            if (n.matches && n.matches('[data-select3]')) destroyAll(n);
            else if (n.querySelectorAll && n.querySelectorAll('[data-select3]').length) destroyAll(n);
          });
        }

        // Added nodes: init.
        if (m.addedNodes && m.addedNodes.length) {
          m.addedNodes.forEach((n) => {
            if (!n || n.nodeType !== 1) return;
            if (n.matches && n.matches('[data-select3]')) initAll(n);
            else if (n.querySelectorAll && n.querySelectorAll('[data-select3]').length) initAll(n);
          });
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }

  // Auto-init
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initAll(document);
      startObserver();
    });
  } else {
    initAll(document);
    startObserver();
  }
})();
