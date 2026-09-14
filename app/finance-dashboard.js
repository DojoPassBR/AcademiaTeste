(function () {
  function money(value) {
    var number = Number(value);
    if (!isFinite(number)) number = 0;
    return number.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function studentMonthlyValue(aluno, defaultValue) {
    if (aluno && aluno.bolsa === true) return 0;
    var ownValue = Number(aluno && aluno.valorMensalidade);
    if (isFinite(ownValue) && ownValue > 0) return ownValue;
    var base = Number(defaultValue);
    return isFinite(base) && base > 0 ? base : 0;
  }

  function partnerDiscount(aluno, partnersById) {
    if (!aluno || !aluno.parceiroId || !partnersById) return 0;
    var partner = partnersById[aluno.parceiroId];
    var percent = Number(partner && partner.percentual);
    return isFinite(percent) && percent > 0 ? Math.min(percent, 100) : 0;
  }

  function effectiveMonthlyValue(aluno, options) {
    var opts = options || {};
    var base = studentMonthlyValue(aluno, opts.defaultValue);
    var discount = partnerDiscount(aluno, opts.partnersById);
    return Math.max(0, base * (1 - discount / 100));
  }

  function summarize(alunos, options) {
    var opts = options || {};
    var contagens = opts.checkinsByStudent || {};
    var totals = {
      alunos: 0,
      bolsistas: 0,
      comParceiro: 0,
      previsto: 0,
      recebido: 0,
      pendente: 0,
      checkins: 0,
      ticketMedio: 0,
      valorPorCheckin: 0,
      alunosPendentes: []
    };

    (Array.isArray(alunos) ? alunos : []).forEach(function (aluno) {
      totals.alunos += 1;
      var valor = effectiveMonthlyValue(aluno, opts);
      var statusPago = (aluno.mensalidadeStatus || "pendente") === "pago";
      var checkins = Number(contagens[aluno.id] || aluno.checkins || 0);
      totals.previsto += valor;
      totals.checkins += isFinite(checkins) ? checkins : 0;
      if (aluno.bolsa === true) totals.bolsistas += 1;
      if (aluno.parceiroId) totals.comParceiro += 1;
      if (statusPago) {
        totals.recebido += valor;
      } else {
        totals.pendente += valor;
        totals.alunosPendentes.push({
          id: aluno.id,
          nome: aluno.nome || "Aluno",
          telefone: aluno.telefone || "",
          valor: valor,
          checkins: checkins
        });
      }
    });

    totals.ticketMedio = totals.alunos ? totals.previsto / totals.alunos : 0;
    totals.valorPorCheckin = totals.checkins ? totals.recebido / totals.checkins : 0;
    totals.alunosPendentes.sort(function (a, b) {
      if (b.valor !== a.valor) return b.valor - a.valor;
      return a.nome.localeCompare(b.nome, "pt-BR");
    });
    return totals;
  }

  function buildStudentRows(alunos, options) {
    var opts = options || {};
    var contagens = opts.checkinsByStudent || {};
    var partnersById = opts.partnersById || {};
    return (Array.isArray(alunos) ? alunos : []).map(function (aluno) {
      var bruto = studentMonthlyValue(aluno, opts.defaultValue);
      var desconto = partnerDiscount(aluno, partnersById);
      var efetivo = effectiveMonthlyValue(aluno, opts);
      var checkins = Number(contagens[aluno.id] || 0);
      var valorPorCheckin = checkins > 0 ? efetivo / checkins : null;
      return {
        aluno: aluno.nome || "",
        status: aluno.mensalidadeStatus || "pendente",
        bolsista: aluno.bolsa === true,
        parceiro: aluno.parceiroId ? ((partnersById[aluno.parceiroId] && partnersById[aluno.parceiroId].nome) || aluno.parceiroId) : "",
        valorBruto: bruto,
        descontoParceiro: desconto,
        valorEfetivo: efetivo,
        checkins: checkins,
        valorPorCheckin: valorPorCheckin
      };
    });
  }

  window.DojoFinanceDashboard = {
    buildStudentRows: buildStudentRows,
    effectiveMonthlyValue: effectiveMonthlyValue,
    money: money,
    summarize: summarize
  };
})();
