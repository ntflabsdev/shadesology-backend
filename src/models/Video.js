const mongoose = require('mongoose');
const { translatableField } = require('../utils/translatableField');

const supportedVideoHosts = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
  'wistia.com',
  'www.wistia.com',
  'fast.wistia.net',
]);

const videoSchema = new mongoose.Schema(
  {
    videoUrl: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      validate: {
        validator(value) {
          try {
            const url = new URL(value);
            if (url.protocol !== 'https:' || url.username || url.password ||
              !supportedVideoHosts.has(url.hostname.toLowerCase())) {return false;}
            const parts = url.pathname.split('/').filter(Boolean);
            const host = url.hostname.toLowerCase();
            const videoId = host === 'youtu.be'
              ? parts[0]
              : host.includes('youtube')
                ? url.searchParams.get('v') || parts[parts.length - 1]
                : parts[parts.length - 1];
            return Boolean(videoId && /^[\w-]{6,}$/.test(videoId));
          } catch {
            return false;
          }
        },
        message: 'Use an HTTPS YouTube, Vimeo, or Wistia video URL.',
      },
    },
    title: translatableField(),
    description: translatableField(),
    category: {
      type: String,
      enum: ['installation', 'demo', 'walkthrough', 'fly-through', 'testimonial', 'factory-tour', 'maintenance'],
      default: 'demo',
    },
    thumbnail: {
      url: { type: String, default: '' },
      alt: translatableField(),
    },
    products: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Product' }],
    chapters: [{
      title: { type: String, required: true, trim: true },
      seconds: { type: Number, required: true, min: 0 },
      _id: false,
    }],
    transcript: translatableField(),
    captionsUrl: {
      type: String,
      default: '',
      validate: {
        validator(value) {
          if (!value) {return true;}
          try {
            return new URL(value).protocol === 'https:';
          } catch {
            return false;
          }
        },
        message: 'Captions URL must use HTTPS.',
      },
    },
    isActive: { type: Boolean, default: true },
    status: { type: String, enum: ['draft', 'published'], default: 'draft' },
    sortOrder: { type: Number, default: 0 },
    metaTitle: translatableField(),
    metaDescription: translatableField(),
  },
  { timestamps: true }
);

videoSchema.index({ status: 1, category: 1, sortOrder: 1 });

module.exports = mongoose.model('Video', videoSchema);
