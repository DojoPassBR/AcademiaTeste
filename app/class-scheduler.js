(function () {
  "use strict";

  const WEEKDAYS = [
    "Domingo",
    "Segunda-feira",
    "Terca-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sabado"
  ];

  const WEEKDAY_SHORT = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sab"];

  const STATUS = {
    solicitada: { label: "Solicitada", className: "badge-alerta" },
    confirmada: { label: "Confirmada", className: "badge-sucesso" },
    lista_espera: { label: "Lista de espera", className: "badge-info" },
    cancelada: { label: "Cancelada", className: "badge-neutro" },
    recusada: { label: "Recusada", className: "badge-neutro" }
  };

  const MODALIDADES = ["jiu-jitsu", "judo", "muay-thai", "boxe", "mma", "kids", "funcional", "outro"];

  function normalizeText(value, max) {
    const text = String(value || "").trim().replace(/\s+/g, " ");
    return text.slice(0, max || 120);
  }

  function normalizeOptionalText(value, max) {
    const text = normalizeText(value, max || 300);
    return text || "";
  }

  function normalizeModality(value) {
    const text = String(value || "").trim().toLowerCase();
    return MODALIDADES.indexOf(text) === -1 ? "jiu-jitsu" : text;
  }

  function modalityLabel(value) {
    const labels = {
      "jiu-jitsu": "Jiu-jitsu",
      judo: "Judô",
      "muay-thai": "Muay Thai",
      boxe: "Boxe",
      mma: "MMA",
      kids: "Kids",
      funcional: "Funcional",
      outro: "Outro"
    };
    return labels[normalizeModality(value)] || "Jiu-jitsu";
  }

  function normalizeTime(value) {
    const text = String(value || "").trim();
    return /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(text) ? text : "";
  }

  function isValidTimeRange(start, end) {
    const inicio = normalizeTime(start);
    const fim = normalizeTime(end);
    return Boolean(inicio && fim && inicio < fim);
  }

  function normalizeCapacity(value) {
    const number = Number(value);
    if (!Number.isInteger(number) || number < 1 || number > 500) return null;
    return number;
  }

  function normalizeDays(days) {
    const source = Array.isArray(days) ? days : [];
    const result = [];
    source.forEach((day) => {
      const number = Number(day);
      if (Number.isInteger(number) && number >= 0 && number <= 6 && result.indexOf(number) === -1) {
        result.push(number);
      }
    });
    return result.sort((a, b) => a - b);
  }

  function normalizeIds(ids, max) {
    const source = Array.isArray(ids) ? ids : [];
    const result = [];
    source.forEach((id) => {
      const value = String(id || "").trim();
      if (value && result.indexOf(value) === -1 && result.length < (max || 20)) result.push(value);
    });
    return result;
  }

  function dayLabels(days) {
    const normalized = normalizeDays(days);
    if (normalized.length === 0) return "Sem dias";
    return normalized.map((day) => WEEKDAY_SHORT[day]).join(", ");
  }

  function toDate(value) {
    if (!value) return null;
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
    if (typeof value.toDate === "function") {
      const date = value.toDate();
      return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function dateKey(value) {
    const date = toDate(value);
    if (!date) return "";
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return year + "-" + month + "-" + day;
  }

  function dateFromKey(key, time) {
    const parts = String(key || "").split("-");
    if (parts.length !== 3) return null;
    const hourMinute = normalizeTime(time || "00:00").split(":");
    const date = new Date(
      Number(parts[0]),
      Number(parts[1]) - 1,
      Number(parts[2]),
      Number(hourMinute[0] || 0),
      Number(hourMinute[1] || 0),
      0,
      0
    );
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(value) {
    const date = toDate(value);
    return date ? date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }) : "";
  }

  function formatTimeRange(turma) {
    const start = normalizeTime(turma && turma.horarioInicio);
    const end = normalizeTime(turma && turma.horarioFim);
    if (start && end) return start + " às " + end;
    return start || end || "Horario nao definido";
  }

  function nextOccurrences(turma, options) {
    const opts = options || {};
    const daysAhead = typeof opts.daysAhead === "number" ? opts.daysAhead : 21;
    const limit = typeof opts.limit === "number" ? opts.limit : 8;
    const today = opts.fromDate instanceof Date ? new Date(opts.fromDate) : new Date();
    today.setHours(0, 0, 0, 0);

    const days = normalizeDays(turma && turma.diasSemana);
    if (days.length === 0 || !isValidTimeRange(turma.horarioInicio, turma.horarioFim)) return [];

    const occurrences = [];
    for (let offset = 0; offset <= daysAhead && occurrences.length < limit; offset++) {
      const date = new Date(today);
      date.setDate(today.getDate() + offset);
      if (days.indexOf(date.getDay()) === -1) continue;
      const key = dateKey(date);
      const startsAt = dateFromKey(key, turma.horarioInicio);
      if (!startsAt || startsAt < new Date()) continue;
      occurrences.push({
        turmaId: turma.id,
        turma,
        key,
        startsAt,
        endsAt: dateFromKey(key, turma.horarioFim)
      });
    }
    return occurrences;
  }

  function reservationKey(turmaId, alunoId, dateValue) {
    const cleanTurma = String(turmaId || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
    const cleanAluno = String(alunoId || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 80);
    const key = dateKey(dateValue).replace(/-/g, "");
    return cleanTurma + "_" + cleanAluno + "_" + key;
  }

  function statusInfo(status) {
    return STATUS[status] || STATUS.solicitada;
  }

  function isActiveReservation(reserva) {
    return reserva && (reserva.status === "solicitada" || reserva.status === "confirmada" || reserva.status === "lista_espera");
  }

  function occupancy(reservas, turmaId, dateValue) {
    const key = dateKey(dateValue);
    const base = { solicitadas: 0, confirmadas: 0, listaEspera: 0, totalAtivas: 0 };
    (reservas || []).forEach((reserva) => {
      if (!reserva || reserva.turmaId !== turmaId || dateKey(reserva.dataAula) !== key) return;
      if (!isActiveReservation(reserva)) return;
      if (reserva.status === "confirmada") base.confirmadas += 1;
      else if (reserva.status === "lista_espera") base.listaEspera += 1;
      else base.solicitadas += 1;
      base.totalAtivas += 1;
    });
    return base;
  }

  function occupancyLabel(turma, reservas, dateValue) {
    const stats = occupancy(reservas, turma.id, dateValue);
    const capacity = normalizeCapacity(turma.capacidade);
    const used = stats.confirmadas + stats.solicitadas;
    if (!capacity) return used + " solicitacao(oes)";
    return used + "/" + capacity + " vagas";
  }

  function isFull(turma, reservas, dateValue) {
    const capacity = normalizeCapacity(turma.capacidade);
    if (!capacity) return false;
    const stats = occupancy(reservas, turma.id, dateValue);
    return stats.confirmadas >= capacity;
  }

  function sortTurmas(a, b) {
    const modality = normalizeModality(a.modalidade).localeCompare(normalizeModality(b.modalidade), "pt-BR");
    if (modality !== 0) return modality;
    const time = String(a.horarioInicio || "").localeCompare(String(b.horarioInicio || ""));
    if (time !== 0) return time;
    return String(a.nome || "").localeCompare(String(b.nome || ""), "pt-BR");
  }

  window.DojoClassScheduler = {
    WEEKDAYS,
    WEEKDAY_SHORT,
    MODALIDADES,
    dateFromKey,
    dateKey,
    dayLabels,
    formatDate,
    formatTimeRange,
    isFull,
    isValidTimeRange,
    modalityLabel,
    nextOccurrences,
    normalizeCapacity,
    normalizeDays,
    normalizeIds,
    normalizeModality,
    normalizeOptionalText,
    normalizeText,
    normalizeTime,
    occupancy,
    occupancyLabel,
    reservationKey,
    sortTurmas,
    statusInfo
  };
})();
