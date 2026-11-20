import { readFileSync } from 'node:fs';

const [zoneName, tunnel, option] = process.argv.slice(2);
const hostname = process.env.GOMOKU_DOMAIN?.toLowerCase();
const token = readFileSync(0, 'utf8').trim();
const domain = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const origin = 'http://127.0.0.1:18080';
const stop = message => { throw new Error(message); };

async function api(path, method = 'GET', body) {
  let response;
  try {
    response = await fetch('https://api.cloudflare.com/client/v4' + path, {
      method, redirect: 'error',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12_000),
    });
    const payload = await response.json();
    if (response.ok && payload.success) return payload;
  } catch {}
  stop(`Cloudflare 请求失败（${response?.status ?? '连接超时或中断'}）。请检查令牌权限和资源编号。`);
}

try {
  if (!token || !domain.test(zoneName ?? '') || !domain.test(hostname ?? '') ||
      !hostname.endsWith('.' + zoneName) || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(tunnel ?? '') ||
      ![undefined, '--apply'].includes(option)) {
    stop('请提供区域根域名和 Tunnel 编号，并在终端中输入 Cloudflare API 令牌。');
  }

  const zones = (await api('/zones?name=' + encodeURIComponent(zoneName))).result;
  if (zones.length !== 1 || zones[0].name !== zoneName || zones[0].status !== 'active') stop('找不到唯一且已启用的 Cloudflare 区域。');
  const { id: zone, account } = zones[0];
  if (![zone, account?.id].every(id => /^[0-9a-f]{32}$/i.test(id))) stop('Cloudflare 返回了无效的区域或账号编号。');
  const dnsPath = `/zones/${zone}/dns_records`;
  const path = `/accounts/${account.id}/cfd_tunnel/${tunnel}/configurations`;
  const target = `${tunnel}.cfargotunnel.com`;
  const records = async () => {
    const result = await api(dnsPath + '?name=' + encodeURIComponent(hostname) + '&per_page=100');
    if (result.result_info?.total_pages > 1 || result.result.some(record => record.name !== hostname)) stop('DNS 查询结果超出指定子域名，已停止。');
    return result.result;
  };
  const current = await records();
  if (current.some(record => !['A', 'AAAA', 'CNAME'].includes(record.type))) stop('该子域名还有其他类型的 DNS 记录，未执行替换。');
  const correctDNS = current.length === 1 && current[0].type === 'CNAME' && current[0].content === target && current[0].proxied;
  const { config, version } = (await api(path)).result;
  const ingress = config?.ingress;
  if (!Array.isArray(ingress) || !ingress.length || ingress.at(-1).hostname || ingress.at(-1).path) stop('现有 Tunnel 配置缺少默认路由，已停止。');
  const matches = ingress.filter(rule => rule.hostname?.toLowerCase() === hostname);
  if (matches.length > 1 || matches.some(rule => rule.path || rule.service !== origin)) stop('该子域名已有不同的 Tunnel 路由，已停止，保留原配置。');
  console.log(`游戏子域名：${hostname}，目标：${origin}。`);
  console.log(`Tunnel 路由：${matches.length ? '已就绪' : '待添加'}。DNS：${correctDNS ? '已就绪' : '待替换'}。`);
  if (!option) {
    console.log('以上为预检，尚未修改任何设置。加上 --apply 可执行。');
  } else {
    const latest = (await api(path)).result;
    if (latest.version !== version || JSON.stringify(latest.config) !== JSON.stringify(config) ||
        JSON.stringify(await records()) !== JSON.stringify(current)) stop('预检后配置发生变化，请重新运行。');
    if (!matches.length) await api(path, 'PUT', { config: { ...config, ingress: [{ hostname, service: origin }, ...ingress] } });
    if (!correctDNS) {
      try {
        await api(dnsPath + '/batch', 'POST', {
          deletes: current.map(({ id }) => ({ id })),
          posts: [{ type: 'CNAME', name: hostname, content: target, proxied: true, ttl: 1 }],
        });
      } catch (error) {
        stop(`DNS 替换未确认。Tunnel 路由的添加可能已完成。请先重新预检。 ${error.message}`);
      }
    }
    const finalRoute = (await api(path)).result.config?.ingress;
    if (!finalRoute?.some(rule => rule.hostname === hostname && rule.service === origin)) stop('未能验证新增的 Tunnel 路由。');
    const final = await records();
    if (!final.some(record => record.type === 'CNAME' && record.content === target && record.proxied)) stop('未能验证新的 DNS 记录。');
    console.log('Tunnel 路由与代理 DNS 已设置。请验证公网 HTTPS。');
  }
} catch (error) {
  console.log('操作未完成：' + error.message);
  process.exitCode = 1;
}
