const { INDIA_TOP_MEDICINES_DB } = require('../data/india-top-medicines.data');

const TOP_MEDICINES_CATALOG_SIZE = 100;

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function clampLimit(raw, fallback = 15) {
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(50, Math.floor(parsed)));
}

const indexedMedicines = INDIA_TOP_MEDICINES_DB.slice(0, TOP_MEDICINES_CATALOG_SIZE).map((item, index) => {
  const sideEffects = Array.isArray(item.sideEffects)
    ? item.sideEffects.map((effect) => String(effect || '').trim()).filter(Boolean)
    : [];

  const searchableText = [item.name, item.genericName, item.uses, ...sideEffects]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return {
    id: index + 1,
    name: String(item.name || '').trim(),
    genericName: String(item.genericName || '').trim(),
    uses: String(item.uses || '').trim(),
    sideEffects,
    searchableText
  };
});

function scoreMedicine(entry, query) {
  const q = normalizeText(query);
  if (!q) return 0;

  const name = normalizeText(entry.name);
  const genericName = normalizeText(entry.genericName);
  const searchable = entry.searchableText;

  if (name === q) return 120;
  if (genericName === q) return 110;

  let score = 0;
  if (name.startsWith(q)) score += 90;
  else if (name.includes(q)) score += 65;

  if (genericName.startsWith(q)) score += 55;
  else if (genericName.includes(q)) score += 40;

  if (searchable.includes(q)) score += 20;

  return score;
}

function stripInternalFields(entry) {
  return {
    id: entry.id,
    name: entry.name,
    genericName: entry.genericName,
    uses: entry.uses,
    sideEffects: entry.sideEffects
  };
}

const medicinesController = {
  listTopMedicines: async (req, res, next) => {
    try {
      const limit = clampLimit(req.query.limit, 15);
      return res.json({
        ok: true,
        totalCatalogSize: indexedMedicines.length,
        results: indexedMedicines.slice(0, limit).map(stripInternalFields)
      });
    } catch (error) {
      return next(error);
    }
  },

  searchMedicines: async (req, res, next) => {
    try {
      const query = String(req.query.q || '').trim();
      const limit = clampLimit(req.query.limit, 12);

      if (query.length < 2) {
        return res.status(400).json({
          ok: false,
          error: 'Enter at least 2 characters to search medicines.'
        });
      }

      const results = indexedMedicines
        .map((entry) => ({ entry, score: scoreMedicine(entry, query) }))
        .filter((row) => row.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit)
        .map((row) => stripInternalFields(row.entry));

      return res.json({
        ok: true,
        query,
        totalCatalogSize: indexedMedicines.length,
        count: results.length,
        results
      });
    } catch (error) {
      return next(error);
    }
  }
};

module.exports = { medicinesController };
