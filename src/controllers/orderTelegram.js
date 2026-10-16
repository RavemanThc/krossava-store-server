export const formatOrder = (body) => {
  const customer = body.customer || body;
  const items = body.items || [{
    name: body.productTitle, size: body.productSize,
    barcode: body.productBarcode, quantity: 1,
  }];
  const lines = items.map((item, index) => [
    `${index + 1}. ${item.name}`,
    `Розмір: ${item.size}; кількість: ${item.quantity}`,
    `Артикул: ${item.barcode}`,
    ...(item.price !== undefined ? [`Ціна: ${item.price} грн; сума: ${(item.price * item.quantity).toFixed(2)} грн`] : []),
  ].join('\n'));
  const total = body.items
    ? `\n\nСума з кошика: ${items.reduce((sum, item) => sum + Math.round(item.price * 100) * item.quantity, 0) / 100} грн`
    : '';
  return `🔥 Нове замовлення\n\nКлієнт: ${customer.firstname} ${customer.lastname}\nКонтакти: ${customer.socialMedia}\n\n${lines.join('\n\n')}${total}`;
};

export const createOrder = async (req, res) => {
  const token = process.env.TG_API_KEY;
  const chatId = process.env.TG_ID;
  if (!token || !chatId) {
    return res.status(503).json({ message: 'Сервіс замовлень не налаштований' });
  }
  const text = formatOrder(req.body);
  // Fail before sending anything: Telegram limits messages to 4096 characters.
  if (text.length > 4096) {
    return res.status(400).json({ message: 'Замовлення завелике. Розділіть його на декілька замовлень.' });
  }
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
      // Plain text safely preserves underscores, brackets and other customer input.
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    const result = await response.json();
    if (!response.ok || result.ok !== true) throw new Error('Telegram delivery failed');
    return res.status(201).json({ message: 'Заказ успешно отправлен' });
  } catch {
    // Do not log the request URL: it contains the bot token.
    console.error('Telegram order delivery failed');
    return res.status(502).json({ message: 'Не удалось отправить заказ в Telegram' });
  }
};
