// Criptografia simétrica (AES-GCM 256) com a Web Crypto API nativa do runtime do
// Cloudflare Workers — sem nenhuma dependência externa.
//
// Existe por um motivo só: a chave de API do Asaas que o professor cadastra pelo painel
// (Fase 5) é guardada no Firestore, e o Firestore não é lugar de segredo em texto plano.
// Um dump/backup do banco, um erro de rule ou um acesso indevido ao Console vazariam a
// credencial de cobrança da academia inteira. Cifrando aqui, o documento
// `config/credenciais` só é útil pra quem TAMBÉM tiver a secret CREDENCIAL_CRYPTO_KEY,
// que vive no Cloudflare (wrangler secret) e nunca toca o Firebase.
//
// AES-GCM é criptografia AUTENTICADA: adulterar o ciphertext (ou usar a chave errada)
// faz a decifragem FALHAR em vez de devolver lixo silenciosamente. É por isso que não
// existe MAC separado aqui.
//
// REGRA DE OURO DESTE ARQUIVO: nada de texto plano (nem a chave, nem pedaço dela, nem o
// resultado decifrado) pode aparecer em console.log/console.error. Os logs do Worker são
// legíveis por quem tem acesso ao dashboard da Cloudflare.

const ALGORITMO = "AES-GCM";
const TAMANHO_CHAVE_BYTES = 32; // AES-256
const TAMANHO_IV_BYTES = 12; // 96 bits — o tamanho recomendado para GCM

// btoa/atob do runtime trabalham com "binary strings" (um caractere = um byte), não com
// bytes arbitrários direto. Converter na mão é o jeito correto — passar um Uint8Array
// pro btoa (ou usar String.fromCharCode com spread num array grande) é fonte clássica
// de corrupção silenciosa de dados.
function bytesParaBase64(bytes) {
  let binario = "";
  for (let i = 0; i < bytes.length; i++) {
    binario += String.fromCharCode(bytes[i]);
  }
  return btoa(binario);
}

function base64ParaBytes(texto) {
  const binario = atob(String(texto));
  const bytes = new Uint8Array(binario.length);
  for (let i = 0; i < binario.length; i++) {
    bytes[i] = binario.charCodeAt(i);
  }
  return bytes;
}

/**
 * Importa a chave mestra da secret CREDENCIAL_CRYPTO_KEY (base64 de 32 bytes).
 * Gerar com: openssl rand -base64 32
 *
 * A CryptoKey é criada com extractable = false: nem o próprio código consegue exportar
 * o material da chave depois de importada.
 */
async function importarChave(env) {
  const bruta = env && env.CREDENCIAL_CRYPTO_KEY;
  if (typeof bruta !== "string" || !bruta.trim()) {
    throw new Error(
      "CREDENCIAL_CRYPTO_KEY não configurada no Worker (gere com: openssl rand -base64 32)."
    );
  }

  let bytes;
  try {
    bytes = base64ParaBytes(bruta.trim());
  } catch (err) {
    // Sem detalhes do valor no erro — a mensagem pode virar resposta HTTP.
    throw new Error("CREDENCIAL_CRYPTO_KEY inválida: não é base64 válido.");
  }

  if (bytes.length !== TAMANHO_CHAVE_BYTES) {
    throw new Error(
      "CREDENCIAL_CRYPTO_KEY inválida: são esperados " +
        TAMANHO_CHAVE_BYTES +
        " bytes (base64 de 32 bytes), veio " +
        bytes.length +
        "."
    );
  }

  return crypto.subtle.importKey("raw", bytes, ALGORITMO, false, ["encrypt", "decrypt"]);
}

/**
 * Cifra uma string. Cada chamada gera um IV novo e aleatório — reusar IV com a mesma
 * chave quebra o AES-GCM por completo, então ele NUNCA é fixo nem derivado do conteúdo.
 * O IV não é segredo e é guardado junto do ciphertext.
 *
 * @returns {Promise<{cipher: string, iv: string}>} ambos em base64
 */
async function cifrar(env, textoPlano) {
  if (typeof textoPlano !== "string" || !textoPlano) {
    throw new Error("Nada para cifrar.");
  }

  const chave = await importarChave(env);
  const iv = crypto.getRandomValues(new Uint8Array(TAMANHO_IV_BYTES));
  const dados = new TextEncoder().encode(textoPlano);

  const cifrado = await crypto.subtle.encrypt({ name: ALGORITMO, iv }, chave, dados);

  return {
    cipher: bytesParaBase64(new Uint8Array(cifrado)),
    iv: bytesParaBase64(iv)
  };
}

/**
 * Decifra o que cifrar() produziu. Falha (lança) se o ciphertext tiver sido adulterado,
 * se o IV não bater ou se a CREDENCIAL_CRYPTO_KEY for outra — a tag de autenticação do
 * GCM detecta os três casos.
 *
 * @returns {Promise<string>} o texto plano original
 */
async function decifrar(env, { cipher, iv } = {}) {
  if (typeof cipher !== "string" || !cipher || typeof iv !== "string" || !iv) {
    throw new Error("Dados cifrados incompletos.");
  }

  const chave = await importarChave(env);

  let bytesCipher;
  let bytesIv;
  try {
    bytesCipher = base64ParaBytes(cipher);
    bytesIv = base64ParaBytes(iv);
  } catch (err) {
    throw new Error("Dados cifrados corrompidos (base64 inválido).");
  }

  if (bytesIv.length !== TAMANHO_IV_BYTES) {
    throw new Error("Dados cifrados corrompidos (IV com tamanho inesperado).");
  }

  let plano;
  try {
    plano = await crypto.subtle.decrypt({ name: ALGORITMO, iv: bytesIv }, chave, bytesCipher);
  } catch (err) {
    // O erro original do WebCrypto não diz nada útil e o conteúdo NUNCA vai pro log.
    throw new Error(
      "Falha ao decifrar a credencial: chave de criptografia trocada ou dado adulterado."
    );
  }

  return new TextDecoder().decode(plano);
}

export { cifrar, decifrar, importarChave };
