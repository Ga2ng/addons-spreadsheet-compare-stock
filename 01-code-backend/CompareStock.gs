/**
 * CompareStock.gs
 * Modul pembanding Stok Lapangan (Aktual) vs Stok Sistem
 * Pembaruan:
 * 1. Perbaikan Akurasi Pembacaan Kolom Section: QTY SECTION vs QTY GUDANG dipisah secara tegas
 * 2. Sinkronisasi Cerdas: jika sheet sistem SECTION BEVERAGE dipilih, lokasi otomatis SECTION
 * 3. Fallback Header Finder: menjamin kolom QTY SECTION dan QTY GUDANG tidak pernah tertukar
 * 4. Legenda Keterangan Warna & Status Lengkap di akhir spreadsheet
 */

/**
 * Mengambil daftar nama sheet yang ada di spreadsheet aktif
 */
function getSpreadsheetSheets() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = ss.getSheets();
  const sheetNames = sheets.map(function(s) { return s.getName(); });
  const activeSheetName = ss.getActiveSheet().getName();
  
  return {
    sheets: sheetNames,
    activeSheet: activeSheetName
  };
}

/**
 * Pembersih angka tangguh (titik ribuan Indonesia "1.000", "1.040,00", teks suffix "13 Galon", nilai '-' = 0)
 */
function parseNumberClean(val) {
  if (val === null || val === undefined) return 0;
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  
  var s = String(val).trim();
  if (s === '' || s === '-' || s === '–' || s === '—' || s === 'null' || s === 'undefined') {
    return 0;
  }
  
  var match = s.match(/[-+]?\s*[\d.,]+/);
  if (!match) return 0;
  
  var numStr = match[0].replace(/\s+/g, '');
  
  // 1. Titik ribuan DAN koma desimal, e.g. "1.040,00" atau "2.640,00"
  if (numStr.indexOf('.') !== -1 && numStr.indexOf(',') !== -1) {
    if (numStr.lastIndexOf(',') > numStr.lastIndexOf('.')) {
      numStr = numStr.replace(/\./g, '').replace(',', '.');
    } else {
      numStr = numStr.replace(/,/g, '');
    }
  }
  // 2. Koma saja, e.g. "6,00", "42,00", "-3,00"
  else if (numStr.indexOf(',') !== -1) {
    numStr = numStr.replace(',', '.');
  }
  // 3. Titik saja e.g. "1.000", "1.040", "7.000"
  else if (numStr.indexOf('.') !== -1) {
    if (/^\d{1,3}(\.\d{3})+$/.test(numStr)) {
      numStr = numStr.replace(/\./g, '');
    }
  }
  
  var num = parseFloat(numStr);
  return isNaN(num) ? 0 : num;
}

/**
 * Normalisasi nama untuk pencocokan teks standar
 */
function normalizeName(str) {
  if (!str) return '';
  return String(str)
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
}

/**
 * Membersihkan nama dasar produk:
 * - Membuang spesifikasi '@...' (contoh: '@1.000 GR/ PACK', '@3970 GR/PAIL')
 * - Membuang teks di dalam kurung '(...)'
 * - Menghilangkan tanda baca dan merapikan spasi
 */
function cleanProductBaseName(str) {
  if (!str) return '';
  var s = String(str);
  
  var atIdx = s.indexOf('@');
  if (atIdx !== -1) {
    s = s.substring(0, atIdx);
  }
  
  s = s.replace(/\([^\)]*\)/g, ' ');
  s = s.replace(/[-_/,.]/g, ' ');
  return s.replace(/\s+/g, ' ').trim().toUpperCase();
}

/**
 * Alfanumerik murni (huruf & angka saja tanpa spasi/simbol)
 */
function toCompactAlphanumeric(str) {
  if (!str) return '';
  return String(str)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

/**
 * Membersihkan kata keterangan umum pelengkap jika tidak ada kecocokan persis
 */
function stripTrailingDescriptors(str) {
  if (!str) return '';
  return str.replace(/\b(PLAIN|PROMO|LOKAL|IMPORT|REGULAR)\b/gi, '').replace(/\s+/g, ' ').trim();
}

/**
 * Helper khusus deteksi Blackpaper Powder & Blackpaper Sauce
 */
function isBlackpaperPowder(str) {
  if (!str) return false;
  var s = String(str).toUpperCase();
  return /BLACK\s*P[AE]P+ER/i.test(s) && /POWDER/i.test(s);
}

function isBlackpaperSauce(str) {
  if (!str) return false;
  var s = String(str).toUpperCase();
  return /BLACK\s*P[AE]P+ER/i.test(s) && (/SAU[CS]E|SAUS/i.test(s) || !/POWDER/i.test(s));
}

function isAnyBlackpaper(str) {
  if (!str) return false;
  return /BLACK\s*P[AE]P+ER/i.test(String(str));
}

/**
 * Konversi baris Blackpaper ke satuan GRAM berdasarkan keterangan kemasan/porsi
 */
function convertBlackpaperRowToGram(rawName, qty, satuanKemasan, satuanGram, satuanSistem) {
  var sName = String(rawName || '').toUpperCase();
  var numQty = parseNumberClean(qty);
  if (numQty === 0) return 0;
  
  var allUnits = [satuanKemasan, satuanGram, satuanSistem].map(function(u) {
    return String(u || '').toUpperCase().trim();
  });
  
  // 1. Blackpaper Powder (@1000 GR/PACK)
  if (/POWDER/i.test(sName)) {
    var matchPowder = sName.match(/@\s*([0-9.,]+)/);
    var factorPowder = matchPowder ? parseNumberClean(matchPowder[1]) : 1000;
    if (factorPowder <= 1) factorPowder = 1000;
    
    // Jika satuan eksplisit GRAM dan angkanya mencerminkan gram (misal 500, 1000)
    if (allUnits.some(function(u) { return u === 'GR' || u === 'GRAM' || u === 'G'; }) && numQty >= 100) {
      return numQty;
    }
    // Jika satuan PACK / PCS atau nilai pack kecil -> kalikan faktor
    return numQty * factorPowder;
  }
  
  // 2. Blackpaper Sauce (@35 GRAM/PORSI)
  if (/SAU[CS]E|SAUS/i.test(sName) || isAnyBlackpaper(sName)) {
    var matchSauce = sName.match(/@\s*([0-9.,]+)/);
    var factorSauce = matchSauce ? parseNumberClean(matchSauce[1]) : 35;
    if (factorSauce <= 1) factorSauce = 35;
    
    // Jika satuan eksplisit GRAM dan nilai besar (> 500)
    if (allUnits.some(function(u) { return u === 'GR' || u === 'GRAM' || u === 'G'; }) && numQty > 500) {
      return numQty;
    }
    // Umumnya dicatat dalam porsi (misal: 20 porsi -> 20 * 35 = 700 gr)
    return numQty * factorSauce;
  }
  
  return numQty;
}

/**
 * Ekstraksi faktor konversi dari nama atau unit:
 * Mendukung format ribuan Indo: @1.000 GR/ PACK, @3970 GR/PAIL, @800GR/PACK, dll.
 */
function extractConversionInfo(strName, strUnitSys, unitKemasan, unitGram, unitSistemAktual) {
  var sources = [strName, strUnitSys, unitKemasan, unitGram, unitSistemAktual];
  
  for (var i = 0; i < sources.length; i++) {
    var src = String(sources[i] || '').trim();
    if (!src) continue;
    
    var match = src.match(/@\s*([0-9.,]+)\s*([A-Za-z/]+)?/i);
    if (match) {
      var rawNumStr = match[1];
      var factor = parseNumberClean(rawNumStr);
      if (factor > 1) {
        var subUnit = match[2] ? match[2].trim().toUpperCase() : '';
        return {
          factor: factor,
          subUnit: subUnit,
          source: 'AT_MARK',
          label: '@' + factor + (subUnit ? ' ' + subUnit : '')
        };
      }
    }
  }
  
  var allUnits = [strUnitSys, unitKemasan, unitGram, unitSistemAktual].map(function(u) {
    return String(u || '').toUpperCase().trim();
  });
  
  var hasKg = allUnits.some(function(u) { return u === 'KG' || u === 'KILOGRAM'; });
  var hasGr = allUnits.some(function(u) { return u === 'GR' || u === 'GRAM' || u === 'G'; });
  if (hasKg && hasGr) {
    return { factor: 1000, subUnit: 'GR', source: 'METRIC', label: '1 KG = 1000 GR' };
  }
  
  var hasLiter = allUnits.some(function(u) { return u === 'L' || u === 'LITER' || u === 'LTR'; });
  var hasMl = allUnits.some(function(u) { return u === 'ML' || u === 'MILLILITER'; });
  if (hasLiter && hasMl) {
    return { factor: 1000, subUnit: 'ML', source: 'METRIC', label: '1 L = 1000 ML' };
  }
  
  return null;
}

/**
 * Mencari baris header dengan pemetaan persis di 35 baris pertama
 */
function findHeaderMapping(sheetData, expectedHeaders) {
  var maxRows = Math.min(sheetData.length, 35);
  var bestRow = -1;
  var bestScore = 0;
  var bestMapping = {};
  
  for (var r = 0; r < maxRows; r++) {
    var row = sheetData[r];
    if (!row || row.length === 0) continue;
    
    var mapping = {};
    var score = 0;
    
    for (var c = 0; c < row.length; c++) {
      var cellRaw = String(row[c] || '').replace(/[\r\n\t]+/g, ' ').trim();
      if (!cellRaw) continue;
      
      var cellVal = cellRaw.toUpperCase().replace(/\s+/g, ' ');
      var cellCompact = cellVal.replace(/[^A-Z0-9]/g, '');
      
      for (var key in expectedHeaders) {
        var aliases = expectedHeaders[key];
        var matched = false;
        
        for (var i = 0; i < aliases.length; i++) {
          var alias = aliases[i].toUpperCase();
          var aliasCompact = alias.replace(/[^A-Z0-9]/g, '');
          
          if (cellVal === alias || cellCompact === aliasCompact) {
            if (mapping[key] === undefined) {
              mapping[key] = c;
              score += 2;
              matched = true;
              break;
            }
          }
        }
        if (matched) break;
      }
    }
    
    if (score > bestScore) {
      bestScore = score;
      bestRow = r;
      bestMapping = mapping;
    }
  }
  
  if (bestScore >= 2 && bestRow !== -1) {
    return {
      headerRowIndex: bestRow,
      mapping: bestMapping,
      score: bestScore
    };
  }
  return null;
}

/**
 * Menjalankan proses komparasi Stok Lapangan vs Stok Sistem
 */
function runStockComparison(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetAktualName = params.sheetAktual;
  var sheetSistemName = params.sheetSistem;
  var enableConversion = params.enableConversion !== false;
  
  // Lokasi murni sesuai pilihan user di sidebar (GUDANG atau SECTION, bebas dan dinamis)
  var lokasi = String(params.lokasi || 'GUDANG').trim().toUpperCase();
  if (lokasi !== 'SECTION' && lokasi !== 'GUDANG') {
    lokasi = 'GUDANG';
  }
  
  var sheetAktual = ss.getSheetByName(sheetAktualName);
  var sheetSistem = ss.getSheetByName(sheetSistemName);
  
  if (!sheetAktual) throw new Error('Sheet Aktual "' + sheetAktualName + '" tidak ditemukan!');
  if (!sheetSistem) throw new Error('Sheet Sistem "' + sheetSistemName + '" tidak ditemukan!');
  
  var dataAktual = sheetAktual.getDataRange().getValues();
  var dataSistem = sheetSistem.getDataRange().getValues();
  
  if (!dataAktual || dataAktual.length === 0) throw new Error('Sheet Aktual kosong!');
  if (!dataSistem || dataSistem.length === 0) throw new Error('Sheet Sistem kosong!');
  
  // 1. Pemetaan Header Sheet Aktual (Lengkap dengan alias Section & Gudang)
  var mappingAktual = findHeaderMapping(dataAktual, {
    nama: ['NAMA', 'PRODUCT NAME', 'PRODUCTNAME', 'NAMA PRODUK', 'NAMA BARANG', 'ITEM', 'BARANG'],
    qtyGudang: ['QTY GUDANG', 'QTYGUDANG', 'GUDANG QTY', 'GUDANG', 'STOK GUDANG'],
    satuanKemasan: ['SATUAN BY KEMASAN', 'SATUANKEMASAN', 'SATUAN KEMASAN', 'KEMASAN'],
    qtySection: [
      'QTY SECTION', 
      'QTYSECTION', 
      'SECTION QTY', 
      'SECTIONQTY', 
      'SECTION', 
      'QTY BAR', 
      'BAR', 
      'QTY OUTLET', 
      'OUTLET', 
      'STOK SECTION'
    ],
    satuanGram: ['SATUAN BY GRAM/ML', 'SATUAN BY GRAM', 'SATUAN GRAM', 'GRAM/ML', 'SATUAN SECTION', 'SATUAN'],
    totalAll: ['TOTAL ALL', 'TOTALALL', 'TOTAL'],
    satuanSistem: ['SATUAN BY SISTEM', 'SATUAN SISTEM']
  });
  
  if (!mappingAktual || mappingAktual.mapping.nama === undefined) {
    throw new Error('Header kolom NAMA pada Sheet Aktual "' + sheetAktualName + '" tidak dapat dideteksi.');
  }

  // Fallback Pemindaian Khusus: Pastikan QTY SECTION & QTY GUDANG tidak tertukar
  var hRowAktual = dataAktual[mappingAktual.headerRowIndex];
  if (mappingAktual.mapping.qtySection === undefined) {
    for (var c = 0; c < hRowAktual.length; c++) {
      var colStr = String(hRowAktual[c] || '').toUpperCase().trim();
      if ((colStr.indexOf('SECTION') !== -1 || colStr.indexOf('BAR') !== -1) && 
          colStr.indexOf('SATUAN') === -1 && 
          c !== mappingAktual.mapping.qtyGudang) {
        mappingAktual.mapping.qtySection = c;
        break;
      }
    }
  }
  if (mappingAktual.mapping.qtyGudang === undefined) {
    for (var c = 0; c < hRowAktual.length; c++) {
      var colStr = String(hRowAktual[c] || '').toUpperCase().trim();
      if (colStr.indexOf('GUDANG') !== -1 && colStr.indexOf('SATUAN') === -1) {
        mappingAktual.mapping.qtyGudang = c;
        break;
      }
    }
  }
  
  // 2. Pemetaan Header Sheet Sistem (Exact Match Prioritas Tinggi)
  var mappingSistem = findHeaderMapping(dataSistem, {
    productName: ['PRODUCT NAME', 'PRODUCTNAME', 'NAMA PRODUK', 'NAMAPRODUK', 'NAMA BARANG', 'PRODUCT', 'NAMA', 'ITEM NAME', 'ITEM', 'BARANG'],
    productCode: ['PRODUCT CODE', 'PRODUCTCODE', 'KODE PRODUK', 'KODE'],
    category: ['CATEGORY', 'KATEGORI'],
    subCategory: ['SUB CATEGORY', 'SUBCATEGORY', 'SUB KATEGORI'],
    unit: ['UNIT', 'SATUAN', 'UOM'],
    stockQty: ['STOCK QTY', 'STOCKQTY', 'CURRENT STOCK', 'QTY STOCK'],
    opnameQty: ['OPNAME QTY', 'OPNAMEQTY', 'OPNAME'],
    diffQty: ['DIFF. QTY', 'DIFF QTY', 'DIFFQTY', 'SELISIH'],
    valuePerUnit: ['VALUE PER UNIT', 'HARGA SATUAN'],
    valueTotal: ['VALUE TOTAL', 'TOTAL VALUE']
  });
  
  if (!mappingSistem || mappingSistem.mapping.productName === undefined) {
    throw new Error('Header kolom PRODUCT NAME pada Sheet Sistem "' + sheetSistemName + '" tidak dapat dideteksi.');
  }
  
  // 3. Bangun Lookup Data Sistem secara Presisi (Kandidat per Baris tanpa Menjumlahkan Data Berbeda)
  var mapSistemByExactName = {};
  var mapSistemByBaseName = {};
  var mapSistemByCompact = {};
  var listSistemItems = [];
  
  var colSysName = mappingSistem.mapping.productName;
  var colSysCode = mappingSistem.mapping.productCode;
  var colSysCat = mappingSistem.mapping.category;
  var colSysUnit = mappingSistem.mapping.unit;
  // Sesuai Instruksi User: Stok sistem diambil langsung dari kolom OPNAME QTY
  var colSysStock = mappingSistem.mapping.opnameQty !== undefined ? mappingSistem.mapping.opnameQty : mappingSistem.mapping.stockQty;
  
  for (var i = mappingSistem.headerRowIndex + 1; i < dataSistem.length; i++) {
    var sRow = dataSistem[i];
    var rawSysName = sRow[colSysName];
    if (!rawSysName) continue;
    
    var exactName = normalizeName(rawSysName);
    var baseName = cleanProductBaseName(rawSysName);
    var compactName = toCompactAlphanumeric(baseName);
    var rowStock = colSysStock !== undefined ? parseNumberClean(sRow[colSysStock]) : 0;
    
    var itemObj = {
      productName: String(rawSysName).trim(),
      exactName: exactName,
      baseName: baseName,
      compactName: compactName,
      productCode: colSysCode !== undefined ? String(sRow[colSysCode] || '') : '',
      category: colSysCat !== undefined ? String(sRow[colSysCat] || '') : '',
      unit: colSysUnit !== undefined ? String(sRow[colSysUnit] || '').trim() : '',
      stockQty: rowStock,
      rowIndex: i + 1
    };
    
    listSistemItems.push(itemObj);
    
    if (exactName) {
      if (!mapSistemByExactName[exactName]) mapSistemByExactName[exactName] = [];
      mapSistemByExactName[exactName].push(itemObj);
    }
    if (baseName) {
      if (!mapSistemByBaseName[baseName]) mapSistemByBaseName[baseName] = [];
      mapSistemByBaseName[baseName].push(itemObj);
    }
    if (compactName) {
      if (!mapSistemByCompact[compactName]) mapSistemByCompact[compactName] = [];
      mapSistemByCompact[compactName].push(itemObj);
    }
  }
  
  // 4. Proses Komparasi Baris Aktual Lapangan
  var items = [];
  var summary = {
    totalAktual: 0,
    matchDirectCount: 0,
    matchConvertedCount: 0,
    convertedSysZeroCount: 0,
    matchCount: 0,
    selisihCount: 0,
    tidakAdaDiSistemCount: 0,
    kosongCount: 0,
    notFoundCount: 0
  };
  
  var mA = mappingAktual.mapping;

  // 4a. Pre-pass Special Case: BLACKPAPER (Powder @1000 GR/PACK + Sauce @35 GRAM/PORSI -> Total Gram vs Sistem)
  var blackpaperPowderInfo = null;
  var blackpaperSauceInfo = null;
  
  for (var p = mappingAktual.headerRowIndex + 1; p < dataAktual.length; p++) {
    var pRow = dataAktual[p];
    var pName = pRow[mA.nama];
    if (!pName) continue;
    
    var pQtyGudang = (mA.qtyGudang !== undefined && pRow[mA.qtyGudang] !== undefined) ? parseNumberClean(pRow[mA.qtyGudang]) : 0;
    var pSatKemasan = (mA.satuanKemasan !== undefined && pRow[mA.satuanKemasan] !== undefined) ? String(pRow[mA.satuanKemasan] || '').trim() : '';
    var pQtySection = (mA.qtySection !== undefined && pRow[mA.qtySection] !== undefined) ? parseNumberClean(pRow[mA.qtySection]) : 0;
    var pSatGram = (mA.satuanGram !== undefined && pRow[mA.satuanGram] !== undefined) ? String(pRow[mA.satuanGram] || '').trim() : '';
    var pSatSistem = (mA.satuanSistem !== undefined && pRow[mA.satuanSistem] !== undefined) ? String(pRow[mA.satuanSistem] || '').trim() : '';
    
    var pQtyTerpilih = (lokasi === 'SECTION') ? pQtySection : pQtyGudang;
    var pSatTerpilih = (lokasi === 'SECTION') ? (pSatGram || pSatSistem || 'GRAM') : (pSatKemasan || pSatSistem || 'PACK');
    
    if (isBlackpaperPowder(pName)) {
      var gPowder = convertBlackpaperRowToGram(pName, pQtyTerpilih, pSatKemasan, pSatGram, pSatSistem);
      blackpaperPowderInfo = {
        rowIndex: p,
        rawName: pName,
        qtyTerpilih: pQtyTerpilih,
        satuanTerpilih: pSatTerpilih,
        grams: gPowder
      };
    } else if (isBlackpaperSauce(pName)) {
      var gSauce = convertBlackpaperRowToGram(pName, pQtyTerpilih, pSatKemasan, pSatGram, pSatSistem);
      blackpaperSauceInfo = {
        rowIndex: p,
        rawName: pName,
        qtyTerpilih: pQtyTerpilih,
        satuanTerpilih: pSatTerpilih,
        grams: gSauce
      };
    }
  }

  var sysBlackpaperItem = null;
  for (var sIdx = 0; sIdx < listSistemItems.length; sIdx++) {
    var it = listSistemItems[sIdx];
    if (isBlackpaperSauce(it.productName) || isBlackpaperSauce(it.baseName) || isAnyBlackpaper(it.productName)) {
      sysBlackpaperItem = it;
      break;
    }
  }

  var totalBlackpaperGrams = (blackpaperPowderInfo ? blackpaperPowderInfo.grams : 0) + 
                             (blackpaperSauceInfo ? blackpaperSauceInfo.grams : 0);
  
  var sysBlackpaperGram = 0;
  if (sysBlackpaperItem) {
    var sU = (sysBlackpaperItem.unit || '').toUpperCase().trim();
    if (sU === 'GR' || sU === 'GRAM' || sU === 'G') {
      sysBlackpaperGram = sysBlackpaperItem.stockQty;
    } else if (sU === 'PORSI') {
      sysBlackpaperGram = sysBlackpaperItem.stockQty * 35;
    } else if (sU === 'KG' || sU === 'KILOGRAM' || sU === 'PACK') {
      sysBlackpaperGram = sysBlackpaperItem.stockQty * 1000;
    } else {
      if (Math.abs(sysBlackpaperItem.stockQty * 35 - totalBlackpaperGrams) < 0.1) {
        sysBlackpaperGram = sysBlackpaperItem.stockQty * 35;
      } else {
        sysBlackpaperGram = sysBlackpaperItem.stockQty;
      }
    }
  }
  var diffBlackpaperGram = Math.round((totalBlackpaperGrams - sysBlackpaperGram) * 100) / 100;

  for (var j = mappingAktual.headerRowIndex + 1; j < dataAktual.length; j++) {
    var aRow = dataAktual[j];
    var rawAktualName = aRow[mA.nama];
    if (!rawAktualName) continue;
    
    var baseAktual = cleanProductBaseName(rawAktualName);
    var compactAktual = toCompactAlphanumeric(baseAktual);
    
    // Nilai terpisah kolom Gudang vs Section
    var qtyGudang = (mA.qtyGudang !== undefined && aRow[mA.qtyGudang] !== undefined) ? parseNumberClean(aRow[mA.qtyGudang]) : 0;
    var satuanKemasan = (mA.satuanKemasan !== undefined && aRow[mA.satuanKemasan] !== undefined) ? String(aRow[mA.satuanKemasan] || '').trim() : '';
    
    var qtySection = (mA.qtySection !== undefined && aRow[mA.qtySection] !== undefined) ? parseNumberClean(aRow[mA.qtySection]) : 0;
    var satuanGram = (mA.satuanGram !== undefined && aRow[mA.satuanGram] !== undefined) ? String(aRow[mA.satuanGram] || '').trim() : '';
    
    var totalAll = (mA.totalAll !== undefined && aRow[mA.totalAll] !== undefined) ? parseNumberClean(aRow[mA.totalAll]) : 0;
    var satuanSistem = (mA.satuanSistem !== undefined && aRow[mA.satuanSistem] !== undefined) ? String(aRow[mA.satuanSistem] || '').trim() : '';
    
    // PEMILIHAN NILAI AKTUAL SECARA KETAT SESUAI LOKASI (HANYA GUDANG ATAU SECTION):
    var qtyAktualTerpilih = 0;
    var satuanAktualTerpilih = '';
    
    if (lokasi === 'SECTION') {
      // HANYA BACA QTY SECTION!
      qtyAktualTerpilih = qtySection;
      satuanAktualTerpilih = satuanGram || satuanSistem || 'GRAM';
    } else {
      // HANYA BACA QTY GUDANG!
      qtyAktualTerpilih = qtyGudang;
      satuanAktualTerpilih = satuanKemasan || satuanSistem || 'PACK';
    }
    
    // Special Case: BLACKPAPER POWDER
    if (isBlackpaperPowder(rawAktualName)) {
      var bpPowderGram = blackpaperPowderInfo ? blackpaperPowderInfo.grams : 0;
      var itemResult = {
        namaAktual: String(rawAktualName).trim(),
        lokasiTerpilih: lokasi,
        qtyGudang: qtyGudang,
        satuanKemasan: satuanKemasan,
        qtySection: qtySection,
        satuanGram: satuanGram,
        totalAktual: totalAll,
        qtyAktual: qtyAktualTerpilih,
        satuanAktual: satuanAktualTerpilih,
        
        foundInSystem: true,
        namaSistem: sysBlackpaperItem ? sysBlackpaperItem.productName : 'BLACKPAPER SAUCE (GABUNGAN)',
        productCode: sysBlackpaperItem ? sysBlackpaperItem.productCode : '-',
        category: sysBlackpaperItem ? sysBlackpaperItem.category : '-',
        qtySistem: '-',
        satuanSistem: 'GRAM',
        faktorKonversi: '@1000 GR/PACK',
        selisih: 0,
        status: 'MATCH_CONVERTED',
        keteranganKonversi: 'Dikonversi: ' + qtyAktualTerpilih + ' ' + (satuanAktualTerpilih || 'PACK') + ' = ' + bpPowderGram + ' GR (@1000 GR/PACK) & disummary ke BLACKPAPER SAUCE'
      };
      
      summary.matchConvertedCount++;
      summary.matchCount++;
      summary.totalAktual++;
      items.push(itemResult);
      continue;
    }

    // Special Case: BLACKPAPER SAUCE
    if (isBlackpaperSauce(rawAktualName)) {
      var bpPowderGram = blackpaperPowderInfo ? blackpaperPowderInfo.grams : 0;
      var bpSauceGram = blackpaperSauceInfo ? blackpaperSauceInfo.grams : 0;
      var isBpMatch = Math.abs(diffBlackpaperGram) < 0.01;
      
      var bpStatus = 'MATCH_CONVERTED';
      var bpSelisih = 0;
      var bpKet = '';
      
      if (!sysBlackpaperItem) {
        if (totalBlackpaperGrams > 0) {
          bpStatus = 'TIDAK_ADA_DI_SISTEM';
          bpSelisih = totalBlackpaperGrams;
          bpKet = 'Total fisik ' + totalBlackpaperGrams + ' GR, namun Blackpaper Sauce tidak ditemukan di sistem';
          summary.tidakAdaDiSistemCount++;
          summary.notFoundCount++;
        } else {
          bpStatus = 'BELUM_TERCATAT';
          bpSelisih = 0;
          bpKet = 'Fisik kosong dan Blackpaper Sauce tidak ditemukan di sistem';
          summary.kosongCount++;
        }
      } else if (isBpMatch) {
        bpStatus = 'MATCH_CONVERTED';
        bpSelisih = 0;
        bpKet = 'Summary Fisik: Powder (' + bpPowderGram + ' gr) + Sauce (' + bpSauceGram + ' gr) = ' + totalBlackpaperGrams + ' GR (Sesuai dengan sistem: ' + sysBlackpaperItem.stockQty + ' ' + sysBlackpaperItem.unit + ')';
        summary.matchConvertedCount++;
        summary.matchCount++;
      } else {
        bpSelisih = diffBlackpaperGram;
        bpStatus = diffBlackpaperGram < 0 ? 'SELISIH_KURANG' : 'SELISIH_LEBIH';
        bpKet = 'Summary Fisik: Powder (' + bpPowderGram + ' gr) + Sauce (' + bpSauceGram + ' gr) = ' + totalBlackpaperGrams + ' GR vs Sistem: ' + sysBlackpaperItem.stockQty + ' ' + sysBlackpaperItem.unit + ' (' + sysBlackpaperGram + ' gr) → Selisih: ' + (diffBlackpaperGram > 0 ? '+' : '') + diffBlackpaperGram + ' GR';
        summary.selisihCount++;
      }
      
      var itemResult = {
        namaAktual: String(rawAktualName).trim(),
        lokasiTerpilih: lokasi,
        qtyGudang: qtyGudang,
        satuanKemasan: satuanKemasan,
        qtySection: qtySection,
        satuanGram: satuanGram,
        totalAktual: totalAll,
        qtyAktual: qtyAktualTerpilih,
        satuanAktual: satuanAktualTerpilih,
        
        foundInSystem: !!sysBlackpaperItem,
        namaSistem: sysBlackpaperItem ? sysBlackpaperItem.productName : '-',
        productCode: sysBlackpaperItem ? sysBlackpaperItem.productCode : '-',
        category: sysBlackpaperItem ? sysBlackpaperItem.category : '-',
        qtySistem: sysBlackpaperItem ? sysBlackpaperItem.stockQty : 0,
        satuanSistem: sysBlackpaperItem ? sysBlackpaperItem.unit : 'GRAM',
        faktorKonversi: '@35 GR/PORSI',
        selisih: bpSelisih,
        status: bpStatus,
        keteranganKonversi: bpKet
      };
      
      summary.totalAktual++;
      items.push(itemResult);
      continue;
    }
    
    // Kumpulkan kandidat sistem yang cocok namanya
    var exactAktual = normalizeName(rawAktualName);
    var candidates = [];
    
    if (mapSistemByExactName[exactAktual] && mapSistemByExactName[exactAktual].length > 0) {
      candidates = mapSistemByExactName[exactAktual];
    } else if (mapSistemByBaseName[baseAktual] && mapSistemByBaseName[baseAktual].length > 0) {
      candidates = mapSistemByBaseName[baseAktual];
    } else if (mapSistemByCompact[compactAktual] && mapSistemByCompact[compactAktual].length > 0) {
      candidates = mapSistemByCompact[compactAktual];
    } else {
      var strippedAktual = stripTrailingDescriptors(baseAktual);
      if (strippedAktual && strippedAktual !== baseAktual) {
        if (mapSistemByBaseName[strippedAktual] && mapSistemByBaseName[strippedAktual].length > 0) {
          candidates = mapSistemByBaseName[strippedAktual];
        } else if (mapSistemByCompact[toCompactAlphanumeric(strippedAktual)]) {
          candidates = mapSistemByCompact[toCompactAlphanumeric(strippedAktual)];
        }
      }
    }

    var sysMatch = null;
    if (candidates && candidates.length > 0) {
      // ATURAN UTAMA: PRIORITASKAN KESAMAAN VALUE TERLEBIH DAHULU!
      // 1. Jika ada kandidat yang nilainya sama persis dengan qtyAktual (misal 80 == 80), LANGSUNG PILIH!
      for (var k = 0; k < candidates.length; k++) {
        if (Math.abs(candidates[k].stockQty - qtyAktualTerpilih) < 0.001) {
          sysMatch = candidates[k];
          break;
        }
      }
      
      // 2. Jika belum cocok, cek apakah ada kandidat yang pas via konversi (@...)
      if (!sysMatch && enableConversion) {
        var tempConv = extractConversionInfo(rawAktualName, '', satuanKemasan, satuanGram, satuanSistem);
        if (tempConv && tempConv.factor > 1) {
          var tf = tempConv.factor;
          for (var k = 0; k < candidates.length; k++) {
            var candQty = candidates[k].stockQty;
            if (candQty > 0 && qtyAktualTerpilih > 0) {
              if (Math.abs(qtyAktualTerpilih / tf - candQty) < 0.01 || Math.abs(qtyAktualTerpilih * tf - candQty) < 0.01) {
                sysMatch = candidates[k];
                break;
              }
            }
          }
        }
      }
      
      // 3. Jika belum cocok, cocokkan berdasarkan kesamaan Satuan / UoM
      if (!sysMatch && satuanAktualTerpilih) {
        var uAktual = satuanAktualTerpilih.toUpperCase().trim();
        for (var k = 0; k < candidates.length; k++) {
          if (candidates[k].unit && candidates[k].unit.toUpperCase().trim() === uAktual) {
            sysMatch = candidates[k];
            break;
          }
        }
      }
      
      // 4. Fallback: gunakan kandidat pertama
      if (!sysMatch) {
        sysMatch = candidates[0];
      }
    }
    
    var convInfo = null;
    if (enableConversion) {
      convInfo = extractConversionInfo(
        rawAktualName, 
        sysMatch ? sysMatch.unit : '', 
        satuanKemasan, 
        satuanGram, 
        satuanSistem
      );
    }
    
    var itemResult = {
      namaAktual: String(rawAktualName).trim(),
      lokasiTerpilih: lokasi,
      qtyGudang: qtyGudang,
      satuanKemasan: satuanKemasan,
      qtySection: qtySection,
      satuanGram: satuanGram,
      totalAktual: totalAll,
      qtyAktual: qtyAktualTerpilih,
      satuanAktual: satuanAktualTerpilih,
      
      // Data Sistem
      foundInSystem: !!sysMatch,
      namaSistem: sysMatch ? sysMatch.productName : '-',
      productCode: sysMatch ? sysMatch.productCode : '-',
      category: sysMatch ? sysMatch.category : '-',
      qtySistem: sysMatch ? sysMatch.stockQty : 0,
      satuanSistem: sysMatch ? sysMatch.unit : (satuanSistem || '-'),
      
      // Konversi Info
      faktorKonversi: convInfo ? convInfo.label : '-',
      keteranganKonversi: '',
      
      // Hasil Komparasi
      selisih: 0,
      status: 'BELUM_TERCATAT'
    };
    
    if (sysMatch) {
      var sQty = sysMatch.stockQty;
      var aQty = qtyAktualTerpilih;
      var diffDirect = Math.round((aQty - sQty) * 100) / 100;
      
      // 1. Cocok Langsung (1 : 1)
      if (Math.abs(diffDirect) < 0.001) {
        if (aQty === 0 && sQty === 0) {
          itemResult.status = 'BELUM_TERCATAT';
          itemResult.selisih = 0;
          itemResult.qtySistem = sQty;
          itemResult.keteranganKonversi = 'Kedua stok bernilai 0 / kosong (nihil)';
          summary.kosongCount++;
        } else {
          itemResult.status = 'MATCH';
          itemResult.selisih = 0;
          itemResult.qtySistem = sQty;
          itemResult.keteranganKonversi = 'Sesuai langsung (1 : 1)';
          summary.matchDirectCount++;
          summary.matchCount++;
        }
      } 
      // 2. Logika Pembagian Jomplang Cerdas (@3970, @1000, dll)
      else if (convInfo && convInfo.factor > 1) {
        var f = convInfo.factor;
        var matchedByConv = false;
        
        // Kasus 2a: Nilai Aktual besar, Sistem nilai kecil (misal 11910 GR vs 3 Pail)
        if (aQty > 0 && sQty > 0 && aQty > sQty) {
          var hasilBagi = Math.round((aQty / f) * 1000) / 1000;
          if (Math.abs(hasilBagi - sQty) < 0.01) {
            itemResult.status = 'MATCH_CONVERTED';
            itemResult.qtySistem = sQty;
            itemResult.selisih = 0;
            itemResult.keteranganKonversi = 'Sesuai: ' + aQty + ' ÷ ' + f + ' = ' + sQty + ' ' + (convInfo.subUnit || itemResult.satuanSistem);
            matchedByConv = true;
          }
        }
        
        // Kasus 2b: Nilai Aktual kecil (2 Pack), Sistem nilai besar (2000 GR)
        if (!matchedByConv && aQty > 0 && sQty > 0 && sQty > aQty) {
          var hasilKali = Math.round((aQty * f) * 1000) / 1000;
          if (Math.abs(hasilKali - sQty) < 0.01) {
            itemResult.status = 'MATCH_CONVERTED';
            itemResult.qtySistem = sQty;
            itemResult.selisih = 0;
            itemResult.keteranganKonversi = 'Sesuai: ' + aQty + ' × ' + f + ' = ' + sQty + ' ' + itemResult.satuanSistem;
            matchedByConv = true;
          }
        }
        
        // KASUS 2d: Hasil bagi pas bulat tapi di sistem 0 -> Hijau Mint
        if (!matchedByConv && aQty > 0 && sQty === 0) {
          var hasilBagiPas = Math.round((aQty / f) * 1000) / 1000;
          if (Math.abs(hasilBagiPas - Math.round(hasilBagiPas)) < 0.001 && hasilBagiPas > 0) {
            var jmlPail = Math.round(hasilBagiPas);
            itemResult.status = 'CONVERTED_SYS_ZERO';
            itemResult.qtySistem = sQty;
            itemResult.selisih = jmlPail;
            itemResult.keteranganKonversi = 'Fisik ' + aQty + ' ' + (satuanAktualTerpilih || 'GR') + ' pas terbagi ' + f + ' = ' + jmlPail + ' ' + (convInfo.subUnit || 'Pail/Kemasan') + ' (Sistem masih 0)';
            matchedByConv = true;
            summary.convertedSysZeroCount++;
            summary.matchCount++;
          }
        }
        
        if (matchedByConv && itemResult.status === 'MATCH_CONVERTED') {
          summary.matchConvertedCount++;
          summary.matchCount++;
        } else if (!matchedByConv) {
          var sysLooksLikeKemasan = /PACK|BTL|BOTOL|PAIL|DOS|KARTON/i.test(itemResult.satuanSistem) || (sQty <= 100 && aQty > 200);
          var aDisetarakan = sysLooksLikeKemasan ? (aQty / f) : aQty;
          var diff = Math.round((aDisetarakan - sQty) * 100) / 100;
          
          itemResult.qtySistem = sQty;
          itemResult.selisih = diff;
          itemResult.status = diff < 0 ? 'SELISIH_KURANG' : 'SELISIH_LEBIH';
          if (sysLooksLikeKemasan) {
            itemResult.keteranganKonversi = 'Tidak sesuai (' + convInfo.label + ': ' + aQty + ' ÷ ' + f + ' = ' + (Math.round(aDisetarakan * 100) / 100) + ' ≠ ' + sQty + ')';
          } else {
            itemResult.keteranganKonversi = 'Tidak sesuai (Aktual: ' + aQty + ' ' + (itemResult.satuanAktual || '') + ' vs Sistem: ' + sQty + ' ' + (itemResult.satuanSistem || '') + ')';
          }
          summary.selisihCount++;
        }
      } 
      // 3. Selisih Langsung Biasa
      else {
        itemResult.qtySistem = sQty;
        itemResult.selisih = diffDirect;
        itemResult.status = diffDirect < 0 ? 'SELISIH_KURANG' : 'SELISIH_LEBIH';
        itemResult.keteranganKonversi = diffDirect === 0 ? 'Sesuai' : 'Tidak sesuai';
        summary.selisihCount++;
      }
    } else {
      itemResult.qtySistem = '-';
      itemResult.foundInSystem = false;
      
      // ATURAN WARNA:
      // OREN: Khusus jika ada nilai di aktual (qtyAktualTerpilih > 0), namun TIDAK ADA di sistem!
      // ABU-ABU: Jika keduanya nilainya kosong, null, atau tidak ada ditemukan!
      if (qtyAktualTerpilih > 0) {
        itemResult.selisih = qtyAktualTerpilih;
        itemResult.status = 'TIDAK_ADA_DI_SISTEM';
        itemResult.keteranganKonversi = 'Ada di aktual (' + qtyAktualTerpilih + ' ' + (satuanAktualTerpilih || '') + '), namun tidak ada di sheet sistem';
        summary.tidakAdaDiSistemCount++;
        summary.notFoundCount++;
      } else {
        itemResult.selisih = 0;
        itemResult.status = 'BELUM_TERCATAT';
        itemResult.keteranganKonversi = 'Keduanya bernilai kosong / 0 / tidak ditemukan';
        summary.kosongCount++;
      }
    }
    
    summary.totalAktual++;
    items.push(itemResult);
  }
  
  return {
    meta: {
      sheetAktual: sheetAktualName,
      sheetSistem: sheetSistemName,
      lokasi: lokasi,
      enableConversion: enableConversion,
      timestamp: new Date().toISOString()
    },
    summary: summary,
    items: items
  };
}

/**
 * Mencetak Hasil Perbandingan langsung ke Sheet Baru:
 * Header bersih: QTY AKTUAL, FAKTOR KONVERSI, QTY SISTEM, SELISIH, STATUS, KETERANGAN
 * Di bagian akhir sheet disertakan LEGENDA KETERANGAN WARNA lengkap
 */
function cetakHasilKeSpreadsheet(params) {
  var comparison = runStockComparison(params);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lokasi = comparison.meta.lokasi; // Mengambil lokasi yang sudah teruji presisi
  
  var targetSheetName = 'HASIL_COMPARE_' + lokasi.toUpperCase();
  var outSheet = ss.getSheetByName(targetSheetName);
  
  if (outSheet) {
    outSheet.clear();
  } else {
    outSheet = ss.insertSheet(targetSheetName);
  }
  
  // 1. Judul & Info Metadata
  outSheet.getRange('A1').setValue('LAPORAN KOMPARASI STOK LAPANGAN VS SISTEM (' + lokasi.toUpperCase() + ')');
  outSheet.getRange('A1').setFontSize(14).setFontWeight('bold').setFontColor('#1a73e8');
  
  var subInfo = 'Sheet Aktual: ' + params.sheetAktual + ' | Sheet Sistem: ' + params.sheetSistem + ' | Lokasi: ' + lokasi.toUpperCase() + ' | Tanggal: ' + Utilities.formatDate(new Date(), 'Asia/Jakarta', 'dd-MM-yyyy HH:mm:ss');
  outSheet.getRange('A2').setValue(subInfo).setFontSize(10).setFontColor('#555555');
  
  // 2. Summary Card di Row 4
  outSheet.getRange('A4:B4').merge().setValue('Total Produk Lapangan: ' + comparison.summary.totalAktual).setFontWeight('bold');
  outSheet.getRange('C4:D4').merge().setValue('Cocok / Sesuai: ' + comparison.summary.matchCount).setFontColor('#137333').setFontWeight('bold');
  outSheet.getRange('E4:F4').merge().setValue('Ada Selisih: ' + comparison.summary.selisihCount).setFontColor('#c5221f').setFontWeight('bold');
  outSheet.getRange('G4:H4').merge().setValue('Tidak Ada di Sistem: ' + comparison.summary.tidakAdaDiSistemCount).setFontColor('#c75b12').setFontWeight('bold');
  outSheet.getRange('I4:J4').merge().setValue('Kosong / Nihil: ' + comparison.summary.kosongCount).setFontColor('#5f6368').setFontWeight('bold');
  
  // 3. Header Kolom Simpel Bersih
  var headers = [
    'NO',
    'NAMA PRODUK (AKTUAL)',
    'KODE PRODUK',
    'KATEGORI',
    'QTY AKTUAL',
    'SATUAN AKTUAL',
    'FAKTOR KONVERSI',
    'QTY SISTEM',
    'SATUAN SISTEM',
    'SELISIH',
    'STATUS',
    'KETERANGAN / LOGIKA KONVERSI'
  ];
  
  var headerRow = 6;
  var headerRange = outSheet.getRange(headerRow, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground('#1f497d');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  
  // 4. Data Rows & Pewarnaan Cerdas
  var rows = [];
  var bgColors = [];
  var fontColors = [];
  
  for (var idx = 0; idx < comparison.items.length; idx++) {
    var item = comparison.items[idx];
    
    var statusText = '';
    var rowBg = '#ffffff';
    var textCol = '#000000';
    
    if (item.status === 'MATCH') {
      statusText = 'SESUAI (0)';
      rowBg = '#e6f4ea';
      textCol = '#137333';
    } else if (item.status === 'MATCH_CONVERTED') {
      statusText = 'SESUAI (KONVERSI)';
      rowBg = '#e0f2f1';
      textCol = '#00695c';
    } else if (item.status === 'CONVERTED_SYS_ZERO') {
      statusText = 'PAS KONVERSI (+ ' + item.selisih + ')';
      rowBg = '#d1e7dd';
      textCol = '#0f5132';
    } else if (item.status === 'SELISIH_KURANG') {
      statusText = 'KURANG (' + item.selisih + ')';
      rowBg = '#fce8e6';
      textCol = '#c5221f';
    } else if (item.status === 'SELISIH_LEBIH') {
      statusText = 'LEBIH (+' + item.selisih + ')';
      rowBg = '#fef7e0';
      textCol = '#b06000';
    } else if (item.status === 'TIDAK_ADA_DI_SISTEM') {
      statusText = 'TIDAK ADA DI SISTEM';
      rowBg = '#ffe8d6'; // Warna Orange Lembut
      textCol = '#c75b12'; // Warna Teks Orange Tegas
    } else {
      statusText = 'TIDAK TERCATAT (0 / -)';
      rowBg = '#f1f3f4';
      textCol = '#5f6368';
    }
    
    var rowValues = [
      idx + 1,
      item.namaAktual,
      item.productCode,
      item.category,
      item.qtyAktual,
      item.satuanAktual,
      item.faktorKonversi,
      item.foundInSystem ? item.qtySistem : '-',
      item.satuanSistem,
      item.foundInSystem ? item.selisih : '-',
      statusText,
      item.keteranganKonversi
    ];
    
    rows.push(rowValues);
    
    var rowBgArr = [];
    var rowFontArr = [];
    for (var c = 0; c < headers.length; c++) {
      if (c === 9 || c === 10) {
        rowBgArr.push(rowBg);
        rowFontArr.push(textCol);
      } else if (c === 6 || c === 7) {
        if (item.status === 'MATCH_CONVERTED') {
          rowBgArr.push('#e0f2f1');
          rowFontArr.push('#00695c');
        } else if (item.status === 'CONVERTED_SYS_ZERO') {
          rowBgArr.push('#d1e7dd');
          rowFontArr.push('#0f5132');
        } else if (item.status === 'TIDAK_ADA_DI_SISTEM') {
          rowBgArr.push('#fff4eb');
          rowFontArr.push('#c75b12');
        } else {
          rowBgArr.push(idx % 2 === 0 ? '#ffffff' : '#f9fbfd');
          rowFontArr.push('#333333');
        }
      } else if (c === 1 && item.status === 'TIDAK_ADA_DI_SISTEM') {
        // Sorotan nama produk yang tidak ada di sistem
        rowBgArr.push('#fff4eb');
        rowFontArr.push('#c75b12');
      } else {
        rowBgArr.push(idx % 2 === 0 ? '#ffffff' : '#f9fbfd');
        rowFontArr.push('#333333');
      }
    }
    bgColors.push(rowBgArr);
    fontColors.push(rowFontArr);
  }
  
  if (rows.length > 0) {
    var dataRange = outSheet.getRange(headerRow + 1, 1, rows.length, headers.length);
    dataRange.setValues(rows);
    dataRange.setBackgrounds(bgColors);
    dataRange.setFontColors(fontColors);
    dataRange.setBorder(true, true, true, true, true, true, '#d0d7de', SpreadsheetApp.BorderStyle.SOLID);
    
    outSheet.getRange(headerRow + 1, 1, rows.length, 1).setHorizontalAlignment('center');
    outSheet.getRange(headerRow + 1, 5, rows.length, 1).setHorizontalAlignment('right').setNumberFormat('#,##0.00');
    outSheet.getRange(headerRow + 1, 6, rows.length, 1).setHorizontalAlignment('center');
    outSheet.getRange(headerRow + 1, 7, rows.length, 1).setHorizontalAlignment('center');
    outSheet.getRange(headerRow + 1, 8, rows.length, 1).setHorizontalAlignment('right').setNumberFormat('#,##0.00');
    outSheet.getRange(headerRow + 1, 9, rows.length, 1).setHorizontalAlignment('center');
    outSheet.getRange(headerRow + 1, 10, rows.length, 1).setHorizontalAlignment('right').setFontWeight('bold');
    outSheet.getRange(headerRow + 1, 11, rows.length, 1).setHorizontalAlignment('center').setFontWeight('bold');
  }
  
  // 5. LEGENDA / KETERANGAN WARNA DI AKHIR SPREADSHEET
  var legendStartRow = headerRow + rows.length + 3;
  outSheet.getRange(legendStartRow, 1).setValue('KETERANGAN WARNA & STATUS:').setFontWeight('bold').setFontSize(11).setFontColor('#202124');
  
  var legendItems = [
    { label: 'SESUAI (0)', bg: '#e6f4ea', text: '#137333', desc: 'Stok fisik lapangan dan stok sistem cocok sempurna (1 : 1).' },
    { label: 'SESUAI (KONVERSI)', bg: '#e0f2f1', text: '#00695c', desc: 'Stok cocok setelah konversi satuan (@1000 GR, @35 PCS/PACK, dsb).' },
    { label: 'PAS KONVERSI (+N)', bg: '#d1e7dd', text: '#0f5132', desc: 'Fisik pas terkonversi utuh (misal: 11910 GR ÷ 3970 = 3 Pail), di sistem masih 0 / belum terisi.' },
    { label: 'LEBIH (+)', bg: '#fef7e0', text: '#b06000', desc: 'Stok fisik lapangan lebih banyak daripada sistem (ada selisih lebih).' },
    { label: 'KURANG (-)', bg: '#fce8e6', text: '#c5221f', desc: 'Stok fisik lapangan lebih sedikit daripada sistem (ada selisih kurang).' },
    { label: 'TIDAK ADA DI SISTEM', bg: '#ffe8d6', text: '#c75b12', desc: 'Stok fisik ADA di aktual (> 0), namun TIDAK DITEMUKAN di sheet sistem.' },
    { label: 'TIDAK TERCATAT (0 / -)', bg: '#f1f3f4', text: '#5f6368', desc: 'Kedua stok bernilai kosong, null, 0, atau tidak ditemukan di sistem.' }
  ];
  
  for (var k = 0; k < legendItems.length; k++) {
    var rIdx = legendStartRow + 1 + k;
    var leg = legendItems[k];
    
    var badgeCell = outSheet.getRange(rIdx, 2);
    badgeCell.setValue(leg.label).setBackground(leg.bg).setFontColor(leg.text).setFontWeight('bold').setHorizontalAlignment('center');
    badgeCell.setBorder(true, true, true, true, true, true, '#d0d7de', SpreadsheetApp.BorderStyle.SOLID);
    
    var descCell = outSheet.getRange(rIdx, 3, 1, 6).merge();
    descCell.setValue(leg.desc).setFontSize(10).setFontColor('#3c4043');
  }
  
  outSheet.setFrozenRows(headerRow);
  for (var col = 1; col <= headers.length; col++) {
    outSheet.autoResizeColumn(col);
  }
  
  ss.setActiveSheet(outSheet);
  
  return {
    success: true,
    sheetName: targetSheetName,
    summary: comparison.summary,
    comparisonData: comparison
  };
}
