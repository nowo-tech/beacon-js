// @ts-check
import { request } from 'node:http';

/** Raw HTTP request (Node's fetch forbids setting Origin). */
export function send(base, { method = 'POST', path, headers = {}, body }) {
  const url = new URL(path, base);
  return new Promise((resolve, reject) => {
    const req = request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    req.end(body);
  });
}
