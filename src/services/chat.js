'use strict';

function getBusinessHoursStatus(now = new Date()) {
  const timeZone = process.env.CHAT_BUSINESS_TIMEZONE || 'America/New_York';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(values.weekday);
  const minutes = Number(values.hour) * 60 + Number(values.minute);
  const weekdays = day >= 1 && day <= 5;
  const saturday = day === 6;
  const online = (weekdays && minutes >= 8 * 60 && minutes < 18 * 60) ||
    (saturday && minutes >= 9 * 60 && minutes < 14 * 60);
  return {
    online,
    provider: (process.env.CHAT_PROVIDER || 'offline').toLowerCase(),
    routing: online ? 'business_hours' : 'offline_message',
    timeZone,
    message: online
      ? 'Our support team is available during business hours. Send a message and we will follow up.'
      : 'Our team is offline. Leave a message and we will follow up.',
  };
}

module.exports = { getBusinessHoursStatus };
