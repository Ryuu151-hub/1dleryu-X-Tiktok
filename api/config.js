export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const maintenance =
    String(process.env.MAINTENANCE_MODE ?? 'false').toLowerCase() === 'true';

  res.status(200).json({
    maintenance,
    message:
      process.env.MAINTENANCE_MESSAGE ||
      'This website is in maintenance mode. Please check back later.',
  });
}
