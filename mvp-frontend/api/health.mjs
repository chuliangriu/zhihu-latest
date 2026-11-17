export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    ok: true,
    service: 'vercel',
    commit: process.env.VERCEL_GIT_COMMIT_SHA || null,
  });
}
