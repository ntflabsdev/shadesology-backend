'use strict';

const ShippingRateRule = require('../models/ShippingRateRule');
const shippo = require('./carrier/shippo');

function mapValue(map, key) {
  if (map instanceof Map) return map.get(key);
  return map?.[key];
}

function isRestricted(rule, address) {
  const country = (address.country || 'US').toUpperCase();
  const state = (address.state || '').toUpperCase();
  const postalCode = (address.zip || '').toUpperCase();
  return rule.restrictedCountries.includes(country) ||
    rule.restrictedStates.includes(state) ||
    rule.restrictedPostalPrefixes.some((prefix) => postalCode.startsWith(prefix.toUpperCase()));
}

async function getShippingOption({ address, items, subtotal }) {
  const country = (address.country || 'US').toUpperCase();
  const state = (address.state || '').toUpperCase();
  const postalCode = (address.zip || '').toUpperCase();
  const rules = await ShippingRateRule.find({
    isActive: true,
    $or: [{ countries: country }, { countries: { $size: 0 } }],
  }).sort({ createdAt: 1 }).lean();

  const blocked = rules.find((rule) =>
    (!rule.countries.length || rule.countries.includes(country)) && isRestricted(rule, address)
  );
  if (blocked) return { quoteRequired: true, reason: `Delivery to ${state || country} requires a custom freight quote.` };

  const rule = rules.find((candidate) =>
    (!candidate.countries.length || candidate.countries.includes(country)) &&
    (!candidate.states.length || candidate.states.includes(state)) &&
    !candidate.restrictedPostalPrefixes.some((prefix) => postalCode.startsWith(prefix.toUpperCase()))
  );
  if (!rule) return { quoteRequired: true, reason: 'We need to confirm delivery availability and freight pricing for this address.' };

  const productionDays = items.reduce((maximum, item) =>
    Math.max(maximum, Number(item.variant.leadTimeDays) || 0), 0);
  const parcels = [];
  let dimensionalDataAvailable = true;
  let oversized = false;

  for (const item of items) {
    const variant = item.variant;
    const length = Number(variant.shippingLengthIn);
    const width = Number(variant.shippingWidthIn);
    const height = Number(variant.shippingHeightIn);
    const weight = Number(variant.shippingWeightLbs);
    if (![length, width, height, weight].every((value) => Number.isFinite(value) && value > 0)) {
      dimensionalDataAvailable = false;
      continue;
    }
    const count = Math.min(item.quantity, 20);
    for (let index = 0; index < count; index += 1) {
      parcels.push({
        length: String(length), width: String(width), height: String(height),
        distance_unit: 'in', weight: String(weight), mass_unit: 'lb',
      });
    }
    if (item.quantity > 20 || length > 96 || width > 96 || height > 96 || weight > 150) oversized = true;
  }

  const carrierRate = process.env.SHIPPO_API_TOKEN && dimensionalDataAvailable && !oversized
    ? await shippo.getRates({ address, parcels })
    : null;
  const pounds = items.reduce((sum, item) =>
    sum + (Number(item.variant.shippingWeightLbs) || 0) * item.quantity, 0);
  const freightClasses = items.map((item) => item.variant.freightClass).filter(Number.isFinite);
  const classMultiplier = freightClasses.reduce((max, freightClass) => {
    const configured = Number(mapValue(rule.freightClassMultipliers, String(freightClass)) ?? 1);
    return Math.max(max, Number.isFinite(configured) && configured >= 0 ? configured : 1);
  }, 1);
  const freeShipping = rule.freeShippingThreshold !== null && subtotal >= rule.freeShippingThreshold;
  const baseCost = carrierRate?.cost ?? (freeShipping ? 0 : (
    rule.baseRate + Math.round(pounds * rule.perPoundRate * classMultiplier)
  ));

  const requiresCrating = items.some((item) => item.variant.requiresCrating);
  const specialHandling = items.flatMap((item) => item.variant.specialHandlingCharges || []);
  const charges = [];
  if (requiresCrating && rule.cratingCharge > 0) {
    charges.push({ label: 'Crating', amount: rule.cratingCharge });
  }
  for (const charge of specialHandling) {
    charges.push({
      label: charge.label,
      amount: Math.round(Number(charge.amount) * 100) / 100,
    });
  }
  if (rule.specialHandlingCharge > 0 && specialHandling.length === 0) {
    charges.push({ label: 'Special handling', amount: rule.specialHandlingCharge });
  }

  const cost = baseCost + charges.reduce((sum, charge) => sum + charge.amount, 0);
  if (!Number.isFinite(cost) || Math.round(cost * 100) !== cost * 100 || cost < 0) {
    throw new Error('Configured shipping rates produced an invalid amount.');
  }
  const transitDays = carrierRate?.transitDays ?? rule.transitDays;
  const estimatedDeliveryDate = new Date();
  estimatedDeliveryDate.setDate(estimatedDeliveryDate.getDate() + productionDays + transitDays);

  return {
    quoteRequired: false,
    rateRuleId: rule._id,
    carrierRateId: carrierRate?.rateId || null,
    carrierName: carrierRate?.carrierName || 'Shadesology freight table',
    label: carrierRate?.label || rule.name,
    cost,
    charges,
    productionDays,
    transitDays,
    estimatedDeliveryDate,
  };
}

async function getDeliveryEstimate({ address, items }) {
  const rules = await ShippingRateRule.find({ isActive: true }).sort({ createdAt: 1 }).lean();
  const country = (address.country || 'US').toUpperCase();
  const state = (address.state || '').toUpperCase();
  const blocked = rules.find((candidate) =>
    (!candidate.countries.length || candidate.countries.includes(country)) &&
    isRestricted(candidate, address)
  );
  if (blocked) return { available: false, quoteRequired: true };
  const rule = rules.find((candidate) =>
    (!candidate.countries.length || candidate.countries.includes(country)) &&
    (!candidate.states.length || candidate.states.includes(state)) &&
    !isRestricted(candidate, address)
  );
  if (!rule) return { available: false, quoteRequired: true };
  const productionDays = items.reduce((maximum, item) => Math.max(maximum, Number(item.variant.leadTimeDays) || 0), 0);
  return { available: true, productionDays, transitDays: rule.transitDays, totalDays: productionDays + rule.transitDays };
}

module.exports = { getShippingOption, getDeliveryEstimate };
