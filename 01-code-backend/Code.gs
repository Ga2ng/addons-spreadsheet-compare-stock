/**
 * Code.gs
 * Entry point Add-on Spreadsheet SO
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu("Add-on SO")
    .addItem("Buka Compare Stock", "showSidebar")
    .addToUi();
}

function onInstall(e) {
  onOpen(e);
}

function showSidebar() {
  const html = HtmlService.createHtmlOutputFromFile("Sidebar")
    .setTitle("Compare Stock SO")
    .setWidth(350);
  SpreadsheetApp.getUi().showSidebar(html);
}

/**
 * Endpoint dipanggil dari Sidebar saat inisialisasi
 */
function getInitialData() {
  var sheetInfo = getSpreadsheetSheets();
  var email = "User";
  try {
    email = Session.getActiveUser().getEmail() || "User";
  } catch (e) {
    email = "User";
  }
  return {
    sheets: sheetInfo.sheets,
    activeSheet: sheetInfo.activeSheet,
    userEmail: email
  };
}

/**
 * Endpoint menjalankan komparasi saja (untuk preview di sidebar / download JSON)
 */
function apiRunComparison(params) {
  return runStockComparison(params);
}

/**
 * Endpoint mencetak hasil komparasi langsung ke sheet baru
 */
function apiCetakHasil(params) {
  return cetakHasilKeSpreadsheet(params);
}
