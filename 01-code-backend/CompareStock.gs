/**
 * CompareStock.gs
 * Modul pembanding Stok Lapangan (Aktual) vs Stok Sistem
 * Fitur:
 * 1. Logika Pembagian Jomplang Cerdas (@3970 -> 11910 / 3970 = 3 Pail)
 * 2. Header Bersih: Kolom QTY DISETARAKAN diganti jadi QTY SISTEM (kolom dobel dihapus)
 * 3. Indikator Sesuai & Tidak Sesuai Informatif
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
  
  // Standar Metrik KG <-> GR atau L <-> ML
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
  var lokasi = params.lokasi || 'TOTAL';
  var enableConversion = params.enableConversion !== false;
  
  var sheetAktual = ss.getSheetByName(sheetAktualName);
  var sheetSistem = ss.getSheetByName(sheetSistemName);
  
  if (!sheetAktual) throw new Error('Sheet Aktual "' + sheetAktualName + '" tidak ditemukan!');
  if (!sheetSistem) throw new Error('Sheet Sistem "' + sheetSistemName + '" tidak ditemukan!');
  
  var dataAktual = sheetAktual.getDataRange().getValues();
  var dataSistem = sheetSistem.getDataRange().getValues();
  
  if (!dataAktual || dataAktual.length === 0) throw new Error('Sheet Aktual kosong!');
  if (!dataSistem || dataSistem.length === 0) throw new Error('Sheet Sistem kosong!');
  
  // 1. Pemetaan Header Sheet Aktual
  var mappingAktual = findHeaderMapping(dataAktual, {
    nama: ['NAMA', 'PRODUCT NAME', 'PRODUCTNAME', 'NAMA PRODUK', 'NAMA BARANG', 'ITEM', 'BARANG'],
    qtyGudang: ['QTY GUDANG', 'QTYGUDANG', 'GUDANG'],
    satuanKemasan: ['SATUAN BY KEMASAN', 'SATUANKEMASAN', 'SATUAN KEMASAN', 'KEMASAN'],
    qtySection: ['QTY SECTION', 'QTYSECTION', 'SECTION'],
    satuanGram: ['SATUAN BY GRAM/ML', 'SATUAN BY GRAM', 'SATUAN GRAM', 'GRAM/ML', 'SATUAN'],
    totalAll: ['TOTAL ALL', 'TOTALALL', 'TOTAL'],
    satuanSistem: ['SATUAN BY SISTEM', 'SATUAN SISTEM']
  });
  
  if (!mappingAktual || mappingAktual.mapping.nama === undefined) {
    throw new Error('Header kolom NAMA pada Sheet Aktual "' + sheetAktualName + '" tidak dapat dideteksi.');
  }
  
  // 2. Pemetaan Header Sheet Sistem
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
  
  // 3. Bangun Lookup Data Sistem secara Presisi
  var mapSistemByBaseName = {};
  var mapSistemByCompact = {};
  var listSistemItems = [];
  
  var colSysName = mappingSistem.mapping.productName;
  var colSysCode = mappingSistem.mapping.productCode;
  var colSysCat = mappingSistem.mapping.category;
  var colSysUnit = mappingSistem.mapping.unit;
  var colSysStock = mappingSistem.mapping.stockQty;
  
  for (var i = mappingSistem.headerRowIndex + 1; i < dataSistem.length; i++) {
    var sRow = dataSistem[i];
    var rawSysName = sRow[colSysName];
    if (!rawSysName) continue;
    
    var baseName = cleanProductBaseName(rawSysName);
    var compactName = toCompactAlphanumeric(baseName);
    var rowStock = colSysStock !== undefined ? parseNumberClean(sRow[colSysStock]) : 0;
    
    if (mapSistemByBaseName[baseName]) {
      mapSistemByBaseName[baseName].stockQty += rowStock;
      if (mapSistemByCompact[compactName]) {
        mapSistemByCompact[compactName].stockQty += rowStock;
      }
    } else {
      var itemObj = {
        productName: String(rawSysName).trim(),
        baseName: baseName,
        compactName: compactName,
        productCode: colSysCode !== undefined ? String(sRow[colSysCode] || '') : '',
        category: colSysCat !== undefined ? String(sRow[colSysCat] || '') : '',
        unit: colSysUnit !== undefined ? String(sRow[colSysUnit] || '').trim() : '',
        stockQty: rowStock,
        rowIndex: i + 1
      };
      
      listSistemItems.push(itemObj);
      if (baseName) mapSistemByBaseName[baseName] = itemObj;
      if (compactName) mapSistemByCompact[compactName] = itemObj;
    }
  }
  
  // 4. Proses Komparasi Baris Aktual Lapangan
  var items = [];
  var summary = {
    totalAktual: 0,
    matchDirectCount: 0,
    matchConvertedCount: 0,
    matchCount: 0,
    selisihCount: 0,
    notFoundCount: 0
  };
  
  var mA = mappingAktual.mapping;
  for (var j = mappingAktual.headerRowIndex + 1; j < dataAktual.length; j++) {
    var aRow = dataAktual[j];
    var rawAktualName = aRow[mA.nama];
    if (!rawAktualName) continue;
    
    var baseAktual = cleanProductBaseName(rawAktualName);
    var compactAktual = toCompactAlphanumeric(baseAktual);
    
    var qtyGudang = mA.qtyGudang !== undefined ? parseNumberClean(aRow[mA.qtyGudang]) : 0;
    var satuanKemasan = mA.satuanKemasan !== undefined ? String(aRow[mA.satuanKemasan] || '').trim() : '';
    var qtySection = mA.qtySection !== undefined ? parseNumberClean(aRow[mA.qtySection]) : 0;
    var satuanGram = mA.satuanGram !== undefined ? String(aRow[mA.satuanGram] || '').trim() : '';
    var totalAll = mA.totalAll !== undefined ? parseNumberClean(aRow[mA.totalAll]) : 0;
    var satuanSistem = mA.satuanSistem !== undefined ? String(aRow[mA.satuanSistem] || '').trim() : '';
    
    var qtyAktualTerpilih = 0;
    var satuanAktualTerpilih = '';
    
    if (lokasi === 'GUDANG') {
      qtyAktualTerpilih = qtyGudang;
      satuanAktualTerpilih = satuanKemasan || satuanSistem;
    } else if (lokasi === 'SECTION') {
      qtyAktualTerpilih = qtySection;
      satuanAktualTerpilih = satuanGram || satuanSistem;
    } else {
      if (totalAll === 0 && (qtyGudang > 0 || qtySection > 0)) {
        totalAll = qtyGudang + qtySection;
      }
      qtyAktualTerpilih = totalAll;
      satuanAktualTerpilih = satuanSistem || satuanKemasan || satuanGram;
    }
    
    // Pencocokan Nama Presisi
    var sysMatch = mapSistemByBaseName[baseAktual] || mapSistemByCompact[compactAktual] || null;
    
    if (!sysMatch) {
      var strippedAktual = stripTrailingDescriptors(baseAktual);
      if (strippedAktual && strippedAktual !== baseAktual) {
        sysMatch = mapSistemByBaseName[strippedAktual] || mapSistemByCompact[toCompactAlphanumeric(strippedAktual)] || null;
      }
    }
    
    // Ekstraksi info faktor konversi (@...)
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
      rawQtySistem: sysMatch ? sysMatch.stockQty : 0,
      qtySistem: sysMatch ? sysMatch.stockQty : 0, // Nilai sistem yang disetarakan
      satuanSistem: sysMatch ? sysMatch.unit : (satuanSistem || '-'),
      
      // Konversi Info
      faktorKonversi: convInfo ? convInfo.label : '-',
      keteranganKonversi: '',
      
      // Hasil Komparasi
      selisih: 0,
      status: 'TIDAK_DITEMUKAN'
    };
    
    if (sysMatch) {
      var sQty = sysMatch.stockQty;
      var aQty = qtyAktualTerpilih;
      var diffDirect = Math.round((aQty - sQty) * 100) / 100;
      
      // 1. Cek Kesesuaian Langsung (1 : 1)
      if (Math.abs(diffDirect) < 0.001) {
        itemResult.status = 'MATCH';
        itemResult.selisih = 0;
        itemResult.qtySistem = sQty;
        itemResult.keteranganKonversi = 'Sesuai langsung (1 : 1)';
        summary.matchDirectCount++;
        summary.matchCount++;
      } 
      // 2. Logika Pembagian Jomplang Cerdas (@3970, @1000, dll)
      else if (convInfo && convInfo.factor > 1) {
        var f = convInfo.factor;
        var matchedByConv = false;
        
        // Kasus 2a: Nilai Aktual besar (misal 11910 GR atau 2000 GR), Sistem nilai kecil (misal 3 Pail atau 2 Pack)
        if (aQty > 0 && sQty > 0 && aQty > sQty) {
          var hasilBagi = Math.round((aQty / f) * 1000) / 1000;
          // Periksa apakah pembagian dengan faktor persis menghasilkan stok sistem
          if (Math.abs(hasilBagi - sQty) < 0.01) {
            itemResult.status = 'MATCH_CONVERTED';
            itemResult.qtySistem = sQty; // Tampilkan nilai sistem yang cocok
            itemResult.selisih = 0;
            itemResult.keteranganKonversi = 'Sesuai: ' + aQty + ' ÷ ' + f + ' = ' + sQty + ' ' + (convInfo.subUnit || itemResult.satuanSistem);
            matchedByConv = true;
          }
        }
        
        // Kasus 2b: Nilai Aktual kecil (misal 2 Pack), Sistem nilai besar (misal 2000 GR)
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
        
        // Kasus 2c: Khusus Lokasi TOTAL
        if (!matchedByConv && lokasi === 'TOTAL' && (qtyGudang > 0 || qtySection > 0)) {
          var totalPack = Math.round((qtyGudang + (qtySection / f)) * 1000) / 1000;
          if (Math.abs(totalPack - sQty) < 0.01) {
            itemResult.status = 'MATCH_CONVERTED';
            itemResult.qtySistem = sQty;
            itemResult.selisih = 0;
            itemResult.keteranganKonversi = 'Sesuai: ' + qtyGudang + ' Pack + (' + qtySection + ' / ' + f + ') = ' + totalPack + ' ' + itemResult.satuanSistem;
            matchedByConv = true;
          }
        }
        
        if (matchedByConv) {
          summary.matchConvertedCount++;
          summary.matchCount++;
        } else {
          // Pembagian tidak ketemu nilai yang pas (Contoh kasus: 11971 / 3 tidak pas 3970)
          var sysLooksLikeKemasan = /PACK|BTL|BOTOL|PAIL|DOS|KARTON/i.test(itemResult.satuanSistem) || (sQty <= 100 && aQty > 200);
          var aDisetarakan = sysLooksLikeKemasan ? (aQty / f) : aQty;
          var diff = Math.round((aDisetarakan - sQty) * 100) / 100;
          
          itemResult.qtySistem = sQty;
          itemResult.selisih = diff;
          itemResult.status = diff < 0 ? 'SELISIH_KURANG' : 'SELISIH_LEBIH';
          itemResult.keteranganKonversi = 'Tidak sesuai (@' + convInfo.label + ': ' + aQty + ' ÷ ' + f + ' = ' + (Math.round(aDisetarakan * 100) / 100) + ' ≠ ' + sQty + ')';
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
      itemResult.status = 'TIDAK_DITEMUKAN';
      itemResult.keteranganKonversi = 'Produk tidak ditemukan di sheet sistem';
      summary.notFoundCount++;
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
 */
function cetakHasilKeSpreadsheet(params) {
  var comparison = runStockComparison(params);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var lokasi = params.lokasi || 'TOTAL';
  
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
  outSheet.getRange('C4:D4').merge().setValue('Cocok Langsung: ' + comparison.summary.matchDirectCount).setFontColor('#137333').setFontWeight('bold');
  outSheet.getRange('E4:F4').merge().setValue('Cocok via Konversi: ' + comparison.summary.matchConvertedCount).setFontColor('#00695c').setFontWeight('bold');
  outSheet.getRange('G4:H4').merge().setValue('Selisih: ' + comparison.summary.selisihCount).setFontColor('#c5221f').setFontWeight('bold');
  outSheet.getRange('I4:J4').merge().setValue('Tidak di Sistem: ' + comparison.summary.notFoundCount).setFontColor('#5f6368').setFontWeight('bold');
  
  // 3. Header Kolom Simpel Bersih (QTY AKTUAL & QTY SISTEM Tunggal)
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
  
  if (lokasi === 'TOTAL') {
    headers.push('QTY GUDANG');
    headers.push('QTY SECTION');
  }
  
  var headerRow = 6;
  var headerRange = outSheet.getRange(headerRow, 1, 1, headers.length);
  headerRange.setValues([headers]);
  headerRange.setBackground('#1f497d');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  
  // 4. Data Rows & Warna
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
    } else if (item.status === 'SELISIH_KURANG') {
      statusText = 'KURANG (' + item.selisih + ')';
      rowBg = '#fce8e6';
      textCol = '#c5221f';
    } else if (item.status === 'SELISIH_LEBIH') {
      statusText = 'LEBIH (+' + item.selisih + ')';
      rowBg = '#fef7e0';
      textCol = '#b06000';
    } else {
      statusText = 'TIDAK DI SISTEM';
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
    
    if (lokasi === 'TOTAL') {
      rowValues.push(item.qtyGudang);
      rowValues.push(item.qtySection);
    }
    
    rows.push(rowValues);
    
    var rowBgArr = [];
    var rowFontArr = [];
    for (var c = 0; c < headers.length; c++) {
      if (c === 9 || c === 10) { // Kolom SELISIH & STATUS
        rowBgArr.push(rowBg);
        rowFontArr.push(textCol);
      } else if (c === 6 || c === 7) { // FAKTOR KONVERSI & QTY SISTEM
        rowBgArr.push(item.status === 'MATCH_CONVERTED' ? '#e0f2f1' : (idx % 2 === 0 ? '#ffffff' : '#f9fbfd'));
        rowFontArr.push(item.status === 'MATCH_CONVERTED' ? '#00695c' : '#333333');
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
