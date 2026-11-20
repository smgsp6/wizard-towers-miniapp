import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const origin = 'http://127.0.0.1:18080';

test('Cloudflare route changes only the configured hostname and preserves other routes', () => {
  const fixture = `
    import assert from 'node:assert/strict';
    const zones = [{ id: 'a'.repeat(32), name: 'example.com', status: 'active', account: { id: 'b'.repeat(32) } }];
    const own = { hostname: 'game.example.com', service: '${origin}' };
    const unrelated = [{ hostname:'other.example.com',service:'http://localhost:20000' },{service:'http_status:404'}];
    let route = { version:4, config:{ ingress:unrelated } };
    let dns = [{ id:'a'.repeat(32), name:own.hostname, type:'A', content:'192.0.2.1' }];
    let writes = 0;
    globalThis.fetch = async (url, options) => {
      assert.equal(new URL(url).hostname, 'api.cloudflare.com');
      assert.equal(options.headers.Authorization, 'Bearer synthetic-token');
      const path = new URL(url).pathname;
      let result;
      if (path.endsWith('/zones')) result = zones;
      else if (path.endsWith('/configurations')) {
        if (options.method === 'PUT') {
          const {config} = JSON.parse(options.body);
          assert.deepEqual(config.ingress, [own,...unrelated]);
          route = { version:5, config }; writes++;
        }
        result = route;
      } else if (path.endsWith('/dns_records')) result = dns;
      else if (path.endsWith('/dns_records/batch')) {
        const {deletes,posts} = JSON.parse(options.body);
        assert.deepEqual(deletes,[{id:dns[0].id}]);
        assert.equal(posts[0].name,own.hostname);
        assert.equal(posts[0].type,'CNAME');
        assert.equal(posts[0].proxied,true);
        dns=posts; writes++;
      } else assert.fail(path);
      return new Response(JSON.stringify({ success:true, result }));
    };
    process.on('exit', () => assert.equal(writes, process.argv.includes('--apply') ? 2 : 0));
  `;
  for (const args of [[], ['--apply']]) {
    const result = spawnSync(process.execPath, [
      '--import', 'data:text/javascript,' + encodeURIComponent(fixture),
      'deploy/cloudflare-route.mjs', 'example.com', '00000000-0000-4000-8000-000000000001', ...args,
    ], {
      input: 'synthetic-token\n', encoding: 'utf8',
      env: { ...process.env, GOMOKU_DOMAIN: 'game.example.com' },
    });
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.match(result.stdout, args.length ? /代理 DNS 已设置/ : /尚未修改/);
    assert.doesNotMatch(result.stdout, /synthetic-token/);
  }
});
