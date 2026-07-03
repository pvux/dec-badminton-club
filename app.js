// ===================================================================
// CẦU LÔNG TÍNH TIỀN — app.js
// Giao tiếp với Google Apps Script API (xem apps-script/Code.gs)
// ===================================================================

const state = {
  members: [],       // danh sách cố định (string[])
  matches: [],        // toàn bộ trận đấu
  months: [],          // các tháng có dữ liệu, "YYYY-MM"
  contributions: [],    // các khoản đóng quỹ
  balances: [],          // số dư quỹ từng người
  selectedParticipants: new Set(),  // người được chọn cho trận đang tạo
  guestNames: [],                    // khách thêm riêng cho trận đang tạo (không nằm trong danh sách cố định)
  editingMatchId: null,                // id trận đấu đang được sửa người tham gia trong Lịch sử trận
  editingParticipants: new Set(),        // người được chọn khi đang sửa trận
  editingGuestNames: [],                   // người thêm khi đang sửa (không nằm trong danh sách cố định)
};

let matchDateField = null;
let contribDateField = null;
let courtFeeField = null;
let shuttleFeeField = null;
let contribAmountField = null;

// ---------- API helpers ----------

async function apiGet(action, params = {}) {
  const url = new URL(CONFIG.API_URL);
  url.searchParams.set('action', action);
  Object.entries(params).forEach(([k, v]) => {
    if (v !== null && v !== undefined && v !== '') url.searchParams.set(k, v);
  });
  const res = await fetch(url.toString());
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Lỗi không xác định');
  return json.data;
}

async function apiPost(action, payload = {}) {
  const res = await fetch(CONFIG.API_URL, {
    method: 'POST',
    // text/plain tránh preflight CORS mà Apps Script không xử lý được
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action, ...payload }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'Lỗi không xác định');
  return json.data;
}

// ---------- Banner ----------

function showBanner(message, type = 'success') {
  const el = document.getElementById('banner');
  el.textContent = message;
  el.className = `banner ${type}`;
  window.scrollTo({ top: 0, behavior: 'smooth' });
  clearTimeout(showBanner._t);
  showBanner._t = setTimeout(() => el.classList.add('hidden'), 4000);
}

// ---------- Tabs ----------

function setupTabs() {
  document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById(`panel-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

// ---------- Money formatting ----------

function fmtVND(n) {
  return Math.round(n).toLocaleString('vi-VN') + 'đ';
}

function monthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `Tháng ${parseInt(m, 10)}/${y}`;
}

function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

// ---------- Date field helpers (hiển thị dd/mm/yyyy, lưu ISO yyyy-mm-dd) ----------

function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function isoToDisplay(iso) {
  const [y, m, d] = String(iso || '').split('-');
  if (!y || !m || !d) return '';
  return `${d.padStart(2, '0')}/${m.padStart(2, '0')}/${y}`;
}

function displayToIso(display) {
  const match = String(display || '').trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!match) return '';
  const day = Number(match[1]);
  const month = Number(match[2]);
  const year = Number(match[3]);
  if (month < 1 || month > 12) return '';
  const daysInMonth = new Date(year, month, 0).getDate();
  if (day < 1 || day > daysInMonth) return '';
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

// Gắn 1 ô nhập ngày dạng text (dd/mm/yyyy) với 1 nút chọn ngày ẩn (input[type=date])
// để vẫn có lịch chọn ngày sẵn có của trình duyệt, nhưng luôn hiển thị đúng định dạng dd/mm/yyyy.
function setupDateField(textId, nativeId, { defaultToday = true } = {}) {
  const textInput = document.getElementById(textId);
  const nativeInput = document.getElementById(nativeId);

  textInput.addEventListener('input', () => {
    const digits = textInput.value.replace(/\D/g, '').slice(0, 8);
    let formatted = digits;
    if (digits.length > 4) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`;
    } else if (digits.length > 2) {
      formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`;
    }
    textInput.value = formatted;
    const iso = displayToIso(formatted);
    if (iso) nativeInput.value = iso;
  });

  nativeInput.addEventListener('change', () => {
    if (nativeInput.value) {
      textInput.value = isoToDisplay(nativeInput.value);
    }
  });

  const controller = {
    getIso: () => displayToIso(textInput.value),
    setIso: (iso) => {
      textInput.value = isoToDisplay(iso);
      nativeInput.value = iso || '';
    },
    reset: () => controller.setIso(defaultToday ? todayIso() : ''),
  };

  if (defaultToday) controller.setIso(todayIso());
  return controller;
}

// Gắn định dạng số tiền kiểu VN (dấu chấm ngăn cách hàng nghìn) khi gõ vào 1 ô input text.
function setupMoneyField(id) {
  const input = document.getElementById(id);

  function format() {
    const digits = input.value.replace(/\D/g, '');
    input.value = digits ? Number(digits).toLocaleString('vi-VN') : '';
  }
  input.addEventListener('input', format);

  return {
    getValue: () => Number(input.value.replace(/\D/g, '')) || 0,
    setValue: (n) => { input.value = n ? Number(n).toLocaleString('vi-VN') : ''; },
  };
}

// ---------- Load data ----------

async function loadAll() {
  const data = await apiGet('getAll');
  state.members = data.members || [];
  state.matches = data.matches || [];
  state.months = data.months || [];
  state.contributions = data.contributions || [];
  state.balances = data.balances || [];
  if (!state.months.includes(currentMonth())) {
    state.months = [currentMonth(), ...state.months];
  }

  // Mỗi bước render độc lập: lỗi ở 1 phần (VD 1 trận đấu dữ liệu lạ) không được
  // phép làm hỏng các phần còn lại của trang (VD làm rớt dropdown "Người đóng" ở Quỹ).
  const steps = [
    renderMembers, renderParticipantChips, populateMonthFilters,
    renderHistory, renderSummary, renderFundMemberSelect,
    renderBalances, renderContributionHistory,
  ];
  steps.forEach(fn => {
    try {
      fn();
    } catch (err) {
      console.error(`Lỗi khi chạy ${fn.name}:`, err);
    }
  });
}

// ===================================================================
// TẠO TRẬN ĐẤU
// ===================================================================

function renderParticipantChips() {
  const wrap = document.getElementById('participant-chips');
  wrap.innerHTML = '';

  const allNames = [...state.members, ...state.guestNames];
  if (allNames.length === 0) {
    wrap.innerHTML = '<span class="empty-state">Chưa có ai trong danh sách. Thêm ở tab "Danh sách cố định" hoặc thêm khách bên dưới.</span>';
  }

  allNames.forEach(name => {
    const isGuest = state.guestNames.includes(name);
    const chip = document.createElement('div');
    chip.className = 'chip' + (state.selectedParticipants.has(name) ? ' selected' : '') + (isGuest ? ' guest' : '');
    chip.innerHTML = `<span>${escapeHtml(name)}</span>${isGuest ? '<span class="remove-guest" title="Xoá khách">✕</span>' : ''}`;

    chip.addEventListener('click', (e) => {
      if (isGuest && e.target.classList.contains('remove-guest')) {
        state.guestNames = state.guestNames.filter(n => n !== name);
        state.selectedParticipants.delete(name);
        renderParticipantChips();
        updateTotalPreview();
        return;
      }
      if (state.selectedParticipants.has(name)) {
        state.selectedParticipants.delete(name);
      } else {
        state.selectedParticipants.add(name);
      }
      renderParticipantChips();
      updateTotalPreview();
    });

    wrap.appendChild(chip);
  });
}

function updateTotalPreview() {
  const courtFee = courtFeeField.getValue();
  const shuttleFee = shuttleFeeField.getValue();
  const total = courtFee + shuttleFee;
  const count = state.selectedParticipants.size;
  const perPerson = count > 0 ? total / count : 0;

  document.getElementById('preview-total').textContent = fmtVND(total);
  document.getElementById('preview-count').textContent = count;
  document.getElementById('preview-per-person').textContent = fmtVND(perPerson);
}

function setupNewMatchForm() {
  courtFeeField = setupMoneyField('court-fee');
  shuttleFeeField = setupMoneyField('shuttle-fee');
  document.getElementById('court-fee').addEventListener('input', updateTotalPreview);
  document.getElementById('shuttle-fee').addEventListener('input', updateTotalPreview);
  matchDateField = setupDateField('match-date', 'match-date-native');

  document.getElementById('add-guest-btn').addEventListener('click', () => {
    const input = document.getElementById('guest-name');
    const name = input.value.trim();
    if (!name) return;
    if ([...state.members, ...state.guestNames].some(n => n.toLowerCase() === name.toLowerCase())) {
      showBanner('Tên này đã có trong danh sách rồi.', 'error');
      return;
    }
    state.guestNames.push(name);
    state.selectedParticipants.add(name);
    input.value = '';
    renderParticipantChips();
    updateTotalPreview();
  });

  document.getElementById('guest-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      document.getElementById('add-guest-btn').click();
    }
  });

  document.getElementById('match-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-match-btn');
    const date = matchDateField.getIso();
    const courtFee = courtFeeField.getValue();
    const shuttleFee = shuttleFeeField.getValue();
    const note = document.getElementById('match-note').value.trim();
    const participants = Array.from(state.selectedParticipants);

    if (!date) {
      showBanner('Ngày đấu không hợp lệ. Nhập theo định dạng dd/mm/yyyy.', 'error');
      return;
    }
    if (participants.length === 0) {
      showBanner('Chọn ít nhất 1 người tham gia trận đấu.', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Đang lưu...';
    try {
      await apiPost('addMatch', { date, courtFee, shuttleFee, note, participants });
      showBanner('Đã lưu trận đấu!', 'success');
      // reset form
      document.getElementById('match-form').reset();
      matchDateField.reset();
      state.selectedParticipants.clear();
      state.guestNames = [];
      updateTotalPreview();
      await loadAll();
    } catch (err) {
      showBanner('Lỗi: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Lưu trận đấu';
    }
  });
}

// ===================================================================
// LỊCH SỬ TRẬN ĐẤU
// ===================================================================

function populateMonthFilters() {
  const months = [...new Set(state.months)].sort().reverse();
  [document.getElementById('history-month-filter'), document.getElementById('summary-month-filter')]
    .forEach(select => {
      const prev = select.value;
      select.innerHTML = '<option value="">Tất cả các tháng</option>' +
        months.map(m => `<option value="${m}">${monthLabel(m)}</option>`).join('');
      select.value = months.includes(prev) ? prev : (select.id === 'summary-month-filter' ? currentMonth() : '');
    });
}

function renderHistory() {
  const filter = document.getElementById('history-month-filter').value;
  const list = document.getElementById('history-list');
  const empty = document.getElementById('history-empty');
  const matches = filter ? state.matches.filter(m => m.date.slice(0, 7) === filter) : state.matches;

  list.innerHTML = '';
  empty.classList.toggle('hidden', matches.length > 0);

  matches.forEach(m => {
    const participants = m.participants || [];
    const item = document.createElement('div');
    item.className = 'match-item';

    if (state.editingMatchId === m.id) {
      renderMatchEditItem(item, m);
      list.appendChild(item);
      return;
    }

    item.innerHTML = `
      <div class="match-item-top">
        <div>
          <div class="match-date">${formatDateVN(m.date)}</div>
          <div class="match-fee">Sân ${fmtVND(m.courtFee)} · Cầu ${fmtVND(m.shuttleFee)}${m.note ? ' · ' + escapeHtml(m.note) : ''}</div>
        </div>
        <div style="text-align:right">
          <div class="match-per-person">${fmtVND(m.perPerson)}/người</div>
          <div class="match-item-actions">
            <button class="btn-icon edit-match-btn" data-id="${m.id}">Sửa</button>
            <button class="btn-icon-danger" data-id="${m.id}">Xoá</button>
          </div>
        </div>
      </div>
      <div class="match-participants">
        ${participants.map(p => `<span class="pill">${escapeHtml(p)}</span>`).join('')}
      </div>
    `;
    item.querySelector('.edit-match-btn').addEventListener('click', () => {
      state.editingMatchId = m.id;
      state.editingParticipants = new Set(participants);
      state.editingGuestNames = participants.filter(p => !state.members.includes(p));
      renderHistory();
    });
    item.querySelector('.btn-icon-danger').addEventListener('click', async () => {
      if (!confirm('Xoá trận đấu này?')) return;
      try {
        await apiPost('deleteMatch', { id: m.id });
        showBanner('Đã xoá trận đấu.', 'success');
        await loadAll();
      } catch (err) {
        showBanner('Lỗi: ' + err.message, 'error');
      }
    });
    list.appendChild(item);
  });
}

// Chế độ sửa 1 trận đấu: cho phép thêm/bỏ người tham gia (không đổi ngày/phí).
function renderMatchEditItem(item, m) {
  item.classList.add('match-item-editing');

  const allNames = [...new Set([...state.members, ...state.editingGuestNames])];

  item.innerHTML = `
    <div class="match-item-top">
      <div>
        <div class="match-date">${formatDateVN(m.date)}</div>
        ${m.note ? `<div class="match-fee">${escapeHtml(m.note)}</div>` : ''}
      </div>
    </div>
    <div class="grid-2">
      <label class="field">
        <span>Phí sân (VNĐ)</span>
        <input type="text" class="edit-court-fee" inputmode="numeric" autocomplete="off">
      </label>
      <label class="field">
        <span>Phí cầu (VNĐ)</span>
        <input type="text" class="edit-shuttle-fee" inputmode="numeric" autocomplete="off">
      </label>
    </div>
    <div class="field">
      <span>Người tham gia</span>
      <div class="chip-list edit-chip-list"></div>
    </div>
    <div class="grid-2 add-guest-row">
      <label class="field">
        <span>Thêm người khác</span>
        <input type="text" class="edit-guest-name" placeholder="Tên người chơi">
      </label>
      <div class="field guest-btn-wrap">
        <span>&nbsp;</span>
        <button type="button" class="btn btn-secondary edit-add-guest-btn">+ Thêm</button>
      </div>
    </div>
    <div class="match-edit-actions">
      <button type="button" class="btn btn-primary edit-save-btn">Lưu thay đổi</button>
      <button type="button" class="btn btn-secondary edit-cancel-btn">Huỷ</button>
    </div>
  `;

  const courtFeeInput = item.querySelector('.edit-court-fee');
  const shuttleFeeInput = item.querySelector('.edit-shuttle-fee');
  courtFeeInput.value = m.courtFee ? Number(m.courtFee).toLocaleString('vi-VN') : '';
  shuttleFeeInput.value = m.shuttleFee ? Number(m.shuttleFee).toLocaleString('vi-VN') : '';
  [courtFeeInput, shuttleFeeInput].forEach(input => {
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '');
      input.value = digits ? Number(digits).toLocaleString('vi-VN') : '';
    });
  });
  const getCourtFee = () => Number(courtFeeInput.value.replace(/\D/g, '')) || 0;
  const getShuttleFee = () => Number(shuttleFeeInput.value.replace(/\D/g, '')) || 0;

  const chipList = item.querySelector('.edit-chip-list');

  function renderChips() {
    chipList.innerHTML = '';
    allNames.forEach(name => {
      const isGuest = state.editingGuestNames.includes(name);
      const chip = document.createElement('div');
      chip.className = 'chip' + (state.editingParticipants.has(name) ? ' selected' : '') + (isGuest ? ' guest' : '');
      chip.innerHTML = `<span>${escapeHtml(name)}</span>${isGuest ? '<span class="remove-guest" title="Xoá khách">✕</span>' : ''}`;
      chip.addEventListener('click', (e) => {
        if (isGuest && e.target.classList.contains('remove-guest')) {
          const idx = allNames.indexOf(name);
          if (idx > -1) allNames.splice(idx, 1);
          state.editingGuestNames = state.editingGuestNames.filter(n => n !== name);
          state.editingParticipants.delete(name);
          renderChips();
          return;
        }
        if (state.editingParticipants.has(name)) {
          state.editingParticipants.delete(name);
        } else {
          state.editingParticipants.add(name);
        }
        renderChips();
      });
      chipList.appendChild(chip);
    });
  }
  renderChips();

  item.querySelector('.edit-add-guest-btn').addEventListener('click', () => {
    const input = item.querySelector('.edit-guest-name');
    const name = input.value.trim();
    if (!name) return;
    if (allNames.some(n => n.toLowerCase() === name.toLowerCase())) {
      showBanner('Tên này đã có trong danh sách rồi.', 'error');
      return;
    }
    allNames.push(name);
    state.editingGuestNames.push(name);
    state.editingParticipants.add(name);
    input.value = '';
    renderChips();
  });
  item.querySelector('.edit-guest-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      item.querySelector('.edit-add-guest-btn').click();
    }
  });

  item.querySelector('.edit-cancel-btn').addEventListener('click', () => {
    state.editingMatchId = null;
    renderHistory();
  });

  item.querySelector('.edit-save-btn').addEventListener('click', async (e) => {
    const participants = Array.from(state.editingParticipants);
    if (participants.length === 0) {
      showBanner('Trận đấu cần ít nhất 1 người tham gia.', 'error');
      return;
    }
    const btn = e.currentTarget;
    btn.disabled = true;
    btn.textContent = 'Đang lưu...';
    try {
      await apiPost('updateMatch', {
        id: m.id,
        participants,
        courtFee: getCourtFee(),
        shuttleFee: getShuttleFee(),
      });
      showBanner('Đã cập nhật trận đấu.', 'success');
      state.editingMatchId = null;
      await loadAll();
    } catch (err) {
      showBanner('Lỗi: ' + err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Lưu thay đổi';
    }
  });
}

// ===================================================================
// TỔNG KẾT THEO THÁNG
// ===================================================================

function renderSummary() {
  const filter = document.getElementById('summary-month-filter').value || currentMonth();
  const board = document.getElementById('scoreboard');
  const empty = document.getElementById('summary-empty');
  const matches = state.matches.filter(m => m.date.slice(0, 7) === filter);

  const totals = {};
  matches.forEach(m => {
    (m.participants || []).forEach(name => {
      if (!totals[name]) totals[name] = { total: 0, count: 0 };
      totals[name].total += m.perPerson;
      totals[name].count += 1;
    });
  });

  const rows = Object.entries(totals)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.total - a.total);

  board.innerHTML = '';
  empty.classList.toggle('hidden', rows.length > 0);

  rows.forEach(r => {
    const row = document.createElement('div');
    row.className = 'score-row';
    row.innerHTML = `
      <div>
        <div class="score-name">${escapeHtml(r.name)}</div>
        <div class="score-meta">${r.count} trận</div>
      </div>
      <div class="score-amount">${fmtVND(r.total)}</div>
    `;
    board.appendChild(row);
  });
}

// ===================================================================
// QUỸ
// ===================================================================

// Cho chọn cả thành viên cố định lẫn khách vãng lai (bất kỳ ai từng tham gia trận đấu)
// để có thể ghi nhận khoản khách vãng lai đã trả, tránh số dư quỹ bị lệch.
function renderFundMemberSelect() {
  const select = document.getElementById('contrib-name');
  const prev = select.value;

  const guestNames = [...new Set(state.matches.flatMap(m => m.participants || []))]
    .filter(name => !state.members.includes(name))
    .sort((a, b) => a.localeCompare(b, 'vi'));

  if (state.members.length === 0 && guestNames.length === 0) {
    select.innerHTML = '<option value="">Chưa có ai để chọn</option>';
    select.disabled = true;
    return;
  }
  select.disabled = false;

  const memberOptions = state.members.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  const guestOptions = guestNames.map(m => `<option value="${escapeHtml(m)}">${escapeHtml(m)}</option>`).join('');
  select.innerHTML =
    (memberOptions ? `<optgroup label="Danh sách cố định">${memberOptions}</optgroup>` : '') +
    (guestOptions ? `<optgroup label="Khách vãng lai">${guestOptions}</optgroup>` : '');

  if ([...state.members, ...guestNames].includes(prev)) select.value = prev;
}

function renderBalances() {
  const list = document.getElementById('balance-list');
  const empty = document.getElementById('balance-empty');
  const totalEl = document.getElementById('total-balance');
  list.innerHTML = '';
  empty.classList.toggle('hidden', state.balances.length > 0);

  const total = state.balances.reduce((sum, b) => sum + b.balance, 0);
  const totalCls = total > 0 ? 'positive' : (total < 0 ? 'negative' : 'zero');
  totalEl.className = `total-balance-banner ${totalCls}`;
  totalEl.innerHTML = `
    <span class="total-balance-label">Tổng quỹ hiện tại</span>
    <span class="total-balance-amount">${total < 0 ? '-' : ''}${fmtVND(Math.abs(total))}${total < 0 ? ' (âm)' : (total > 0 ? ' (dương)' : '')}</span>
  `;

  state.balances.forEach(b => {
    const cls = b.balance > 0 ? 'positive' : (b.balance < 0 ? 'negative' : 'zero');
    const row = document.createElement('div');
    const isGuest = !state.members.includes(b.name);
    row.className = 'balance-row';
    row.innerHTML = `
      <div>
        <div class="balance-name">${escapeHtml(b.name)}${isGuest ? '<span class="guest-tag">Vãng lai</span>' : ''}</div>
        <div class="balance-meta">Đã đóng ${fmtVND(b.contributed)} · Đã chi ${fmtVND(b.spent)}</div>
      </div>
      <div class="balance-amount ${cls}">${b.balance < 0 ? '-' : ''}${fmtVND(Math.abs(b.balance))}${b.balance < 0 ? ' (còn thiếu)' : (b.balance > 0 ? ' (dư)' : '')}</div>
    `;
    list.appendChild(row);
  });
}

function renderContributionHistory() {
  const list = document.getElementById('contribution-list');
  const empty = document.getElementById('contribution-empty');
  list.innerHTML = '';
  empty.classList.toggle('hidden', state.contributions.length > 0);

  state.contributions.forEach(c => {
    const item = document.createElement('div');
    item.className = 'match-item';
    item.innerHTML = `
      <div class="match-item-top">
        <div>
          <div class="match-date">${escapeHtml(c.name)}</div>
          <div class="match-fee">${formatDateVN(c.date)}${c.note ? ' · ' + escapeHtml(c.note) : ''}</div>
        </div>
        <div style="text-align:right">
          <div class="match-per-person">+${fmtVND(c.amount)}</div>
          <button class="btn-icon-danger" data-id="${c.id}">Xoá</button>
        </div>
      </div>
    `;
    item.querySelector('.btn-icon-danger').addEventListener('click', async () => {
      if (!confirm(`Xoá khoản đóng quỹ ${fmtVND(c.amount)} của ${c.name}?`)) return;
      try {
        await apiPost('deleteContribution', { id: c.id });
        showBanner('Đã xoá khoản đóng quỹ.', 'success');
        await loadAll();
      } catch (err) {
        showBanner('Lỗi: ' + err.message, 'error');
      }
    });
    list.appendChild(item);
  });
}

function setupContributionForm() {
  contribDateField = setupDateField('contrib-date', 'contrib-date-native');
  contribAmountField = setupMoneyField('contrib-amount');

  document.getElementById('contribution-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = document.getElementById('submit-contrib-btn');
    const name = document.getElementById('contrib-name').value;
    const amount = contribAmountField.getValue();
    const date = contribDateField.getIso();
    const note = document.getElementById('contrib-note').value.trim();

    if (!name) {
      showBanner('Chưa có ai để chọn — thêm người vào danh sách cố định hoặc tạo 1 trận đấu trước.', 'error');
      return;
    }
    if (amount <= 0) {
      showBanner('Số tiền đóng quỹ phải lớn hơn 0.', 'error');
      return;
    }
    if (!date) {
      showBanner('Ngày đóng không hợp lệ. Nhập theo định dạng dd/mm/yyyy.', 'error');
      return;
    }

    btn.disabled = true;
    btn.textContent = 'Đang lưu...';
    try {
      await apiPost('addContribution', { name, amount, date, note });
      showBanner('Đã ghi nhận khoản đóng quỹ!', 'success');
      document.getElementById('contribution-form').reset();
      contribDateField.reset();
      await loadAll();
    } catch (err) {
      showBanner('Lỗi: ' + err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Lưu khoản đóng quỹ';
    }
  });
}

// ===================================================================
// DANH SÁCH CỐ ĐỊNH
// ===================================================================

function renderMembers() {
  const list = document.getElementById('member-list');
  list.innerHTML = '';
  state.members.forEach(name => {
    const li = document.createElement('li');
    li.innerHTML = `<span>${escapeHtml(name)}</span><button class="btn-icon-danger" data-name="${escapeHtml(name)}">Xoá</button>`;
    li.querySelector('.btn-icon-danger').addEventListener('click', async () => {
      if (!confirm(`Xoá "${name}" khỏi danh sách cố định?`)) return;
      try {
        await apiPost('deleteMember', { name });
        showBanner('Đã xoá thành viên.', 'success');
        await loadAll();
      } catch (err) {
        showBanner('Lỗi: ' + err.message, 'error');
      }
    });
    list.appendChild(li);
  });
}

function setupMemberForm() {
  document.getElementById('member-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const input = document.getElementById('new-member-name');
    const name = input.value.trim();
    if (!name) return;
    try {
      await apiPost('addMember', { name });
      input.value = '';
      showBanner('Đã thêm thành viên.', 'success');
      await loadAll();
    } catch (err) {
      showBanner('Lỗi: ' + err.message, 'error');
    }
  });
}

// ---------- Utils ----------

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function formatDateVN(value) {
  // Chỉ lấy đúng phần yyyy-MM-dd, phòng khi dữ liệu cũ còn lẫn giờ/timezone
  // (vd '2026-07-01T17:00:00.000Z') thì vẫn hiển thị đúng dd/mm/yyyy.
  const ymd = String(value || '').slice(0, 10);
  const [y, m, d] = ymd.split('-');
  if (!y || !m || !d) return value;
  return `${d}/${m}/${y}`;
}

// ---------- Init ----------

async function init() {
  setupTabs();
  setupNewMatchForm();
  setupMemberForm();
  setupContributionForm();

  document.getElementById('history-month-filter').addEventListener('change', renderHistory);
  document.getElementById('summary-month-filter').addEventListener('change', renderSummary);

  if (!CONFIG.API_URL || CONFIG.API_URL.includes('PASTE_YOUR')) {
    showBanner('Chưa cấu hình API_URL trong config.js — xem README.md để lấy URL từ Apps Script.', 'error');
    return;
  }

  try {
    await loadAll();
  } catch (err) {
    showBanner('Không tải được dữ liệu: ' + err.message, 'error');
  }
}

document.addEventListener('DOMContentLoaded', init);
