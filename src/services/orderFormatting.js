'use strict';

function normalizeOrderForResponse(order) {
  if (!order) {
    return order;
  }
  const serialized = typeof order.toObject === 'function' ? order.toObject() : { ...order };
  serialized.items = (serialized.items || []).map((item) => ({
    ...item,
    selectedOptions: item.selectedOptions instanceof Map
      ? Object.fromEntries(item.selectedOptions.entries())
      : item.selectedOptions || {},
  }));
  return serialized;
}

module.exports = { normalizeOrderForResponse };
