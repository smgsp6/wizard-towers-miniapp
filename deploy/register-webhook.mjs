const { TELEGRAM_BOT_TOKEN: token, TELEGRAM_WEBHOOK_SECRET: secret, GOMOKU_DOMAIN: domain } = process.env;
try {
  if (!token || !secret || !domain) throw new Error();
  const response = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: `https://${domain}/api/telegram`, secret_token: secret, allowed_updates: ['message'],
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok || (await response.json()).ok !== true) throw new Error();
  console.log('Telegram webhook 已设置。');
} catch {
  console.error('Telegram webhook 设置失败。请检查 Token 与域名的公网 HTTPS，再重试。');
  process.exitCode = 1;
}
