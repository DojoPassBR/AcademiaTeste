(function () {
  function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function daysBetween(from, to) {
    var start = startOfDay(from);
    var end = startOfDay(to || new Date());
    return Math.max(0, Math.floor((end.getTime() - start.getTime()) / 86400000));
  }

  function daysSince(value) {
    var date = toDate(value);
    return date ? daysBetween(date, new Date()) : null;
  }

  function ageFromBirthdate(birthdate) {
    if (typeof birthdate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return null;
    var parts = birthdate.split("-").map(Number);
    var birth = new Date(parts[0], parts[1] - 1, parts[2]);
    if (isNaN(birth.getTime())) return null;
    var today = new Date();
    var age = today.getFullYear() - birth.getFullYear();
    var hadBirthday = today.getMonth() > birth.getMonth()
      || (today.getMonth() === birth.getMonth() && today.getDate() >= birth.getDate());
    return hadBirthday ? age : age - 1;
  }

  function monthDayFromBirthdate(birthdate) {
    if (typeof birthdate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return "";
    return birthdate.slice(5, 10);
  }

  function isBirthdayInNextDays(birthdate, windowDays) {
    if (typeof birthdate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(birthdate)) return false;
    var days = typeof windowDays === "number" ? windowDays : 30;
    var parts = birthdate.split("-").map(Number);
    var today = startOfDay(new Date());
    var birthday = new Date(today.getFullYear(), parts[1] - 1, parts[2]);
    if (birthday < today) birthday.setFullYear(today.getFullYear() + 1);
    return daysBetween(today, birthday) <= days;
  }

  function valuePerCheckin(monthlyValue, checkinCount) {
    var value = Number(monthlyValue);
    var count = Number(checkinCount);
    if (!isFinite(value) || value <= 0 || !isFinite(count) || count <= 0) return null;
    return value / count;
  }

  function calculateStreak(checkins) {
    if (!Array.isArray(checkins) || checkins.length === 0) return 0;
    var days = {};
    checkins.forEach(function (item) {
      var date = toDate(item && item.timestamp ? item.timestamp : item);
      if (!date) return;
      days[startOfDay(date).toISOString().slice(0, 10)] = true;
    });
    var cursor = startOfDay(new Date());
    var streak = 0;
    while (days[cursor.toISOString().slice(0, 10)]) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    }
    return streak;
  }

  function buildRanking(entries) {
    return (Array.isArray(entries) ? entries : [])
      .slice()
      .sort(function (a, b) {
        var pontosA = Number(a.pontos || a.checkins || 0);
        var pontosB = Number(b.pontos || b.checkins || 0);
        if (pontosA !== pontosB) return pontosB - pontosA;
        return String(a.nome || a.nomePublico || "").localeCompare(String(b.nome || b.nomePublico || ""), "pt-BR");
      })
      .map(function (entry, index) {
        var copy = Object.assign({}, entry);
        copy.posicao = index + 1;
        return copy;
      });
  }

  function calcularProgressoGraduacao(aluno) {
    var dados = aluno && typeof aluno === "object" ? aluno : {};
    var grau = Number.isInteger(dados.grau) ? dados.grau : 0;
    var diasNoGrau = daysSince(dados.grauAtualizadoEm || dados.ultimaGraduacaoEm || dados.criadoEm);
    var alvoDias = 180;
    var percentualTempo = diasNoGrau === null ? 0 : Math.min(100, Math.round((diasNoGrau / alvoDias) * 100));
    return {
      faixa: dados.faixa || "Faixa",
      grau: Math.max(0, Math.min(4, grau)),
      diasNoGrau: diasNoGrau,
      percentualTempo: percentualTempo
    };
  }

  function valorPorCheckin(aluno, totalCheckins) {
    var dados = aluno && typeof aluno === "object" ? aluno : {};
    var valor = Number(dados.valorMensalidade || dados.valorMensalidadePadrao || dados.mensalidadeValor);
    return valuePerCheckin(valor, totalCheckins);
  }

  function montarRankingLocal(alunos, contagensPorAluno) {
    var contagens = contagensPorAluno && typeof contagensPorAluno === "object" ? contagensPorAluno : {};
    return buildRanking((Array.isArray(alunos) ? alunos : []).map(function (aluno) {
      var checkins = Number(contagens[aluno.id] || 0);
      var mensalidadePaga = (aluno.mensalidadeStatus || "pendente") === "pago";
      var pontos = checkins * 10 + (mensalidadePaga ? 15 : 0);
      return Object.assign({}, aluno, {
        checkins: checkins,
        pontos: pontos,
        nomePublico: aluno.nome || "Aluno"
      });
    }));
  }

  window.DojoPassMetrics = {
    ageFromBirthdate: ageFromBirthdate,
    buildRanking: buildRanking,
    calcularProgressoGraduacao: calcularProgressoGraduacao,
    calculateStreak: calculateStreak,
    daysSince: daysSince,
    isBirthdayInNextDays: isBirthdayInNextDays,
    monthDayFromBirthdate: monthDayFromBirthdate,
    montarRankingLocal: montarRankingLocal,
    valorPorCheckin: valorPorCheckin,
    valuePerCheckin: valuePerCheckin
  };
  window.DojoStudentMetrics = window.DojoPassMetrics;
})();
