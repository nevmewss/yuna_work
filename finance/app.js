(function () {
  "use strict";

  var CFG = window.APP_CONFIG || {};
  var CARDS = CFG.CARDS || [];
  var PURPOSES = CFG.PURPOSES || { income: [], expense: [] };
  var CURRENCY = CFG.currency || "грн";
  var TITLE = CFG.title || "Мої платежі";
  var STORE_KEY = "fin.records.v1";
  var TYPE_LABEL = { income: "Дохід", expense: "Витрата" };
  var STEPS = ["type", "card", "purpose", "amount", "file"];

  var $ = function (id) { return document.getElementById(id); };

  // ------------------------------------------------------------------
  // Збереження записів (localStorage) і файлів (IndexedDB)
  // ------------------------------------------------------------------
  function loadRecords() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY)) || []; } catch (e) { return []; }
  }
  function saveRecords() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(records)); }
    catch (e) { toast("Не вдалося зберегти. Можливо, браузер у приватному режимі."); }
  }

  var dbPromise = null;
  function db() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error("no idb"));
      var req = indexedDB.open("fin-files", 1);
      req.onupgradeneeded = function () { req.result.createObjectStore("files"); };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error); };
    });
    return dbPromise;
  }
  function idb(mode, fn) {
    return db().then(function (d) {
      return new Promise(function (resolve, reject) {
        var tx = d.transaction("files", mode);
        var r = fn(tx.objectStore("files"));
        tx.oncomplete = function () { resolve(r && r.result); };
        tx.onerror = function () { reject(tx.error); };
      });
    });
  }
  var putFile = function (id, file) { return idb("readwrite", function (s) { return s.put({ name: file.name, blob: file }, id); }); };
  var getFile = function (id) { return idb("readonly", function (s) { return s.get(id); }); };
  var delFile = function (id) { return idb("readwrite", function (s) { return s.delete(id); }); };
  var clearFiles = function () { return idb("readwrite", function (s) { return s.clear(); }); };

  var records = loadRecords();

  // ------------------------------------------------------------------
  // Допоміжне
  // ------------------------------------------------------------------
  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function fmtDate(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    return p.length === 3 ? p[2] + "." + p[1] + "." + p[0] : iso;
  }
  function fmtMoney(n) {
    if (n === null || n === undefined || n === "") return "";
    return Number(n).toLocaleString("uk-UA", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  function fmtCard(v) {
    var s = String(v || "").trim();
    var digits = s.replace(/[\s-]/g, "");
    if (/^\d+$/.test(digits)) return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
    return s.toUpperCase(); // наприклад, IBAN
  }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function toast(msg) {
    var t = $("toast");
    t.textContent = msg; t.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { t.hidden = true; }, 3000);
  }
  function fileStamp() { return today(); }
  function totals() {
    var t = { income: 0, expense: 0 };
    records.forEach(function (r) { if (r.amount) t[r.type] += Number(r.amount); });
    return t;
  }

  // ------------------------------------------------------------------
  // Головний екран
  // ------------------------------------------------------------------
  function render() {
    document.title = TITLE;
    $("appTitle").textContent = TITLE;

    var list = $("list");
    if (!records.length) {
      list.innerHTML = '<div class="empty">Поки що немає жодного запису.</div>';
      $("totals").innerHTML = "";
      return;
    }

    var t = totals();
    $("totals").innerHTML =
      '<div class="total in"><small>Дохід разом</small>' + fmtMoney(t.income) + " " + esc(CURRENCY) + "</div>" +
      '<div class="total out"><small>Витрати разом</small>' + fmtMoney(t.expense) + " " + esc(CURRENCY) + "</div>";

    list.innerHTML = records.map(function (r, i) {
      var docHtml = r.fileName ? esc(r.fileName) + (r.hasFile ? " 📎" : "") : "—";
      return (
        '<article class="row ' + r.type + '">' +
          '<div class="row-head">' +
            '<span class="row-num">№ ' + (i + 1) + "</span>" +
            '<span class="badge ' + r.type + '">' + TYPE_LABEL[r.type] + "</span>" +
            (r.amount ? '<span class="row-amount">' + (r.type === "income" ? "+" : "−") + fmtMoney(r.amount) + " " + esc(CURRENCY) + "</span>" : "") +
          "</div>" +
          "<dl>" +
            "<dt>Дата</dt><dd>" + esc(fmtDate(r.date)) + "</dd>" +
            "<dt>Картка</dt><dd><span class=\"nowrap\">" + esc(r.cardNumber) + "</span>" + (r.cardName ? "<br>" + esc(r.cardName) : "") + "</dd>" +
            "<dt>Призначення</dt><dd>" + esc(r.purpose) + "</dd>" +
            "<dt>Документ</dt><dd>" + docHtml + "</dd>" +
          "</dl>" +
          '<div class="row-actions">' +
            (r.hasFile ? '<button data-act="file" data-id="' + r.id + '">⬇️ Файл</button>' : "") +
            '<button data-act="edit" data-id="' + r.id + '">✏️ Змінити</button>' +
            '<button class="del" data-act="del" data-id="' + r.id + '">🗑 Видалити</button>' +
          "</div>" +
        "</article>"
      );
    }).join("");
  }

  $("list").addEventListener("click", function (e) {
    var b = e.target.closest("button[data-act]");
    if (!b) return;
    var id = b.dataset.id;
    var idx = records.findIndex(function (r) { return r.id === id; });
    if (idx < 0) return;
    var act = b.dataset.act;
    if (act === "edit") openWizard(records[idx]);
    if (act === "del") {
      if (!confirm("Видалити запис № " + (idx + 1) + "?")) return;
      if (records[idx].hasFile) delFile(id).catch(function () {});
      records.splice(idx, 1);
      saveRecords(); render(); toast("Запис видалено");
    }
    if (act === "file") downloadAttachment(id);
  });

  function downloadAttachment(id) {
    getFile(id).then(function (f) {
      if (!f) return toast("Файл не знайдено на цьому пристрої");
      var url = URL.createObjectURL(f.blob);
      var a = document.createElement("a");
      a.href = url; a.download = f.name || "файл";
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    }).catch(function () { toast("Не вдалося відкрити файл"); });
  }

  // ------------------------------------------------------------------
  // Майстер додавання / редагування
  // ------------------------------------------------------------------
  var draft = null;     // запис, що редагується
  var pendingFile = null; // новий файл (ще не збережений)
  var removeFile = false;
  var history = [];

  function openWizard(existing) {
    draft = existing ? Object.assign({}, existing) : { id: null, type: null, cardNumber: "", cardName: "", purpose: "", amount: null, date: today(), fileName: "", hasFile: false };
    pendingFile = null; removeFile = false; history = [];
    $("wizard").hidden = false;
    document.body.style.overflow = "hidden";
    goTo("type", true);
  }
  function closeWizard() {
    $("wizard").hidden = true;
    document.body.style.overflow = "";
    draft = null;
  }

  function goTo(step, reset) {
    if (!reset) history.push(currentStep);
    currentStep = step;
    document.querySelectorAll(".step").forEach(function (s) { s.classList.toggle("active", s.dataset.step === step); });
    $("btnBack").disabled = history.length === 0;
    $("stepCount").textContent = "Крок " + (STEPS.indexOf(step) + 1) + " з " + STEPS.length;
    prepare[step]();
    $("wizard").scrollTop = 0;
  }
  var currentStep = "type";

  var prepare = {
    type: function () {
      document.querySelectorAll("[data-type]").forEach(function (b) {
        b.style.outline = draft.type === b.dataset.type ? "4px solid #111" : "";
      });
    },
    card: function () {
      $("cardTitle").textContent = draft.type === "income" ? "На яку картку прийшли гроші? / Від кого?" : "На яку картку відправили гроші? / Кому?";
      var box = $("cardChoices");
      box.innerHTML = CARDS.map(function (c, i) {
        var num = fmtCard(c.number);
        var sel = draft.cardNumber === num ? " selected" : "";
        return '<button class="choice' + sel + '" data-card="' + i + '"><b>' + esc(c.name) + "</b><span>" + esc(num) + "</span></button>";
      }).join("");
      var known = CARDS.some(function (c) { return fmtCard(c.number) === draft.cardNumber; });
      $("cardInput").value = known ? "" : draft.cardNumber;
      $("cardNameInput").value = known ? "" : draft.cardName;
    },
    purpose: function () {
      var opts = PURPOSES[draft.type] || [];
      $("purposeTitle").textContent = draft.type === "income" ? "За що прийшли гроші?" : "За що заплатили?";
      $("purposeChoices").innerHTML = opts.map(function (p, i) {
        return '<button class="choice' + (draft.purpose === p ? " selected" : "") + '" data-purpose="' + i + '"><b>' + esc(p) + "</b></button>";
      }).join("");
      $("purposeInput").value = opts.indexOf(draft.purpose) >= 0 ? "" : draft.purpose;
    },
    amount: function () {
      $("currency").textContent = CURRENCY;
      $("amountInput").value = draft.amount != null ? String(draft.amount).replace(".", ",") : "";
      $("dateInput").value = draft.date || today();
    },
    file: function () {
      $("fileNameInput").value = draft.hasFile ? "" : draft.fileName;
      showChosenFile();
    },
  };

  function showChosenFile() {
    var box = $("fileChosen");
    var name = pendingFile ? pendingFile.name : (draft.hasFile && !removeFile ? draft.fileName : "");
    if (!name) { box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = "<span>📎 " + esc(name) + '</span><button type="button" id="fileRemove">✕ Прибрати</button>';
    $("fileRemove").onclick = function () {
      if (pendingFile) pendingFile = null; else removeFile = true;
      $("fileInput").value = "";
      showChosenFile();
    };
  }

  $("btnAdd").onclick = function () { openWizard(null); };
  $("btnCancel").onclick = function () {
    if (confirm("Закрити без збереження?")) closeWizard();
  };
  $("btnBack").onclick = function () {
    if (!history.length) return;
    var prev = history.pop();
    currentStep = prev;
    document.querySelectorAll(".step").forEach(function (s) { s.classList.toggle("active", s.dataset.step === prev); });
    $("btnBack").disabled = history.length === 0;
    $("stepCount").textContent = "Крок " + (STEPS.indexOf(prev) + 1) + " з " + STEPS.length;
    prepare[prev]();
  };

  // Крок 1
  document.querySelectorAll("[data-type]").forEach(function (b) {
    b.onclick = function () {
      draft.type = b.dataset.type;
      goTo("card");
    };
  });

  // Крок 2
  $("cardChoices").addEventListener("click", function (e) {
    var b = e.target.closest("[data-card]");
    if (!b) return;
    var c = CARDS[Number(b.dataset.card)];
    draft.cardNumber = fmtCard(c.number);
    draft.cardName = c.name;
    goTo("purpose");
  });
  $("cardInput").addEventListener("input", function (e) {
    var v = e.target.value;
    if (/^[\d\s-]*$/.test(v)) {
      var pos = v.replace(/\D/g, "").length;
      e.target.value = fmtCard(v.replace(/\D/g, "").slice(0, 19));
      if (pos === 0) e.target.value = "";
    }
  });
  $("cardNext").onclick = function () {
    var v = $("cardInput").value.trim();
    if (!v) {
      if (draft.cardNumber) return goTo("purpose");
      toast("Виберіть картку зі списку або введіть номер");
      return $("cardInput").focus();
    }
    var digits = v.replace(/\D/g, "");
    if (/^[\d\s-]+$/.test(v) && digits.length < 4) {
      toast("Номер картки занадто короткий");
      return $("cardInput").focus();
    }
    draft.cardNumber = fmtCard(v);
    draft.cardName = $("cardNameInput").value.trim();
    goTo("purpose");
  };

  // Крок 3
  $("purposeChoices").addEventListener("click", function (e) {
    var b = e.target.closest("[data-purpose]");
    if (!b) return;
    draft.purpose = PURPOSES[draft.type][Number(b.dataset.purpose)];
    goTo("amount");
  });
  $("purposeNext").onclick = function () {
    var v = $("purposeInput").value.trim();
    if (v) draft.purpose = v;
    if (!draft.purpose) { toast("Виберіть призначення або напишіть своє"); return $("purposeInput").focus(); }
    goTo("amount");
  };

  // Крок 4
  $("amountNext").onclick = function () {
    var raw = $("amountInput").value.replace(/\s/g, "").replace(",", ".");
    if (raw && !/^\d+(\.\d{1,2})?$/.test(raw)) { toast("Сума має бути числом, наприклад 1500 або 99,50"); return $("amountInput").focus(); }
    draft.amount = raw ? Number(raw) : null;
    draft.date = $("dateInput").value || today();
    goTo("file");
  };

  // Крок 5
  $("fileInput").onchange = function (e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;
    pendingFile = f;
    showChosenFile();
  };
  $("btnSave").onclick = function () {
    var typedName = $("fileNameInput").value.trim();
    var isNew = !draft.id;
    if (isNew) draft.id = uid();
    var id = draft.id;
    var job = Promise.resolve();

    if (pendingFile) {
      // новий файл; якщо людина ще й написала назву — показуємо її
      draft.fileName = typedName || pendingFile.name;
      draft.hasFile = true;
      job = putFile(id, pendingFile).catch(function () {
        draft.hasFile = false;
        toast("Файл не вдалося зберегти, збережено лише назву");
      });
    } else if (draft.hasFile && !removeFile) {
      if (typedName) draft.fileName = typedName; // старий файл лишається
    } else {
      if (draft.hasFile) delFile(id).catch(function () {});
      draft.hasFile = false;
      draft.fileName = typedName;
    }

    var rec = draft;
    job.then(function () {
      var idx = records.findIndex(function (r) { return r.id === id; });
      if (idx >= 0) records[idx] = rec; else records.push(rec);
      saveRecords(); render(); closeWizard();
      toast(isNew ? "✅ Запис додано" : "✅ Зміни збережено");
    });
  };

  // ------------------------------------------------------------------
  // Експорт: Excel
  // ------------------------------------------------------------------
  var HEAD = ["№", "Дата", "Тип", "Номер картки", "Ім'я", "Призначення платежу", "Сума, " + CURRENCY, "Документ"];

  function rowsForExport() {
    return records.map(function (r, i) {
      return [i + 1, fmtDate(r.date), TYPE_LABEL[r.type], r.cardNumber, r.cardName || "", r.purpose, r.amount != null ? Number(r.amount) : "", r.fileName || ""];
    });
  }

  $("btnExcel").onclick = function () {
    if (!records.length) return toast("Таблиця порожня — спочатку додайте запис");
    if (!window.XLSX) return toast("Зачекайте секунду і спробуйте ще раз");
    var t = totals();
    var aoa = [[TITLE], ["Сформовано: " + fmtDate(today())], [], HEAD]
      .concat(rowsForExport())
      .concat([[], ["", "", "", "", "", "Дохід разом", t.income], ["", "", "", "", "", "Витрати разом", t.expense], ["", "", "", "", "", "Різниця", t.income - t.expense]]);
    var ws = XLSX.utils.aoa_to_sheet(aoa);
    ws["!cols"] = [{ wch: 5 }, { wch: 12 }, { wch: 10 }, { wch: 22 }, { wch: 22 }, { wch: 40 }, { wch: 14 }, { wch: 30 }];
    // номер картки — як текст, суми — з двома знаками
    Object.keys(ws).forEach(function (k) {
      if (k[0] === "!") return;
      var cell = ws[k];
      if (k[0] === "D" && cell.t === "n") { cell.t = "s"; cell.v = String(cell.v); }
      if (k[0] === "G" && cell.t === "n") cell.z = "#,##0.00";
    });
    var wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Платежі");
    XLSX.writeFile(wb, "platezhi_" + fileStamp() + ".xlsx");
    toast("📊 Excel-файл завантажено");
  };

  // ------------------------------------------------------------------
  // Експорт: PDF
  // ------------------------------------------------------------------
  $("btnPdf").onclick = function () {
    if (!records.length) return toast("Таблиця порожня — спочатку додайте запис");
    if (!window.pdfMake) return toast("Зачекайте секунду і спробуйте ще раз");
    var t = totals();
    var body = [HEAD.map(function (h) { return { text: h, style: "th" }; })].concat(
      records.map(function (r, i) {
        return [
          String(i + 1), fmtDate(r.date),
          { text: TYPE_LABEL[r.type], color: r.type === "income" ? "#1a7f37" : "#c62828", bold: true },
          r.cardNumber, r.cardName || "", r.purpose,
          { text: fmtMoney(r.amount), alignment: "right" }, r.fileName || "",
        ];
      })
    );
    var doc = {
      pageSize: "A4", pageOrientation: "landscape", pageMargins: [28, 28, 28, 36],
      defaultStyle: { font: "Roboto", fontSize: 9 },
      footer: function (cur, all) { return { text: cur + " / " + all, alignment: "center", fontSize: 8, color: "#666" }; },
      content: [
        { text: TITLE, fontSize: 16, bold: true },
        { text: "Сформовано: " + fmtDate(today()), color: "#666", margin: [0, 2, 0, 10] },
        {
          table: { headerRows: 1, widths: [18, 52, 46, 92, 90, "*", 60, 100], body: body },
          layout: {
            fillColor: function (row) { return row === 0 ? "#eeeeee" : null; },
            hLineColor: "#bbbbbb", vLineColor: "#bbbbbb",
          },
        },
        {
          margin: [0, 12, 0, 0],
          table: {
            widths: ["auto", "auto"],
            body: [
              ["Дохід разом", { text: fmtMoney(t.income) + " " + CURRENCY, alignment: "right", color: "#1a7f37", bold: true }],
              ["Витрати разом", { text: fmtMoney(t.expense) + " " + CURRENCY, alignment: "right", color: "#c62828", bold: true }],
              ["Різниця", { text: fmtMoney(t.income - t.expense) + " " + CURRENCY, alignment: "right", bold: true }],
            ],
          },
          layout: "lightHorizontalLines",
        },
      ],
      styles: { th: { bold: true } },
    };
    pdfMake.createPdf(doc).download("platezhi_" + fileStamp() + ".pdf");
    toast("📄 PDF-файл завантажено");
  };

  // ------------------------------------------------------------------
  // Нова таблиця
  // ------------------------------------------------------------------
  $("btnClear").onclick = function () {
    if (!records.length) return toast("Таблиця і так порожня");
    if (!confirm("Видалити ВСІ записи і почати нову таблицю?\n\nПорада: спочатку збережіть Excel або PDF.")) return;
    records = []; saveRecords(); clearFiles().catch(function () {}); render();
    toast("Нова таблиця");
  };

  render();
})();
