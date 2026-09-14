(function () {
  var STATUS_TECNICOS = {
    desenvolvimento: {
      label: "Em desenvolvimento",
      classe: "evolution-status-development"
    },
    apto: {
      label: "Apto",
      classe: "evolution-status-ready"
    },
    revisar: {
      label: "Revisar",
      classe: "evolution-status-review"
    }
  };

  var STATUS_METAS = {
    ativa: {
      label: "Ativa",
      classe: "evolution-status-development"
    },
    concluida: {
      label: "Concluída",
      classe: "evolution-status-ready"
    },
    pausada: {
      label: "Pausada",
      classe: "evolution-status-review"
    }
  };

  var TIPOS_META = {
    tecnica: "Técnica",
    frequencia: "Frequência",
    graduacao: "Graduação",
    outro: "Outro"
  };

  function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function normalizeText(value, maxLength) {
    var text = String(value || "").replace(/\s+/g, " ").trim();
    return text.slice(0, maxLength);
  }

  function normalizeOptionalText(value, maxLength) {
    var text = normalizeText(value, maxLength);
    return text || "";
  }

  function normalizeProgress(value) {
    var number = Number(value);
    if (!isFinite(number)) return 0;
    return Math.max(0, Math.min(100, Math.round(number)));
  }

  function statusTecnicoInfo(status) {
    return STATUS_TECNICOS[status] || STATUS_TECNICOS.desenvolvimento;
  }

  function statusMetaInfo(status) {
    return STATUS_METAS[status] || STATUS_METAS.ativa;
  }

  function tipoMetaLabel(tipo) {
    return TIPOS_META[tipo] || TIPOS_META.outro;
  }

  function formatDate(value) {
    var date = toDate(value);
    if (!date) return "";
    return date.toLocaleDateString("pt-BR");
  }

  function formatDateTime(value) {
    var date = toDate(value);
    if (!date) return "";
    return date.toLocaleString("pt-BR", {
      dateStyle: "short",
      timeStyle: "short"
    });
  }

  function daysUntil(value) {
    var date = toDate(value);
    if (!date) return null;
    var today = new Date();
    var start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var target = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    return Math.round((target.getTime() - start.getTime()) / 86400000);
  }

  function prazoResumo(value) {
    var date = toDate(value);
    if (!date) return "";
    var dias = daysUntil(date);
    var data = formatDate(date);
    if (dias === null) return data;
    if (dias < 0) return data + " · atrasada";
    if (dias === 0) return data + " · hoje";
    if (dias === 1) return data + " · amanhã";
    return data + " · em " + dias + " dias";
  }

  function sortRecentFirst(items) {
    return (Array.isArray(items) ? items : []).slice().sort(function (a, b) {
      var dateA = toDate(a.atualizadoEm || a.criadoEm);
      var dateB = toDate(b.atualizadoEm || b.criadoEm);
      var timeA = dateA ? dateA.getTime() : 0;
      var timeB = dateB ? dateB.getTime() : 0;
      return timeB - timeA;
    });
  }

  window.DojoStudentEvolution = {
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    normalizeOptionalText: normalizeOptionalText,
    normalizeProgress: normalizeProgress,
    normalizeText: normalizeText,
    prazoResumo: prazoResumo,
    sortRecentFirst: sortRecentFirst,
    statusMetaInfo: statusMetaInfo,
    statusTecnicoInfo: statusTecnicoInfo,
    tipoMetaLabel: tipoMetaLabel
  };
})();
