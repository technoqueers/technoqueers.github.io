// Minimal Cloudflare R2 client (S3-compatible API, AWS SigV4) with just the two
// calls the image mirror needs: HEAD and PUT. Hand-rolled so the repo stays
// dependency-free.
//
// Configured from the environment:
//   R2_ACCOUNT_ID          Cloudflare account id (builds the default endpoint)
//   R2_ACCESS_KEY_ID       R2 API token access key
//   R2_SECRET_ACCESS_KEY   R2 API token secret
//   R2_BUCKET              bucket name
//   R2_PUBLIC_BASE_URL     public URL the bucket is served from, e.g.
//                          https://images.technoqueers.com or https://pub-xxxx.r2.dev
//   R2_ENDPOINT            optional override of https://<account>.r2.cloudflarestorage.com

import { createHash, createHmac } from 'node:crypto';

const REGION = 'auto';
const SERVICE = 's3';

const sha256Hex = (data) => createHash('sha256').update(data).digest('hex');
const hmac = (key, data) => createHmac('sha256', key).update(data).digest();

// S3's URI encoding: everything but unreserved characters, keeping '/' in paths.
function encodePath(p) {
  return p.split('/').map((seg) =>
    encodeURIComponent(seg).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase()),
  ).join('/');
}

// R2 settings that, if any is set, mean R2 is meant to be in use.
const R2_VARS = ['R2_ACCOUNT_ID', 'R2_ENDPOINT', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL'];

// Returns the config, or { problems: [...], unset } if anything is missing or
// malformed. `unset` is true when no R2 variable is set at all (R2 not set up
// yet, as opposed to set up wrong). Empty strings count as unset, which is
// what GitHub Actions passes for a secret that doesn't exist.
export function r2ConfigFromEnv(env = process.env) {
  const problems = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET', 'R2_PUBLIC_BASE_URL']
    .filter((name) => !env[name])
    .map((name) => `${name} is not set`);
  if (!env.R2_ENDPOINT && !env.R2_ACCOUNT_ID) problems.push('R2_ACCOUNT_ID (or R2_ENDPOINT) is not set');
  // Without a scheme, every rewritten <img src> would be a broken relative URL.
  for (const name of ['R2_PUBLIC_BASE_URL', 'R2_ENDPOINT']) {
    if (env[name] && !/^https?:\/\/[^/]/i.test(env[name])) problems.push(`${name} must start with https://`);
  }
  if (problems.length) return { problems, unset: R2_VARS.every((name) => !env[name]) };
  return {
    endpoint: (env.R2_ENDPOINT || `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`).replace(/\/+$/, ''),
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    publicBaseUrl: env.R2_PUBLIC_BASE_URL.replace(/\/+$/, ''),
  };
}

// AWS SigV4 for S3 (no query string). Returns the headers to send, minus Host,
// which fetch sets itself.
export function signRequest({ method, url, headers = {}, payloadHash, date, accessKeyId, secretAccessKey, region = REGION }) {
  const amzDate = date.toISOString().replace(/[:-]|\.\d{3}/g, ''); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);

  const allHeaders = {
    ...Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), String(v).trim()])),
    host: url.host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
  };
  const signedHeaderNames = Object.keys(allHeaders).sort();
  const canonicalHeaders = signedHeaderNames.map((h) => `${h}:${allHeaders[h]}\n`).join('');
  const signedHeaders = signedHeaderNames.join(';');

  const canonicalRequest = [method, url.pathname, '', canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const scope = `${dateStamp}/${region}/${SERVICE}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256Hex(canonicalRequest)].join('\n');

  let signingKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  for (const part of [region, SERVICE, 'aws4_request']) signingKey = hmac(signingKey, part);
  const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex');

  const { host, ...sendHeaders } = allHeaders;
  sendHeaders.authorization =
    `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return sendHeaders;
}

export function createR2Client(config) {
  // Every failure here (HTTP or network) throws an error starting "R2 ", so it
  // can't be mistaken for a problem with the source image. Network errors and
  // 5xx responses are retried a couple of times first.
  async function request(method, key, { body, headers = {} } = {}, attempts = 3) {
    const url = new URL(`${config.endpoint}/${encodePath(config.bucket)}/${encodePath(key)}`);
    for (let attempt = 1; ; attempt++) {
      const sendHeaders = signRequest({
        method,
        url,
        headers,
        payloadHash: sha256Hex(body || ''),
        date: new Date(),
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      });
      let res;
      try {
        res = await fetch(url, { method, headers: sendHeaders, body, signal: AbortSignal.timeout(120_000) });
      } catch (err) {
        if (attempt < attempts) { await sleep(attempt); continue; }
        throw new Error(`R2 ${method} ${key}: ${err.cause?.code || err.message}`);
      }
      if (res.status >= 500 && attempt < attempts) {
        await res.body?.cancel();
        await sleep(attempt);
        continue;
      }
      return res;
    }
  }

  return {
    publicBaseUrl: config.publicBaseUrl,

    // Returns { contentType, bytes } if the object exists, null on 404; throws otherwise.
    async head(key) {
      const res = await request('HEAD', key);
      await res.body?.cancel();
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`R2 HEAD ${key} -> HTTP ${res.status}`);
      return {
        contentType: res.headers.get('content-type'),
        bytes: Number(res.headers.get('content-length')) || null,
      };
    },

    async put(key, body, contentType) {
      const res = await request('PUT', key, {
        body,
        headers: {
          'content-type': contentType,
          'cache-control': 'public, max-age=31536000, immutable',
        },
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`R2 PUT ${key} -> HTTP ${res.status}: ${text}`);
    },
  };
}

function sleep(attempt) {
  return new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
}

// The R2 client if configured, else null with a log line: for scripts where
// mirroring images is a bonus rather than the point (sync, backfill). In the
// weekly workflow, the mirror-images step after the sync reports R2 problems
// on the run page.
export function imageMirror() {
  const config = r2ConfigFromEnv();
  if (config.problems) {
    console.warn(`R2 not configured (${config.problems.join('; ')}); new images stay on their original hosts.`);
    return null;
  }
  return createR2Client(config);
}
