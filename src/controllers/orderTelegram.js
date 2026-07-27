export const createOrder = async (req, res) => {
  const { customer, items } = req.body;

  const { firstname, lastname, socialMedia } = customer;

  const token = process.env.TG_API_KEY;
  const chatId = process.env.TG_ID;

  if (!token || !chatId) {
    return res.status(500).json({
      message: 'Ошибка конфигурации сервера',
    });
  }

  try {
    const products = items
      .map(
        (item, index) => `
${index + 1}. ${item.name}
📏 Розмір: ${item.size}
🔢 Кількість: ${item.quantity}
💰 Ціна: ${item.price} грн
🏷 Артикул: \`${item.barcode}\`
`,
      )
      .join('\n');

    const total = items.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0,
    );

    const text = `
🔥 *Нове замовлення* 🔥

👤 *Клієнт:*
• Ім'я: ${firstname}
• Прізвище: ${lastname}
• Контакти: ${socialMedia}

🛒 *Товари:*

${products}

💵 *Загальна сума:* ${total} грн
`.trim();

    const response = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: 'Markdown',
        }),
      },
    );

    if (!response.ok) {
      throw new Error('Telegram API вернул ошибку');
    }

    return res.status(201).json({
      message: 'Заказ успешно отправлен',
    });
  } catch (error) {
    console.error(error);

    return res.status(500).json({
      message: 'Не удалось отправить заказ',
    });
  }
};
