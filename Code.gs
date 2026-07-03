/**
 * CẦU LÔNG TÍNH TIỀN — Backend API (Google Apps Script)
 * ------------------------------------------------------
 * Sheet này đóng vai trò database. Script này biến Google Sheet
 * thành một API JSON đơn giản để trang web (host trên GitHub Pages)
 * đọc/ghi dữ liệu.
 *
 * CÁCH TRIỂN KHAI (xem chi tiết trong README.md):
 * 1. Tạo 1 Google Sheet mới.
 * 2. Extensions > Apps Script, dán toàn bộ file này vào.
 * 3. Deploy > New deployment > Web app.
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 4. Copy URL /exec, dán vào CONFIG.API_URL trong app.js.
 */

const SHEET_MEMBERS = 'Members';
const SHEET_MATCHES = 'Matches';
const SHEET_CONTRIB = 'Contributions';

// Dán ID của Google Sheet vào đây (lấy từ URL của Sheet, đoạn giữa /d/ và /edit).
// VD URL: https://docs.google.com/spreadsheets/d/1AbCDefGhIJklmNoPQrStuVwxYZ/edit
//                                                  ^^^^^^^^^^^^^^^^^^^^^^^^^^ chính là SPREADSHEET_ID
const SPREADSHEET_ID = '1Cf1E6BgK0ERbVzYEr0_S0JMN9Yi5OkJNN8Ph4umWNIc';

// ---------- Sheet helpers ----------

function getSS() {
  // Không dùng getActiveSpreadsheet() vì khi chạy dưới dạng Web App
  // (gọi từ bên ngoài qua URL /exec), Apps Script KHÔNG có "spreadsheet
  // đang mở" nên getActiveSpreadsheet() trả về null và làm hỏng mọi request.
  // openById() luôn trỏ đúng vào Sheet này bất kể ai gọi hay gọi từ đâu.
  return SpreadsheetApp.openById(SPREADSHEET_ID);
}

function getOrCreateSheet_(name, headers) {
  const ss = getSS();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function membersSheet_() {
  return getOrCreateSheet_(SHEET_MEMBERS, ['Name']);
}

function matchesSheet_() {
  return getOrCreateSheet_(SHEET_MATCHES, [
    'ID', 'Date', 'CourtFee', 'ShuttleFee', 'TotalFee',
    'Participants', 'PerPerson', 'Note', 'CreatedAt'
  ]);
}

function contributionsSheet_() {
  return getOrCreateSheet_(SHEET_CONTRIB, [
    'ID', 'Name', 'Amount', 'Date', 'Note', 'CreatedAt'
  ]);
}

function sheetToObjects_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];
  const headers = values[0];
  const rows = values.slice(1);
  return rows
    .filter(r => r.some(c => c !== '' && c !== null))
    .map(r => {
      const obj = {};
      headers.forEach((h, i) => (obj[h] = r[i]));
      return obj;
    });
}

// ---------- Domain logic ----------

function getMembers_() {
  return sheetToObjects_(membersSheet_())
    .map(m => String(m.Name).trim())
    .filter(Boolean);
}

function addMember_(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('Tên không được để trống');
  const existing = getMembers_();
  if (existing.some(n => n.toLowerCase() === name.toLowerCase())) {
    throw new Error('Người này đã có trong danh sách');
  }
  membersSheet_().appendRow([name]);
  return getMembers_();
}

function deleteMember_(name) {
  const sheet = membersSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]).trim().toLowerCase() === String(name).trim().toLowerCase()) {
      sheet.deleteRow(i + 1);
    }
  }
  return getMembers_();
}

function matchToObj_(row) {
  let participants = [];
  try {
    participants = JSON.parse(row.Participants || '[]');
  } catch (e) {
    participants = String(row.Participants || '').split(',').map(s => s.trim()).filter(Boolean);
  }
  return {
    id: row.ID,
    date: row.Date instanceof Date
      ? Utilities.formatDate(row.Date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : row.Date,
    courtFee: Number(row.CourtFee) || 0,
    shuttleFee: Number(row.ShuttleFee) || 0,
    totalFee: Number(row.TotalFee) || 0,
    participants: participants,
    perPerson: Number(row.PerPerson) || 0,
    note: row.Note || '',
    createdAt: row.CreatedAt
  };
}

function getMatches_(month) {
  const rows = sheetToObjects_(matchesSheet_()).map(matchToObj_);
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  if (month) {
    return rows.filter(r => String(r.date).slice(0, 7) === month);
  }
  return rows;
}

function addMatch_(data) {
  const date = String(data.date || '').trim();
  const courtFee = Number(data.courtFee) || 0;
  const shuttleFee = Number(data.shuttleFee) || 0;
  const participants = Array.isArray(data.participants) ? data.participants.filter(Boolean) : [];
  const note = String(data.note || '').trim();

  if (!date) throw new Error('Thiếu ngày đấu');
  if (participants.length === 0) throw new Error('Cần ít nhất 1 người tham gia');

  const totalFee = courtFee + shuttleFee;
  const perPerson = totalFee / participants.length;
  const id = Utilities.getUuid();
  const createdAt = new Date();

  matchesSheet_().appendRow([
    id, date, courtFee, shuttleFee, totalFee,
    JSON.stringify(participants), perPerson, note, createdAt
  ]);

  return matchToObj_({
    ID: id, Date: date, CourtFee: courtFee, ShuttleFee: shuttleFee,
    TotalFee: totalFee, Participants: JSON.stringify(participants),
    PerPerson: perPerson, Note: note, CreatedAt: createdAt
  });
}

function updateMatch_(data) {
  const id = String(data.id || '').trim();
  const participants = Array.isArray(data.participants) ? data.participants.filter(Boolean) : [];
  if (!id) throw new Error('Thiếu ID trận đấu');
  if (participants.length === 0) throw new Error('Cần ít nhất 1 người tham gia');

  const sheet = matchesSheet_();
  const values = sheet.getDataRange().getValues();
  const headers = values[0];
  const idCol = headers.indexOf('ID');
  const totalFeeCol = headers.indexOf('TotalFee');
  const participantsCol = headers.indexOf('Participants');
  const perPersonCol = headers.indexOf('PerPerson');

  for (let i = 1; i < values.length; i++) {
    if (String(values[i][idCol]) === id) {
      const totalFee = Number(values[i][totalFeeCol]) || 0;
      const perPerson = totalFee / participants.length;
      sheet.getRange(i + 1, participantsCol + 1).setValue(JSON.stringify(participants));
      sheet.getRange(i + 1, perPersonCol + 1).setValue(perPerson);
      const row = {};
      headers.forEach((h, idx) => (row[h] = values[i][idx]));
      row.Participants = JSON.stringify(participants);
      row.PerPerson = perPerson;
      return matchToObj_(row);
    }
  }
  throw new Error('Không tìm thấy trận đấu');
}

function deleteMatch_(id) {
  const sheet = matchesSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
    }
  }
  return true;
}

function getSummary_(month) {
  const matches = getMatches_(month);
  const totals = {}; // name -> {total, matchCount}
  matches.forEach(m => {
    m.participants.forEach(name => {
      if (!totals[name]) totals[name] = { name: name, total: 0, matchCount: 0 };
      totals[name].total += m.perPerson;
      totals[name].matchCount += 1;
    });
  });
  return Object.values(totals).sort((a, b) => b.total - a.total);
}

function getMonthsAvailable_() {
  const matches = getMatches_(null);
  const months = new Set(matches.map(m => String(m.date).slice(0, 7)));
  return Array.from(months).sort().reverse();
}

// ---------- Quỹ (Contributions) ----------

function contribToObj_(row) {
  return {
    id: row.ID,
    name: row.Name,
    amount: Number(row.Amount) || 0,
    date: row.Date instanceof Date
      ? Utilities.formatDate(row.Date, Session.getScriptTimeZone(), 'yyyy-MM-dd')
      : row.Date,
    note: row.Note || '',
    createdAt: row.CreatedAt
  };
}

function getContributions_(month) {
  const rows = sheetToObjects_(contributionsSheet_()).map(contribToObj_);
  rows.sort((a, b) => (a.date < b.date ? 1 : -1));
  if (month) {
    return rows.filter(r => String(r.date).slice(0, 7) === month);
  }
  return rows;
}

function addContribution_(data) {
  const name = String(data.name || '').trim();
  const amount = Number(data.amount) || 0;
  const date = String(data.date || '').trim();
  const note = String(data.note || '').trim();

  if (!name) throw new Error('Thiếu tên người đóng quỹ');
  if (!date) throw new Error('Thiếu ngày đóng quỹ');
  if (amount <= 0) throw new Error('Số tiền đóng quỹ phải lớn hơn 0');

  const id = Utilities.getUuid();
  const createdAt = new Date();
  contributionsSheet_().appendRow([id, name, amount, date, note, createdAt]);

  return contribToObj_({ ID: id, Name: name, Amount: amount, Date: date, Note: note, CreatedAt: createdAt });
}

function deleteContribution_(id) {
  const sheet = contributionsSheet_();
  const values = sheet.getDataRange().getValues();
  for (let i = values.length - 1; i >= 1; i--) {
    if (String(values[i][0]) === String(id)) {
      sheet.deleteRow(i + 1);
    }
  }
  return true;
}

// Số dư quỹ = Tổng đã đóng - Tổng đã chi (tổng phí các trận đã tham gia, tính từ trước tới nay)
function getBalances_() {
  const members = getMembers_();
  const contributions = getContributions_(null);
  const matches = getMatches_(null);

  const contributed = {};
  contributions.forEach(c => {
    contributed[c.name] = (contributed[c.name] || 0) + c.amount;
  });

  const spent = {};
  matches.forEach(m => {
    m.participants.forEach(name => {
      spent[name] = (spent[name] || 0) + m.perPerson;
    });
  });

  // Gồm mọi thành viên cố định, cộng thêm bất kỳ ai từng đóng quỹ hoặc từng tham gia trận đấu
  // (kể cả khách vãng lai không có trong danh sách cố định) để tổng quỹ luôn khớp với
  // tổng đã thu - tổng đã chi trên thực tế, không bị "mất" phần chi phí của khách vãng lai.
  const names = new Set([...members, ...Object.keys(contributed), ...Object.keys(spent)]);

  return Array.from(names).map(name => {
    const totalContributed = contributed[name] || 0;
    const totalSpent = spent[name] || 0;
    return {
      name: name,
      contributed: totalContributed,
      spent: totalSpent,
      balance: totalContributed - totalSpent
    };
  }).sort((a, b) => b.balance - a.balance);
}

// ---------- HTTP routing ----------

function jsonOut_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet(e) {
  try {
    const action = e.parameter.action;
    let result;
    switch (action) {
      case 'getMembers':
        result = getMembers_();
        break;
      case 'getMatches':
        result = getMatches_(e.parameter.month || null);
        break;
      case 'getSummary':
        result = getSummary_(e.parameter.month || null);
        break;
      case 'getMonths':
        result = getMonthsAvailable_();
        break;
      case 'getContributions':
        result = getContributions_(e.parameter.month || null);
        break;
      case 'getBalances':
        result = getBalances_();
        break;
      case 'getAll':
        result = {
          members: getMembers_(),
          matches: getMatches_(null),
          months: getMonthsAvailable_(),
          contributions: getContributions_(null),
          balances: getBalances_()
        };
        break;
      default:
        return jsonOut_({ ok: false, error: 'Unknown action: ' + action });
    }
    return jsonOut_({ ok: true, data: result });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err.message || err) });
  }
}

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents || '{}');
    const action = body.action;
    let result;
    switch (action) {
      case 'addMember':
        result = addMember_(body.name);
        break;
      case 'deleteMember':
        result = deleteMember_(body.name);
        break;
      case 'addMatch':
        result = addMatch_(body);
        break;
      case 'updateMatch':
        result = updateMatch_(body);
        break;
      case 'deleteMatch':
        result = deleteMatch_(body.id);
        break;
      case 'addContribution':
        result = addContribution_(body);
        break;
      case 'deleteContribution':
        result = deleteContribution_(body.id);
        break;
      default:
        return jsonOut_({ ok: false, error: 'Unknown action: ' + action });
    }
    return jsonOut_({ ok: true, data: result });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err.message || err) });
  }
}
