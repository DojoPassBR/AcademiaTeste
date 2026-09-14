(function () {
  var STATUS_COMERCIAL = {
    ativo: { label: "Ativo", classe: "crm-status-active" },
    acompanhar: { label: "Acompanhar", classe: "crm-status-watch" },
    risco: { label: "Risco", classe: "crm-status-risk" },
    recuperacao: { label: "Recuperação", classe: "crm-status-recovery" },
    pausado: { label: "Pausado", classe: "crm-status-paused" },
    convertido: { label: "Convertido", classe: "crm-status-converted" }
  };

  var CANAIS = {
    whatsapp: "WhatsApp",
    telefone: "Telefone",
    presencial: "Presencial",
    email: "E-mail"
  };

  var STATUS_INTERACAO = {
    aberto: "Aberto",
    respondido: "Respondido",
    resolvido: "Resolvido",
    sem_resposta: "Sem resposta"
  };

  function toDate(value) {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    var date = new Date(value);
    return isNaN(date.getTime()) ? null : date;
  }

  function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  }

  function daysSince(value) {
    var date = toDate(value);
    if (!date) return null;
    var diff = startOfDay(new Date()).getTime() - startOfDay(date).getTime();
    return Math.max(0, Math.floor(diff / 86400000));
  }

  function normalizeText(value, maxLength) {
    var text = String(value || "").replace(/\s+/g, " ").trim();
    return text.slice(0, maxLength);
  }

  function normalizeTag(value) {
    return normalizeText(value, 24)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9 _-]/g, "")
      .toLowerCase();
  }

  function normalizeTags(value) {
    var source = Array.isArray(value) ? value : String(value || "").split(",");
    var seen = {};
    var tags = [];
    source.forEach(function (item) {
      var tag = normalizeTag(item);
      if (!tag || seen[tag] || tags.length >= 8) return;
      seen[tag] = true;
      tags.push(tag);
    });
    return tags;
  }

  function tagsToText(tags) {
    return normalizeTags(tags).join(", ");
  }

  function statusComercialInfo(status) {
    return STATUS_COMERCIAL[status] || STATUS_COMERCIAL.ativo;
  }

  function canalLabel(canal) {
    return CANAIS[canal] || CANAIS.whatsapp;
  }

  function statusInteracaoLabel(status) {
    return STATUS_INTERACAO[status] || STATUS_INTERACAO.aberto;
  }

  function firstName(aluno) {
    var nome = normalizeText(aluno && aluno.nome, 100);
    return nome ? nome.split(" ")[0] : "aluno";
  }

  function birthdayInNextDays(nascimento, windowDays) {
    if (typeof nascimento !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(nascimento)) return false;
    var parts = nascimento.split("-").map(Number);
    var today = startOfDay(new Date());
    var target = new Date(today.getFullYear(), parts[1] - 1, parts[2]);
    if (target < today) target.setFullYear(today.getFullYear() + 1);
    var diff = Math.floor((target.getTime() - today.getTime()) / 86400000);
    return diff >= 0 && diff <= (typeof windowDays === "number" ? windowDays : 30);
  }

  function graduationProgress(aluno) {
    if (window.DojoStudentMetrics && typeof window.DojoStudentMetrics.calcularProgressoGraduacao === "function") {
      return window.DojoStudentMetrics.calcularProgressoGraduacao(aluno);
    }
    return { percentualTempo: 0 };
  }

  function nearGraduation(aluno, metas) {
    var progresso = graduationProgress(aluno);
    if (progresso && Number(progresso.percentualTempo || 0) >= 75) return true;
    return (Array.isArray(metas) ? metas : []).some(function (meta) {
      if (!meta || meta.status === "concluida" || meta.status === "pausada") return false;
      var tipo = String(meta.tipo || "").toLowerCase();
      var titulo = String(meta.titulo || "").toLowerCase();
      var progressoMeta = Number(meta.progresso || 0);
      return (tipo === "graduacao" || titulo.indexOf("gradua") !== -1 || titulo.indexOf("faixa") !== -1)
        && progressoMeta >= 70;
    });
  }

  function classificarAluno(aluno, options) {
    var opts = options && typeof options === "object" ? options : {};
    var ultimoCheckin = opts.ultimoCheckin || null;
    var diasSemCheckin = daysSince(ultimoCheckin);
    var limiteSumido = Number(opts.limiteSumido);
    if (!isFinite(limiteSumido) || limiteSumido < 1) limiteSumido = 14;

    var totalCheckins = Number(opts.totalCheckins || 0);
    var sumido = diasSemCheckin === null ? totalCheckins === 0 : diasSemCheckin >= limiteSumido;
    var inadimplente = (aluno && aluno.mensalidadeStatus || "pendente") !== "pago";
    var aniversariante = birthdayInNextDays(aluno && aluno.nascimento, Number(opts.janelaAniversario || 30));
    var pertoGraduacao = nearGraduation(aluno, opts.metas);
    var motivos = [];

    if (sumido) motivos.push("sumido");
    if (inadimplente) motivos.push("inadimplente");
    if (aniversariante) motivos.push("aniversariante");
    if (pertoGraduacao) motivos.push("graduacao");

    return {
      aluno: aluno,
      diasSemCheckin: diasSemCheckin,
      sumido: sumido,
      inadimplente: inadimplente,
      aniversariante: aniversariante,
      pertoGraduacao: pertoGraduacao,
      motivos: motivos,
      prioridade: (sumido ? 4 : 0) + (inadimplente ? 3 : 0) + (pertoGraduacao ? 2 : 0) + (aniversariante ? 1 : 0)
    };
  }

  function filtrarAlunos(alunos, options) {
    var opts = options && typeof options === "object" ? options : {};
    var filtro = opts.filtro || "todos";
    var professorId = opts.professorId || "";
    var tag = normalizeTag(opts.tag || "");
    var status = opts.statusComercial || "";
    return (Array.isArray(alunos) ? alunos : [])
      .map(function (aluno) {
        var id = aluno && aluno.id;
        return classificarAluno(aluno, Object.assign({}, opts, {
          ultimoCheckin: opts.ultimosCheckins && id ? opts.ultimosCheckins[id] : null,
          totalCheckins: opts.contagens && id ? opts.contagens[id] : 0,
          metas: opts.metasPorAluno && id ? opts.metasPorAluno[id] : []
        }));
      })
      .filter(function (item) {
        var aluno = item.aluno || {};
        if (filtro === "sumidos" && !item.sumido) return false;
        if (filtro === "inadimplentes" && !item.inadimplente) return false;
        if (filtro === "aniversariantes" && !item.aniversariante) return false;
        if (filtro === "graduacao" && !item.pertoGraduacao) return false;
        if (professorId) {
          var professores = Array.isArray(aluno.professorIds) ? aluno.professorIds : (aluno.professorId ? [aluno.professorId] : []);
          if (professores.indexOf(professorId) === -1) return false;
        }
        if (tag && normalizeTags(aluno.tagsCrm).indexOf(tag) === -1) return false;
        if (status && (aluno.statusComercial || "ativo") !== status) return false;
        return true;
      })
      .sort(function (a, b) {
        if (a.prioridade !== b.prioridade) return b.prioridade - a.prioridade;
        return String(a.aluno && a.aluno.nome || "").localeCompare(String(b.aluno && b.aluno.nome || ""), "pt-BR");
      });
  }

  function resumoMotivos(info) {
    var nomes = {
      sumido: "sumido",
      inadimplente: "inadimplente",
      aniversariante: "aniversário",
      graduacao: "próximo da graduação"
    };
    return (info && info.motivos || []).map(function (motivo) {
      return nomes[motivo] || motivo;
    }).join(" · ");
  }

  function mensagemWhatsApp(aluno, motivo, contexto) {
    var ctx = contexto && typeof contexto === "object" ? contexto : {};
    var nome = firstName(aluno);
    var academia = normalizeText(ctx.academia, 80) || "academia";
    if (motivo === "inadimplente") {
      return "Oi, " + nome + "! Tudo bem? Passando para lembrar da mensalidade da " + academia + ". Posso te ajudar com isso?";
    }
    if (motivo === "aniversariante") {
      return "Oi, " + nome + "! A equipe da " + academia + " passou para te desejar parabéns. Que seu novo ciclo venha com muito treino e evolução!";
    }
    if (motivo === "graduacao") {
      return "Oi, " + nome + "! Seu professor percebeu uma boa evolução. Vamos manter a frequência para chegar forte na próxima graduação?";
    }
    if (motivo === "sumido") {
      return "Oi, " + nome + "! Sentimos sua falta no tatame. Queremos te ver de volta na " + academia + " esta semana. Posso te ajudar a encaixar um horário?";
    }
    return "Oi, " + nome + "! Tudo bem? Passando para acompanhar sua rotina na " + academia + ".";
  }

  window.DojoCrmTools = {
    canalLabel: canalLabel,
    classificarAluno: classificarAluno,
    daysSince: daysSince,
    filtrarAlunos: filtrarAlunos,
    mensagemWhatsApp: mensagemWhatsApp,
    normalizeTags: normalizeTags,
    normalizeText: normalizeText,
    resumoMotivos: resumoMotivos,
    statusComercialInfo: statusComercialInfo,
    statusInteracaoLabel: statusInteracaoLabel,
    tagsToText: tagsToText
  };
})();
