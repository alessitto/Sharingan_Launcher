// =====================================================================
// IA (Claude) — orden de sagas y recomendaciones de "Jarvis"
// =====================================================================
// Se llama a la API de Claude con el SDK oficial y salida estructurada
// (esquema Zod), así la respuesta llega ya como objeto validado. La clave
// de API es la del usuario (Ajustes > Inteligencia artificial) y nunca
// sale del proceso principal.
const Anthropic = require("@anthropic-ai/sdk").default;
const { z } = require("zod");
const { betaZodOutputFormat } = require("@anthropic-ai/sdk/helpers/beta/zod");

const MODEL = "claude-opus-5-5";

// Si el modelo rechazara la petición, la API la reintenta sola con otro
// modelo adecuado (respaldo del lado del servidor).
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };

class AiError extends Error {}

async function ask(apiKey, { system, prompt, schema, effort = "medium" }) {
  const client = new Anthropic({ apiKey, maxRetries: 2 });
  let res;
  try {
    res = await client.beta.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort, format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    throw new AiError(describeError(err));
  }
  if (res.stop_reason === "refusal") throw new AiError("La IA no ha querido responder a esta petición.");
  if (res.stop_reason === "max_tokens") throw new AiError("La respuesta de la IA se ha quedado a medias. Prueba otra vez.");
  if (!res.parsed_output) throw new AiError("La IA no ha devuelto una respuesta válida. Prueba otra vez.");
  return res.parsed_output;
}

function describeError(err) {
  if (err instanceof Anthropic.AuthenticationError) return "La clave de API no es válida. Revísala en Ajustes.";
  if (err instanceof Anthropic.PermissionDeniedError) return "Tu clave de API no tiene permiso para usar este modelo.";
  if (err instanceof Anthropic.RateLimitError) return "Has llegado al límite de uso de la API. Espera un poco y vuelve a probar.";
  if (err instanceof Anthropic.BadRequestError) {
    if (/credit|balance/i.test(err.message)) return "Tu cuenta de la API de Claude no tiene saldo.";
    return "La API de Claude ha rechazado la petición.";
  }
  if (err instanceof Anthropic.APIConnectionError) return "No se ha podido conectar con la IA. Revisa tu conexión.";
  if (err instanceof Anthropic.InternalServerError) return "La API de Claude está teniendo problemas. Prueba en un rato.";
  if (err instanceof Anthropic.APIError) return `Error de la API de Claude (${err.status ?? "?"}).`;
  return "No se ha podido hablar con la IA.";
}

// Comprueba la clave con la llamada más barata posible (lista de modelos).
async function checkKey(apiKey) {
  try {
    await new Anthropic({ apiKey, maxRetries: 1 }).models.retrieve(MODEL);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeError(err) };
  }
}

const year = (g) => (g?.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null);
const line = (g) => {
  const y = year(g);
  return `- [${g.id}] ${g.name}${y ? ` (${y})` : ""}`;
};

// ------------------------------------------------------------ Sagas
const SagaOrder = z.object({
  order: z.array(
    z.object({
      id: z.number().int(),
      note: z.string(),
    })
  ),
  summary: z.string(),
});

async function orderSaga(apiKey, sagaName, list) {
  const system =
    "Eres un experto en videojuegos y en la cronología interna de sus historias. " +
    "Respondes en español de España, con frases cortas.";
  const prompt = [
    `Ordena los juegos de la saga «${sagaName}» por orden cronológico de la historia (cuándo ocurren dentro del universo del juego), no por fecha de lanzamiento.`,
    "Si un juego no tiene una posición clara en la cronología (spin-off, recopilatorio, historia aparte), colócalo donde tenga más sentido jugarlo y dilo en su nota.",
    "Si dos juegos ocurren a la vez o son versiones del mismo juego (remake, remaster), pon primero el original y explícalo en la nota.",
    "Devuelve todos los juegos de la lista, cada uno una sola vez, usando su número entre corchetes como id.",
    "En «note» explica en una frase corta cuándo ocurre ese juego; en «summary», en una o dos frases, el criterio que has seguido.",
    "",
    "Juegos:",
    ...list.map(line),
  ].join("\n");
  const out = await ask(apiKey, { system, prompt, schema: SagaOrder, effort: "medium" });

  // Se respeta la lista real: ids desconocidos fuera, duplicados fuera y
  // los que la IA se haya dejado van al final en su orden actual.
  const valid = new Set(list.map((g) => g.id));
  const seen = new Set();
  const order = [];
  for (const o of out.order) {
    if (!valid.has(o.id) || seen.has(o.id)) continue;
    seen.add(o.id);
    order.push({ id: o.id, note: o.note });
  }
  for (const g of list) if (!seen.has(g.id)) order.push({ id: g.id, note: "" });
  return { order, summary: out.summary };
}

// ------------------------------------------------------------ Jarvis
const Recommendations = z.object({
  recommendations: z.array(
    z.object({
      title: z.string(),
      year: z.number().int().nullable(),
      reason: z.string(),
    })
  ),
});

async function recommend(apiKey, { platinum, completed, library, exclude, count }) {
  const system =
    "Eres Jarvis, el asistente de Sharingan Launcher, un lanzador de juegos de PC. " +
    "Recomiendas videojuegos a partir de los gustos del usuario. Respondes en español de España.";
  const section = (title, games) => (games.length ? [title, ...games.map((g) => `- ${g.name}${year(g) ? ` (${year(g)})` : ""}`), ""] : []);
  const prompt = [
    `Recomiéndame ${count} videojuegos que creas que me van a gustar, ordenados de más a menos recomendable para mí.`,
    "Pesa así mis gustos: lo que más dice de mí son los juegos que he platinado, después los que me he pasado y, por último, los que tengo en la biblioteca sin pasar.",
    "No recomiendes ningún juego de las listas de abajo (ni ediciones, remasters o versiones del mismo juego que ya tenga).",
    "Usa el nombre oficial en inglés de cada juego, tal como aparece en tiendas como Steam, y su año de lanzamiento original. Solo juegos que existan y estén ya a la venta.",
    "En «reason», una frase corta (máx. 120 caracteres) que diga por qué me puede gustar, mencionando si puedes algún juego mío.",
    "",
    ...section("Juegos que he platinado:", platinum),
    ...section("Juegos que me he pasado:", completed),
    ...section("Juegos en mi biblioteca (sin pasar):", library),
    ...section("Ya me los has recomendado antes, no los repitas:", exclude.map((name) => ({ name }))),
  ].join("\n");
  const out = await ask(apiKey, { system, prompt, schema: Recommendations, effort: "medium" });
  return out.recommendations;
}

module.exports = { AiError, checkKey, orderSaga, recommend, MODEL };
