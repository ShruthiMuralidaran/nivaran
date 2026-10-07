// GET /api/stats -> usage measured from logged AI runs in Supabase (for the How it works page).
const { handler } = require('./_lib/http');
const supabase = require('./_lib/supabase');

module.exports = handler('GET', async () => {
  if (!supabase.enabled()) return { enabled: false };
  try {
    const rows = await supabase.fetchStats();
    return { enabled: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (e) {
    return { enabled: true, error: 'Could not read usage stats from Supabase.', rows: [] };
  }
});
