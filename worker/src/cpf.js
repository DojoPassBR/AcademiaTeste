// Validação de CPF/CNPJ — função pura, sem env/fetch.
//
// O Asaas exige cpfCnpj pra criar o customer. No DojoPass esse dado é coletado sob
// demanda, na primeira cobrança de cada aluno, usado só em trânsito e NUNCA gravado no
// Firestore (só o asaasCustomerId devolvido pelo Asaas é persistido).
//
// REGRA: nada neste arquivo — nem em quem o chama — pode logar o valor recebido.
// Nenhum console.log/console.error aqui, de propósito.

function digitoVerificadorCpf(digitos, ate) {
  let soma = 0;
  let peso = ate + 1;
  for (let i = 0; i < ate; i++) soma += digitos[i] * peso--;
  const resto = (soma * 10) % 11;
  return resto === 10 || resto === 11 ? 0 : resto;
}

function cpfValido(digitos) {
  if (digitoVerificadorCpf(digitos, 9) !== digitos[9]) return false;
  return digitoVerificadorCpf(digitos, 10) === digitos[10];
}

function digitoVerificadorCnpj(digitos, ate) {
  // Pesos oficiais: 5..2,9..2 (12 dígitos) e 6..2,9..2 (13 dígitos).
  let peso = ate - 7;
  let soma = 0;
  for (let i = 0; i < ate; i++) {
    soma += digitos[i] * peso--;
    if (peso < 2) peso = 9;
  }
  const resto = soma % 11;
  return resto < 2 ? 0 : 11 - resto;
}

function cnpjValido(digitos) {
  if (digitoVerificadorCnpj(digitos, 12) !== digitos[12]) return false;
  return digitoVerificadorCnpj(digitos, 13) === digitos[13];
}

/**
 * Aceita CPF (11 dígitos) ou CNPJ (14 dígitos), com ou sem máscara.
 * Rejeita sequências de dígito repetido ("00000000000", "11111111111111"), que passam
 * na conta do dígito verificador mas nunca são documentos reais.
 * @param {unknown} v
 * @returns {boolean}
 */
function cpfCnpjValido(v) {
  if (typeof v !== "string" && typeof v !== "number") return false;

  const limpo = String(v).replace(/\D/g, "");
  if (limpo.length !== 11 && limpo.length !== 14) return false;
  if (/^(\d)\1+$/.test(limpo)) return false;

  const digitos = limpo.split("").map(Number);
  return limpo.length === 11 ? cpfValido(digitos) : cnpjValido(digitos);
}

export { cpfCnpjValido };
