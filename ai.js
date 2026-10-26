// =====================================================================
// IA — orden de sagas y recomendaciones de "Jarvis"
// =====================================================================
// Desde la 4.4.2 la IA va por la API de Sharingan (rutas ai/saga y
// ai/recommend), que en el servidor la pasa a OmniRoute con modelos
// gratuitos. Ya no hace falta clave propia: solo sesión iniciada. Los
// prompts viven en el servidor (sharingan_api/ai.php); aquí se manda la
// lista de juegos y se valida lo que vuelve.
class AiError extends Error {}

const year = (g) => (g?.first_release_date ? new Date(g.first_release_date * 1000).getUTCFullYear() : null);

function describe(err) {
  switch (err?.code) {
    case "ai_rate_limited":
      return "Has llegado al límite de usos de la IA por hoy. Vuelve mañana.";
    case "ai_not_configured":
      return "La IA no está disponible ahora mismo.";
    case "ai_failed":
      return "La IA no ha respondido. Prueba otra vez en un momento.";
    case "network":
      return "No se ha podido conectar con la IA. Revisa tu conexión.";
    case "unauthorized":
      return "Tu sesión ha caducado. Vuelve a iniciar sesión.";
    default:
      return "No se ha podido hablar con la IA.";
  }
}

async function call(cloud, route, body) {
  if (!cloud?.loggedIn()) throw new AiError("Inicia sesión para usar la IA.");
  try {
    return await cloud.ai(route, body);
  } catch (err) {
    throw new AiError(describe(err));
  }
}

// ------------------------------------------------------------ Sagas
async function orderSaga(cloud, sagaName, list) {
  const out = await call(cloud, "ai/saga", {
    name: sagaName,
    games: list.map((g) => ({ id: Number(g.id), name: g.name, year: year(g) })),
  });

  // Se respeta la lista real: ids desconocidos fuera, duplicados fuera y
  // los que la IA se haya dejado van al final en su orden actual.
  const valid = new Set(list.map((g) => g.id));
  const seen = new Set();
  const order = [];
  for (const o of out.order || []) {
    if (!valid.has(o.id) || seen.has(o.id)) continue;
    seen.add(o.id);
    order.push({ id: o.id, note: o.note });
  }
  for (const g of list) if (!seen.has(g.id)) order.push({ id: g.id, note: "" });
  return { order, summary: out.summary || "" };
}

// ------------------------------------------------------------ Jarvis
async function recommend(cloud, { platinum, completed, library, exclude, count }) {
  const brief = (games) => games.map((g) => ({ name: g.name, year: year(g) }));
  const out = await call(cloud, "ai/recommend", {
    platinum: brief(platinum),
    completed: brief(completed),
    library: brief(library),
    exclude,
    count,
  });
  return out.recommendations || [];
}

module.exports = { AiError, orderSaga, recommend };
