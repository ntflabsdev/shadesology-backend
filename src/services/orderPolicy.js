'use strict';

function evaluateCustomerRequest(order, type) {
  if (!['cancellation', 'return'].includes(type)) {
    return { allowed: false, message: 'Request type must be cancellation or return.' };
  }
  const availability = [...new Set((order.items || []).map((item) =>
    item.availability === 'in_stock' ? 'in_stock' : 'made_to_order'
  ))];

  if (type === 'cancellation' && !['pending', 'payment_processing', 'confirmed'].includes(order.status)) {
    return { allowed: false, message: 'Cancellation requests must be submitted before production or shipment begins.', availability };
  }
  if (type === 'return' && order.status !== 'delivered') {
    return { allowed: false, message: 'Return requests can be submitted after delivery.', availability };
  }

  return {
    allowed: true,
    availability,
    policyNotice: type === 'return' && availability.includes('made_to_order')
      ? 'This order includes made-to-order items. Return eligibility is reviewed case by case; this request is not an approval or refund.'
      : 'Your request is pending staff review and does not itself cancel the order or issue a refund.',
  };
}

module.exports = { evaluateCustomerRequest };
