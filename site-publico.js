// ============================================================
// site-publico.js — hidrata o site institucional (index.html) com os dados que o
// professor cadastra no admin, lendo as quatro coleções públicas do Firestore:
// turmas, equipe, horarios e academia/perfil (todas com `allow read: if true`).
//
// PRINCÍPIO DESTE ARQUIVO: o HTML estático de index.html é a verdade que já está na
// tela. Este script só SUBSTITUI um bloco quando os dados daquele bloco chegaram com
// sucesso. Se o Firestore falhar, demorar, estiver bloqueado por um ad-blocker ou o
// visitante estiver offline, nada é apagado — o visitante continua vendo a grade, a
// equipe e o endereço estáticos. Nunca existe estado "Carregando..." na tela.
//
// SEGURANÇA: toda renderização usa document.createElement + textContent. Nenhum dado
// vindo do Firestore passa por innerHTML em lugar nenhum, e todo link externo passa
// por linkHttpsValido() antes de virar href — as Firestore Rules já validam o formato
// dos links, mas defesa em profundidade é barata aqui.
//
// Uma leitura por coleção, uma vez, no carregamento. Sem onSnapshot, sem listener
// persistente: é uma página institucional, não um painel ao vivo.
// ============================================================

(function () {
  "use strict";

  var TIMEOUT_MS = 6000;

  var DIAS_SEMANA = [
    "Domingo",
    "Segunda-feira",
    "Terça-feira",
    "Quarta-feira",
    "Quinta-feira",
    "Sexta-feira",
    "Sábado"
  ];

  // Só estas cores têm classe .tag no style.css. 'white' (e qualquer valor inesperado)
  // cai no texto normal, sem classe — nunca inventa uma classe CSS que não existe.
  var CORES_COM_TAG = { red: true, yellow: true, pink: true };

  // Ordem de exibição dos links de rede social, e o rótulo humano de cada um.
  var REDES = [
    { chave: "instagram", rotulo: "Instagram" },
    { chave: "facebook", rotulo: "Facebook" },
    { chave: "youtube", rotulo: "YouTube" },
    { chave: "tiktok", rotulo: "TikTok" },
    { chave: "whatsapp", rotulo: "WhatsApp" },
    { chave: "site", rotulo: "Site" }
  ];

  // ---------- helpers genéricos ----------

  function el(tag, classe, texto) {
    var node = document.createElement(tag);
    if (classe) node.className = classe;
    if (texto !== undefined && texto !== null && texto !== "") node.textContent = String(texto);
    return node;
  }

  // Esvazia um container removendo os filhos um a um. Nada de innerHTML.
  function limpar(node) {
    while (node.firstChild) {
      node.removeChild(node.firstChild);
    }
  }

  function textoNaoVazio(valor) {
    return typeof valor === "string" && valor.trim().length > 0 ? valor.trim() : null;
  }

  // Só aceita URL absoluta https:// e que o parser do browser consiga entender.
  // Devolve a URL normalizada ou null. Bloqueia javascript:, data:, http:// e lixo.
  function linkHttpsValido(url) {
    if (typeof url !== "string") return null;
    var bruto = url.trim();
    if (bruto.length === 0 || bruto.length > 500) return null;
    try {
      var parsed = new URL(bruto);
      if (parsed.protocol !== "https:") return null;
      if (!parsed.hostname || parsed.hostname.indexOf(".") === -1) return null;
      return parsed.href;
    } catch (erro) {
      return null;
    }
  }

  // Promise que rejeita depois de ms milissegundos, pra usar em Promise.race.
  function comTimeout(promise, ms, rotulo) {
    var estouro = new Promise(function (_resolve, reject) {
      setTimeout(function () {
        reject(new Error("timeout ao carregar " + rotulo));
      }, ms);
    });
    return Promise.race([promise, estouro]);
  }

  // Cada consulta é isolada: se falhar (rules, rede, timeout, índice faltando),
  // devolve null e quem chama simplesmente não mexe naquele pedaço da página.
  function consultaSegura(fabricaPromise, rotulo) {
    var promise;
    try {
      promise = fabricaPromise();
    } catch (erro) {
      console.warn("[site] " + rotulo + ": consulta não pôde ser montada.", erro);
      return Promise.resolve(null);
    }
    return comTimeout(promise, TIMEOUT_MS, rotulo).catch(function (erro) {
      console.warn("[site] " + rotulo + ": mantendo conteúdo estático.", erro);
      return null;
    });
  }

  function docsParaLista(snapshot) {
    if (!snapshot || !snapshot.docs) return [];
    return snapshot.docs.map(function (doc) {
      var dados = doc.data() || {};
      dados.id = doc.id;
      return dados;
    });
  }

  function faixaHorario(horario) {
    var inicio = textoNaoVazio(horario.horaInicio);
    var fim = textoNaoVazio(horario.horaFim);
    if (inicio && fim) return inicio + " às " + fim;
    return inicio || fim || "";
  }

  // ---------- grade de horários ----------

  // Agrupa os horários por dia da semana (0 = Domingo ... 6 = Sábado), já resolvendo
  // o JOIN em memória com turmas e equipe. Devolve só os dias que têm aula.
  function agruparPorDia(horarios, turmasPorId, equipePorId) {
    var grupos = [];
    for (var dia = 0; dia <= 6; dia++) {
      grupos.push({ dia: dia, nome: DIAS_SEMANA[dia], linhas: [] });
    }

    horarios.forEach(function (horario) {
      var dia = horario.diaSemana;
      if (typeof dia !== "number" || dia < 0 || dia > 6) return;

      var turma = turmasPorId[horario.turmaId] || null;
      var professor = horario.professorId ? equipePorId[horario.professorId] || null : null;

      var nomeTurma = turma ? textoNaoVazio(turma.nome) : null;
      if (!nomeTurma) return; // horário órfão (turma inativa ou apagada): não exibe

      var detalhes = [];
      if (professor && textoNaoVazio(professor.nome)) detalhes.push("Prof. " + textoNaoVazio(professor.nome));
      var observacao = textoNaoVazio(horario.observacao);
      if (observacao) detalhes.push(observacao);

      grupos[dia].linhas.push({
        faixa: faixaHorario(horario),
        turma: nomeTurma,
        // nivel/descricao vêm do cadastro da turma no painel do admin.
        nivel: turma ? textoNaoVazio(turma.nivel) : null,
        descricao: turma ? textoNaoVazio(turma.descricao) : null,
        cor: turma && CORES_COM_TAG[turma.cor] ? turma.cor : null,
        detalhe: detalhes.length > 0 ? detalhes.join(" · ") : null
      });
    });

    return grupos.filter(function (grupo) {
      return grupo.linhas.length > 0;
    });
  }

  // Escreve o nome da turma na cor certa + detalhe opcional (professor, observação)
  // dentro do elemento pai recebido (uma <td> na tabela, um <span> na versão mobile).
  function preencherTurma(destino, linha) {
    var nome = el("span", linha.cor ? "tag " + linha.cor : null, linha.turma);
    destino.appendChild(nome);
    // Nível como subtítulo curto ao lado do nome ("Kids — Infantil"); descrição abaixo.
    if (linha.nivel) {
      destino.appendChild(el("span", "grade-detalhe", "— " + linha.nivel));
    }
    if (linha.descricao) {
      destino.appendChild(el("span", "grade-detalhe", linha.descricao));
    }
    if (linha.detalhe) {
      destino.appendChild(el("span", "grade-detalhe", linha.detalhe));
    }
  }

  function renderizarTabela(grupos) {
    var corpo = document.getElementById("grade-tabela-corpo");
    if (!corpo) return;

    var fragmento = document.createDocumentFragment();

    grupos.forEach(function (grupo) {
      grupo.linhas.forEach(function (linha, indice) {
        var tr = document.createElement("tr");

        if (indice === 0) {
          var tdDia = el("td", null, grupo.nome);
          if (grupo.linhas.length > 1) tdDia.rowSpan = grupo.linhas.length;
          tr.appendChild(tdDia);
        }

        tr.appendChild(el("td", null, linha.faixa));

        var tdTurma = document.createElement("td");
        preencherTurma(tdTurma, linha);
        tr.appendChild(tdTurma);

        fragmento.appendChild(tr);
      });
    });

    limpar(corpo);
    corpo.appendChild(fragmento);
  }

  function renderizarGradeMobile(grupos) {
    var container = document.getElementById("grade-mobile");
    if (!container) return;

    var fragmento = document.createDocumentFragment();

    grupos.forEach(function (grupo) {
      var bloco = el("div", "day-group");
      bloco.appendChild(el("h3", "day-title", grupo.nome));

      grupo.linhas.forEach(function (linha) {
        var row = el("div", "time-row");
        row.appendChild(el("span", "time", linha.faixa));
        var direita = el("span", "time-turma");
        preencherTurma(direita, linha);
        row.appendChild(direita);
        bloco.appendChild(row);
      });

      fragmento.appendChild(bloco);
    });

    limpar(container);
    container.appendChild(fragmento);
  }

  // ---------- equipe ----------

  function montarLinksRedes(redes, nomeDono) {
    if (!redes || typeof redes !== "object") return null;

    var caixa = el("div", "staff-redes");
    var algum = false;

    REDES.forEach(function (rede) {
      var href = linkHttpsValido(redes[rede.chave]);
      if (!href) return;
      var link = el("a", null, rede.rotulo);
      link.href = href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.setAttribute("aria-label", rede.rotulo + (nomeDono ? " de " + nomeDono : ""));
      caixa.appendChild(link);
      algum = true;
    });

    return algum ? caixa : null;
  }

  function renderizarEquipe(equipe) {
    var container = document.getElementById("lista-equipe");
    if (!container) return;

    var visiveis = equipe.filter(function (membro) {
      return textoNaoVazio(membro.nome);
    });
    if (visiveis.length === 0) return; // sem dados úteis: mantém os cards estáticos

    var fragmento = document.createDocumentFragment();

    visiveis.forEach(function (membro) {
      var nome = textoNaoVazio(membro.nome);
      var card = el("div", "staff-card");

      card.appendChild(el("span", "staff-label", membro.tipo === "instrutor" ? "Instrutor" : "Professor"));
      card.appendChild(el("span", "staff-name", nome));

      var faixa = textoNaoVazio(membro.faixa);
      if (faixa) card.appendChild(el("span", "staff-faixa", "Faixa " + faixa));

      var bio = textoNaoVazio(membro.bio);
      if (bio) card.appendChild(el("p", "staff-bio", bio));

      // Telefone é opcional e o formulário do admin avisa que ele aparece aqui.
      // Texto simples (sem link tel:), só quando o campo existe.
      var telefoneMembro = textoNaoVazio(membro.telefone);
      if (telefoneMembro) card.appendChild(el("span", "staff-telefone", telefoneMembro));

      var redes = montarLinksRedes(membro.redes, nome);
      if (redes) card.appendChild(redes);

      fragmento.appendChild(card);
    });

    limpar(container);
    container.appendChild(fragmento);
  }

  // ---------- endereço / contato ----------

  function renderizarEndereco(perfil) {
    var alvo = document.getElementById("local-endereco");
    if (!alvo) return;

    var endereco = textoNaoVazio(perfil.endereco);
    if (!endereco) return; // sem endereço no banco: mantém o estático

    var linhas = [];
    var complemento = textoNaoVazio(perfil.complemento);
    linhas.push(complemento ? endereco + " - " + complemento : endereco);

    var cidade = textoNaoVazio(perfil.cidadeUf);
    var cep = textoNaoVazio(perfil.cep);
    if (cidade && cep) linhas.push(cidade + " - CEP: " + cep);
    else if (cidade) linhas.push(cidade);
    else if (cep) linhas.push("CEP: " + cep);

    limpar(alvo);
    alvo.appendChild(el("strong", null, "Endereço:"));
    linhas.forEach(function (linha) {
      alvo.appendChild(document.createElement("br"));
      alvo.appendChild(document.createTextNode(linha));
    });
  }

  // O horário de funcionamento não tem equivalente estático no HTML (a academia pode
  // simplesmente não ter preenchido), então o parágrafo é CRIADO só quando o dado
  // existe — nada de <p> vazio ou escondido esperando o JS rodar.
  function renderizarHorarioFuncionamento(perfil) {
    var texto = textoNaoVazio(perfil.horarioFuncionamento);
    var container = document.getElementById("local-info");
    if (!texto || !container) return;

    var alvo = document.getElementById("local-horario");
    if (!alvo) {
      alvo = el("p", "local-horario");
      alvo.id = "local-horario";
      container.appendChild(alvo);
    }

    limpar(alvo);
    alvo.appendChild(el("strong", null, "Horário de funcionamento:"));
    alvo.appendChild(document.createElement("br"));
    alvo.appendChild(document.createTextNode(texto));
  }

  function trocarValorDoCard(card, valor) {
    var alvo = card.querySelector(".card-value");
    if (!alvo) return;
    limpar(alvo);
    alvo.textContent = valor;
  }

  // Texto legível pro card de contato, derivado da URL — nunca a URL crua inteira.
  // Em perfis (instagram/facebook/tiktok/youtube) vira "@handle"; em wa.me vira o
  // número; no resto, o domínio. Cai no rótulo padrão se a URL não tiver nada útil.
  function rotuloDeRede(href, rotuloPadrao, usarArroba) {
    try {
      var parsed = new URL(href);
      var dominio = parsed.hostname.replace(/^www\./, "");
      var partes = parsed.pathname.split("/").filter(function (p) { return p.length > 0; });
      if (partes.length !== 1 || partes[0].length > 40) return dominio || rotuloPadrao;
      if (/^\+?[0-9]{8,15}$/.test(partes[0])) return partes[0]; // wa.me/5511999999999
      if (!usarArroba) return dominio || rotuloPadrao;
      return partes[0].charAt(0) === "@" ? partes[0] : "@" + partes[0];
    } catch (erro) {
      return rotuloPadrao;
    }
  }

  // Redes onde o primeiro segmento da URL é um nome de usuário (vira "@fulano").
  var REDES_COM_ARROBA = { instagram: true, facebook: true, tiktok: true, youtube: true };

  function renderizarContato(perfil) {
    var telefone = textoNaoVazio(perfil.telefoneContato);
    var cardTelefone = document.getElementById("contato-telefone");
    if (telefone && cardTelefone) {
      var digitos = telefone.replace(/\D/g, "");
      if (digitos.length >= 8) {
        cardTelefone.href = "tel:+" + (digitos.length <= 11 ? "55" + digitos : digitos);
      }
      trocarValorDoCard(cardTelefone, telefone);
    }

    var redes = perfil.redes && typeof perfil.redes === "object" ? perfil.redes : {};

    var instagram = linkHttpsValido(redes.instagram);
    var cardInstagram = document.getElementById("contato-instagram");
    if (instagram && cardInstagram) {
      cardInstagram.href = instagram;
      trocarValorDoCard(cardInstagram, rotuloDeRede(instagram, "Instagram", true));
    }

    // E-mail e as demais redes viram cards EXTRAS, criados só quando o dado existe e
    // reaproveitando a classe .card já existente. Nenhum card fica escondido no HTML
    // esperando o JS: o que não tem dado simplesmente não é criado.
    var container = document.getElementById("contato-cards");
    if (!container) return;

    var email = textoNaoVazio(perfil.emailContato);
    if (email) {
      var cardEmail = el("a", "card");
      cardEmail.href = "mailto:" + email;
      cardEmail.setAttribute("aria-label", "E-mail da academia");
      cardEmail.appendChild(el("span", "card-label", "E-mail"));
      cardEmail.appendChild(el("span", "card-value", email));
      container.appendChild(cardEmail);
    }

    REDES.forEach(function (rede) {
      if (rede.chave === "instagram") return; // já tem card fixo
      var href = linkHttpsValido(redes[rede.chave]);
      if (!href) return;

      var card = el("a", "card");
      card.href = href;
      card.target = "_blank";
      card.rel = "noopener noreferrer";
      card.setAttribute("aria-label", rede.rotulo + " da academia");
      card.appendChild(el("span", "card-label", rede.rotulo));
      card.appendChild(el("span", "card-value", rotuloDeRede(href, rede.rotulo, !!REDES_COM_ARROBA[rede.chave])));
      container.appendChild(card);
    });
  }

  // ---------- orquestração ----------

  function indexarPorId(lista) {
    var mapa = {};
    lista.forEach(function (item) {
      if (item && item.id) mapa[item.id] = item;
    });
    return mapa;
  }

  function iniciar() {
    // SDK não carregou ou site-firebase.js nem executou: página estática segue intacta.
    if (typeof dbPublico === "undefined" || !dbPublico) return;

    Promise.resolve(typeof ensureTenantContext === "function" ? ensureTenantContext() : null).then(function () {
    var pTurmas = consultaSegura(function () {
      return tenantCollection("turmas").where("ativo", "==", true).limit(50).get();
    }, "turmas");

    var pEquipe = consultaSegura(function () {
      return tenantCollection("equipe")
        .where("ativo", "==", true)
        .orderBy("ordem")
        .orderBy("nome")
        .limit(50)
        .get();
    }, "equipe");

    var pHorarios = consultaSegura(function () {
      return tenantCollection("horarios")
        .where("ativo", "==", true)
        .orderBy("diaSemana")
        .orderBy("horaInicio")
        .limit(200)
        .get();
    }, "horarios");

    var pPerfil = consultaSegura(function () {
      return tenantCollection("academia").doc("perfil").get();
    }, "perfil da academia");

    Promise.all([pTurmas, pEquipe, pHorarios, pPerfil]).then(function (resultados) {
      var turmas = docsParaLista(resultados[0]);
      var equipe = docsParaLista(resultados[1]);
      var horarios = docsParaLista(resultados[2]);
      var docPerfil = resultados[3];

      // Grade: só substitui se as três consultas necessárias vieram e há linha exibível.
      try {
        if (resultados[0] && resultados[2] && horarios.length > 0 && turmas.length > 0) {
          var grupos = agruparPorDia(horarios, indexarPorId(turmas), indexarPorId(equipe));
          if (grupos.length > 0) {
            renderizarTabela(grupos);
            renderizarGradeMobile(grupos);
          }
        }
      } catch (erro) {
        console.warn("[site] grade de horários: mantendo conteúdo estático.", erro);
      }

      try {
        if (resultados[1] && equipe.length > 0) renderizarEquipe(equipe);
      } catch (erro) {
        console.warn("[site] equipe: mantendo conteúdo estático.", erro);
      }

      try {
        if (docPerfil && docPerfil.exists) {
          var perfil = docPerfil.data() || {};
          renderizarEndereco(perfil);
          renderizarHorarioFuncionamento(perfil);
          renderizarContato(perfil);
        }
      } catch (erro) {
        console.warn("[site] endereço/contato: mantendo conteúdo estático.", erro);
      }
    }).catch(function (erro) {
      // Promise.all aqui nunca deveria rejeitar (cada consulta já tem catch próprio),
      // mas se rejeitar a página estática continua exatamente como está.
      console.warn("[site] carga pública falhou; mantendo conteúdo estático.", erro);
    });
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", iniciar);
  } else {
    iniciar();
  }
})();
