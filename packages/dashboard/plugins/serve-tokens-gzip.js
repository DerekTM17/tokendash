import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// tokens.json is the one big asset here — 1.4MB today and growing by roughly
// 600KB/day of subagent sessions — and the dashboard polls it every 8s. Vite's
// dev server serves it uncompressed, so every change costs a full-size
// transfer. It gzips about 10:1, so this pays for itself immediately.
//
// Two behaviours matter and both are preserved:
//   * `Cache-Control: no-cache` + a strong ETag, so an UNCHANGED file costs a
//     304 with an empty body. (useTokenData deliberately does not cache-bust,
//     which is what makes that possible.)
//   * `Vary: Accept-Encoding`, so a cache never hands a gzipped body to a
//     client that didn't ask for one.
//
// The compressed buffer is cached and only recomputed when the file's mtime or
// size changes, so a poll storm doesn't re-gzip the same bytes.
export default function serveTokensGzip({ file = 'tokens.json' } = {}) {
  let cache = null; // { key, gzip, raw, etag }

  return {
    name: 'serve-tokens-gzip',
    apply: 'serve',
    configureServer(server) {
      const filePath = path.resolve(server.config.publicDir, file);

      server.middlewares.use((req, res, next) => {
        // Ignore any query string: the poll URL is bare today, but a stray
        // cache-buster shouldn't silently disable compression.
        const url = (req.url || '').split('?')[0];
        if (url !== `/${file}`) return next();

        let stat;
        try {
          stat = fs.statSync(filePath);
        } catch {
          return next(); // not generated yet — let Vite 404 it
        }

        const key = `${stat.mtimeMs}-${stat.size}`;
        if (!cache || cache.key !== key) {
          const raw = fs.readFileSync(filePath);
          cache = { key, raw, gzip: zlib.gzipSync(raw), etag: `"${stat.size}-${stat.mtimeMs}"` };
        }

        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.setHeader('Vary', 'Accept-Encoding');
        res.setHeader('ETag', cache.etag);

        if (req.headers['if-none-match'] === cache.etag) {
          res.statusCode = 304;
          return res.end();
        }

        const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');
        const body = wantsGzip ? cache.gzip : cache.raw;
        if (wantsGzip) res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Length', String(body.length));
        res.end(body);
      });
    },
  };
}
