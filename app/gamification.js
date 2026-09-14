(function () {
  var TIPOS_CONQUISTA = {
    frequencia: {
      label: "Frequência",
      classe: "achievement-type-frequency"
    },
    streak: {
      label: "Sequência",
      classe: "achievement-type-streak"
    },
    graduacao: {
      label: "Graduação",
      classe: "achievement-type-graduation"
    },
    manual: {
      label: "Manual",
      classe: "achievement-type-manual"
    },
    evento: {
      label: "Evento",
      classe: "achievement-type-event"
    },
    outro: {
      label: "Outro",
      classe: "achievement-type-other"
    }
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

  function normalizePoints(value) {
    var number = Number(value);
    if (!isFinite(number)) return 0;
    return Math.max(0, Math.min(10000, Math.round(number)));
  }

  function tipoInfo(tipo) {
    return TIPOS_CONQUISTA[tipo] || TIPOS_CONQUISTA.outro;
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

  function formatPoints(points) {
    var total = normalizePoints(points);
    return total + " " + (total === 1 ? "ponto" : "pontos");
  }

  function sortByTitle(items) {
    return (Array.isArray(items) ? items : []).slice().sort(function (a, b) {
      return String(a.titulo || "").localeCompare(String(b.titulo || ""), "pt-BR");
    });
  }

  function sortUnlockedFirst(items) {
    return (Array.isArray(items) ? items : []).slice().sort(function (a, b) {
      var dateA = toDate(a.desbloqueadoEm);
      var dateB = toDate(b.desbloqueadoEm);
      var timeA = dateA ? dateA.getTime() : 0;
      var timeB = dateB ? dateB.getTime() : 0;
      return timeB - timeA;
    });
  }

  function totalPoints(items) {
    return (Array.isArray(items) ? items : []).reduce(function (sum, item) {
      return sum + normalizePoints(item.pontos);
    }, 0);
  }

  function unlockedIds(items) {
    return (Array.isArray(items) ? items : []).reduce(function (map, item) {
      if (item && item.conquistaId) map[item.conquistaId] = true;
      return map;
    }, {});
  }

  function mapById(items) {
    return (Array.isArray(items) ? items : []).reduce(function (map, item) {
      if (item && item.id) map[item.id] = item;
      return map;
    }, {});
  }

  function activeChallenges(items) {
    return sortByTitle((Array.isArray(items) ? items : []).filter(function (item) {
      return item && item.ativo !== false;
    }));
  }

  function calculateStreak(checkins) {
    var days = {};
    (Array.isArray(checkins) ? checkins : []).forEach(function (item) {
      var date = toDate(item.timestamp || item.criadoEm || item.data);
      if (!date) return;
      days[date.toISOString().slice(0, 10)] = true;
    });

    var cursor = new Date();
    cursor.setHours(12, 0, 0, 0);
    var streak = 0;
    while (streak < 366) {
      var key = cursor.toISOString().slice(0, 10);
      if (!days[key]) break;
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function resumoDesafio(conquista) {
    var partes = [];
    var tipo = tipoInfo(conquista && conquista.tipo).label;
    if (tipo) partes.push(tipo);
    if (conquista && conquista.regra) partes.push(conquista.regra);
    if (conquista && typeof conquista.pontos === "number") partes.push(formatPoints(conquista.pontos));
    return partes.join(" · ");
  }

  window.DojoGamification = {
    activeChallenges: activeChallenges,
    calculateStreak: calculateStreak,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
    formatPoints: formatPoints,
    mapById: mapById,
    normalizeOptionalText: normalizeOptionalText,
    normalizePoints: normalizePoints,
    normalizeText: normalizeText,
    resumoDesafio: resumoDesafio,
    sortByTitle: sortByTitle,
    sortUnlockedFirst: sortUnlockedFirst,
    tipoInfo: tipoInfo,
    totalPoints: totalPoints,
    unlockedIds: unlockedIds
  };
})();
