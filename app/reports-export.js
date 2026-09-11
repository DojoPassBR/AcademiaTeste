(function () {
  function sanitizeCell(value) {
    if (value === null || value === undefined) return "";
    var text = String(value).replace(/\r?\n/g, " ").trim();
    if (/^[=+\-@]/.test(text)) text = "'" + text;
    return text;
  }

  function csvEscape(value) {
    var text = sanitizeCell(value);
    if (/[",;\n]/.test(text)) return '"' + text.replace(/"/g, '""') + '"';
    return text;
  }

  function toCsv(rows, columns) {
    var header = columns.map(function (col) { return csvEscape(col.label); }).join(";");
    var body = (Array.isArray(rows) ? rows : []).map(function (row) {
      return columns.map(function (col) {
        var value = typeof col.value === "function" ? col.value(row) : row[col.key];
        return csvEscape(value);
      }).join(";");
    });
    return "\uFEFF" + [header].concat(body).join("\n");
  }

  function downloadCsv(filename, rows, columns) {
    var csv = toCsv(rows, columns);
    var blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var link = document.createElement("a");
    link.href = url;
    link.download = filename || "relatorio-dojopass.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  function baixarCsv(filename, headers, rows) {
    var columns = (Array.isArray(headers) ? headers : []).map(function (header) {
      return {
        label: header,
        value: function (row) {
          return row && Object.prototype.hasOwnProperty.call(row, header) ? row[header] : "";
        }
      };
    });
    downloadCsv(filename, rows, columns);
  }

  function formatMoney(value) {
    var number = Number(value);
    if (!isFinite(number)) return "";
    return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatDate(value) {
    if (!value) return "";
    var date = typeof value.toDate === "function" ? value.toDate() : new Date(value);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleDateString("pt-BR");
  }

  function dataCurtaCsv(value) {
    return formatDate(value);
  }

  function simNao(value) {
    return value ? "Sim" : "Não";
  }

  function formatNumber(value) {
    var number = Number(value || 0);
    if (!isFinite(number)) return "0";
    return String(number).replace(".", ",");
  }

  function professorNomes(aluno, professores) {
    var ids = Array.isArray(aluno.professorIds) ? aluno.professorIds.slice() : [];
    if (!ids.length && aluno.professorId) ids.push(aluno.professorId);
    return ids.map(function (id) { return professores[id] || id; }).filter(Boolean).join(", ");
  }

  function montarLinhasAlunosRelatorio(alunos, options) {
    var opts = options || {};
    var contagens = opts.contagens || {};
    var professores = opts.professores || {};
    var parceiros = opts.parceiros || {};
    return (Array.isArray(alunos) ? alunos : []).map(function (aluno) {
      var mensalidade = typeof aluno.mensalidade === "number" ? aluno.mensalidade : aluno.valorMensalidade;
      var checkins = contagens[aluno.id] || contagens[aluno.uid] || 0;
      return {
        "Aluno": aluno.nome || "",
        "E-mail": aluno.email || "",
        "Telefone": aluno.telefone || "",
        "Status": aluno.status || "",
        "Faixa": aluno.faixa || "",
        "Grau": aluno.grau || 0,
        "Professor(es)": professorNomes(aluno, professores),
        "Parceiro": aluno.parceiroId ? (parceiros[aluno.parceiroId] || aluno.parceiroId) : "",
        "Bolsista": simNao(aluno.bolsista || aluno.bolsa),
        "Kids": simNao(aluno.kids || aluno.tipoCadastro === "kids"),
        "Nascimento": dataCurtaCsv(aluno.dataNascimento || aluno.nascimento),
        "Mensalidade": formatMoney(mensalidade),
        "Check-ins": checkins,
        "Valor por check-in": checkins > 0 ? formatMoney(Number(mensalidade || 0) / checkins) : "",
        "Criado em": dataCurtaCsv(aluno.criadoEm || aluno.createdAt),
        "Dias sem check-in": formatNumber(aluno.diasSemCheckin)
      };
    });
  }

  window.DojoPassReports = {
    baixarCsv: baixarCsv,
    dataCurtaCsv: dataCurtaCsv,
    downloadCsv: downloadCsv,
    formatDate: formatDate,
    formatMoney: formatMoney,
    montarLinhasAlunosRelatorio: montarLinhasAlunosRelatorio,
    toCsv: toCsv
  };
  window.DojoReports = window.DojoPassReports;
})();
