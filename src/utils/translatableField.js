const mongoose = require('mongoose');

/**
 * Creates a Mongoose schema type for a translatable string field.
 * Stores { en: 'English text', es: 'Spanish text', ... }
 * Falls back to English if the requested locale is missing.
 *
 * Usage in a schema:
 *   name: translatableField({ required: true })
 *   description: translatableField()
 */
const translatableField = (options = {}) => {
  const field = {
    type: new mongoose.Schema(
      {
        en: { type: String, default: '' },
        es: { type: String, default: '' },
        de: { type: String, default: '' },
        fr: { type: String, default: '' },
        it: { type: String, default: '' },
        pt: { type: String, default: '' },
      },
      { _id: false }
    ),
    default: () => ({ en: '', es: '', de: '', fr: '', it: '', pt: '' }),
  };

  if (options.required) {
    field.validate = {
      validator: function (v) {
        return v && v.en && v.en.trim().length > 0;
      },
      message: 'English (en) translation is required.',
    };
  }

  return field;
};

/**
 * Helper to get a translated value from a translatable field object.
 * Falls back to English if the locale is missing.
 *
 * @param {Object} field  - The translatable field object e.g. { en: 'Awning', es: 'Toldo' }
 * @param {string} locale - Locale code e.g. 'es'
 * @returns {string}
 */
const getTranslation = (field, locale = 'en') => {
  if (!field) {
    return '';
  }
  return field[locale] || field.en || '';
};

module.exports = { translatableField, getTranslation };
