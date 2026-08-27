/* Visa Cost Dashboard controller.
   - Visa price (foreign currency) = user-maintained, persistent, stored server-side.
   - INR visa cost = DERIVED (visa price x latest exchange rate), computed by the server.
   - Editing a price and refreshing exchange rates are SEPARATE actions. */
(() => {
  'use strict';

  const FLAGS = {
    Vietnam: '🇻🇳', Bahrain: '🇧🇭', 'United Arab Emirates': '🇦🇪', Tanzania: '🇹🇿',
    Kyrgyzstan: '🇰🇬', Armenia: '🇦🇲', Israel: '🇮🇱', Morocco: '🇲🇦', Turkey: '🇹🇷',
    Indonesia: '🇮🇩', Georgia: '🇬🇪', Cambodia: '🇰🇭', Egypt: '🇪🇬', Russia: '🇷🇺',
    'United States': '🇺🇸', Eurozone: '🇪🇺', India: '🇮🇳',
  };
  const flag = (country) => FLAGS[country] || '🏳️';

  const state = {
    data: null, rows: [], filtered: [],
    search: '', filter: 'all', sort: 'country',
    trendCode: null, trendDays: 30, trendMode: 'visa', chart: null,
    editCode: null,
  };

  const $ = (id) => document.getElementById(id);
  const grp = (v, d) => Number(v).toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d });
  const rupee = (v, d = 2) => (v == null || Number.isNaN(v) ? '—' : '₹' + grp(v, d));

  function rateDecimals(rate) {
    if (rate == null) return 2;
    if (rate >= 1) return 2;
    if (rate >= 0.01) return 4;
    if (rate >= 0.0001) return 6;
    return 8;
  }
  // "100 AED", "1,500,000 VND"
  function priceLabel(r) {
    if (!r.price_configured || r.visa_price == null) return null;
    const dec = Number.isInteger(r.visa_price) ? 0 : 2;
    return `${grp(r.visa_price, dec)} ${r.code}`;
  }
  // "1 AED = ₹26.11"  or low-value "1,000 VND = ₹3.64"
  function rateLabel(r) {
    if (r.rate == null) return '—';
    if (r.display_unit > 1) {
      return `${grp(r.display_unit, 0)} ${r.code} = ₹${grp(r.rate * r.display_unit, 2)}`;
    }
    return `1 ${r.code} = ₹${grp(r.rate, rateDecimals(r.rate))}`;
  }
  const dirClass = (d) => (d === 'up' ? 'up' : d === 'down' ? 'down' : 'flat');
  const arrow = (d) => (d === 'up' ? '↑' : d === 'down' ? '↓' : '→');

  // ---------- Load ----------
  async function loadDashboard() {
    const res = await fetch('/api/dashboard');
    if (!res.ok) throw new Error('Failed to load dashboard');
    const data = await res.json();
    state.data = data;
    // Visa dashboard focuses on core (non-reference) countries; keep reference out of visa views.
    state.rows = data.currencies.filter((c) => !c.is_reference);
    renderStatus();
    renderCards();
    applyFilters();
    populateTrendSelect();
    renderInfo();
    const setup = data.visa_summary && data.visa_summary.needs_setup;
    $('setupBanner').hidden = !setup;
    if (!state.trendCode && state.rows.length) {
      state.trendCode = (state.rows.find((r) => r.is_card && r.price_configured) || state.rows.find((r) => r.price_configured) || state.rows[0]).code;
      $('trendCurrency').value = state.trendCode;
    }
    loadTrend();
    loadPriceHistory();
  }

  // ---------- Status ----------
  function renderStatus() {
    const s = state.data.status;
    $('statusPill').className = 'status-pill ' + s.system_status;
    $('statusLabel').textContent = 'Exchange rates: ' + s.status_label;
    const last = s.last_successful_update;
    const vs = state.data.visa_summary;
    const m = [];
    m.push(`Exchange rates last updated: <b>${last ? last.human : '—'}</b>`);
    m.push(`Next exchange-rate update: <b>${s.next_scheduled_update.human}</b>`);
    if (last) m.push(`Currencies updated: <b>${last.currencies_successful}/${last.requested}</b>`);
    if (vs) m.push(`Visa prices configured: <b>${vs.configured}/${vs.total_countries}</b>`);
    if (vs && vs.configured > 0) m.push(`Total visa cost (all configured): <b>${rupee(vs.total_inr_today, 0)}</b>`);
    $('statusMetrics').innerHTML = m.join('');

    const banner = $('staleBanner');
    if (s.is_stale && last) {
      banner.hidden = false;
      $('staleBannerText').textContent = `Showing the last successful exchange rates from ${last.human}. Visa prices are unaffected.`;
    } else banner.hidden = true;
  }

  // ---------- Cards ----------
  function renderCards() {
    const cardRows = state.rows.filter((r) => r.is_card);
    $('cards').innerHTML = cardRows.map(cardHtml).join('');
    bindCardButtons();
  }
  function cardHtml(r) {
    if (!r.price_configured) {
      return `<div class="card notconfigured flat">
        <div class="c-name"><span class="c-flag">${flag(r.country)}</span> <b>${r.country}</b> (${r.code})</div>
        <div class="c-cost">Not Configured</div>
        <div class="c-sub">Set a visa price to see its INR cost.</div>
        <div class="c-setbtn"><button class="btn primary sm edit-price" data-code="${r.code}">Set price</button></div>
      </div>`;
    }
    const noRate = r.rate == null;
    const cls = noRate ? 'flat' : dirClass(r.visa_direction);
    const delta = !r.visa_change_available || r.inr_change == null
      ? '<span class="delta flat">N/A — no prior day</span>'
      : `<span class="delta ${dirClass(r.visa_direction)}">${arrow(r.visa_direction)} ${rupee(Math.abs(r.inr_change), 2)} (${r.inr_pct_change >= 0 ? '+' : '−'}${grp(Math.abs(r.inr_pct_change), 2)}%)</span>`
        + (r.price_change_flag ? ` <span class="price-changed-tag" title="Visa price was changed">price changed</span>` : '');
    return `<div class="card ${cls}">
      <div class="c-name"><span class="c-flag">${flag(r.country)}</span> <b>${r.country}</b> (${r.code})</div>
      <div class="c-cost">${noRate ? 'Awaiting rate' : rupee(r.inr_cost, 2)}</div>
      <div class="c-sub">Visa price: <b>${priceLabel(r)}</b></div>
      <div class="c-sub">Rate: ${rateLabel(r)}</div>
      <div class="c-delta">${delta}</div>
      <div class="c-updated">Rate updated: ${r.rate_date || '—'}${r.price_changed_at_ist ? ' · Price changed: ' + r.price_changed_at_ist.replace(/ IST$/, '') : ''}</div>
      <div class="c-setbtn"><button class="btn edit sm edit-price" data-code="${r.code}">Edit price</button></div>
    </div>`;
  }

  // ---------- Table ----------
  function applyFilters() {
    const q = state.search.trim().toLowerCase();
    let rows = state.rows.slice();
    if (q) rows = rows.filter((r) =>
      r.country.toLowerCase().includes(q) || r.currency_name.toLowerCase().includes(q) || r.code.toLowerCase().includes(q));
    switch (state.filter) {
      case 'configured': rows = rows.filter((r) => r.price_configured); break;
      case 'notconfigured': rows = rows.filter((r) => !r.price_configured); break;
      case 'gainers': rows = rows.filter((r) => r.inr_change != null && r.inr_change > 0.001); break;
      case 'losers': rows = rows.filter((r) => r.inr_change != null && r.inr_change < -0.001); break;
    }
    const byNum = (a, b, k, dir) => ((a[k] ?? -Infinity) - (b[k] ?? -Infinity)) * dir;
    switch (state.sort) {
      case 'cost_desc': rows.sort((a, b) => byNum(a, b, 'inr_cost', -1)); break;
      case 'cost_asc': rows.sort((a, b) => byNum(a, b, 'inr_cost', 1)); break;
      case 'pct_desc': rows.sort((a, b) => byNum(a, b, 'inr_pct_change', -1)); break;
      case 'pct_asc': rows.sort((a, b) => byNum(a, b, 'inr_pct_change', 1)); break;
      default: rows.sort((a, b) => a.country.localeCompare(b.country));
    }
    state.filtered = rows;
    renderTable();
  }
  function renderTable() {
    const rows = state.filtered;
    $('tableEmpty').hidden = rows.length > 0;
    $('visaTableBody').innerHTML = rows.map((r) => {
      const editBtn = `<button class="btn edit edit-price" data-code="${r.code}">${r.price_configured ? 'Edit Price' : 'Set Price'}</button>`;
      if (!r.price_configured) {
        return `<tr>
          <td>${flag(r.country)} ${r.country}</td>
          <td>${r.currency_name} <span class="code-chip">${r.code}</span></td>
          <td class="num notcfg" colspan="4">Not Configured</td>
          <td class="notcfg">—</td>
          <td>${editBtn}</td></tr>`;
      }
      const dc = dirClass(r.visa_direction);
      const change = r.inr_change == null
        ? '<span class="na">N/A</span>'
        : `<span class="cell-${dc}">${r.inr_change >= 0 ? '+' : '−'}₹${grp(Math.abs(r.inr_change), 2)}` +
          (r.inr_pct_change != null ? ` (${r.inr_pct_change >= 0 ? '+' : '−'}${grp(Math.abs(r.inr_pct_change), 2)}%)` : '') + '</span>' +
          (r.price_change_flag ? ` <span class="price-changed-tag">${grp(r.prev_visa_price, Number.isInteger(r.prev_visa_price) ? 0 : 2)}→${grp(r.visa_price, Number.isInteger(r.visa_price) ? 0 : 2)}</span>` : '');
      return `<tr>
        <td>${flag(r.country)} ${r.country}</td>
        <td>${r.currency_name} <span class="code-chip">${r.code}</span></td>
        <td class="num">${priceLabel(r)}</td>
        <td class="num">${rateLabel(r)}</td>
        <td class="num cost-col">${r.inr_cost == null ? '<span class="na">awaiting rate</span>' : rupee(r.inr_cost, 2)}</td>
        <td class="num">${change}</td>
        <td>${r.price_changed_at_ist ? r.price_changed_at_ist.replace(/ IST$/, '') : '—'}</td>
        <td>${editBtn}</td>
      </tr>`;
    }).join('');
    bindCardButtons();
  }

  function bindCardButtons() {
    document.querySelectorAll('.edit-price').forEach((b) => {
      b.onclick = () => openEditModal(b.dataset.code);
    });
  }

  // ---------- Info ----------
  function renderInfo() {
    const s = state.data.status, last = s.last_successful_update, vs = state.data.visa_summary;
    const items = [
      ['Exchange-rate status', s.status_label],
      ['Exchange rates last updated', last ? last.human : '—'],
      ['Next scheduled update', s.next_scheduled_update.human],
      ['Update type (last)', last ? last.type : '—'],
      ['Data source', last ? last.source : state.data.active_provider],
      ['Currencies updated', last ? `${last.currencies_successful}/${last.requested}` : '—'],
      ['Visa prices configured', vs ? `${vs.configured}/${vs.total_countries}` : '—'],
      ['Base currency', state.data.meta.base_currency],
      ['Timezone', state.data.meta.timezone],
      ['Server time (IST)', s.server_now_ist],
    ];
    $('infoGrid').innerHTML = items.map(([k, v]) => `<div class="info-item"><div class="k">${k}</div><div class="v">${v}</div></div>`).join('');
  }

  // ---------- Trend + price history ----------
  function populateTrendSelect() {
    const sel = $('trendCurrency'), cur = state.trendCode;
    sel.innerHTML = state.rows.map((r) => `<option value="${r.code}">${flag(r.country)} ${r.country} (${r.code})</option>`).join('');
    if (cur) sel.value = cur;
  }
  async function loadTrend() {
    if (!state.trendCode) return;
    const note = $('chartNote');
    note.textContent = 'Loading…';
    try {
      const isVisa = state.trendMode === 'visa';
      const url = isVisa ? `/api/visa-history/${state.trendCode}?days=${state.trendDays}` : `/api/history/${state.trendCode}?days=${state.trendDays}`;
      const data = await (await fetch(url)).json();
      const points = data.points || [];
      const label = isVisa ? 'INR Visa Cost' : `INR per 1 ${data.code}`;
      const values = points.map((p) => (isVisa ? p.inr_cost : p.rate));
      drawChart(points.map((p) => p.date), values, label, isVisa, data.code);
      if (!points.length) note.textContent = 'No history stored yet — it accumulates from each daily 09:00 IST update.';
      else if (points.filter((p, i) => values[i] != null).length <= 1) note.textContent = 'Only one data point so far — the line grows daily.';
      else note.textContent = `${data.country} (${data.code}) · ${label} · ${points.length} points`;
    } catch { note.textContent = 'Could not load history.'; }
  }
  async function loadPriceHistory() {
    if (!state.trendCode) return;
    try {
      const data = await (await fetch(`/api/visa-prices/${state.trendCode}/history`)).json();
      const v = data.versions || [];
      $('priceHistoryEmpty').hidden = v.length > 0;
      $('priceHistoryBody').innerHTML = v.map((row) => `<tr>
        <td>${row.effective_from_date}</td>
        <td>${row.effective_until_date || '<b>Current</b>'}</td>
        <td class="num">${grp(row.visa_price, Number.isInteger(row.visa_price) ? 0 : 2)} ${row.currency_code}</td>
        <td class="num">${row.inr_at_change == null ? '<span class="na">—</span>' : rupee(row.inr_at_change, 2)}</td>
        <td>${row.changed_by}</td>
        <td>${row.is_active ? '<span class="pill ok">Active</span>' : '<span class="pill stale">Superseded</span>'}</td>
      </tr>`).join('');
    } catch {}
  }
  function cssVar(n) { return getComputedStyle(document.documentElement).getPropertyValue(n).trim(); }
  function drawChart(labels, values, label, isVisa, code) {
    const ctx = $('trendChart').getContext('2d');
    const line = cssVar('--series-1'), grid = cssVar('--grid'), ink = cssVar('--muted');
    if (state.chart) state.chart.destroy();
    state.chart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{ label, data: values, borderColor: line, backgroundColor: 'transparent',
        borderWidth: 2, pointRadius: values.length > 60 ? 0 : 3, pointHoverRadius: 5, pointBackgroundColor: line, tension: 0.15, spanGaps: true }] },
      options: {
        responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { display: false }, tooltip: { callbacks: {
          title: (i) => i[0].label,
          label: (i) => isVisa ? `₹${grp(i.parsed.y, 2)} visa cost` : `₹${grp(i.parsed.y, rateDecimals(i.parsed.y))} per 1 ${code}`,
        } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: ink, maxRotation: 0, autoSkipPadding: 24 } },
          y: { grid: { color: grid }, ticks: { color: ink, callback: (v) => '₹' + grp(v, isVisa ? 0 : rateDecimals(v)) } },
        },
      },
    });
  }

  // ---------- Edit price modal ----------
  function openEditModal(code) {
    const r = state.rows.find((x) => x.code === code);
    if (!r) return;
    state.editCode = code;
    $('editModalTitle').textContent = `Edit Visa Price — ${r.country}`;
    $('editModalSub').textContent = r.price_configured
      ? `Current visa price: ${priceLabel(r)}. Editing only changes the visa price, not the exchange rate.`
      : `No price set yet. Enter the visa price in ${r.currency_name} (${r.code}).`;
    $('editModalCode').textContent = r.code;
    $('editPriceInput').value = r.price_configured ? r.visa_price : '';
    $('editModalHint').textContent = r.rate != null
      ? `At the current rate (${rateLabel(r)}), the INR cost updates instantly on save.`
      : 'INR cost will appear once an exchange rate is available.';
    $('editModalError').hidden = true;
    $('editModal').hidden = false;
    setTimeout(() => $('editPriceInput').focus(), 30);
  }
  function closeEditModal() { $('editModal').hidden = true; state.editCode = null; }
  async function saveEdit() {
    const code = state.editCode; if (!code) return;
    const val = $('editPriceInput').value;
    const btn = $('editSaveBtn'); btn.disabled = true;
    try {
      const res = await fetch(`/api/visa-prices/${code}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ price: val }),
      });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        const e = $('editModalError'); e.textContent = body.message || 'Could not save price.'; e.hidden = false;
        btn.disabled = false; return;
      }
      closeEditModal();
      await loadDashboard();
    } catch {
      const e = $('editModalError'); e.textContent = 'Network error while saving.'; e.hidden = false;
    } finally { btn.disabled = false; }
  }

  // ---------- Configure-all modal ----------
  function openConfigModal() {
    const rows = state.rows; // core countries
    $('configGrid').innerHTML = rows.map((r) => `
      <div class="config-row">
        <div class="cr-label">${flag(r.country)} ${r.country} <small>(${r.code})</small></div>
        <input type="text" inputmode="decimal" data-code="${r.code}" placeholder="price in ${r.code}"
               value="${r.price_configured ? r.visa_price : ''}" />
      </div>`).join('');
    $('configError').hidden = true;
    $('configModal').hidden = false;
  }
  function closeConfigModal() { $('configModal').hidden = true; }
  async function saveConfig() {
    const inputs = $('configGrid').querySelectorAll('input[data-code]');
    const prices = {};
    inputs.forEach((i) => { const v = i.value.trim(); if (v !== '') prices[i.dataset.code] = v; });
    if (Object.keys(prices).length === 0) { const e = $('configError'); e.textContent = 'Enter at least one price.'; e.hidden = false; return; }
    const btn = $('configSaveBtn'); btn.disabled = true;
    try {
      const res = await fetch('/api/visa-prices', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prices }),
      });
      const body = await res.json();
      if (!res.ok) { const e = $('configError'); e.textContent = 'Some prices failed to save.'; e.hidden = false; btn.disabled = false; return; }
      if (body.errors && body.errors.length) {
        const e = $('configError'); e.textContent = `Saved ${body.saved.length}; ${body.errors.length} invalid (${body.errors.map((x) => x.code).join(', ')}).`; e.hidden = false;
      }
      closeConfigModal();
      await loadDashboard();
    } catch { const e = $('configError'); e.textContent = 'Network error while saving.'; e.hidden = false; }
    finally { btn.disabled = false; }
  }

  // ---------- Manual exchange-rate refresh (separate from visa edits) ----------
  async function doRefresh() {
    const btn = $('refreshBtn'); btn.disabled = true; const orig = btn.textContent; btn.textContent = 'Refreshing rates…';
    try {
      const res = await fetch('/api/refresh', { method: 'POST' });
      const body = await res.json();
      if (res.status === 429) { btn.textContent = 'Please wait…'; setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 2500); return; }
      await loadDashboard();
      btn.textContent = body.ok ? '✓ Rates updated' : '⚠ Update issue';
    } catch { btn.textContent = '⚠ Failed'; }
    finally { setTimeout(() => { btn.textContent = orig; btn.disabled = false; }, 1800); }
  }

  // ---------- Theme ----------
  function initTheme() {
    const prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', prefersDark ? 'dark' : 'light');
    $('themeToggle').addEventListener('click', () => {
      const cur = document.documentElement.getAttribute('data-theme');
      document.documentElement.setAttribute('data-theme', cur === 'dark' ? 'light' : 'dark');
      if (state.data) { renderStatus(); loadTrend(); }
    });
  }

  // ---------- Wire up ----------
  function init() {
    initTheme();
    $('search').addEventListener('input', (e) => { state.search = e.target.value; applyFilters(); });
    $('filter').addEventListener('change', (e) => { state.filter = e.target.value; applyFilters(); });
    $('sort').addEventListener('change', (e) => { state.sort = e.target.value; applyFilters(); });
    $('refreshBtn').addEventListener('click', doRefresh);
    $('configureBtn').addEventListener('click', openConfigModal);
    $('setupBannerBtn').addEventListener('click', openConfigModal);
    $('editCancelBtn').addEventListener('click', closeEditModal);
    $('editSaveBtn').addEventListener('click', saveEdit);
    $('editPriceInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveEdit(); });
    $('configCancelBtn').addEventListener('click', closeConfigModal);
    $('configSaveBtn').addEventListener('click', saveConfig);
    document.querySelectorAll('.modal-overlay').forEach((o) => o.addEventListener('click', (e) => { if (e.target === o) o.hidden = true; }));
    $('trendCurrency').addEventListener('change', (e) => { state.trendCode = e.target.value; loadTrend(); loadPriceHistory(); });
    $('trendMode').addEventListener('change', (e) => { state.trendMode = e.target.value; loadTrend(); });
    $('rangeTabs').addEventListener('click', (e) => {
      const b = e.target.closest('.range-tab'); if (!b) return;
      document.querySelectorAll('.range-tab').forEach((t) => { t.classList.remove('active'); t.removeAttribute('aria-selected'); });
      b.classList.add('active'); b.setAttribute('aria-selected', 'true');
      state.trendDays = Number(b.dataset.days); loadTrend();
    });

    loadDashboard().catch((err) => { $('statusLabel').textContent = 'Failed to load data'; console.error(err); });
    setInterval(() => loadDashboard().catch(() => {}), 5 * 60 * 1000);
  }
  document.addEventListener('DOMContentLoaded', init);
})();
