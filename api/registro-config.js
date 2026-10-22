// Endpoint público que expone la configuración de Supabase al frontend.
// Solo devuelve la anon key (segura de exponer) — nunca la service key.
//
// Con `?interes=1` despacha el formulario de interés (`_interes.js`, rewrite
// `/api/interes`): el plan Hobby está en su tope de funciones.
const { handleInteres } = require('./_interes');

module.exports = (req, res) => {
  if (req.method === 'OPTIONS') return res.status(200).end();

  const url = new URL(req.url, 'http://x');
  if (url.searchParams.get('interes') === '1') return handleInteres(req, res);

  res.setHeader('Cache-Control', 'no-store');
  res.json({
    supabaseUrl: process.env.SUPABASE_URL || '',
    supabaseAnonKey: process.env.SUPABASE_KEY || '',
  });
};
