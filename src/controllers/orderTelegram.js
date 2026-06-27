export const createOrder = async (req, res) => {
  const {
    firstname,
    lastname,
    socialMedia,
    productTitle,
    productSize,
    productBarcode,
  } = req.body;
  const token = process.env.TG_API_KEY;
  const chatId = process.env.TG_ID;
  if (!token || !chatId) {
    console.error(
      'Критическая ошибка: Переменные Telegram не настроены в бэкенд .env',
    );
    return res.status(500).json({ message: 'Ошибка конфигурации сервера' });
  }
  try {
    const text = `
🔥 *Нове замовлення* 🔥

👤 *Клієнт:*
• Ім'я: ${firstname}
• Прізвище: ${lastname}
• Контакти: ${socialMedia}

👟 *Товар:*
• Назва: ${productTitle}
• Розмір: ${productSize}
• Артикль: \`${productBarcode}\`
    `.trim();
    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: text,
          parse_mode: 'Markdown',
        }),
      },
    );
    if (!response.ok) {
      throw new Error('Telegram API вернул ошибку');
    }
    return res.status(201).json({ message: 'Заказ успешно отправлен' });
  } catch (error) {
    console.error('Ошибка при отправке в Telegram:', error);
    return res
      .status(500)
      .json({ message: 'Не удалось отправить заказ в Telegram' });
  }
};
