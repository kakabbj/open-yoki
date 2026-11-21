// Minimal HTTP CONNECT tunnel agent for the ws client, used only when a proxy
// env var is set. edge-tts (Python, aiohttp trust_env=True) routes through the
// proxy; the ws client does not, so on a machine that needs a proxy to reach
// Microsoft the direct connection is dropped (close code 1006). No dependency:
// CONNECT with node:net, then TLS with node:tls over the tunnel. The socket
// returned to the ws package is already TLS-wrapped, as https.request expects
// for a wss target. No effect at all when no proxy env var is set.
import http from 'node:http';
import net from 'node:net';
import tls from 'node:tls';

export function proxyEnv() {
  return process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || '';
}

// An http.Agent whose createConnection tunnels to the target through the proxy
// and wraps the tunnel in TLS. `options` is the ws/https target ({host, port}).
export function connectProxyAgent(proxyUrl) {
  const p = new URL(proxyUrl);
  const agent = new http.Agent();
  agent.createConnection = (options, cb) => {
    const targetHost = options.host;
    const targetPort = options.port || 443;
    const sock = net.connect({ host: p.hostname, port: Number(p.port || 80) });
    let buf = Buffer.alloc(0);
    let settled = false;
    const fail = err => { if (settled) return; settled = true; clearTimeout(timer); sock.destroy(); cb(err); };
    const timer = setTimeout(() => fail(new Error('proxy connect timeout')), 15000);
    const onData = chunk => {
      if (settled) return;
      buf = Buffer.concat([buf, chunk]);
      const end = buf.indexOf('\r\n\r\n');
      if (end < 0) return;
      const head = buf.subarray(0, end).toString('utf8');
      const status = Number(head.split(' ')[1]);
      if (status !== 200) return fail(new Error(`proxy CONNECT ${status}: ${head.split('\r\n')[0].slice(0, 80)}`));
      settled = true;
      clearTimeout(timer);
      const rest = buf.subarray(end + 4);
      // Stop consuming bytes here: from now on the TLS layer owns the socket.
      // (No pause(): tls.connect attaches its reader synchronously in this
      // same tick, so no bytes can arrive in between; pausing stalls the
      // handshake because the wrapped socket is never resumed.)
      sock.removeListener('data', onData);
      sock.removeListener('error', fail);
      if (rest.length) sock.unshift(rest);
      let tlsSock;
      try {
        tlsSock = tls.connect({ socket: sock, servername: targetHost, ALPNProtocols: ['http/1.1'] });
      } catch (e) { return cb(e); }
      tlsSock.on('error', () => {});
      cb(null, tlsSock);
    };
    sock.on('error', fail);
    sock.on('connect', () => {
      const lines = [`CONNECT ${targetHost}:${targetPort} HTTP/1.1`, `Host: ${targetHost}:${targetPort}`];
      if (p.username) lines.push(`Proxy-Authorization: Basic ${Buffer.from(`${decodeURIComponent(p.username)}:${decodeURIComponent(p.password || '')}`).toString('base64')}`);
      lines.push('', '');
      sock.write(lines.join('\r\n'));
    });
    sock.on('data', onData);
  };
  return agent;
}
