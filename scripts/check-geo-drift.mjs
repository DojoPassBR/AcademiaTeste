#!/usr/bin/env node
// Checagem de drift geográfico entre firestore.rules e app/firebase-init.js.
//
// As coordenadas da escola, o raio do check-in e a janela do cooldown existem duplicados
// nos dois arquivos por necessidade (as rules não conseguem ler constantes do JS, e o
// cliente precisa dos mesmos números pro feedback visual e pra montar o checkinId).
// Mudar só um lado quebra o check-in de um jeito silencioso e confuso ("check-in falhou"
// sem motivo aparente), então o CI compara os dois aqui.
//
// O contrato são os comentários "// GEO-SYNC: <nome> = <valor>" nos dois arquivos.
// Sem dependências externas — roda com node puro.

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const TOLERANCIA = 1e-6;

// nome no rules -> nome no JS
const PARES = [
  ["schoolLat", "SCHOOL_LAT"],
  ["schoolLng", "SCHOOL_LNG"],
  ["raioMetros", "CHECKIN_RADIUS_METERS"],
  ["janelaCheckinMs", "CHECKIN_JANELA_MS"]
];

// Literais que precisam bater com o marcador GEO-SYNC do próprio arquivo — impede que
// alguém mude o código e esqueça de atualizar o comentário (o que passaria despercebido).
const LITERAIS_RULES = [
  ["schoolLat", /let\s+schoolLat\s*=\s*(-?[0-9.]+)\s*;/],
  ["schoolLng", /let\s+schoolLng\s*=\s*(-?[0-9.]+)\s*;/],
  ["raioMetros", /let\s+raioMetros\s*=\s*(-?[0-9.]+)\s*;/],
  ["janelaCheckinMs", /request\.time\.toMillis\(\)\s*\/\s*([0-9]+)\s*\)/]
];

const LITERAIS_JS = [
  ["SCHOOL_LAT", /const\s+SCHOOL_LAT\s*=\s*(-?[0-9.]+)\s*;/],
  ["SCHOOL_LNG", /const\s+SCHOOL_LNG\s*=\s*(-?[0-9.]+)\s*;/],
  ["CHECKIN_RADIUS_METERS", /const\s+CHECKIN_RADIUS_METERS\s*=\s*(-?[0-9.]+)\s*;/],
  ["CHECKIN_INTERVALO_MINUTOS", /const\s+CHECKIN_INTERVALO_MINUTOS\s*=\s*(-?[0-9.]+)\s*;/]
];

const erros = [];

function lerArquivo(caminhoRelativo) {
  try {
    return readFileSync(join(raiz, caminhoRelativo), "utf8");
  } catch (err) {
    erros.push(`Não foi possível ler ${caminhoRelativo}: ${err.message}`);
    return "";
  }
}

function extrairMarcadores(texto, arquivo) {
  const marcadores = {};
  const regex = /\/\/\s*GEO-SYNC:\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(-?[0-9]+(?:\.[0-9]+)?)/g;
  let m;
  while ((m = regex.exec(texto)) !== null) {
    const nome = m[1];
    const valor = Number(m[2]);
    if (!Number.isFinite(valor)) {
      erros.push(`${arquivo}: marcador GEO-SYNC "${nome}" com valor não numérico ("${m[2]}").`);
      continue;
    }
    if (nome in marcadores && marcadores[nome] !== valor) {
      erros.push(`${arquivo}: marcador GEO-SYNC "${nome}" declarado duas vezes com valores diferentes.`);
    }
    marcadores[nome] = valor;
  }
  return marcadores;
}

function conferirLiterais(texto, arquivo, marcadores, literais) {
  for (const [nome, regex] of literais) {
    const m = texto.match(regex);
    if (!m) {
      erros.push(`${arquivo}: não encontrei o valor real de "${nome}" no código.`);
      continue;
    }
    const doCodigo = Number(m[1]);
    const doMarcador = marcadores[nome];
    if (doMarcador === undefined) {
      erros.push(`${arquivo}: falta o comentário "// GEO-SYNC: ${nome} = ${doCodigo}".`);
      continue;
    }
    if (Math.abs(doCodigo - doMarcador) > TOLERANCIA) {
      erros.push(
        `${arquivo}: o marcador GEO-SYNC de "${nome}" (${doMarcador}) não bate com o valor no código (${doCodigo}).`
      );
    }
  }
}

const textoRules = lerArquivo("firestore.rules");
const textoJs = lerArquivo("app/firebase-init.js");

const marcadoresRules = extrairMarcadores(textoRules, "firestore.rules");
const marcadoresJs = extrairMarcadores(textoJs, "app/firebase-init.js");

conferirLiterais(textoRules, "firestore.rules", marcadoresRules, LITERAIS_RULES);
conferirLiterais(textoJs, "app/firebase-init.js", marcadoresJs, LITERAIS_JS);

// CHECKIN_JANELA_MS é derivado: tem que ser exatamente os minutos em milissegundos.
if (
  marcadoresJs.CHECKIN_INTERVALO_MINUTOS !== undefined &&
  marcadoresJs.CHECKIN_JANELA_MS !== undefined
) {
  const esperado = marcadoresJs.CHECKIN_INTERVALO_MINUTOS * 60 * 1000;
  if (Math.abs(esperado - marcadoresJs.CHECKIN_JANELA_MS) > TOLERANCIA) {
    erros.push(
      `app/firebase-init.js: CHECKIN_JANELA_MS (${marcadoresJs.CHECKIN_JANELA_MS}) deveria ser ` +
        `CHECKIN_INTERVALO_MINUTOS * 60 * 1000 = ${esperado}.`
    );
  }
}

for (const [nomeRules, nomeJs] of PARES) {
  const a = marcadoresRules[nomeRules];
  const b = marcadoresJs[nomeJs];

  if (a === undefined) {
    erros.push(`firestore.rules: falta o marcador "// GEO-SYNC: ${nomeRules} = ...".`);
    continue;
  }
  if (b === undefined) {
    erros.push(`app/firebase-init.js: falta o marcador "// GEO-SYNC: ${nomeJs} = ...".`);
    continue;
  }
  const diff = Math.abs(a - b);
  if (diff > TOLERANCIA) {
    erros.push(
      `Divergência entre ${nomeRules} (firestore.rules = ${a}) e ${nomeJs} ` +
        `(app/firebase-init.js = ${b}) — diferença de ${diff}.`
    );
  }
}

if (erros.length) {
  console.error("Drift geográfico detectado entre firestore.rules e app/firebase-init.js:\n");
  for (const erro of erros) console.error("  - " + erro);
  console.error(
    "\nOs dois arquivos precisam usar as mesmas coordenadas, o mesmo raio e a mesma janela de check-in."
  );
  process.exit(1);
}

console.log("OK");
