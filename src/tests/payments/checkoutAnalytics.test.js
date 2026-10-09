'use strict';

const { after, test } = require('node:test');
const assert = require('node:assert/strict');

const Order = require('../../models/Order');
const stripe = require('../../services/payments/stripe');
const originalFindById = Order.findById;
const originalRetrieveCheckoutSession = stripe.retrieveCheckoutSession;
const { getCheckoutSessionStatus } = require('../../controllers/paymentController');

after(() => {
  Order.findById = originalFindById;
  stripe.retrieveCheckoutSession = originalRetrieveCheckoutSession;
});

test('paid checkout status returns product-level analytics data without customer information', async () => {
  let selectedFields = '';
  stripe.retrieveCheckoutSession = async () => ({
    payment_status: 'paid',
    metadata: { orderId: 'order-id' },
  });
  Order.findById = () => ({
    select(fields) {
      selectedFields = fields;
      return {
        lean: async () => ({
          orderNumber: 'SH-ANALYTICS-1',
          total: 1299,
          currency: 'USD',
          paymentStatus: 'paid',
          balanceDue: 0,
          tax: 99,
          shippingCost: 100,
          guestEmail: 'customer@example.test',
          items: [{
            product: 'product-id',
            productName: 'Outdoor Awning',
            variantName: '12 ft',
            sku: 'AWN-12',
            quantity: 1,
            unitPrice: 1100,
          }],
        }),
      };
    },
  });

  let response;
  let error;
  await getCheckoutSessionStatus({ params: { sessionId: 'session-id' } }, {
    json(value) {
      response = value;
      return this;
    },
  }, (cause) => {
    error = cause;
  });

  assert.equal(error, undefined);
  assert.match(selectedFields, /items\.productName/);
  assert(!selectedFields.includes('guestEmail'));
  assert.deepEqual(response.data.items, [{
    productId: 'product-id',
    itemName: 'Outdoor Awning',
    itemVariant: '12 ft',
    itemSku: 'AWN-12',
    quantity: 1,
    price: 1100,
  }]);
  assert.equal(response.data.tax, 99);
  assert.equal(response.data.shipping, 100);
  assert.equal('guestEmail' in response.data, false);
});
