'use strict';

async function persistBeforeNotify(persist, notify) {
  const record = await persist();
  try {
    await notify(record);
  } catch (err) {
    console.error('[Lead] Post-persistence notification failed; record remains stored:', err.message);
  }
  return record;
}

module.exports = { persistBeforeNotify };
