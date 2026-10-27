import { createServer } from 'node:http';
import { connect, type Socket } from 'node:net';
import { WebSocketServer } from 'ws';
import type { startEgressProxy } from '../backend/src/browser/egress-proxy.js';

/** The production network guard still validates a public DNS answer. Only this
 * test-owned dial function maps that validated address to its loopback fixture. */
export async function startModernFixture(createProxy: typeof startEgressProxy) {
  const hits: { url: string; method: string; cookie: string }[] = [];
  const sockets = new Set<Socket>();
  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (socket) => {
    socket.send('Live WebSocket');
  });
  const server = createServer((request, response) => {
    const url = new URL(request.url ?? '/', 'http://app.example');
    hits.push({
      url: url.href,
      method: request.method ?? '',
      cookie: request.headers.cookie ?? '',
    });
    if (url.pathname === '/app.js') {
      response.setHeader('content-type', 'text/javascript');
      response.end(`document.title='JavaScript ready';document.cookie='client=1; SameSite=Lax';
        fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'hello'})}).then(r=>r.text()).then(t=>document.querySelector('#result').textContent=t);
        const socket=new WebSocket('ws://chat.example/events');socket.onmessage=e=>document.querySelector('#live').textContent=e.data;
        document.querySelector('#change').onclick=()=>{document.querySelector('#result').textContent='Clicked with JavaScript';};
        fetch('http://private.example/probe').catch(()=>{});`);
      return;
    }
    if (url.pathname === '/api') {
      let body = '';
      request.on('data', (chunk) => {
        body += chunk;
      });
      request.on('end', () => {
        response.setHeader('set-cookie', 'server=1; HttpOnly; SameSite=Lax');
        response.end(
          request.method === 'POST' && body.includes('hello')
            ? 'POST worked'
            : 'Unexpected request',
        );
      });
      return;
    }
    if (url.pathname === '/login') {
      request.resume();
      request.on('end', () => {
        response.writeHead(303, {
          location: '/account',
          'set-cookie': 'login=fixture; HttpOnly; SameSite=Lax',
        });
        response.end();
      });
      return;
    }
    if (url.pathname === '/account') {
      response.end(
        `<title>Account</title><h1>${request.headers.cookie?.includes('login=fixture') ? 'Signed in' : 'No cookie'}</h1>`,
      );
      return;
    }
    if (url.pathname === '/redirect-private') {
      response.writeHead(302, { location: 'http://private.example/probe' });
      response.end();
      return;
    }
    if (url.pathname === '/second') {
      response.end('<title>Second modern page</title><h1>Second page</h1>');
      return;
    }
    if (url.pathname === '/motion') {
      response.setHeader('content-type', 'text/html');
      response.end(`<!doctype html><title>Motion fixture</title><style>body{margin:0;overflow:hidden;background:#123}canvas{display:block}</style><canvas id="motion"></canvas><script>
        const canvas=document.querySelector('canvas');const ctx=canvas.getContext('2d');let changed=false;
        canvas.width=innerWidth;canvas.height=innerHeight;
        onresize=()=>{canvas.width=innerWidth;canvas.height=innerHeight;};
        onpointerdown=()=>{changed=!changed;};
        function draw(t){ctx.fillStyle='#123';ctx.fillRect(0,0,canvas.width,canvas.height);
          ctx.fillStyle=changed?'#ff0000':'#000000';ctx.fillRect(0,0,100,100);
          ctx.fillStyle='#8fe';ctx.fillRect((t/4)%(canvas.width-100),180,100,100);
          ctx.fillStyle='#fff';ctx.font='30px Arial';ctx.fillText('Frame '+Math.floor(t),120,70);
          requestAnimationFrame(draw);}requestAnimationFrame(draw);
        </script>`);
      return;
    }
    response.setHeader('content-type', 'text/html');
    response.end(
      `<!doctype html><title>Modern fixture</title><style>body{font:20px Arial;padding:24px;background:#def3e8}</style><h1>Modern fixture</h1><p id="result">Loading</p><p id="live">Connecting</p><button id="change">Change text</button><form method="post" action="/login"><input name="name" value="test"><button id="submit">Sign in</button></form><a id="next" href="http://second.example/second">Next domain</a><a id="popup" href="/second" target="_blank">Open new window</a><script src="/app.js"></script>`,
    );
  });
  server.on('upgrade', (request, socket, head) =>
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request)),
  );
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Fixture failed.');
  return {
    hits,
    proxyFactory: () =>
      createProxy({
        resolve: async (host) => [
          { address: host === 'private.example' ? '127.0.0.1' : '93.184.216.34', family: 4 },
        ],
        connect: () => connect({ host: '127.0.0.1', port: address.port }),
      }),
    async close() {
      for (const socket of sockets) socket.destroy();
      for (const client of wss.clients) client.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
