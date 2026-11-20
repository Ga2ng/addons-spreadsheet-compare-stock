/**
 * ValidateEsbNames.gs
 * Fitur Validasi & Perbandingan Nama Bahan System ESB vs Form SO Outlet
 * 
 * Fitur Utama:
 * 1. Filter Item Aktif: Hanya membandingkan Stock Name / Bahan yang statusnya AKTIF di system ESB.
 * 2. Normalisasi & Pembersihan Nama: Menghilangkan keterangan kemasan (@1000 GR, kurung, dsb).
 * 3. Deteksi Kata Terbalik: Menangani urutan kata yang terbalik (contoh: "SYRUP CARAMEL" vs "CARAMEL SYRUP").
 * 4. Kamus Terjemahan F&B (Indonesia <-> Inggris): Mengenali istilah seperti AYAM <-> CHICKEN, SUSU <-> MILK, dsb.
 * 5. Deteksi Typo / Kemiripan Karakter (Levenshtein & N-gram): Menemukan kesalahan ketik (misal: "BLACKPAPER" vs "BLACKPEPPER").
 * 6. Penempatan Hasil: Menuliskan hasil validasi & pembenaran NAMA PERSIS di sebelah kolom Form SO.
 */

// Kamus sinonim & terjemahan bahan baku F&B (Indonesia <-> Inggris & variasi ejaan lokal)
var FNB_DICTIONARY = {
  // Protein & Daging
  'AYAM': 'CHICKEN',
  'CHICKEN': 'AYAM',
  'SAPI': 'BEEF',
  'BEEF': 'SAPI',
  'IKAN': 'FISH',
  'FISH': 'IKAN',
  'UDANG': 'SHRIMP',
  'SHRIMP': 'UDANG',
  'PRAWN': 'UDANG',
  'CUMI': 'SQUID',
  'SQUID': 'CUMI',
  'TELUR': 'EGG',
  'TELOR': 'EGG',
  'EGG': 'TELUR',
  'DAGING': 'MEAT',
  'MEAT': 'DAGING',
  'BEBEK': 'DUCK',
  'DUCK': 'BEBEK',

  // Bumbu & Rempah
  'BAWANG PUTIH': 'GARLIC',
  'GARLIC': 'BAWANG PUTIH',
  'BAWANG BOMBAY': 'ONION',
  'BOMBAY': 'ONION',
  'ONION': 'BAWANG BOMBAY',
  'BAWANG MERAH': 'SHALLOT',
  'SHALLOT': 'BAWANG MERAH',
  'JAHE': 'GINGER',
  'GINGER': 'JAHE',
  'CABAI': 'CHILI',
  'CABE': 'CHILI',
  'CHILI': 'CABE',
  'CHILLI': 'CABE',
  'LADA': 'PEPPER',
  'MERICA': 'PEPPER',
  'PEPPER': 'LADA',
  'LADA HITAM': 'BLACKPEPPER',
  'BLACKPEPPER': 'LADA HITAM',
  'BLACKPAPER': 'BLACKPEPPER',
  'GARAM': 'SALT',
  'SALT': 'GARAM',
  'GULA': 'SUGAR',
  'SUGAR': 'GULA',
  'GULA PASIR': 'WHITE SUGAR',
  'GULA MERAH': 'BROWNSUGAR',
  'BROWNSUGAR': 'GULA MERAH',
  'KAYU MANIS': 'CINNAMON',
  'CINNAMON': 'KAYU MANIS',
  'KUNYIT': 'TURMERIC',
  'TURMERIC': 'KUNYIT',
  'SERAI': 'LEMONGRASS',
  'SEREH': 'LEMONGRASS',
  'LEMONGRASS': 'SERAI',
  'KETUMBAR': 'CORIANDER',
  'CORIANDER': 'KETUMBAR',
  'PALA': 'NUTMEG',
  'NUTMEG': 'PALA',
  'CENGKEH': 'CLOVE',
  'CLOVE': 'CENGKEH',
  'WIJEN': 'SESAME',
  'SESAME': 'WIJEN',

  // Saus, Minyak, & Cairan
  'SAUS': 'SAUCE',
  'SAOS': 'SAUCE',
  'SAUCE': 'SAUS',
  'KECAP': 'SOY SAUCE',
  'KECAP ASIN': 'SOY SAUCE',
  'KECAP MANIS': 'SWEET SOY SAUCE',
  'MINYAK': 'OIL',
  'OIL': 'MINYAK',
  'MINYAK GORENG': 'COOKING OIL',
  'CUKA': 'VINEGAR',
  'VINEGAR': 'CUKA',
  'MADU': 'HONEY',
  'HONEY': 'MADU',
  'AIR': 'WATER',
  'WATER': 'AIR',

  // Dairy & Minuman
  'SUSU': 'MILK',
  'MILK': 'SUSU',
  'KEJU': 'CHEESE',
  'CHEESE': 'KEJU',
  'MENTEGA': 'BUTTER',
  'MARGARIN': 'MARGARINE',
  'BUTTER': 'MENTEGA',
  'KRIM': 'CREAM',
  'CREAM': 'KRIM',
  'TEH': 'TEA',
  'TEA': 'TEH',
  'KOPI': 'COFFEE',
  'COFFEE': 'KOPI',
  'SIRUP': 'SYRUP',
  'SYRUP': 'SIRUP',
  'ES': 'ICE',
  'ICE': 'ES',

  // Sayuran & Buah
  'DAUN': 'LEAF',
  'LEAF': 'DAUN',
  'JAMUR': 'MUSHROOM',
  'MUSHROOM': 'JAMUR',
  'WORTEL': 'CARROT',
  'CARROT': 'WORTEL',
  'KENTANG': 'POTATO',
  'POTATO': 'KENTANG',
  'TOMAT': 'TOMATO',
  'TOMATO': 'TOMAT',
  'TIMUN': 'CUCUMBER',
  'MENTIMUN': 'CUCUMBER',
  'CUCUMBER': 'TIMUN',
  'JERUK': 'ORANGE',
  'ORANGE': 'JERUK',
  'LEMON': 'LEMON',
  'LIME': 'JERUK NIPIS',
  'JERUK NIPIS': 'LIME',
  'KELAPA': 'COCONUT',
  'COCONUT': 'KELAPA',
  'DURIAN': 'DURIAN',
  'DUREN': 'DURIAN',

  // Tepung & Karbohidrat
  'TEPUNG': 'FLOUR',
  'FLOUR': 'TEPUNG',
  'BUBUK': 'POWDER',
  'POWDER': 'BUBUK',
  'BERAS': 'RICE',
  'NASI': 'RICE',
  'RICE': 'BERAS',
  'MIE': 'NOODLE',
  'MI': 'NOODLE',
  'NOODLE': 'MIE',
  'ROTI': 'BREAD',
  'BREAD': 'ROTI',
  'KACANG': 'PEANUT',
  'PEANUT': 'KACANG',
  'COKELAT': 'CHOCOLATE',
  'COKLAT': 'CHOCOLATE',
  'CHOCO': 'CHOCOLATE',
  'CHOCOLATE': 'COKLAT'
};

/**
 * Normalisasi dasar string: huruf kapital, buang spasi berlebih
 */
function cleanStringStandard(str) {
  if (!str) return '';
  return String(str).trim().toUpperCase().replace(/\s+/g, ' ');
}

/**
 * Menghilangkan spesifikasi kemasan dan tanda kurung dari nama bahan Form SO
 * Contoh: "BLACKPAPER POWDER (@1000 GR/PACK)" -> "BLACKPAPER POWDER"
 * Contoh: "CARAMEL SYRUP @1000ML/BTL" -> "CARAMEL SYRUP"
 */
function cleanMaterialNameForMatching(str) {
  if (!str) return '';
  var s = String(str);
  
  // Buang mulai dari tanda '@'
  var atIdx = s.indexOf('@');
  if (atIdx !== -1) {
    s = s.substring(0, atIdx);
  }
  
  // Buang isi dalam kurung '(...)'
  s = s.replace(/\([^\)]*\)/g, ' ');
  // Ganti tanda baca dengan spasi
  s = s.replace(/[-_/,.:;]/g, ' ');
  // Buang kata-kata kuantitas umum seperti 1000GR, 500ML, 1KG, 1LTR
  s = s.replace(/\b\d+\s*(GR|GRAM|KG|ML|L|LTR|PCS|BTL|PACK|PORSI|CAN|BOKS|DOS|SACHET)\b/gi, ' ');
  
  return cleanStringStandard(s);
}

/**
 * Memecah string menjadi array kata-kata kunci (tokens) yang bersih
 */
function tokenizeWords(str) {
  var cleaned = cleanMaterialNameForMatching(str);
  if (!cleaned) return [];
  var words = cleaned.split(/\s+/).filter(function(w) {
    return w.length > 1; // buang karakter tunggal
  });
  return words;
}

/**
 * Menghitung jarak Levenshtein antara dua teks
 */
function getLevenshteinDistance(a, b) {
  var matrix = [];
  var i, j;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  for (i = 0; i <= b.length; i++) {
    matrix[i] = [i];
  }
  for (j = 0; j <= a.length; j++) {
    matrix[0][j] = j;
  }

  for (i = 1; i <= b.length; i++) {
    for (j = 1; j <= a.length; j++) {
      if (b.charAt(i - 1) === a.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitusi
          matrix[i][j - 1] + 1,     // insersi
          matrix[i - 1][j] + 1      // delesi
        );
      }
    }
  }
  return matrix[b.length][a.length];
}

/**
 * Skor kesamaan string 0.0 - 1.0 (Levenshtein similarity)
 */
function getStringSimilarity(s1, s2) {
  var str1 = cleanStringStandard(s1);
  var str2 = cleanStringStandard(s2);
  if (str1 === str2) return 1.0;
  if (!str1 || !str2) return 0.0;
  
  var maxLen = Math.max(str1.length, str2.length);
  if (maxLen === 0) return 1.0;
  
  var dist = getLevenshteinDistance(str1, str2);
  return Math.max(0, (maxLen - dist) / maxLen);
}

/**
 * Memeriksa apakah token set sama (kata terbalik)
 * Contoh: ["SYRUP", "CARAMEL"] vs ["CARAMEL", "SYRUP"] -> True
 */
function isWordOrderInvertedMatch(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) return false;
  if (tokensA.length !== tokensB.length) return false;
  
  var sortedA = tokensA.slice().sort().join(' ');
  var sortedB = tokensB.slice().sort().join(' ');
  return sortedA === sortedB;
}

/**
 * Menerjemahkan token menggunakan kamus F&B
 */
function translateTokens(tokens) {
  return tokens.map(function(t) {
    return FNB_DICTIONARY[t] || t;
  });
}

/**
 * Menguji kecocokan dengan kamus terjemahan Indonesia <-> Inggris
 */
function isTranslationMatch(tokensA, tokensB) {
  var transA = translateTokens(tokensA).sort().join(' ');
  var transB = translateTokens(tokensB).sort().join(' ');
  if (transA === transB && transA.length > 0) return true;
  
  // Uji satu arah: A diterjemahkan sama dengan B
  var directTransA = translateTokens(tokensA).sort().join(' ');
  var rawB = tokensB.slice().sort().join(' ');
  if (directTransA === rawB) return true;
  
  // Uji sebaliknya: B diterjemahkan sama dengan A
  var directTransB = translateTokens(tokensB).sort().join(' ');
  var rawA = tokensA.slice().sort().join(' ');
  if (directTransB === rawA) return true;
  
  return false;
}

/**
 * Menghitung kecocokan Jaccard antar kumpulan kata (0.0 - 1.0)
 */
function getTokenOverlapScore(tokensA, tokensB) {
  if (tokensA.length === 0 || tokensB.length === 0) return 0;
  
  var setB = {};
  tokensB.forEach(function(b) { setB[b] = true; });
  
  var matchedCount = 0;
  tokensA.forEach(function(a) {
    if (setB[a]) {
      matchedCount++;
    } else {
      // Cek apakah ada terjemahan yang cocok
      var trans = FNB_DICTIONARY[a];
      if (trans && setB[trans]) {
        matchedCount += 0.95;
      } else {
        // Cek typo ringan per kata (> 80% similar)
        for (var bWord in setB) {
          if (getStringSimilarity(a, bWord) >= 0.8) {
            matchedCount += 0.85;
            break;
          }
        }
      }
    }
  });
  
  var totalDistinct = Math.max(tokensA.length, tokensB.length);
  return matchedCount / totalDistinct;
}

/**
 * Algoritma Cerdas Pencocokan Nama Bahan Form SO ke Master ESB
 * Mengembalikan objek: { matchItem, matchType, score, notes }
 */
function findBestEsbMatch(rawSoName, activeEsbItems) {
  if (!rawSoName || !activeEsbItems || activeEsbItems.length === 0) {
    return {
      matchItem: null,
      matchType: 'TIDAK_DITEMUKAN',
      score: 0,
      notes: 'Nama Form SO kosong atau Master ESB tidak memiliki item aktif'
    };
  }
  
  var cleanSoName = cleanMaterialNameForMatching(rawSoName);
  var tokensSo = tokenizeWords(rawSoName);
  var compactSo = cleanSoName.replace(/\s+/g, '');
  
  var bestMatch = null;
  var bestScore = 0;
  var bestType = 'TIDAK_DITEMUKAN';
  var bestNotes = '';
  
  for (var i = 0; i < activeEsbItems.length; i++) {
    var esb = activeEsbItems[i];
    var rawEsb = esb.productName;
    var cleanEsb = esb.cleanName;
    var tokensEsb = esb.tokens;
    var compactEsb = esb.compactName;
    
    // 1. KECOCOKAN PERSIS 100% (EXACT MATCH)
    if (cleanSoName === cleanEsb || compactSo === compactEsb) {
      return {
        matchItem: esb,
        matchType: 'PERSIS',
        score: 1.0,
        notes: 'Cocok persis dengan sistem ESB'
      };
    }
    
    // 2. KECOCOKAN KATA TERBALIK (WORD ORDER INVERTED)
    // Contoh: "SYRUP CARAMEL" vs "CARAMEL SYRUP"
    if (isWordOrderInvertedMatch(tokensSo, tokensEsb)) {
      return {
        matchItem: esb,
        matchType: 'KATA_TERBALIK',
        score: 0.98,
        notes: 'Urutan kata terbalik (' + cleanSoName + ' ⇄ ' + cleanEsb + ')'
      };
    }
    
    // 3. KECOCOKAN TERJEMAHAN BAHASA (INDONESIA <-> INGGRIS)
    // Contoh: "AYAM DADU" vs "CHICKEN DICED", "SUSU UHT" vs "UHT MILK"
    if (isTranslationMatch(tokensSo, tokensEsb)) {
      return {
        matchItem: esb,
        matchType: 'TERJEMAHAN',
        score: 0.95,
        notes: 'Cocok terjemahan bahasa (' + cleanSoName + ' ⇄ ' + cleanEsb + ')'
      };
    }
    
    // 4. KECOCOKAN TOKEN OVERLAP & TYPO (FUZZY)
    var overlapScore = getTokenOverlapScore(tokensSo, tokensEsb);
    var fullSimScore = getStringSimilarity(cleanSoName, cleanEsb);
    var combinedScore = Math.max(overlapScore, fullSimScore);
    
    if (combinedScore > bestScore) {
      bestScore = combinedScore;
      bestMatch = esb;
      
      if (overlapScore >= 0.85) {
        bestType = 'KATA_MIRIP';
        bestNotes = 'Komponen kata sangat mirip (Skor: ' + Math.round(overlapScore * 100) + '%)';
      } else if (fullSimScore >= 0.75) {
        bestType = 'TYPO';
        bestNotes = 'Kemungkinan ada typo / salah ketik (Kemiripan: ' + Math.round(fullSimScore * 100) + '%)';
      } else if (combinedScore >= 0.6) {
        bestType = 'MIRIP_SEBAGIAN';
        bestNotes = 'Mirip sebagian (' + Math.round(combinedScore * 100) + '%)';
      } else {
        bestType = 'TIDAK_DITEMUKAN';
        bestNotes = 'Tingkat kemiripan rendah (< 60%)';
      }
    }
  }
  
  if (bestScore >= 0.60 && bestMatch) {
    return {
      matchItem: bestMatch,
      matchType: bestType,
      score: bestScore,
      notes: bestNotes
    };
  }
  
  return {
    matchItem: null,
    matchType: 'TIDAK_DITEMUKAN',
    score: bestScore,
    notes: 'Tidak ditemukan bahan yang cocok di data aktif ESB'
  };
}

/**
 * Mengambil & Memfilter Master Bahan ESB: HANYA YANG AKTIF!
 */
function getActiveEsbItemsFromSheet(sheet) {
  var data = sheet.getDataRange().getValues();
  if (!data || data.length === 0) return [];
  
  // Cari header row di 30 baris pertama
  var headerRowIdx = -1;
  var colName = -1;
  var colStatus = -1;
  var colCode = -1;
  var colCat = -1;
  var colUnit = -1;
  
  var maxScanRows = Math.min(data.length, 30);
  for (var r = 0; r < maxScanRows; r++) {
    var row = data[r];
    for (var c = 0; c < row.length; c++) {
      var val = String(row[c] || '').toUpperCase().trim();
      if (/PRODUCT\s*NAME|ITEM\s*NAME|NAMA\s*BAHAN|NAMA\s*ITEM|STOCK\s*NAME|NAMA\s*PRODUK|NAMA\s*BARANG/.test(val) && colName === -1) {
        colName = c;
        headerRowIdx = r;
      }
      if (/STATUS\s*AKTIF|ACTIVE\s*STATUS|IS\s*ACTIVE|ISACTIVE|^STATUS$|^ACTIVE$/.test(val) && colStatus === -1) {
        colStatus = c;
      }
      if (/PRODUCT\s*CODE|ITEM\s*CODE|KODE\s*PRODUK|KODE\s*BAHAN|KODE/.test(val) && colCode === -1) {
        colCode = c;
      }
      if (/CATEGORY|KATEGORI/.test(val) && colCat === -1) {
        colCat = c;
      }
      if (/UNIT|SATUAN|UOM/.test(val) && colUnit === -1) {
        colUnit = c;
      }
    }
    if (colName !== -1) break;
  }
  
  // Fallback jika tidak terdeteksi via regex standar: kolom 0 sebagai nama
  if (colName === -1) {
    colName = 0;
    headerRowIdx = 0;
  }
  
  var items = [];
  for (var i = headerRowIdx + 1; i < data.length; i++) {
    var row = data[i];
    var rawName = String(row[colName] || '').trim();
    if (!rawName) continue;
    
    // FILTER UTAMA: Hanya yang aktif saja!
    if (colStatus !== -1) {
      var statusRaw = String(row[colStatus] || '').toUpperCase().trim();
      // Jika ada teks status, harus mengandung 'ACT' / 'AKTIF' / 'Y' / 'TRUE' / '1' dan TIDAK boleh 'INACT' / 'NON' / 'TIDAK' / 'FALSE' / '0'
      if (statusRaw !== '') {
        var isInactive = /INACTIVE|NON|TIDAK|DISABLED|TIDAK\s*AKTIF|FALSE|^0$|^N$/i.test(statusRaw);
        if (isInactive) {
          continue; // Lewatkan item non-aktif!
        }
      }
    }
    
    var cleanName = cleanMaterialNameForMatching(rawName);
    var tokens = tokenizeWords(rawName);
    var compactName = cleanName.replace(/\s+/g, '');
    
    items.push({
      productName: rawName,
      cleanName: cleanName,
      tokens: tokens,
      compactName: compactName,
      productCode: colCode !== -1 ? String(row[colCode] || '').trim() : '',
      category: colCat !== -1 ? String(row[colCat] || '').trim() : '',
      unit: colUnit !== -1 ? String(row[colUnit] || '').trim() : '',
      rowIndex: i + 1
    });
  }
  
  return items;
}

/**
 * Mencari kolom Nama pada Sheet Form SO Outlet
 */
function findSoNameColumn(sheet) {
  var data = sheet.getDataRange().getValues();
  var maxScanRows = Math.min(data.length, 30);
  
  for (var r = 0; r < maxScanRows; r++) {
    var row = data[r];
    for (var c = 0; c < row.length; c++) {
      var val = String(row[c] || '').toUpperCase().trim();
      if (/^NAMA$|NAMA\s*BAHAN|NAMA\s*ITEM|PRODUCT\s*NAME|NAMA\s*BARANG|ITEM\s*NAME/.test(val)) {
        return {
          headerRow: r,
          nameCol: c
        };
      }
    }
  }
  
  // Fallback: cari kolom yang berisi teks produk di baris 0 atau 1
  return {
    headerRow: 0,
    nameCol: 1 // Biasanya kolom B (kolom kedua setelah nomor)
  };
}

/**
 * Menjalankan proses validasi dan MENULISKAN HASILNYA DI SEBELAH FORM SO
 */
function runValidateAndWriteToFormSo(params) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetSoName = params.sheetSo;
  var sheetEsbName = params.sheetEsb;
  
  var sheetSo = ss.getSheetByName(sheetSoName);
  var sheetEsb = ss.getSheetByName(sheetEsbName);
  
  if (!sheetSo) throw new Error('Sheet Form SO "' + sheetSoName + '" tidak ditemukan!');
  if (!sheetEsb) throw new Error('Sheet System ESB "' + sheetEsbName + '" tidak ditemukan!');
  
  // 1. Ambil data ESB yang aktif
  var activeEsbItems = getActiveEsbItemsFromSheet(sheetEsb);
  if (activeEsbItems.length === 0) {
    throw new Error('Tidak ditemukan bahan dengan status aktif pada Sheet System ESB "' + sheetEsbName + '"!');
  }
  
  // 2. Ambil data Form SO
  var soColInfo = findSoNameColumn(sheetSo);
  var soData = sheetSo.getDataRange().getValues();
  var headerRow = soColInfo.headerRow;
  var nameCol = soColInfo.nameCol;
  
  var totalRows = soData.length;
  if (totalRows <= headerRow + 1) {
    throw new Error('Sheet Form SO tidak memiliki baris data untuk dibandingkan.');
  }
  
  // Tentukan kolom penulisan hasil: di sebelah kanan data terakhir Form SO
  var lastCol = sheetSo.getLastColumn();
  
  // Periksa apakah kolom hasil validasi sebelumnya sudah ada agar bisa dioverwrite rapi
  var headerValues = sheetSo.getRange(headerRow + 1, 1, 1, lastCol).getValues()[0];
  var targetCol = -1;
  for (var c = 0; c < headerValues.length; c++) {
    var h = String(headerValues[c] || '').toUpperCase();
    if (h.indexOf('[ESB]') !== -1 || h.indexOf('REKOMENDASI NAMA ESB') !== -1) {
      targetCol = c + 1; // 1-indexed
      break;
    }
  }
  
  if (targetCol === -1) {
    targetCol = lastCol + 2; // Beri jarak 1 kolom kosong dari Form SO
  }
  
  // Siapkan header hasil validasi
  var resultHeaders = [
    '[ESB] REKOMENDASI NAMA RESMI',
    '[ESB] STATUS VALIDASI',
    '[ESB] KETERANGAN PEMBENARAN'
  ];
  
  var resultRows = [];
  var resultBg = [];
  var resultFont = [];
  
  var summary = {
    totalChecked: 0,
    exactMatch: 0,
    invertedMatch: 0,
    translationMatch: 0,
    typoMatch: 0,
    notFound: 0
  };
  
  for (var r = headerRow + 1; r < totalRows; r++) {
    var rawSoName = String(soData[r][nameCol] || '').trim();
    
    // Jika baris kosong, beri strip
    if (!rawSoName) {
      resultRows.push(['-', '-', '-']);
      resultBg.push(['#ffffff', '#ffffff', '#ffffff']);
      resultFont.push(['#555555', '#555555', '#555555']);
      continue;
    }
    
    summary.totalChecked++;
    var matchRes = findBestEsbMatch(rawSoName, activeEsbItems);
    
    var recName = '-';
    var statusText = '';
    var noteText = '';
    var bgCol = '#ffffff';
    var textCol = '#333333';
    
    if (matchRes.matchType === 'PERSIS') {
      recName = matchRes.matchItem.productName;
      statusText = 'SESUAI (PERSIS)';
      noteText = 'Nama bahan sudah sesuai dengan master ESB';
      bgCol = '#e6f4ea'; // Hijau muda
      textCol = '#137333';
      summary.exactMatch++;
    } else if (matchRes.matchType === 'KATA_TERBALIK') {
      recName = matchRes.matchItem.productName;
      statusText = 'SESUAI (KATA TERBALIK)';
      noteText = 'Urutan kata di Form SO terbalik → Disarankan: ' + recName;
      bgCol = '#e0f2f1'; // Teal lembut
      textCol = '#00695c';
      summary.invertedMatch++;
    } else if (matchRes.matchType === 'TERJEMAHAN') {
      recName = matchRes.matchItem.productName;
      statusText = 'SESUAI (TERJEMAHAN ID/EN)';
      noteText = 'Beda bahasa (Indonesia ⇄ Inggris) → Nama resmi: ' + recName;
      bgCol = '#e0f7fa'; // Cyan lembut
      textCol = '#00838f';
      summary.translationMatch++;
    } else if (matchRes.matchType === 'TYPO' || matchRes.matchType === 'KATA_MIRIP' || matchRes.matchType === 'MIRIP_SEBAGIAN') {
      recName = matchRes.matchItem.productName;
      statusText = 'KEMUNGKINAN TYPO / MIRIP (' + Math.round(matchRes.score * 100) + '%)';
      noteText = 'Mirip dengan: ' + recName + ' (' + matchRes.notes + ')';
      bgCol = '#fef7e0'; // Kuning lembut
      textCol = '#b06000';
      summary.typoMatch++;
    } else {
      recName = '-';
      statusText = 'TIDAK DITEMUKAN DI ESB';
      noteText = 'Bahan ini tidak ada di daftar Master ESB Aktif. Cek apakah non-aktif atau belum terdaftar.';
      bgCol = '#ffe8d6'; // Orange lembut
      textCol = '#c75b12';
      summary.notFound++;
    }
    
    resultRows.push([recName, statusText, noteText]);
    resultBg.push([bgCol, bgCol, '#ffffff']);
    resultFont.push([textCol, textCol, '#333333']);
  }
  
  // Tulis Header Hasil
  var headerRange = sheetSo.getRange(headerRow + 1, targetCol, 1, resultHeaders.length);
  headerRange.setValues([resultHeaders]);
  headerRange.setBackground('#2c3e50');
  headerRange.setFontColor('#ffffff');
  headerRange.setFontWeight('bold');
  headerRange.setHorizontalAlignment('center');
  
  // Tulis Baris Data Hasil
  if (resultRows.length > 0) {
    var dataRange = sheetSo.getRange(headerRow + 2, targetCol, resultRows.length, resultHeaders.length);
    dataRange.setValues(resultRows);
    dataRange.setBackgrounds(resultBg);
    dataRange.setFontColors(resultFont);
    dataRange.setBorder(true, true, true, true, true, true, '#d0d7de', SpreadsheetApp.BorderStyle.SOLID);
    
    // Format Alignment
    sheetSo.getRange(headerRow + 2, targetCol, resultRows.length, 1).setFontWeight('bold');
    sheetSo.getRange(headerRow + 2, targetCol + 1, resultRows.length, 1).setHorizontalAlignment('center').setFontWeight('bold');
    
    // Auto resize kolom hasil
    for (var k = 0; k < resultHeaders.length; k++) {
      sheetSo.autoResizeColumn(targetCol + k);
    }
  }
  
  sheetSo.activate();
  
  return {
    success: true,
    sheetName: sheetSoName,
    targetCol: targetCol,
    summary: summary,
    activeEsbCount: activeEsbItems.length
  };
}
